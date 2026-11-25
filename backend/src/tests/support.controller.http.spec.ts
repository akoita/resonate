/**
 * SupportController — HTTP contract (#2667)
 *
 * Sending a request is public (a valid session links it to the person);
 * the queue and status changes are admin/operator only and audited. The
 * service is mocked; no database (see support.integration.spec.ts).
 */

import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { SupportController } from "../modules/support/support.controller";
import { SupportService } from "../modules/support/support.service";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { authToken, createControllerTestApp } from "./e2e-helpers";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const mockSupport = { create: jest.fn(), list: jest.fn(), setStatus: jest.fn() };

describe("SupportController (http)", () => {
  let app: INestApplication;
  const listener = authToken("listener-1", "listener");
  const artist = authToken("artist-1", "artist");
  const operator = authToken("operator-1", "operator");
  const admin = authToken("admin-1", "admin");

  beforeAll(async () => {
    app = await createControllerTestApp(SupportController, [{ provide: SupportService, useValue: mockSupport }]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupport.create.mockResolvedValue({ id: "req-1", status: "new", createdAt: new Date().toISOString(), receiptSent: false });
    mockSupport.list.mockResolvedValue({ requests: [], counts: { new: 0, answered: 0, closed: 0 } });
    mockSupport.setStatus.mockResolvedValue({ id: "req-1", status: "answered" });
  });

  describe("POST /support/requests (public)", () => {
    const body = { topic: "account", message: "I cannot find my library." };

    it("accepts a signed-out visitor, with no account linked", async () => {
      await request(app.getHttpServer())
        .post("/support/requests")
        .send({ ...body, email: "visitor@example.com" })
        .expect(201);
      expect(mockSupport.create).toHaveBeenCalledWith(null, expect.objectContaining({ email: "visitor@example.com" }));
    });

    it("links the request to a signed-in person", async () => {
      await request(app.getHttpServer()).post("/support/requests").set("Authorization", `Bearer ${listener}`).send(body).expect(201);
      expect(mockSupport.create).toHaveBeenCalledWith("listener-1", expect.objectContaining({ topic: "account" }));
    });

    it("treats an invalid token as signed out rather than refusing", async () => {
      await request(app.getHttpServer()).post("/support/requests").set("Authorization", "Bearer not-a-jwt").send(body).expect(201);
      expect(mockSupport.create).toHaveBeenCalledWith(null, expect.anything());
    });

    it.each([
      ["an unknown topic", { ...body, topic: "refunds-now" }],
      ["a missing message", { topic: "account" }],
      ["a message that is too long", { ...body, message: "x".repeat(4001) }],
      ["an email that is not an address", { ...body, email: "nope" }],
    ])("400 for %s", async (_label, payload) => {
      await request(app.getHttpServer()).post("/support/requests").send(payload).expect(400);
      expect(mockSupport.create).not.toHaveBeenCalled();
    });
  });

  describe("GET /admin/support/requests", () => {
    it("401 without a JWT", async () => {
      await request(app.getHttpServer()).get("/admin/support/requests").expect(401);
      expect(mockSupport.list).not.toHaveBeenCalled();
    });

    it.each([
      ["listener", listener],
      ["artist", artist],
    ])("403 for a %s", async (_role, token) => {
      await request(app.getHttpServer()).get("/admin/support/requests").set("Authorization", `Bearer ${token}`).expect(403);
      expect(mockSupport.list).not.toHaveBeenCalled();
    });

    it("200 for an operator, and the view is recorded", async () => {
      await request(app.getHttpServer())
        .get("/admin/support/requests?status=new")
        .set("Authorization", `Bearer ${operator}`)
        .expect(200);
      expect(mockSupport.list).toHaveBeenCalledWith("new");
      expect(mockAudit).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: "operator-1", action: "support.requests_viewed", detail: { status: "new" } }),
      );
    });
  });

  describe("PATCH /admin/support/requests/:id", () => {
    it("403 for a listener", async () => {
      await request(app.getHttpServer())
        .patch("/admin/support/requests/req-1")
        .set("Authorization", `Bearer ${listener}`)
        .send({ status: "answered" })
        .expect(403);
      expect(mockSupport.setStatus).not.toHaveBeenCalled();
    });

    it("400 for an unknown status", async () => {
      await request(app.getHttpServer())
        .patch("/admin/support/requests/req-1")
        .set("Authorization", `Bearer ${admin}`)
        .send({ status: "ignored" })
        .expect(400);
      expect(mockSupport.setStatus).not.toHaveBeenCalled();
    });

    it("200 for an admin, recorded with the id and the status only", async () => {
      await request(app.getHttpServer())
        .patch("/admin/support/requests/req-1")
        .set("Authorization", `Bearer ${admin}`)
        .send({ status: "answered" })
        .expect(200);
      expect(mockSupport.setStatus).toHaveBeenCalledWith("req-1", "answered", "admin-1");
      expect(mockAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: "admin-1",
          action: "support.request_status_changed",
          detail: { requestId: "req-1", status: "answered" },
        }),
      );
    });
  });
});
