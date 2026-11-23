/**
 * Admin remix watermark check (#2575) — HTTP contract: JWT, admin role only,
 * the multipart upload, DTO validation, and audit records with ids and codes.
 * The service is mocked; Postgres is remix-watermark-detection.integration.spec.ts.
 */
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { RemixWatermarkAdminController } from "../modules/remix/remix-watermark-admin.controller";
import { RemixWatermarkDetectionService } from "../modules/remix/remix-watermark-detection.service";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { authToken, createControllerTestApp } from "./e2e-helpers";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const DETECTION = {
  id: "det-1",
  status: "pending",
  clipSha256: "a".repeat(64),
  clipBytes: 4,
  match: null,
};

const mockService = {
  status: jest.fn().mockReturnValue({ configured: true, keyIds: ["k1"], maxClipBytes: 1 }),
  list: jest.fn().mockResolvedValue([DETECTION]),
  start: jest.fn().mockResolvedValue(DETECTION),
  get: jest.fn().mockResolvedValue({ ...DETECTION, status: "matched" }),
  attachEvidence: jest.fn().mockResolvedValue({ detection: DETECTION, bundleId: "b-1", evidenceId: "ev-1" }),
};

describe("RemixWatermarkAdminController (http, #2575)", () => {
  let app: INestApplication;
  const base = "/admin/remix-watermark/detections";
  const admin = `Bearer ${authToken("admin-1", "admin")}`;

  beforeAll(async () => {
    app = await createControllerTestApp(RemixWatermarkAdminController, [
      { provide: RemixWatermarkDetectionService, useValue: mockService },
    ]);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  it("requires a JWT on every route", async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer()).post(base).expect(401);
    await request(app.getHttpServer()).get(`${base}/det-1`).expect(401);
    await request(app.getHttpServer()).post(`${base}/det-1/evidence`).expect(401);
  });

  it.each(["listener", "artist", "operator"])("rejects a %s with 403 on every route", async (role) => {
    const bearer = `Bearer ${authToken("user-1", role)}`;
    await request(app.getHttpServer()).get(base).set("Authorization", bearer).expect(403);
    await request(app.getHttpServer())
      .post(base)
      .set("Authorization", bearer)
      .attach("clip", Buffer.from("clip"), "clip.mp3")
      .expect(403);
    await request(app.getHttpServer()).get(`${base}/det-1`).set("Authorization", bearer).expect(403);
    await request(app.getHttpServer())
      .post(`${base}/det-1/evidence`)
      .set("Authorization", bearer)
      .send({ subjectType: "dispute", subjectId: "d-1" })
      .expect(403);
    expect(mockService.start).not.toHaveBeenCalled();
    expect(mockService.attachEvidence).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("starts a check from the uploaded clip and answers 202", async () => {
    const res = await request(app.getHttpServer())
      .post(base)
      .set("Authorization", admin)
      .attach("clip", Buffer.from("clip"), "clip.mp3")
      .expect(202);
    expect(res.body).toMatchObject({ id: "det-1", status: "pending" });
    expect(mockService.start.mock.calls[0][0]).toEqual(Buffer.from("clip"));
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "admin-1",
        action: "remix_watermark.detect_started",
        detail: { detectionId: "det-1", clipSha256: "a".repeat(64), clipBytes: 4 },
      }),
    );
  });

  it("lists recent checks with the key status, and reads one", async () => {
    const list = await request(app.getHttpServer()).get(base).set("Authorization", admin).expect(200);
    expect(list.body).toMatchObject({ configured: true, keyIds: ["k1"], detections: [DETECTION] });
    await request(app.getHttpServer()).get(`${base}/det-1`).set("Authorization", admin).expect(200);
    expect(mockAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "remix_watermark.detect_viewed",
        detail: { detectionId: "det-1", status: "matched" },
      }),
    );
  });

  it("attaches a match as evidence and records where", async () => {
    await request(app.getHttpServer())
      .post(`${base}/det-1/evidence`)
      .set("Authorization", admin)
      .send({ subjectType: "dispute", subjectId: "d-1" })
      .expect(201);
    expect(mockService.attachEvidence).toHaveBeenCalledWith(
      "det-1",
      expect.objectContaining({ subjectType: "dispute", subjectId: "d-1" }),
      "admin-1",
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "remix_watermark.evidence_attached",
        detail: { detectionId: "det-1", evidenceId: "ev-1", subjectType: "dispute", subjectId: "d-1" },
      }),
    );
  });

  it.each([
    [{ subjectType: "upload", subjectId: "d-1" }],
    [{ subjectType: "dispute" }],
    [{ subjectType: "dispute", subjectId: "" }],
  ])("answers 400 for %j", async (body) => {
    await request(app.getHttpServer())
      .post(`${base}/det-1/evidence`)
      .set("Authorization", admin)
      .send(body)
      .expect(400);
    expect(mockService.attachEvidence).not.toHaveBeenCalled();
  });
});
