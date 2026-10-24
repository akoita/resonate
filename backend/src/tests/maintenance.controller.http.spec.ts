import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { RolesGuard } from "../modules/auth/roles.guard";
import { MaintenanceController } from "../modules/maintenance/maintenance.controller";
import { StemFeatureBackfillService } from "../modules/ingestion/stem-feature-backfill.service";
import { MaintenanceService } from "../modules/maintenance/maintenance.service";
import { TrackEmbeddingService } from "../modules/embeddings/track_embedding.service";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { authToken, confirmedBearer as confirmed, createControllerTestApp, expectStepUpRequired } from "./e2e-helpers";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const maintenanceService = {
  runRetentionCleanup: jest.fn(),
  runDueAccountErasures: jest.fn(),
  loadAnalyticsWarehouse: jest.fn(),
  backfillAnalyticsWarehouse: jest.fn(),
  getAnalyticsPipelineHealth: jest.fn(),
  generateCommunityCohorts: jest.fn(),
  getCommunityCohortQuality: jest.fn(),
  getCommunityModerationQueue: jest.fn(),
  resolveCommunityModerationReport: jest.fn(),
  wipeReleases: jest.fn(),
};

const stemFeatureBackfillService = {
  status: jest.fn().mockResolvedValue({ remaining: 3, remainingByType: { original: 3 } }),
  backfill: jest
    .fn()
    .mockResolvedValue({ scanned: 2, updated: 2, skipped: [], remaining: 0 }),
};

const trackEmbeddingService = {
  backfill: jest.fn().mockResolvedValue({
    status: "ok",
    model: "text-multilingual-embedding-002",
    scanned: 3,
    embedded: 3,
    skipped: 0,
    failed: 0,
    remaining: 0,
  }),
};

describe("MaintenanceController (HTTP)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(MaintenanceController, [
      RolesGuard,
      { provide: MaintenanceService, useValue: maintenanceService },
      { provide: StemFeatureBackfillService, useValue: stemFeatureBackfillService },
      { provide: TrackEmbeddingService, useValue: trackEmbeddingService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    maintenanceService.getAnalyticsPipelineHealth.mockResolvedValue({
      status: "ok",
      freshness: { status: "ok" },
    });
    maintenanceService.generateCommunityCohorts.mockResolvedValue({
      schemaVersion: "community-cohort-generation/v1",
      summary: { cohortsMaterialized: 1 },
    });
    maintenanceService.getCommunityCohortQuality.mockResolvedValue({
      schemaVersion: "community-cohort-quality/v1",
      cohorts: { total: 0 },
      privacy: { aggregateOnly: true },
    });
    maintenanceService.getCommunityModerationQueue.mockResolvedValue({
      schemaVersion: "community-moderation-queue/v1",
      reports: [
        {
          id: "report-1",
          status: "open",
          assist: {
            summary: "Single reported community message. Review the preview and room context before deciding.",
            severity: "low",
            likelihood: "low",
            reasonCodes: ["single_report_review"],
            reviewFocus: ["Compare the report reason with the message preview."],
            source: "bounded_moderation_context",
            advisory: {
              noAutoEnforcement: true,
              copy: "Advisory only. A human admin must choose and confirm any moderation action.",
            },
          },
        },
      ],
      privacy: { operatorOnly: true, noWalletAddresses: true },
    });
    maintenanceService.resolveCommunityModerationReport.mockResolvedValue({
      schemaVersion: "community-moderation-resolution/v1",
      report: { id: "report-1", status: "resolved" },
      action: { type: "delete_message", status: "resolved" },
      privacy: { operatorOnly: true, noWalletAddresses: true },
    });
  });

  it("GET /admin/analytics/pipeline/health requires JWT auth", async () => {
    await request(app.getHttpServer()).get("/admin/analytics/pipeline/health").expect(401);
  });

  it("GET /admin/analytics/pipeline/health requires an admin role", async () => {
    await request(app.getHttpServer())
      .get("/admin/analytics/pipeline/health")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(403);
  });

  it("GET /admin/analytics/pipeline/health returns the service report for admins", async () => {
    await request(app.getHttpServer())
      .get("/admin/analytics/pipeline/health")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          status: "ok",
          freshness: { status: "ok" },
        });
      });

    expect(maintenanceService.getAnalyticsPipelineHealth).toHaveBeenCalledTimes(1);
  });

  it("POST /admin/erasure/run-due is admin-only and runs the due erasures (#1771)", async () => {
    maintenanceService.runDueAccountErasures.mockResolvedValue({
      status: "ok",
      ranAt: "2026-09-18T00:00:00.000Z",
      due: 1,
      erased: 1,
      failed: 0,
      results: [{ requestId: "request-1", status: "erased", newUserId: "rotated-uuid" }],
    });

    // Erasure is irreversible, so an unauthenticated or non-admin caller must
    // not reach it at all.
    await request(app.getHttpServer()).post("/admin/erasure/run-due").send({}).expect(401);

    await request(app.getHttpServer())
      .post("/admin/erasure/run-due")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({})
      .expect(403);

    await request(app.getHttpServer())
      .post("/admin/erasure/run-due")
      .set(confirmed("admin-1", "admin"))
      .send({ limit: 5 })
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe("ok");
        expect(body.results[0].requestId).toBe("request-1");
      });

    expect(maintenanceService.runDueAccountErasures).toHaveBeenCalledWith({ limit: 5 });
  });

  it("POST /admin/stems/backfill-audio-features requires admin role and delegates (#1184)", async () => {
    await request(app.getHttpServer())
      .post("/admin/stems/backfill-audio-features")
      .send({ limit: 10 })
      .expect(401);

    await request(app.getHttpServer())
      .post("/admin/stems/backfill-audio-features")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({ limit: 10 })
      .expect(403);

    await request(app.getHttpServer())
      .post("/admin/stems/backfill-audio-features")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .send({ limit: 10 })
      .expect(201)
      .expect(({ body }) => {
        expect(body.remaining).toBe(0);
      });

    expect(stemFeatureBackfillService.backfill).toHaveBeenCalledWith({ limit: 10 });
  });

  it("POST /admin/stems/backfill-audio-features passes the stem type filter through (#1959)", async () => {
    await request(app.getHttpServer())
      .post("/admin/stems/backfill-audio-features")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .send({ limit: 5, types: ["original"] })
      .expect(201);

    expect(stemFeatureBackfillService.backfill).toHaveBeenCalledWith({
      limit: 5,
      types: ["original"],
    });
  });

  it("POST /admin/stems/backfill-audio-features passes refresh through (#2016)", async () => {
    await request(app.getHttpServer())
      .post("/admin/stems/backfill-audio-features")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .send({ limit: 5, refresh: true })
      .expect(201);

    expect(stemFeatureBackfillService.backfill).toHaveBeenLastCalledWith({
      limit: 5,
      refresh: true,
    });
  });

  it("GET /admin/stems/backfill-audio-features requires admin role and passes types (#2013)", async () => {
    await request(app.getHttpServer())
      .get("/admin/stems/backfill-audio-features")
      .expect(401);

    await request(app.getHttpServer())
      .get("/admin/stems/backfill-audio-features")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(403);

    await request(app.getHttpServer())
      .get("/admin/stems/backfill-audio-features?types=original,vocals")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ remaining: 3, remainingByType: { original: 3 } });
      });
    expect(stemFeatureBackfillService.status).toHaveBeenCalledWith({
      types: ["original", "vocals"],
      refresh: false,
    });

    await request(app.getHttpServer())
      .get("/admin/stems/backfill-audio-features")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .expect(200);
    expect(stemFeatureBackfillService.status).toHaveBeenLastCalledWith({
      types: undefined,
      refresh: false,
    });

    await request(app.getHttpServer())
      .get("/admin/stems/backfill-audio-features?types=original&refresh=true")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .expect(200);
    expect(stemFeatureBackfillService.status).toHaveBeenLastCalledWith({
      types: ["original"],
      refresh: true,
    });

    // Only the literal string "true" enables refresh.
    await request(app.getHttpServer())
      .get("/admin/stems/backfill-audio-features?refresh=1")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .expect(200);
    expect(stemFeatureBackfillService.status).toHaveBeenLastCalledWith({
      types: undefined,
      refresh: false,
    });
  });

  it("POST /admin/embeddings/backfill requires admin role and delegates (#1452)", async () => {
    await request(app.getHttpServer())
      .post("/admin/embeddings/backfill")
      .send({ limit: 25 })
      .expect(401);

    await request(app.getHttpServer())
      .post("/admin/embeddings/backfill")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({ limit: 25 })
      .expect(403);
    expect(trackEmbeddingService.backfill).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post("/admin/embeddings/backfill")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .send({ limit: 25 })
      .expect(201)
      .expect(({ body }) => {
        expect(body.remaining).toBe(0);
        expect(body.model).toBe("text-multilingual-embedding-002");
      });
    expect(trackEmbeddingService.backfill).toHaveBeenCalledWith({ limit: 25 });

    // An empty body runs with the service defaults.
    await request(app.getHttpServer())
      .post("/admin/embeddings/backfill")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .expect(201);
    expect(trackEmbeddingService.backfill).toHaveBeenLastCalledWith({});
  });

  it("POST /admin/community/cohorts/generate requires admin role and runs cohort generation", async () => {
    await request(app.getHttpServer())
      .post("/admin/community/cohorts/generate")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({ minimumSize: 5 })
      .expect(403);

    await request(app.getHttpServer())
      .post("/admin/community/cohorts/generate")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .send({ minimumSize: 5 })
      .expect(201)
      .expect(({ body }) => {
        expect(body.schemaVersion).toBe("community-cohort-generation/v1");
      });

    expect(maintenanceService.generateCommunityCohorts).toHaveBeenCalledWith({ minimumSize: 5 });
  });

  it("GET /admin/community/cohorts/quality requires admin role and returns aggregate quality metrics", async () => {
    await request(app.getHttpServer())
      .get("/admin/community/cohorts/quality")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(403);

    await request(app.getHttpServer())
      .get("/admin/community/cohorts/quality")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.schemaVersion).toBe("community-cohort-quality/v1");
        expect(body.privacy.aggregateOnly).toBe(true);
      });

    expect(maintenanceService.getCommunityCohortQuality).toHaveBeenCalledTimes(1);
  });

  it("GET /admin/community/moderation/reports requires admin role and returns the moderation queue", async () => {
    await request(app.getHttpServer())
      .get("/admin/community/moderation/reports")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(403);

    await request(app.getHttpServer())
      .get("/admin/community/moderation/reports?status=open&limit=25")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.schemaVersion).toBe("community-moderation-queue/v1");
        expect(body.privacy.noWalletAddresses).toBe(true);
        expect(body.reports[0].assist.advisory.noAutoEnforcement).toBe(true);
      });

    expect(maintenanceService.getCommunityModerationQueue).toHaveBeenCalledWith({ status: "open", limit: "25" });
  });

  it("PATCH /admin/community/moderation/reports/:reportId requires admin role and resolves a report", async () => {
    await request(app.getHttpServer())
      .patch("/admin/community/moderation/reports/report-1")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({ action: "delete_message" })
      .expect(403);

    await request(app.getHttpServer())
      .patch("/admin/community/moderation/reports/report-1")
      .set(confirmed("admin-1", "admin"))
      .send({ action: "delete_message", note: "Confirmed report." })
      .expect(200)
      .expect(({ body }) => {
        expect(body.schemaVersion).toBe("community-moderation-resolution/v1");
        expect(body.action.type).toBe("delete_message");
      });

    expect(maintenanceService.resolveCommunityModerationReport).toHaveBeenCalledWith(
      { userId: "admin-1", role: "admin" },
      "report-1",
      { action: "delete_message", note: "Confirmed report." },
    );
  });

  describe("step-up for destructive maintenance (#2362)", () => {
    const admin = { userId: "admin-1", role: "admin" };

    it.each([
      ["post", "/admin/retention/cleanup", {}, () => maintenanceService.runRetentionCleanup],
      ["post", "/admin/erasure/run-due", { limit: 1 }, () => maintenanceService.runDueAccountErasures],
      ["delete", "/admin/wipe-releases", {}, () => maintenanceService.wipeReleases],
      [
        "patch",
        "/admin/community/moderation/reports/report-1",
        { action: "ban_member" },
        () => maintenanceService.resolveCommunityModerationReport,
      ],
    ] as const)("%s %s needs a fresh step-up proof", async (method, path, body, service) => {
      await expectStepUpRequired(app, method, path, admin, body);
      expect(service()).not.toHaveBeenCalled();
      expect(mockAudit).not.toHaveBeenCalled();
    });

    it("runs a retention cleanup and a wipe with a proof, and records both", async () => {
      maintenanceService.runRetentionCleanup.mockResolvedValue({ status: "ok" });
      maintenanceService.wipeReleases.mockResolvedValue({ status: "blocked" });
      await request(app.getHttpServer()).post("/admin/retention/cleanup").set(confirmed("admin-1", "admin")).expect(201);
      await request(app.getHttpServer()).delete("/admin/wipe-releases").set(confirmed("admin-1", "admin")).expect(200);
      expect(mockAudit).toHaveBeenNthCalledWith(1, {
        actorUserId: "admin-1",
        action: "maintenance.retention_cleanup_run",
        targetUserId: null,
      });
      expect(mockAudit).toHaveBeenNthCalledWith(2, {
        actorUserId: "admin-1",
        action: "maintenance.releases_wiped",
        targetUserId: null,
      });
    });

    it("operators cannot reach admin-only maintenance even with a proof", async () => {
      await request(app.getHttpServer())
        .delete("/admin/wipe-releases")
        .set(confirmed("operator-1", "operator"))
        .expect(403);
      expect(maintenanceService.wipeReleases).not.toHaveBeenCalled();
    });
  });

  describe("audit of the other maintenance actions (#2362)", () => {
    const admin = () => ({ Authorization: `Bearer ${authToken("admin-1", "admin")}` });

    it("records a stem-feature backfill with its settings only", async () => {
      await request(app.getHttpServer())
        .post("/admin/stems/backfill-audio-features")
        .set(admin())
        .send({ limit: 5, refresh: true, retryFailed: false, types: ["original"] })
        .expect(201);
      expect(mockAudit).toHaveBeenCalledWith({
        actorUserId: "admin-1",
        action: "maintenance.stem_features_backfill_run",
        targetUserId: null,
        detail: { limit: 5, refresh: true, retryFailed: false },
      });
    });

    it("records an analytics warehouse load with the run id and no dates or free text", async () => {
      maintenanceService.loadAnalyticsWarehouse.mockResolvedValue({ status: "ok" });
      await request(app.getHttpServer())
        .post("/admin/analytics/warehouse/load")
        .set(admin())
        .send({ eventFamily: "playback", runId: "run-1", dryRun: true, from: "2026-01-01" })
        .expect(201);
      expect(mockAudit).toHaveBeenCalledWith({
        actorUserId: "admin-1",
        action: "maintenance.analytics_warehouse_loaded",
        targetUserId: null,
        detail: { eventFamily: "playback", runId: "run-1", dryRun: true },
      });
    });

    it("records opening the moderation queue, and resolving a report with its action code", async () => {
      await request(app.getHttpServer())
        .get("/admin/community/moderation/reports?status=open")
        .set(admin())
        .expect(200);
      await request(app.getHttpServer())
        .patch("/admin/community/moderation/reports/report-1")
        .set(confirmed("admin-1", "admin"))
        .send({ action: "no_action", note: "never recorded" })
        .expect(200);
      expect(mockAudit).toHaveBeenNthCalledWith(1, {
        actorUserId: "admin-1",
        action: "community_moderation.queue_viewed",
        targetUserId: null,
        detail: { status: "open" },
      });
      expect(mockAudit).toHaveBeenNthCalledWith(2, {
        actorUserId: "admin-1",
        action: "community_moderation.report_resolved",
        targetUserId: null,
        detail: { reportId: "report-1", action: "no_action" },
      });
    });

    it("does not record the read-only status routes or a failed run", async () => {
      await request(app.getHttpServer()).get("/admin/analytics/pipeline/health").set(admin()).expect(200);
      await request(app.getHttpServer()).get("/admin/stems/backfill-audio-features").set(admin()).expect(200);
      trackEmbeddingService.backfill.mockRejectedValueOnce(new Error("provider down"));
      await request(app.getHttpServer()).post("/admin/embeddings/backfill").set(admin()).send({ limit: 5 }).expect(500);
      expect(mockAudit).not.toHaveBeenCalled();
    });
  });

  describe("request bodies are class DTOs (#2362)", () => {
    const admin = () => ({ Authorization: `Bearer ${authToken("admin-1", "admin")}` });

    it.each([
      ["/admin/stems/backfill-audio-features", { limit: "ten" }],
      ["/admin/stems/backfill-audio-features", { types: "original" }],
      ["/admin/stems/backfill-audio-features", { refresh: "yes" }],
      ["/admin/stems/backfill-audio-features", { retryFailed: 1 }],
      ["/admin/embeddings/backfill", { limit: "25" }],
      ["/admin/analytics/warehouse/load", { dryRun: "true" }],
      ["/admin/analytics/warehouse/backfill", { from: 20260101 }],
      ["/admin/analytics/warehouse/backfill", { runId: ["a"] }],
      ["/admin/community/cohorts/generate", { minimumSize: "5" }],
    ])("%s rejects %j with 400 before reaching the service", async (path, body) => {
      await request(app.getHttpServer()).post(path).set(admin()).send(body).expect(400);
      expect(stemFeatureBackfillService.backfill).not.toHaveBeenCalled();
      expect(trackEmbeddingService.backfill).not.toHaveBeenCalled();
      expect(maintenanceService.loadAnalyticsWarehouse).not.toHaveBeenCalled();
      expect(maintenanceService.backfillAnalyticsWarehouse).not.toHaveBeenCalled();
      expect(maintenanceService.generateCommunityCohorts).not.toHaveBeenCalled();
      expect(mockAudit).not.toHaveBeenCalled();
    });

    it("run-due rejects a non-numeric limit but still takes a numeric string, as the service does", async () => {
      maintenanceService.runDueAccountErasures.mockResolvedValue({ status: "ok" });
      await request(app.getHttpServer())
        .post("/admin/erasure/run-due")
        .set(confirmed("admin-1", "admin"))
        .send({ limit: 0 })
        .expect(400);
      await request(app.getHttpServer())
        .post("/admin/erasure/run-due")
        .set(confirmed("admin-1", "admin"))
        .send({ limit: true })
        .expect(400);
      await request(app.getHttpServer())
        .post("/admin/erasure/run-due")
        .set(confirmed("admin-1", "admin"))
        .send({ limit: "5" })
        .expect(201);
      expect(maintenanceService.runDueAccountErasures).toHaveBeenCalledTimes(1);
    });

    it("moderation resolution rejects non-string fields and leaves a missing action to the service", async () => {
      const resolve = (body: Record<string, unknown>) =>
        request(app.getHttpServer())
          .patch("/admin/community/moderation/reports/report-1")
          .set(confirmed("admin-1", "admin"))
          .send(body);
      await resolve({ action: 5 }).expect(400);
      await resolve({ action: "no_action", note: ["x"] }).expect(400);
      expect(maintenanceService.resolveCommunityModerationReport).not.toHaveBeenCalled();
      await resolve({}).expect(200);
      expect(maintenanceService.resolveCommunityModerationReport).toHaveBeenCalledTimes(1);
    });

    it("accepts the documented bodies and an empty one", async () => {
      await request(app.getHttpServer())
        .post("/admin/analytics/warehouse/backfill")
        .set(admin())
        .send({ from: "2026-01-01", to: "2026-02-01", eventFamily: "playback", runId: "r", dryRun: false })
        .expect(201);
      await request(app.getHttpServer()).post("/admin/community/cohorts/generate").set(admin()).expect(201);
    });
  });
});
