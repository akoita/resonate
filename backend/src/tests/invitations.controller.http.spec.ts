/**
 * Invitation routes (#2662): who may call them, body validation, and the
 * admin audit record.
 */
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { RolesGuard } from "../modules/auth/roles.guard";
import { AdminInvitationsController } from "../modules/invitations/admin_invitations.controller";
import { InvitationsController } from "../modules/invitations/invitations.controller";
import { InvitationsService } from "../modules/invitations/invitations.service";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { authToken, createControllerTestApp } from "./e2e-helpers";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const service = {
  registrationStatus: jest.fn().mockResolvedValue({ mode: "invite", artistCapReached: false, waitlist: true }),
  check: jest.fn().mockResolvedValue({ status: "valid", role: "listener" }),
  redeemForExistingAccount: jest.fn().mockResolvedValue({ status: "redeemed", role: "artist" }),
  listMine: jest.fn().mockResolvedValue({ eligible: false, allowance: 0, remaining: 0, invitations: [] }),
  createMine: jest.fn(),
  joinWaitlist: jest.fn().mockResolvedValue({ status: "joined" }),
  list: jest.fn().mockResolvedValue({ mode: "invite", foundingArtists: { used: 0, cap: null }, invitations: [] }),
  create: jest.fn().mockResolvedValue({ id: "inv-1", code: "ABCD-EFGH-JKMN", role: "artist" }),
  revoke: jest.fn().mockResolvedValue({ id: "inv-1", state: "revoked" }),
  listWaitlist: jest.fn().mockResolvedValue([]),
  inviteWaitlistEntry: jest.fn().mockResolvedValue({ id: "inv-2", code: "ABCD-EFGH-JKMN" }),
  deleteWaitlistEntry: jest.fn().mockResolvedValue({ deleted: true }),
};

describe("Invitation routes (http)", () => {
  let app: INestApplication;
  const operator = `Bearer ${authToken("op-1", "operator")}`;
  const listener = `Bearer ${authToken("user-1", "listener")}`;

  beforeAll(async () => {
    app = await createControllerTestApp([InvitationsController, AdminInvitationsController], [
      { provide: InvitationsService, useValue: service },
      RolesGuard,
    ]);
  });
  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it("tells anyone the registration mode", async () => {
    await request(app.getHttpServer()).get("/auth/registration").expect(200).expect((res) => {
      expect(res.body.mode).toBe("invite");
    });
  });

  it("checks a code without an account, and validates the body", async () => {
    await request(app.getHttpServer()).post("/auth/invitations/check").send({ code: "ABCD-EFGH-JKMN" }).expect(201);
    await request(app.getHttpServer()).post("/auth/invitations/check").send({ code: 42 }).expect(400);
  });

  it("joins the waiting list signed out, and refuses a body without consent", async () => {
    await request(app.getHttpServer())
      .post("/waitlist")
      .send({ email: "fan@example.com", kind: "listener", consent: true })
      .expect(201);
    expect(service.joinWaitlist).toHaveBeenCalledWith(expect.anything(), undefined);
    await request(app.getHttpServer()).post("/waitlist").send({ email: "fan@example.com", kind: "listener" }).expect(400);
    await request(app.getHttpServer()).post("/waitlist").send({ email: "fan@example.com", kind: "vip", consent: true }).expect(400);
  });

  it("needs an account to redeem a code or see one's own codes", async () => {
    await request(app.getHttpServer()).post("/invitations/redeem").send({ code: "ABCD-EFGH-JKMN" }).expect(401);
    await request(app.getHttpServer()).get("/invitations/mine").expect(401);
    await request(app.getHttpServer())
      .post("/invitations/redeem")
      .set("Authorization", listener)
      .send({ code: "ABCD-EFGH-JKMN" })
      .expect(201);
    expect(service.redeemForExistingAccount).toHaveBeenCalledWith("user-1", "ABCD-EFGH-JKMN");
  });

  it("keeps the operator routes for operators", async () => {
    await request(app.getHttpServer()).get("/admin/invitations").expect(401);
    await request(app.getHttpServer()).get("/admin/invitations").set("Authorization", listener).expect(403);
    await request(app.getHttpServer()).post("/admin/invitations").set("Authorization", listener).send({ role: "artist" }).expect(403);
    await request(app.getHttpServer()).get("/admin/waitlist").set("Authorization", listener).expect(403);
    await request(app.getHttpServer()).delete("/admin/waitlist/w-1").set("Authorization", listener).expect(403);
  });

  it("creates an invitation, validates it, and audits it without the code", async () => {
    await request(app.getHttpServer())
      .post("/admin/invitations")
      .set("Authorization", operator)
      .send({ role: "admin" })
      .expect(400);
    await request(app.getHttpServer())
      .post("/admin/invitations")
      .set("Authorization", operator)
      .send({ role: "artist", maxUses: 2, expiresInDays: 14 })
      .expect(201);
    expect(service.create).toHaveBeenCalledWith("op-1", expect.objectContaining({ role: "artist", maxUses: 2 }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "invitation.created",
      actorUserId: "op-1",
      detail: expect.objectContaining({ invitationId: "inv-1", role: "artist", maxUses: 2, expiresInDays: 14 }),
    }));
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain("ABCD-EFGH-JKMN");
  });

  it("audits revoking, inviting from and deleting from the waiting list", async () => {
    await request(app.getHttpServer()).post("/admin/invitations/inv-1/revoke").set("Authorization", operator).expect(201);
    await request(app.getHttpServer()).post("/admin/waitlist/w-1/invite").set("Authorization", operator).expect(201);
    await request(app.getHttpServer()).delete("/admin/waitlist/w-1").set("Authorization", operator).expect(200);
    const actions = mockAudit.mock.calls.map(([event]) => event.action);
    expect(actions).toEqual(["invitation.revoked", "waitlist.entry_invited", "waitlist.entry_deleted"]);
  });
});
