import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AnalyticsAuthorizationService } from "./analytics_authorization.service";
import { AnalyticsIngestService } from "./analytics_ingest.service";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsEventInput } from "./analytics_event";
import { AnalyticsWarehouseExportService } from "./analytics_warehouse";

@UseGuards(AuthGuard("jwt"))
@Controller("analytics")
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly analyticsAuthorizationService: AnalyticsAuthorizationService,
    private readonly analyticsIngestService: AnalyticsIngestService,
    private readonly warehouseExportService: AnalyticsWarehouseExportService
  ) {}

  @Get("artist/:id")
  async getArtist(
    @Param("id") artistId: string,
    @Query("days") days: string | undefined,
    @Request() req: any
  ) {
    await this.analyticsAuthorizationService.assertCanReadArtistMetrics(artistId, req.user);
    return this.analyticsService.getArtistStats(artistId, Number(days ?? 7));
  }

  @Get("artist/:id/v1")
  async getArtistDashboard(
    @Param("id") artistId: string,
    @Query("days") days: string | undefined,
    @Request() req: any
  ) {
    await this.analyticsAuthorizationService.assertCanReadArtistMetrics(artistId, req.user);
    return this.analyticsService.getArtistDashboard(artistId, Number(days ?? 30));
  }

  @Post("ingest")
  async ingest(@Body() body: AnalyticsEventInput) {
    return this.analyticsIngestService.ingest(body);
  }

  @Get("rollup/daily")
  async rollup() {
    return this.analyticsIngestService.dailyRollup();
  }

  @Get("export/layers")
  async exportLayers() {
    return this.warehouseExportService.exportLayers();
  }
}
