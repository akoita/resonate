import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { authToken, createControllerTestApp } from "./e2e-helpers";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { StreamRenditionAdminController } from "../modules/catalog/stream_rendition.controller";
import { StreamRenditionService } from "../modules/catalog/stream_rendition.service";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

describe("StreamRenditionAdminController (#2661)", () => {
  let app: INestApplication;
  const renditions = { runSweep: jest.fn(), remaining: jest.fn() };

  beforeAll(async () => {
    app = await createControllerTestApp(StreamRenditionAdminController, [
      { provide: StreamRenditionService, useValue: renditions },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    renditions.runSweep.mockResolvedValue({ processed: 2, failed: 0, remaining: 5 });
  });

  it.each(["listener", "artist", "operator"])("refuses a %s", async (role) => {
    const token = authToken("u1", role);
    await request(app.getHttpServer()).get("/admin/stems/stream-renditions").set("Authorization", `Bearer ${token}`).expect(403);
    await request(app.getHttpServer())
      .post("/admin/stems/stream-renditions/backfill")
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(403);
    expect(renditions.runSweep).not.toHaveBeenCalled();
  });

  it("runs one clamped batch for an admin and records it", async () => {
    const res = await request(app.getHttpServer())
      .post("/admin/stems/stream-renditions/backfill")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .send({ limit: 500 })
      .expect(201);
    expect(res.body).toEqual({ processed: 2, failed: 0, remaining: 5 });
    expect(renditions.runSweep).toHaveBeenCalledWith(50);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "maintenance.stream_renditions_backfill_run" }),
    );
  });

  it("rejects a malformed body", async () => {
    await request(app.getHttpServer())
      .post("/admin/stems/stream-renditions/backfill")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .send({ limit: "ten" })
      .expect(400);
  });
});
