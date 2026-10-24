import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { RolesGuard } from "../modules/auth/roles.guard";
import { AccountStatusService } from "../modules/accounts/account_status.service";
import { AccountController, AdminAccountsController } from "../modules/accounts/accounts.controller";
import { authToken, createControllerTestApp, stepUpProof } from "./e2e-helpers";

const status = {
  userId: "user-2",
  status: "suspended",
  effectiveStatus: "suspended",
  reason: "abuse",
  until: null,
  changedAt: null,
  changedBy: "admin-1",
  walletAddress: null,
  erasureScheduledFor: null,
};
const mockAccounts = {
  getStatus: jest.fn().mockResolvedValue(status),
  suspend: jest.fn().mockResolvedValue(status),
  unsuspend: jest.fn().mockResolvedValue(status),
  close: jest.fn().mockResolvedValue(status),
  getOwnStatus: jest.fn().mockResolvedValue({ status: "active", reason: null, until: null, changedAt: null }),
};

describe("AdminAccountsController (http)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(
      [AdminAccountsController, AccountController],
      [{ provide: AccountStatusService, useValue: mockAccounts }, RolesGuard],
    );
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  const server = () => app.getHttpServer();
  const bearer = (userId: string, role: string) => ({ Authorization: `Bearer ${authToken(userId, role)}` });
  const admin = bearer("admin-1", "admin");
  /** An admin session plus a fresh step-up proof (#2173), for suspend and close. */
  const confirmed = { ...admin, "X-Admin-Step-Up": stepUpProof("admin-1") };

  const adminRoutes: Array<[string, string, Record<string, unknown>]> = [
    ["get", "/admin/accounts/user-2/status", {}],
    ["post", "/admin/accounts/user-2/suspend", { reason: "abuse" }],
    ["post", "/admin/accounts/user-2/unsuspend", {}],
    ["post", "/admin/accounts/user-2/close", { reason: "fraud" }],
  ];

  it.each(adminRoutes)("%s %s requires a JWT (401)", async (method, path, body) => {
    await (request(server()) as any)[method](path).send(body).expect(401);
  });

  it.each(["listener", "artist", "curator", "agent", "operator"])(
    "rejects the %s role on every admin route (403)",
    async (role) => {
      for (const [method, path, body] of adminRoutes) {
        await (request(server()) as any)[method](path).set(bearer("u-1", role)).send(body).expect(403);
      }
      expect(mockAccounts.suspend).not.toHaveBeenCalled();
      expect(mockAccounts.unsuspend).not.toHaveBeenCalled();
      expect(mockAccounts.close).not.toHaveBeenCalled();
      expect(mockAccounts.getStatus).not.toHaveBeenCalled();
    },
  );

  it("passes the acting admin and the body to the service", async () => {
    await request(server())
      .post("/admin/accounts/user-2/suspend")
      .set(confirmed)
      .send({ reason: "abuse", until: "2999-01-01T00:00:00.000Z", note: "n" })
      .expect(200);
    expect(mockAccounts.suspend).toHaveBeenCalledWith(
      { userId: "admin-1", role: "admin" },
      "user-2",
      expect.objectContaining({ reason: "abuse", note: "n" }),
    );
    await request(server()).post("/admin/accounts/user-2/unsuspend").set(admin).send({}).expect(200);
    await request(server())
      .post("/admin/accounts/user-2/close")
      .set(confirmed)
      .send({ reason: "fraud", scheduleErasure: true })
      .expect(200);
    expect(mockAccounts.close).toHaveBeenCalledWith(
      { userId: "admin-1", role: "admin" },
      "user-2",
      expect.objectContaining({ scheduleErasure: true }),
    );
    await request(server()).get("/admin/accounts/user-2/status").set(admin).expect(200);
  });

  describe("step-up confirmation (#2173)", () => {
    const protectedRoutes: Array<[string, Record<string, unknown>]> = [
      ["/admin/accounts/user-2/suspend", { reason: "abuse" }],
      ["/admin/accounts/user-2/close", { reason: "fraud" }],
    ];
    const staleProof = () => stepUpProof("admin-1", Date.now() - 6 * 60 * 1000);

    it.each(protectedRoutes)("%s refuses an admin without a proof (403 step_up_required)", async (path, body) => {
      const res = await request(server()).post(path).set(admin).send(body).expect(403);
      expect(res.body.code).toBe("step_up_required");
      expect(mockAccounts.suspend).not.toHaveBeenCalled();
      expect(mockAccounts.close).not.toHaveBeenCalled();
    });

    it.each(protectedRoutes)("%s refuses a stale proof (403 step_up_expired)", async (path, body) => {
      const res = await request(server())
        .post(path)
        .set({ ...admin, "X-Admin-Step-Up": staleProof() })
        .send(body)
        .expect(403);
      expect(res.body.code).toBe("step_up_expired");
    });

    it.each(protectedRoutes)("%s refuses a proof earned by someone else (403 step_up_invalid)", async (path, body) => {
      const res = await request(server())
        .post(path)
        .set({ ...admin, "X-Admin-Step-Up": stepUpProof("admin-2") })
        .send(body)
        .expect(403);
      expect(res.body.code).toBe("step_up_invalid");
    });

    it.each(protectedRoutes)("%s refuses a garbage or session-token proof (403 step_up_invalid)", async (path, body) => {
      for (const proof of ["not-a-proof", authToken("admin-1", "admin")]) {
        const res = await request(server())
          .post(path)
          .set({ ...admin, "X-Admin-Step-Up": proof })
          .send(body)
          .expect(403);
        expect(res.body.code).toBe("step_up_invalid");
      }
    });

    it.each(protectedRoutes)("%s accepts a fresh proof", async (path, body) => {
      await request(server()).post(path).set(confirmed).send(body).expect(200);
    });

    it("does not ask for a proof to lift a suspension or to read a status", async () => {
      await request(server()).post("/admin/accounts/user-2/unsuspend").set(admin).send({}).expect(200);
      await request(server()).get("/admin/accounts/user-2/status").set(admin).expect(200);
    });

    it("answers a non-admin 403 without revealing anything about the proof", async () => {
      const res = await request(server())
        .post("/admin/accounts/user-2/suspend")
        .set({ ...bearer("u-1", "listener"), "X-Admin-Step-Up": stepUpProof("u-1") })
        .send({ reason: "abuse" })
        .expect(403);
      expect(res.body.code).toBeUndefined();
    });
  });

  describe("validation (400)", () => {
    it("rejects an unknown or missing reason", async () => {
      await request(server()).post("/admin/accounts/user-2/suspend").set(confirmed).send({}).expect(400);
      await request(server()).post("/admin/accounts/user-2/suspend").set(confirmed).send({ reason: "because" }).expect(400);
      await request(server()).post("/admin/accounts/user-2/close").set(confirmed).send({ reason: 5 }).expect(400);
    });

    it("rejects a non-ISO end date", async () => {
      await request(server())
        .post("/admin/accounts/user-2/suspend")
        .set(confirmed)
        .send({ reason: "abuse", until: "next week" })
        .expect(400);
    });

    it("rejects an over-long note and a non-boolean scheduleErasure", async () => {
      await request(server())
        .post("/admin/accounts/user-2/suspend")
        .set(confirmed)
        .send({ reason: "abuse", note: "x".repeat(1001) })
        .expect(400);
      await request(server())
        .post("/admin/accounts/user-2/close")
        .set(confirmed)
        .send({ reason: "fraud", scheduleErasure: "yes" })
        .expect(400);
      expect(mockAccounts.suspend).not.toHaveBeenCalled();
      expect(mockAccounts.close).not.toHaveBeenCalled();
    });
  });

  describe("GET /account/status", () => {
    it("requires a JWT and returns only the caller's own state", async () => {
      await request(server()).get("/account/status").expect(401);
      await request(server()).get("/account/status").set(bearer("user-9", "listener")).expect(200);
      expect(mockAccounts.getOwnStatus).toHaveBeenCalledWith("user-9");
    });
  });
});
