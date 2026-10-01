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
import {
  EmbeddingBackfillRequest,
  TrackEmbeddingService,
} from "../embeddings/track_embedding.service";
import { MaintenanceService } from "./maintenance.service";

@Controller("admin")
export class MaintenanceController {
  constructor(
    private readonly maintenanceService: MaintenanceService,
    private readonly stemFeatureBackfillService: StemFeatureBackfillService,
    private readonly trackEmbeddingService: TrackEmbeddingService,
  ) {}

  /**
   * Backfills measured audio features (#1184) for stems ingested before
   * feature extraction shipped. Batch-bounded; re-run until remaining=0.
   * Transport follows configuration (#2013): synchronous HTTP to the demucs
   * worker when DEMUCS_WORKER_URL is set (result carries `updated`), else an
   * analysis message through the Pub/Sub/Cloud Run Job dispatch (result is
   * `status: "dispatched"`; poll `remaining` or the GET route). With neither,
   * `status: "worker_unavailable"`.
   */
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("stems/backfill-audio-features")
  async backfillStemAudioFeatures(@Body() body: StemFeatureBackfillRequest) {
    return this.stemFeatureBackfillService.backfill(body ?? {});
  }

  /**
   * Remaining stems lacking audio features, without calling any worker (#2013).
   * `types` is a comma-separated list, e.g. `?types=original`.
   */
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Get("stems/backfill-audio-features")
  async getStemAudioFeatureBackfillStatus(@Query("types") types?: string) {
    return this.stemFeatureBackfillService.status({
      types: typeof types === "string" && types ? types.split(",").map((t) => t.trim()) : undefined,
    });
  }

  /**
   * Backfills track text embeddings (#1452, WS-5) for tracks published before
   * embed-on-ingest shipped, and re-verifies stale ones. Batch-bounded
   * (1-200 per run, default 50); re-run until remaining=0. Each run makes
   * metered embedding-model calls only for tracks that need a vector.
   */
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("embeddings/backfill")
  async backfillTrackEmbeddings(@Body() body: EmbeddingBackfillRequest) {
    return this.trackEmbeddingService.backfill(body ?? {});
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("retention/cleanup")
  async cleanup() {
    return this.maintenanceService.runRetentionCleanup();
  }

  /**
   * Run the erasures whose closure window has elapsed (#1771 slice 3).
   *
   * Shaped like `retention/cleanup` next to it, and called by the same external
   * scheduler: nothing in this codebase runs on a `@Cron`. Admin-guarded like
   * every other route here — an erasure is irreversible, and the person's own
   * request is what schedules it, not this call.
   */
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("erasure/run-due")
  async runDueAccountErasures(@Body() body: { limit?: number }) {
    return this.maintenanceService.runDueAccountErasures(body ?? {});
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
