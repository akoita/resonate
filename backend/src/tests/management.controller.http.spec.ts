import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { RolesGuard } from "../modules/auth/roles.guard";
import { ManagementController } from "../modules/management/management.controller";
import { ManagementService } from "../modules/management/management.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const mockService = {
  getMe: jest.fn().mockResolvedValue({ ownedArtists: [], pendingGrants: [] }),
  getArtistAccess: jest.fn().mockResolvedValue({ resourceId: "artist-1" }),
  getReleaseAccess: jest.fn().mockResolvedValue({ resourceId: "release-1" }),
  createGrant: jest.fn().mockResolvedValue({ id: "grant-1", status: "pending" }),
  updateGrant: jest.fn().mockResolvedValue({ id: "grant-2", status: "active" }),
  acceptGrant: jest.fn().mockResolvedValue({ id: "grant-1", status: "active" }),
  declineGrant: jest.fn().mockResolvedValue({ id: "grant-1", status: "declined" }),
  revokeGrant: jest.fn().mockResolvedValue({ id: "grant-1", status: "revoked" }),
  createTransfer: jest.fn().mockResolvedValue({ id: "transfer-1", status: "pending" }),
  acceptTransfer: jest.fn().mockResolvedValue({ id: "transfer-1", status: "accepted" }),
  declineTransfer: jest.fn().mockResolvedValue({ id: "transfer-1", status: "declined" }),
  cancelTransfer: jest.fn().mockResolvedValue({ id: "transfer-1", status: "cancelled" }),
  createTransferRecoveryRequest: jest.fn().mockResolvedValue({ id: "recovery-1", status: "pending" }),
  getMyTransferRecoveries: jest.fn().mockResolvedValue({ transfers: [] }),
  getPendingTransferRecoveries: jest.fn().mockResolvedValue({ requests: [] }),
  reviewTransferRecoveryRequest: jest.fn().mockResolvedValue({ id: "recovery-1", status: "rejected" }),
};

describe("ManagementController HTTP contract", () => {
  let app: INestApplication;
  const token = authToken("manager-1");

  beforeAll(async () => {
    app = await createControllerTestApp(ManagementController, [
      { provide: ManagementService, useValue: mockService },
      RolesGuard,
    ]);
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it("requires a JWT for management reads and mutations", async () => {
    await request(app.getHttpServer()).get("/management/me").expect(401);
    await request(app.getHttpServer()).get("/management/artists/artist-1/access").expect(401);
    await request(app.getHttpServer()).post("/management/grants").send({}).expect(401);
    await request(app.getHttpServer()).patch("/management/grants/grant-1").send({ scopes: ["CATALOG_READ"] }).expect(401);
    await request(app.getHttpServer()).post("/management/transfers/transfer-1/accept").expect(401);
    await request(app.getHttpServer()).post("/management/transfers/transfer-1/recovery-requests").send({ evidence: "This is valid evidence text." }).expect(401);
    await request(app.getHttpServer()).get("/management/recoveries/me").expect(401);
    await request(app.getHttpServer()).get("/management/recoveries/pending").expect(401);
    await request(app.getHttpServer()).patch("/management/recoveries/recovery-1").send({ decision: "reject", note: "Reviewed." }).expect(401);
  });

  it("uses the authenticated user for grant and transfer requests", async () => {
    const grant = { artistId: "artist-1", recipientEmail: "other@test.resonate", scopes: ["PROFILE_EDIT"] };
    const grantUpdate = { scopes: ["CATALOG_READ"], expiresAt: "2027-01-01T00:00:00.000Z" };
    const transfer = { releaseIds: ["release-1"], recipientEmail: "other@test.resonate" };
    await request(app.getHttpServer()).post("/management/grants")
      .set("Authorization", `Bearer ${token}`).send(grant).expect(201);
    await request(app.getHttpServer()).patch("/management/grants/grant-1")
      .set("Authorization", `Bearer ${token}`).send(grantUpdate).expect(200);
    await request(app.getHttpServer()).post("/management/transfers")
      .set("Authorization", `Bearer ${token}`).send(transfer).expect(201);
    await request(app.getHttpServer()).post("/management/grants/grant-1/accept")
      .set("Authorization", `Bearer ${token}`).expect(201);
    await request(app.getHttpServer()).post("/management/transfers/transfer-1/accept")
      .set("Authorization", `Bearer ${token}`).expect(201);

    expect(mockService.createGrant).toHaveBeenCalledWith("manager-1", grant);
    expect(mockService.updateGrant).toHaveBeenCalledWith("manager-1", "grant-1", grantUpdate);
    expect(mockService.createTransfer).toHaveBeenCalledWith("manager-1", transfer);
    expect(mockService.acceptGrant).toHaveBeenCalledWith("manager-1", "grant-1");
    expect(mockService.acceptTransfer).toHaveBeenCalledWith("manager-1", "transfer-1");
  });

  it("requires a JSON object for grant updates", async () => {
    await request(app.getHttpServer()).patch("/management/grants/grant-1")
      .set("Authorization", `Bearer ${token}`).expect(400);
    await request(app.getHttpServer()).patch("/management/grants/grant-1")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send("null")
      .expect(400);
    await request(app.getHttpServer()).patch("/management/grants/grant-1")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send("5")
      .expect(400);

    expect(mockService.updateGrant).not.toHaveBeenCalled();
  });

  it("uses the authenticated user for recovery requests and the recovery list", async () => {
    const evidence = "I did not authorize this management transfer.";
    await request(app.getHttpServer())
      .post("/management/transfers/transfer-1/recovery-requests")
      .set("Authorization", `Bearer ${token}`)
      .send({ evidence })
      .expect(201);
    await request(app.getHttpServer())
      .get("/management/recoveries/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(mockService.createTransferRecoveryRequest).toHaveBeenCalledWith("manager-1", "transfer-1", evidence);
    expect(mockService.getMyTransferRecoveries).toHaveBeenCalledWith("manager-1");
  });

  it("restricts pending recovery review to operators and admins and forwards note", async () => {
    const review = { decision: "reject", note: "Evidence does not support recovery." };
    await request(app.getHttpServer())
      .get("/management/recoveries/pending")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .patch("/management/recoveries/recovery-1")
      .set("Authorization", `Bearer ${token}`)
      .send(review)
      .expect(403);
    expect(mockService.getPendingTransferRecoveries).not.toHaveBeenCalled();
    expect(mockService.reviewTransferRecoveryRequest).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .get("/management/recoveries/pending")
      .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch("/management/recoveries/recovery-1")
      .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
      .send(review)
      .expect(200);

    expect(mockService.getPendingTransferRecoveries).toHaveBeenCalledWith("operator-1", "operator");
    expect(mockService.reviewTransferRecoveryRequest).toHaveBeenCalledWith(
      "operator-1",
      "operator",
      "recovery-1",
      "reject",
      "Evidence does not support recovery.",
    );
  });
});
