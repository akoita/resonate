import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { ManagementController } from "../modules/management/management.controller";
import { ManagementService } from "../modules/management/management.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const mockService = {
  getMe: jest.fn().mockResolvedValue({ ownedArtists: [], pendingGrants: [] }),
  getArtistAccess: jest.fn().mockResolvedValue({ resourceId: "artist-1" }),
  getReleaseAccess: jest.fn().mockResolvedValue({ resourceId: "release-1" }),
  createGrant: jest.fn().mockResolvedValue({ id: "grant-1", status: "pending" }),
  acceptGrant: jest.fn().mockResolvedValue({ id: "grant-1", status: "active" }),
  declineGrant: jest.fn().mockResolvedValue({ id: "grant-1", status: "declined" }),
  revokeGrant: jest.fn().mockResolvedValue({ id: "grant-1", status: "revoked" }),
  createTransfer: jest.fn().mockResolvedValue({ id: "transfer-1", status: "pending" }),
  acceptTransfer: jest.fn().mockResolvedValue({ id: "transfer-1", status: "accepted" }),
  declineTransfer: jest.fn().mockResolvedValue({ id: "transfer-1", status: "declined" }),
  cancelTransfer: jest.fn().mockResolvedValue({ id: "transfer-1", status: "cancelled" }),
};

describe("ManagementController HTTP contract", () => {
  let app: INestApplication;
  const token = authToken("manager-1");

  beforeAll(async () => {
    app = await createControllerTestApp(ManagementController, [
      { provide: ManagementService, useValue: mockService },
    ]);
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { jest.clearAllMocks(); });

  it("requires a JWT for management reads and mutations", async () => {
    await request(app.getHttpServer()).get("/management/me").expect(401);
    await request(app.getHttpServer()).get("/management/artists/artist-1/access").expect(401);
    await request(app.getHttpServer()).post("/management/grants").send({}).expect(401);
    await request(app.getHttpServer()).post("/management/transfers/transfer-1/accept").expect(401);
  });

  it("uses the authenticated user for grant and transfer requests", async () => {
    const grant = { artistId: "artist-1", recipientEmail: "other@test.resonate", scopes: ["PROFILE_EDIT"] };
    const transfer = { releaseIds: ["release-1"], recipientEmail: "other@test.resonate" };
    await request(app.getHttpServer()).post("/management/grants")
      .set("Authorization", `Bearer ${token}`).send(grant).expect(201);
    await request(app.getHttpServer()).post("/management/transfers")
      .set("Authorization", `Bearer ${token}`).send(transfer).expect(201);
    await request(app.getHttpServer()).post("/management/grants/grant-1/accept")
      .set("Authorization", `Bearer ${token}`).expect(201);
    await request(app.getHttpServer()).post("/management/transfers/transfer-1/accept")
      .set("Authorization", `Bearer ${token}`).expect(201);

    expect(mockService.createGrant).toHaveBeenCalledWith("manager-1", grant);
    expect(mockService.createTransfer).toHaveBeenCalledWith("manager-1", transfer);
    expect(mockService.acceptGrant).toHaveBeenCalledWith("manager-1", "grant-1");
    expect(mockService.acceptTransfer).toHaveBeenCalledWith("manager-1", "transfer-1");
  });
});
