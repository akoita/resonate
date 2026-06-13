import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { RolesGuard } from "../modules/auth/roles.guard";
import { MaintenanceController } from "../modules/maintenance/maintenance.controller";
import { StemFeatureBackfillService } from "../modules/ingestion/stem-feature-backfill.service";
import { MaintenanceService } from "../modules/maintenance/maintenance.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const maintenanceService = {
  runRetentionCleanup: jest.fn(),
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
  backfill: jest
    .fn()
    .mockResolvedValue({ scanned: 2, updated: 2, skipped: [], remaining: 0 }),
};

describe("MaintenanceController (HTTP)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(MaintenanceController, [
      RolesGuard,
      { provide: MaintenanceService, useValue: maintenanceService },
      { provide: StemFeatureBackfillService, useValue: stemFeatureBackfillService },
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
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
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
});
