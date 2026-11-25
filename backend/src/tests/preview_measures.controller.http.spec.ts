/**
 * PreviewMeasuresController — HTTP contract (#2670): admin only, audited on
 * view. The service is mocked (see preview_measures.integration.spec.ts).
 */
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { PreviewMeasuresController } from "../modules/preview_measures/preview_measures.controller";
import { PreviewMeasuresService } from "../modules/preview_measures/preview_measures.service";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { authToken, createControllerTestApp } from "./e2e-helpers";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;
const mockMeasures = { measures: jest.fn() };

describe("PreviewMeasuresController (http)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(PreviewMeasuresController, [
      { provide: PreviewMeasuresService, useValue: mockMeasures },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockMeasures.measures.mockResolvedValue({ minimumGroup: 5 });
  });

  it("401 without a JWT", async () => {
    await request(app.getHttpServer()).get("/admin/preview-measures").expect(401);
  });

  it.each([["a listener", "listener"], ["an operator", "operator"]])("403 for %s", async (_label, role) => {
    await request(app.getHttpServer())
      .get("/admin/preview-measures")
      .set("Authorization", `Bearer ${authToken(`${role}-1`, role)}`)
      .expect(403);
    expect(mockMeasures.measures).not.toHaveBeenCalled();
  });

  it("returns the measures to an admin and records the view", async () => {
    await request(app.getHttpServer())
      .get("/admin/preview-measures?from=2026-11-01&to=2026-11-29")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .expect(200, { minimumGroup: 5 });
    expect(mockMeasures.measures).toHaveBeenCalledWith("2026-11-01", "2026-11-29");
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "preview_measures.viewed" }));
  });
});
