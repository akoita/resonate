/**
 * Admin Pro grants (#2406) — HTTP contract: JWT, admin role, step-up on create
 * and revoke, audit with ids and codes only (never the admin's note), and DTO
 * validation. The service is mocked; Postgres is entitlements.integration.spec.ts.
 */
import request from "supertest";
import { ConflictException, INestApplication, NotFoundException } from "@nestjs/common";
import { AdminEntitlementGrantsController } from "../modules/entitlements/admin_entitlement_grants.controller";
import { EntitlementGrantsService } from "../modules/entitlements/entitlement_grants.service";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { authToken, confirmedBearer as confirmed, createControllerTestApp, expectStepUpRequired } from "./e2e-helpers";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const NOTE = "Founding artist, agreed on the call";
const GRANT = {
  id: "grant-1",
  userId: "user-2",
  plan: "pro",
  source: "operator_grant",
  validFrom: "2026-10-25T00:00:00.000Z",
  validUntil: "2026-12-31T23:59:59.000Z",
  reason: NOTE,
  createdByUserId: "admin-1",
  createdAt: "2026-10-25T00:00:00.000Z",
  revokedAt: null,
  revokedByUserId: null,
  status: "active",
};

const mockGrants = {
  listForUser: jest.fn().mockResolvedValue([GRANT]),
  create: jest.fn().mockResolvedValue(GRANT),
  revoke: jest.fn().mockResolvedValue({ ...GRANT, revokedAt: "2026-10-26T00:00:00.000Z", revokedByUserId: "admin-1", status: "revoked" }),
};

describe("AdminEntitlementGrantsController (http, #2406)", () => {
  let app: INestApplication;
  const base = "/admin/entitlements/grants";
  const body = { userId: "user-2", validUntil: "2026-12-31T23:59:59.000Z", reason: NOTE };

  beforeAll(async () => {
    app = await createControllerTestApp(AdminEntitlementGrantsController, [
      { provide: EntitlementGrantsService, useValue: mockGrants },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe("GET /admin/entitlements/grants", () => {
    it("requires a JWT", async () => {
      await request(app.getHttpServer()).get(`${base}?userId=user-2`).expect(401);
    });

    it.each(["listener", "artist", "operator"])("rejects a %s with 403", async (role) => {
      await request(app.getHttpServer())
        .get(`${base}?userId=user-2`)
        .set("Authorization", `Bearer ${authToken("user-1", role)}`)
        .expect(403);
      expect(mockGrants.listForUser).not.toHaveBeenCalled();
    });

    it("lists a person's grants for an admin, without a step-up", async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}?userId=user-2`)
        .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
        .expect(200);
      expect(res.body).toEqual([GRANT]);
      expect(mockGrants.listForUser).toHaveBeenCalledWith("user-2");
    });

    it("answers 400 without a userId", async () => {
      await request(app.getHttpServer())
        .get(base)
        .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
        .expect(400);
      expect(mockGrants.listForUser).not.toHaveBeenCalled();
    });
  });

  describe("POST /admin/entitlements/grants", () => {
    it("requires a JWT", async () => {
      await request(app.getHttpServer()).post(base).send(body).expect(401);
    });

    it.each(["listener", "artist", "operator"])("rejects a %s with 403", async (role) => {
      await request(app.getHttpServer()).post(base).set(confirmed("user-1", role)).send(body).expect(403);
      expect(mockGrants.create).not.toHaveBeenCalled();
    });

    it("needs a fresh step-up proof", async () => {
      await expectStepUpRequired(app, "post", base, { userId: "admin-1", role: "admin" }, body);
      expect(mockGrants.create).not.toHaveBeenCalled();
      expect(mockAudit).not.toHaveBeenCalled();
    });

    it("creates the grant as the admin and audits ids and codes, never the note", async () => {
      const res = await request(app.getHttpServer()).post(base).set(confirmed("admin-1", "admin")).send(body).expect(201);
      expect(res.body).toEqual(GRANT);
      expect(mockGrants.create).toHaveBeenCalledWith("admin-1", body);
      expect(mockAudit).toHaveBeenCalledTimes(1);
      const [event] = mockAudit.mock.calls[0];
      expect(event).toEqual({
        actorUserId: "admin-1",
        action: "entitlement_grant.created",
        targetUserId: "user-2",
        detail: { grantId: "grant-1", plan: "pro", source: "operator_grant", validUntil: "2026-12-31T23:59:59.000Z" },
      });
      expect(JSON.stringify(event)).not.toContain("Founding");
    });

    it("accepts an open-ended promo grant", async () => {
      const open = { userId: "user-2", source: "promo", validUntil: null, reason: NOTE };
      await request(app.getHttpServer()).post(base).set(confirmed("admin-1", "admin")).send(open).expect(201);
      expect(mockGrants.create).toHaveBeenCalledWith("admin-1", open);
    });

    it.each([
      ["a missing userId", { validUntil: body.validUntil, reason: NOTE }],
      ["an empty userId", { ...body, userId: "" }],
      ["a missing reason", { userId: "user-2", validUntil: body.validUntil }],
      ["an empty reason", { ...body, reason: "" }],
      ["a reason over 500 characters", { ...body, reason: "n".repeat(501) }],
      ["an unknown plan", { ...body, plan: "enterprise" }],
      ["an unknown source", { ...body, source: "stripe_subscription" }],
      ["a validUntil that is not a date", { ...body, validUntil: "next year" }],
      ["a numeric validUntil", { ...body, validUntil: 1767225599000 }],
      ["a validFrom that is not a date", { ...body, validFrom: "soon" }],
    ])("rejects %s with 400", async (_label, invalid) => {
      await request(app.getHttpServer()).post(base).set(confirmed("admin-1", "admin")).send(invalid).expect(400);
      expect(mockGrants.create).not.toHaveBeenCalled();
      expect(mockAudit).not.toHaveBeenCalled();
    });

    it("passes a 404 through and records nothing", async () => {
      mockGrants.create.mockRejectedValueOnce(new NotFoundException({ code: "user_not_found" }));
      const res = await request(app.getHttpServer()).post(base).set(confirmed("admin-1", "admin")).send(body).expect(404);
      expect(res.body.code).toBe("user_not_found");
      expect(mockAudit).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /admin/entitlements/grants/:id", () => {
    it("requires a JWT", async () => {
      await request(app.getHttpServer()).delete(`${base}/grant-1`).expect(401);
    });

    it.each(["listener", "operator"])("rejects a %s with 403", async (role) => {
      await request(app.getHttpServer()).delete(`${base}/grant-1`).set(confirmed("user-1", role)).expect(403);
      expect(mockGrants.revoke).not.toHaveBeenCalled();
    });

    it("needs a fresh step-up proof", async () => {
      await expectStepUpRequired(app, "delete", `${base}/grant-1`, { userId: "admin-1", role: "admin" });
      expect(mockGrants.revoke).not.toHaveBeenCalled();
    });

    it("revokes as the admin and audits the grant id", async () => {
      const res = await request(app.getHttpServer()).delete(`${base}/grant-1`).set(confirmed("admin-1", "admin")).expect(200);
      expect(res.body.status).toBe("revoked");
      expect(mockGrants.revoke).toHaveBeenCalledWith("admin-1", "grant-1");
      expect(mockAudit).toHaveBeenCalledWith({
        actorUserId: "admin-1",
        action: "entitlement_grant.revoked",
        targetUserId: "user-2",
        detail: { grantId: "grant-1", plan: "pro" },
      });
      expect(JSON.stringify(mockAudit.mock.calls)).not.toContain("Founding");
    });

    it("answers 409 for an already revoked grant and records nothing", async () => {
      mockGrants.revoke.mockRejectedValueOnce(new ConflictException({ code: "already_revoked" }));
      const res = await request(app.getHttpServer()).delete(`${base}/grant-1`).set(confirmed("admin-1", "admin")).expect(409);
      expect(res.body.code).toBe("already_revoked");
      expect(mockAudit).not.toHaveBeenCalled();
    });
  });
});
