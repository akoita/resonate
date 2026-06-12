import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { AnalyticsWarehouseLoadRequest } from "../analytics/analytics_warehouse_loader";
import { CommunityCohortGenerationRequest } from "../community/community_cohort_generation.service";
import {
  StemFeatureBackfillRequest,
  StemFeatureBackfillService,
} from "../ingestion/stem-feature-backfill.service";
import { MaintenanceService } from "./maintenance.service";

@Controller("admin")
export class MaintenanceController {
  constructor(
    private readonly maintenanceService: MaintenanceService,
    private readonly stemFeatureBackfillService: StemFeatureBackfillService,
  ) {}

  /**
   * Backfills measured audio features (#1184) for stems ingested before
   * feature extraction shipped. Batch-bounded; re-run until remaining=0.
   */
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("stems/backfill-audio-features")
  async backfillStemAudioFeatures(@Body() body: StemFeatureBackfillRequest) {
    return this.stemFeatureBackfillService.backfill(body ?? {});
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("retention/cleanup")
  async cleanup() {
    return this.maintenanceService.runRetentionCleanup();
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("analytics/warehouse/load")
  async loadAnalyticsWarehouse(@Body() body: AnalyticsWarehouseLoadRequest) {
    return this.maintenanceService.loadAnalyticsWarehouse(body ?? {});
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("analytics/warehouse/backfill")
  async backfillAnalyticsWarehouse(@Body() body: AnalyticsWarehouseLoadRequest) {
    return this.maintenanceService.backfillAnalyticsWarehouse(body ?? {});
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Get("analytics/pipeline/health")
  async getAnalyticsPipelineHealth() {
    return this.maintenanceService.getAnalyticsPipelineHealth();
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("community/cohorts/generate")
  async generateCommunityCohorts(@Body() body: CommunityCohortGenerationRequest) {
    return this.maintenanceService.generateCommunityCohorts(body ?? {});
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Get("community/cohorts/quality")
  async getCommunityCohortQuality() {
    return this.maintenanceService.getCommunityCohortQuality();
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Get("community/moderation/reports")
  async getCommunityModerationQueue(@Query("status") status?: string, @Query("limit") limit?: string) {
    return this.maintenanceService.getCommunityModerationQueue({ status, limit });
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Patch("community/moderation/reports/:reportId")
  async resolveCommunityModerationReport(
    @Req() req: any,
    @Param("reportId") reportId: string,
    @Body() body: Parameters<MaintenanceService["resolveCommunityModerationReport"]>[2],
  ) {
    return this.maintenanceService.resolveCommunityModerationReport(
      { userId: req.user.userId, role: req.user.role },
      reportId,
      body ?? {},
    );
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Delete("wipe-releases")
  wipeReleases() {
    return this.maintenanceService.wipeReleases();
  }
}
