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
});
