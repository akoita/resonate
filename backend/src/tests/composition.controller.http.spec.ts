/**
 * CompositionController — HTTP contract (#2669)
 *
 * Reading a release's composition is public (a session decides how much is
 * shown, in the service); writing and copying need a JWT; the usage export is
 * admin/operator only and audited. The service is mocked; no database (see
 * composition.integration.spec.ts).
 */

import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { CompositionController } from "../modules/composition/composition.controller";
import { CompositionService } from "../modules/composition/composition.service";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { authToken, createControllerTestApp } from "./e2e-helpers";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const mockComposition = {
  getForRelease: jest.fn(),
  saveForTrack: jest.fn(),
  copyToRelease: jest.fn(),
  usageExport: jest.fn(),
};

describe("CompositionController (http)", () => {
  let app: INestApplication;
  const artist = authToken("artist-1", "artist");
  const operator = authToken("operator-1", "operator");
  const listener = authToken("listener-1", "listener");

  beforeAll(async () => {
    app = await createControllerTestApp(CompositionController, [
      { provide: CompositionService, useValue: mockComposition },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockComposition.getForRelease.mockResolvedValue({ releaseId: "rel-1", access: "public", canEdit: false, tracks: [] });
    mockComposition.saveForTrack.mockResolvedValue({ trackId: "trk-1", composition: null });
    mockComposition.copyToRelease.mockResolvedValue({ copiedTo: 2 });
    mockComposition.usageExport.mockResolvedValue({ csv: "a\r\n", rows: 3, truncated: false, from: "f", to: "t" });
  });

  describe("GET /catalog/releases/:releaseId/composition", () => {
    it("is open to signed-out readers", async () => {
      await request(app.getHttpServer()).get("/catalog/releases/rel-1/composition").expect(200);
      expect(mockComposition.getForRelease).toHaveBeenCalledWith("rel-1", { userId: undefined, role: undefined });
    });

    it("passes the signed-in person and role to the service", async () => {
      await request(app.getHttpServer())
        .get("/catalog/releases/rel-1/composition")
        .set("Authorization", `Bearer ${operator}`)
        .expect(200);
      expect(mockComposition.getForRelease).toHaveBeenCalledWith("rel-1", { userId: "operator-1", role: "operator" });
    });
  });

  describe("PUT /catalog/releases/:releaseId/tracks/:trackId/composition", () => {
    const body = { writers: [{ name: "A", role: "composer" }], publisher: "P", iswc: "T-034.524.680-1" };

    it("401 without a JWT", async () => {
      await request(app.getHttpServer()).put("/catalog/releases/rel-1/tracks/trk-1/composition").send(body).expect(401);
      expect(mockComposition.saveForTrack).not.toHaveBeenCalled();
    });

    it("saves for the signed-in person", async () => {
      await request(app.getHttpServer())
        .put("/catalog/releases/rel-1/tracks/trk-1/composition")
        .set("Authorization", `Bearer ${artist}`)
        .send(body)
        .expect(200);
      expect(mockComposition.saveForTrack).toHaveBeenCalledWith("rel-1", "trk-1", "artist-1", expect.objectContaining(body));
    });

    it.each([
      ["writers that are not a list", { writers: "A" }],
      ["too many writers", { writers: Array.from({ length: 21 }, () => ({ name: "A", role: "composer" })) }],
      ["a publisher that is too long", { publisher: "x".repeat(201) }],
      ["a non-boolean declaration", { coverOrSamples: "yes" }],
      ["a cover note that is too long", { coverNote: "x".repeat(1001) }],
    ])("400 for %s", async (_label, payload) => {
      await request(app.getHttpServer())
        .put("/catalog/releases/rel-1/tracks/trk-1/composition")
        .set("Authorization", `Bearer ${artist}`)
        .send(payload)
        .expect(400);
      expect(mockComposition.saveForTrack).not.toHaveBeenCalled();
    });
  });

  describe("POST .../composition/copy", () => {
    it("401 without a JWT", async () => {
      await request(app.getHttpServer()).post("/catalog/releases/rel-1/tracks/trk-1/composition/copy").expect(401);
    });

    it("copies for the signed-in person and answers 200", async () => {
      const res = await request(app.getHttpServer())
        .post("/catalog/releases/rel-1/tracks/trk-1/composition/copy")
        .set("Authorization", `Bearer ${artist}`)
        .expect(200);
      expect(res.body).toEqual({ copiedTo: 2 });
      expect(mockComposition.copyToRelease).toHaveBeenCalledWith("rel-1", "trk-1", "artist-1");
    });
  });

  describe("GET /admin/composition/usage-export", () => {
    it("401 without a JWT", async () => {
      await request(app.getHttpServer()).get("/admin/composition/usage-export").expect(401);
    });

    it.each([["a listener", listener], ["an artist", artist]])("403 for %s", async (_label, token) => {
      await request(app.getHttpServer())
        .get("/admin/composition/usage-export")
        .set("Authorization", `Bearer ${token}`)
        .expect(403);
      expect(mockComposition.usageExport).not.toHaveBeenCalled();
    });

    it("exports for an operator and records an audit event with the row count only", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/composition/usage-export?from=2026-11-01&to=2026-12-01")
        .set("Authorization", `Bearer ${operator}`)
        .expect(200);
      expect(res.body.rows).toBe(3);
      expect(mockComposition.usageExport).toHaveBeenCalledWith("2026-11-01", "2026-12-01");
      expect(mockAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "composition.usage_exported", detail: { rows: 3 } }),
      );
    });
  });
});
