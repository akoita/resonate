import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { RolesGuard } from "../modules/auth/roles.guard";
import { NoticeController } from "../modules/notifications/notice.controller";
import { NoticeService } from "../modules/notifications/notice.service";
import { authToken, createControllerTestApp, stepUpProof } from "./e2e-helpers";

const mockNoticeService = {
  listForUser: jest.fn().mockResolvedValue({ notices: [], unreadCount: 0 }),
  markRead: jest.fn().mockResolvedValue({ id: "n-1", readAt: "2026-10-15T00:00:00.000Z" }),
  listSentBroadcasts: jest.fn().mockResolvedValue({ notices: [] }),
  sendBroadcast: jest.fn().mockResolvedValue({ id: "n-1" }),
  sendTargeted: jest.fn().mockResolvedValue({ recipientCount: 1, created: 1 }),
};

const BROADCAST = { audience: "all", category: "policy", title: "Policy update", body: "We changed the policy." };
const TARGETED = { userIds: ["user-2"], category: "account", title: "Your account", body: "Details." };

describe("NoticeController (http)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(NoticeController, [
      { provide: NoticeService, useValue: mockNoticeService },
      RolesGuard,
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const server = () => app.getHttpServer();
  const bearer = (userId: string, role: string) => ({ Authorization: `Bearer ${authToken(userId, role)}` });
  /** A session plus a fresh step-up proof (#2173): what a broadcast needs. */
  const confirmed = (userId: string, role: string) => ({
    ...bearer(userId, role),
    "X-Admin-Step-Up": stepUpProof(userId),
  });

  describe("user routes", () => {
    it("require a JWT", async () => {
      await request(server()).get("/notices").expect(401);
      await request(server()).post("/notices/n-1/read").expect(401);
    });

    it("list the caller's notices with their own id and role", async () => {
      await request(server()).get("/notices").set(bearer("listener-1", "listener")).expect(200);
      expect(mockNoticeService.listForUser).toHaveBeenCalledWith("listener-1", "listener");
    });

    it("mark a notice read for the caller only", async () => {
      await request(server()).post("/notices/n-1/read").set(bearer("listener-1", "listener")).expect(200);
      expect(mockNoticeService.markRead).toHaveBeenCalledWith("listener-1", "listener", "n-1");
    });
  });

  describe("broadcast step-up (#2173)", () => {
    it("refuses a broadcast without a proof (403 step_up_required)", async () => {
      const res = await request(server()).post("/notices/broadcast").set(bearer("op-1", "admin")).send(BROADCAST).expect(403);
      expect(res.body.code).toBe("step_up_required");
      expect(mockNoticeService.sendBroadcast).not.toHaveBeenCalled();
    });

    it("refuses a stale proof (403 step_up_expired)", async () => {
      const stale = stepUpProof("op-1", Date.now() - 6 * 60 * 1000);
      const res = await request(server())
        .post("/notices/broadcast")
        .set({ ...bearer("op-1", "admin"), "X-Admin-Step-Up": stale })
        .send(BROADCAST)
        .expect(403);
      expect(res.body.code).toBe("step_up_expired");
      expect(mockNoticeService.sendBroadcast).not.toHaveBeenCalled();
    });

    it("refuses another person's proof (403 step_up_invalid)", async () => {
      const res = await request(server())
        .post("/notices/broadcast")
        .set({ ...bearer("op-1", "admin"), "X-Admin-Step-Up": stepUpProof("op-2") })
        .send(BROADCAST)
        .expect(403);
      expect(res.body.code).toBe("step_up_invalid");
    });

    it("does not ask for a proof to send a targeted notice or read the sent list", async () => {
      await request(server()).post("/notices/targeted").set(bearer("op-1", "admin")).send(TARGETED).expect(201);
      await request(server()).get("/notices/sent").set(bearer("op-1", "admin")).expect(200);
    });
  });

  describe("send routes", () => {
    it("reject unauthenticated callers with 401", async () => {
      await request(server()).post("/notices/broadcast").send(BROADCAST).expect(401);
      await request(server()).post("/notices/targeted").send(TARGETED).expect(401);
      await request(server()).get("/notices/sent").expect(401);
    });

    it.each(["listener", "artist", "curator", "agent"])("reject the %s role with 403", async (role) => {
      await request(server()).post("/notices/broadcast").set(bearer("u-1", role)).send(BROADCAST).expect(403);
      await request(server()).post("/notices/targeted").set(bearer("u-1", role)).send(TARGETED).expect(403);
      await request(server()).get("/notices/sent").set(bearer("u-1", role)).expect(403);
      expect(mockNoticeService.sendBroadcast).not.toHaveBeenCalled();
      expect(mockNoticeService.sendTargeted).not.toHaveBeenCalled();
    });

    it.each(["operator", "admin"])("accept the %s role", async (role) => {
      await request(server()).post("/notices/broadcast").set(confirmed("op-1", role)).send(BROADCAST).expect(201);
      expect(mockNoticeService.sendBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({ audience: "all", category: "policy", title: "Policy update" }),
        { userId: "op-1", role },
      );
      await request(server()).post("/notices/targeted").set(bearer("op-1", role)).send(TARGETED).expect(201);
      expect(mockNoticeService.sendTargeted).toHaveBeenCalledWith(
        expect.objectContaining({ userIds: ["user-2"], category: "account" }),
        { userId: "op-1", role },
      );
      await request(server()).get("/notices/sent").set(bearer("op-1", role)).expect(200);
    });

    it.each([
      ["an unknown category", { ...BROADCAST, category: "marketing" }],
      ["a malformed audience", { ...BROADCAST, audience: "everyone" }],
      ["an unknown role audience", { ...BROADCAST, audience: "role:superuser" }],
      ["an empty title", { ...BROADCAST, title: "  " }],
      ["an over-long title", { ...BROADCAST, title: "x".repeat(121) }],
      ["an over-long body", { ...BROADCAST, body: "x".repeat(2001) }],
      ["an off-site link", { ...BROADCAST, link: "https://evil.example" }],
      ["an invalid effective date", { ...BROADCAST, effectiveAt: "not-a-date" }],
      ["an expiry in the past", { ...BROADCAST, expiresAt: "2000-01-01T00:00:00.000Z" }],
    ])("reject a broadcast with %s (400)", async (_label, body) => {
      await request(server()).post("/notices/broadcast").set(confirmed("op-1", "operator")).send(body).expect(400);
      expect(mockNoticeService.sendBroadcast).not.toHaveBeenCalled();
    });

    it.each([
      ["no recipients", { ...TARGETED, userIds: [] }],
      ["a non-array recipient list", { ...TARGETED, userIds: "user-2" }],
      ["a blank recipient id", { ...TARGETED, userIds: [""] }],
      ["more than 1000 recipients", { ...TARGETED, userIds: Array.from({ length: 1001 }, (_, i) => `u-${i}`) }],
      ["an unknown category", { ...TARGETED, category: "promo" }],
      ["a missing body", { ...TARGETED, body: undefined }],
    ])("reject a targeted send with %s (400)", async (_label, body) => {
      await request(server()).post("/notices/targeted").set(bearer("op-1", "admin")).send(body).expect(400);
      expect(mockNoticeService.sendTargeted).not.toHaveBeenCalled();
    });

    it.each([
      ["a numeric title", { ...BROADCAST, title: 5 }],
      ["an array category", { ...BROADCAST, category: ["policy"] }],
      ["an object audience", { ...BROADCAST, audience: { role: "all" } }],
      ["a numeric body", { ...BROADCAST, body: 5 }],
      ["a numeric link", { ...BROADCAST, link: 5 }],
      ["a numeric expiry", { ...BROADCAST, expiresAt: 4102444800000 }],
    ])("class DTO: rejects a broadcast with %s before the parser (#2362)", async (_label, body) => {
      const res = await request(server()).post("/notices/broadcast").set(confirmed("op-1", "operator")).send(body).expect(400);
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(mockNoticeService.sendBroadcast).not.toHaveBeenCalled();
    });

    it.each([
      ["an object recipient list", { ...TARGETED, userIds: { 0: "u" } }],
      ["a numeric title", { ...TARGETED, title: 5 }],
      ["a boolean category", { ...TARGETED, category: true }],
      ["a numeric link", { ...TARGETED, link: 5 }],
    ])("class DTO: rejects a targeted send with %s before the parser (#2362)", async (_label, body) => {
      const res = await request(server()).post("/notices/targeted").set(bearer("op-1", "admin")).send(body).expect(400);
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(mockNoticeService.sendTargeted).not.toHaveBeenCalled();
    });

    it("class DTO: still hands a valid body to the parser and the service unchanged", async () => {
      await request(server())
        .post("/notices/broadcast")
        .set(confirmed("op-1", "operator"))
        .send({ ...BROADCAST, link: null, effectiveAt: null, expiresAt: "2999-01-01T00:00:00.000Z" })
        .expect(201);
      expect(mockNoticeService.sendBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({ audience: "all", link: null }),
        { userId: "op-1", role: "operator" },
      );
    });
  });
});
