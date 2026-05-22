import { ForbiddenException, INestApplication } from "@nestjs/common";
import request from "supertest";
import { AnalyticsAuthorizationService } from "../modules/analytics/analytics_authorization.service";
import { AnalyticsController } from "../modules/analytics/analytics.controller";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { AnalyticsService } from "../modules/analytics/analytics.service";
import { AnalyticsWarehouseExportService } from "../modules/analytics/analytics_warehouse";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const analyticsService = {
  getArtistStats: jest.fn(),
  getArtistDashboard: jest.fn(),
};

const authorizationService = {
  assertCanReadArtistMetrics: jest.fn(),
};

const ingestService = {
  ingest: jest.fn(),
  dailyRollup: jest.fn(),
};

const warehouseExportService = {
  exportLayers: jest.fn(),
};

describe("AnalyticsController (HTTP)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(AnalyticsController, [
      { provide: AnalyticsService, useValue: analyticsService },
      { provide: AnalyticsAuthorizationService, useValue: authorizationService },
      { provide: AnalyticsIngestService, useValue: ingestService },
      { provide: AnalyticsWarehouseExportService, useValue: warehouseExportService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    analyticsService.getArtistStats.mockResolvedValue({ summary: { totalPlays: 0 }, tracks: [] });
    analyticsService.getArtistDashboard.mockResolvedValue({
      summary: { totalPlays: 0 },
      tracks: [],
      meta: { isEmpty: true },
    });
    authorizationService.assertCanReadArtistMetrics.mockResolvedValue(undefined);
  });

  it("GET /analytics/artist/:id/v1 requires JWT auth", async () => {
    await request(app.getHttpServer()).get("/analytics/artist/artist-1/v1").expect(401);
  });

  it("authorizes artist dashboard access before returning metrics", async () => {
    await request(app.getHttpServer())
      .get("/analytics/artist/artist-1/v1?days=14")
      .set("Authorization", `Bearer ${authToken("user-1", "artist")}`)
      .expect(200);

    expect(authorizationService.assertCanReadArtistMetrics).toHaveBeenCalledWith("artist-1", {
      userId: "user-1",
      role: "artist",
    });
    expect(analyticsService.getArtistDashboard).toHaveBeenCalledWith("artist-1", 14);
  });

  it("rejects artist dashboard access when the authorization check fails", async () => {
    authorizationService.assertCanReadArtistMetrics.mockRejectedValue(
      new ForbiddenException("Artist analytics are restricted to the artist owner"),
    );

    await request(app.getHttpServer())
      .get("/analytics/artist/artist-2/v1")
      .set("Authorization", `Bearer ${authToken("user-1", "artist")}`)
      .expect(403);

    expect(analyticsService.getArtistDashboard).not.toHaveBeenCalled();
  });

  it("authorizes the legacy artist stats endpoint too", async () => {
    await request(app.getHttpServer())
      .get("/analytics/artist/artist-1?days=7")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .expect(200);

    expect(authorizationService.assertCanReadArtistMetrics).toHaveBeenCalledWith("artist-1", {
      userId: "admin-1",
      role: "admin",
    });
    expect(analyticsService.getArtistStats).toHaveBeenCalledWith("artist-1", 7);
  });
});
