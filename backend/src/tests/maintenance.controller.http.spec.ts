import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { RolesGuard } from "../modules/auth/roles.guard";
import { MaintenanceController } from "../modules/maintenance/maintenance.controller";
import { MaintenanceService } from "../modules/maintenance/maintenance.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const maintenanceService = {
  runRetentionCleanup: jest.fn(),
  loadAnalyticsWarehouse: jest.fn(),
  backfillAnalyticsWarehouse: jest.fn(),
  getAnalyticsPipelineHealth: jest.fn(),
  generateCommunityCohorts: jest.fn(),
  wipeReleases: jest.fn(),
};

describe("MaintenanceController (HTTP)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(MaintenanceController, [
      RolesGuard,
      { provide: MaintenanceService, useValue: maintenanceService },
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
});
