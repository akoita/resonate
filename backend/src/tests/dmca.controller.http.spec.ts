/**
 * DmcaController — HTTP contract
 *
 * Route access: filing a report is public; a counter-notice requires a
 * signed-in caller (ownership is checked by the service, covered by
 * dmca.service.integration.spec.ts); resolving and listing reports are
 * admin/operator only. The service is mocked; no database.
 */

import request from "supertest";
import {
  BadRequestException,
  ForbiddenException,
  INestApplication,
  NotFoundException,
} from "@nestjs/common";
import { DmcaController } from "../modules/dmca/dmca.controller";
import { DmcaService } from "../modules/dmca/dmca.service";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { authToken, confirmedBearer as confirmed, createControllerTestApp, expectStepUpRequired } from "./e2e-helpers";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const mockDmcaService = {
  fileReport: jest.fn(),
  fileCounter: jest.fn(),
  resolveReport: jest.fn(),
  listReports: jest.fn(),
};

const reportBody = {
  trackId: "track-1",
  claimantName: "Claimant",
  claimantEmail: "claimant@example.com",
  originalWorkUrl: "https://example.com/original",
  reason: "Uploaded without permission",
};

describe("DmcaController (http)", () => {
  let app: INestApplication;
  const listener = authToken("listener-1", "listener");
  const artist = authToken("artist-1", "artist");
  const agent = authToken("agent-1", "agent");
  const operator = authToken("operator-1", "operator");
  const admin = authToken("admin-1", "admin");

  beforeAll(async () => {
    app = await createControllerTestApp(DmcaController, [
      { provide: DmcaService, useValue: mockDmcaService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockDmcaService.fileReport.mockResolvedValue({
      id: "report-1",
      trackId: "track-1",
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    mockDmcaService.fileCounter.mockResolvedValue({
      id: "report-1",
      trackId: "track-1",
      status: "countered",
      counterNotice: "Proof",
    });
    mockDmcaService.resolveReport.mockResolvedValue({ outcome: "upheld", trackId: "track-1" });
    mockDmcaService.listReports.mockResolvedValue([]);
  });

  describe("POST /api/dmca/report (public)", () => {
    it("201 without a JWT", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/dmca/report")
        .send(reportBody)
        .expect(201);
      expect(res.body.id).toBe("report-1");
      expect(res.body).not.toHaveProperty("claimantEmail");
      expect(mockDmcaService.fileReport).toHaveBeenCalledWith(reportBody);
    });
  });

  describe("POST /api/dmca/counter (signed-in owner/manager)", () => {
    const body = { reportId: "report-1", counterNotice: "Proof" };

    it("401 without a JWT", async () => {
      await request(app.getHttpServer()).post("/api/dmca/counter").send(body).expect(401);
      expect(mockDmcaService.fileCounter).not.toHaveBeenCalled();
    });

    it("401 with an invalid JWT", async () => {
      await request(app.getHttpServer())
        .post("/api/dmca/counter")
        .set("Authorization", "Bearer not-a-jwt")
        .send(body)
        .expect(401);
      expect(mockDmcaService.fileCounter).not.toHaveBeenCalled();
    });

    it("403 when the service denies a non-owner listener", async () => {
      mockDmcaService.fileCounter.mockRejectedValueOnce(
        new ForbiddenException("You do not have access to this release"),
      );
      await request(app.getHttpServer())
        .post("/api/dmca/counter")
        .set("Authorization", `Bearer ${listener}`)
        .send(body)
        .expect(403);
      expect(mockDmcaService.fileCounter).toHaveBeenCalledWith("report-1", "Proof", {
        userId: "listener-1",
        role: "listener",
      });
    });

    it("201 for the release owner, passing the JWT identity", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/dmca/counter")
        .set("Authorization", `Bearer ${artist}`)
        .send(body)
        .expect(201);
      expect(res.body.status).toBe("countered");
      expect(mockDmcaService.fileCounter).toHaveBeenCalledWith("report-1", "Proof", {
        userId: "artist-1",
        role: "artist",
      });
    });

    it("404 for an unknown report", async () => {
      mockDmcaService.fileCounter.mockRejectedValueOnce(new NotFoundException("not found"));
      await request(app.getHttpServer())
        .post("/api/dmca/counter")
        .set("Authorization", `Bearer ${artist}`)
        .send({ reportId: "missing", counterNotice: "Proof" })
        .expect(404);
    });

    it("400 for a report that no longer accepts a counter-notice", async () => {
      mockDmcaService.fileCounter.mockRejectedValueOnce(new BadRequestException("closed"));
      await request(app.getHttpServer())
        .post("/api/dmca/counter")
        .set("Authorization", `Bearer ${artist}`)
        .send(body)
        .expect(400);
    });
  });

  describe("PATCH /api/dmca/:id/resolve (admin, operator)", () => {
    const body = { outcome: "upheld" };

    it("401 without a JWT", async () => {
      await request(app.getHttpServer())
        .patch("/api/dmca/report-1/resolve")
        .send(body)
        .expect(401);
      expect(mockDmcaService.resolveReport).not.toHaveBeenCalled();
    });

    it.each([
      ["listener", listener],
      ["artist", artist],
      ["agent", agent],
    ])("403 for a %s", async (_role, token) => {
      await request(app.getHttpServer())
        .patch("/api/dmca/report-1/resolve")
        .set("Authorization", `Bearer ${token}`)
        .send(body)
        .expect(403);
      expect(mockDmcaService.resolveReport).not.toHaveBeenCalled();
    });

    it("200 for an admin, taking the resolver from the JWT", async () => {
      await request(app.getHttpServer())
        .patch("/api/dmca/report-1/resolve")
        .set(confirmed("admin-1", "admin"))
        .send({ ...body, resolvedBy: "someone-else" })
        .expect(200);
      expect(mockDmcaService.resolveReport).toHaveBeenCalledWith("report-1", "upheld", {
        userId: "admin-1",
        role: "admin",
      });
    });

    it("200 for an operator", async () => {
      await request(app.getHttpServer())
        .patch("/api/dmca/report-1/resolve")
        .set(confirmed("operator-1", "operator"))
        .send(body)
        .expect(200);
      expect(mockDmcaService.resolveReport).toHaveBeenCalledWith("report-1", "upheld", {
        userId: "operator-1",
        role: "operator",
      });
    });
  
    it("needs a fresh step-up proof: a takedown is destructive (#2362)", async () => {
      await expectStepUpRequired(app, "patch", "/api/dmca/report-1/resolve", { userId: "operator-1", role: "operator" }, body);
      expect(mockDmcaService.resolveReport).not.toHaveBeenCalled();
      expect(mockAudit).not.toHaveBeenCalled();
    });

    it("records the report and the outcome, nothing else", async () => {
      await request(app.getHttpServer())
        .patch("/api/dmca/report-1/resolve")
        .set(confirmed("admin-1", "admin"))
        .send({ outcome: "rejected", counterNotice: "free text" })
        .expect(200);
      expect(mockAudit).toHaveBeenCalledTimes(1);
      expect(mockAudit).toHaveBeenCalledWith({
        actorUserId: "admin-1",
        action: "dmca.report_resolved",
        targetUserId: null,
        detail: { reportId: "report-1", outcome: "rejected" },
      });
    });

    it("drops an outcome that is not a known code instead of recording it", async () => {
      await request(app.getHttpServer())
        .patch("/api/dmca/report-1/resolve")
        .set(confirmed("admin-1", "admin"))
        .send({ outcome: "some free text typed by mistake" })
        .expect(200);
      expect(mockAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "dmca.report_resolved", detail: { reportId: "report-1" } }),
      );
    });

    it("records nothing when the service refuses", async () => {
      mockDmcaService.resolveReport.mockRejectedValueOnce(new BadRequestException("outcome must be upheld or rejected"));
      await request(app.getHttpServer())
        .patch("/api/dmca/report-1/resolve")
        .set(confirmed("admin-1", "admin"))
        .send({ outcome: "x" })
        .expect(400);
      expect(mockAudit).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/dmca (admin, operator)", () => {
    it("401 without a JWT", async () => {
      await request(app.getHttpServer()).get("/api/dmca").expect(401);
      expect(mockDmcaService.listReports).not.toHaveBeenCalled();
    });

    it.each([
      ["listener", listener],
      ["artist", artist],
      ["agent", agent],
    ])("403 for a %s", async (_role, token) => {
      await request(app.getHttpServer())
        .get("/api/dmca")
        .set("Authorization", `Bearer ${token}`)
        .expect(403);
      expect(mockDmcaService.listReports).not.toHaveBeenCalled();
    });

    it("200 for an admin", async () => {
      await request(app.getHttpServer())
        .get("/api/dmca?status=pending")
        .set("Authorization", `Bearer ${admin}`)
        .expect(200);
      expect(mockDmcaService.listReports).toHaveBeenCalledWith("pending");
    });

    it("200 for an operator", async () => {
      await request(app.getHttpServer())
        .get("/api/dmca")
        .set("Authorization", `Bearer ${operator}`)
        .expect(200);
      expect(mockDmcaService.listReports).toHaveBeenCalledTimes(1);
    });

    it("records that the claimant contact details were opened", async () => {
      await request(app.getHttpServer()).get("/api/dmca?status=pending").set("Authorization", `Bearer ${admin}`).expect(200);
      expect(mockAudit).toHaveBeenCalledWith({
        actorUserId: "admin-1",
        action: "dmca.reports_viewed",
        targetUserId: null,
        detail: { status: "pending" },
      });
    });
  });
});
