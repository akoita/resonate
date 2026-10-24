import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { StemFeatureBackfillService } from "../ingestion/stem-feature-backfill.service";
import { TrackEmbeddingService } from "../embeddings/track_embedding.service";
import {
  AnalyticsWarehouseLoadDto,
  CommunityCohortGenerationDto,
  EmbeddingBackfillDto,
  ResolveCommunityModerationReportDto,
  RunDueErasuresDto,
  StemFeatureBackfillDto,
} from "./maintenance.dto";
import { MaintenanceService } from "./maintenance.service";
import { AdminAudit, auditBody, auditBoolean, auditCode, auditNumber, auditRef } from "../admin_audit/admin_audit.interceptor";
import { RequireStepUp } from "../admin_step_up/require_step_up.decorator";

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
   * `status: "worker_unavailable"`. Body `refresh: true` also re-measures
   * stems analyzed with an older analysis revision (#2016). Stems whose
   * analysis failed are held back and counted in `failed` (#2012); body
   * `retryFailed: true` re-attempts them.
   */
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("stems/backfill-audio-features")
  @AdminAudit("maintenance.stem_features_backfill_run", (c) => ({ detail: { limit: auditNumber(auditBody(c).limit), refresh: auditBoolean(auditBody(c).refresh), retryFailed: auditBoolean(auditBody(c).retryFailed) } }))
  async backfillStemAudioFeatures(@Body() body: StemFeatureBackfillDto) {
    return this.stemFeatureBackfillService.backfill(body ?? {});
  }

  /**
   * Remaining stems lacking audio features, without calling any worker (#2013).
   * `types` is a comma-separated list, e.g. `?types=original`. With
   * `?refresh=true` it also counts stems whose stored features come from an
   * older analysis revision (#2016), matching a `refresh: true` backfill.
   */
  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Get("stems/backfill-audio-features")
  async getStemAudioFeatureBackfillStatus(
    @Query("types") types?: string,
    @Query("refresh") refresh?: string,
  ) {
    return this.stemFeatureBackfillService.status({
      types: typeof types === "string" && types ? types.split(",").map((t) => t.trim()) : undefined,
      refresh: refresh === "true",
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
  @AdminAudit("maintenance.track_embeddings_backfill_run", (c) => ({ detail: { limit: auditNumber(auditBody(c).limit) } }))
  async backfillTrackEmbeddings(@Body() body: EmbeddingBackfillDto) {
    return this.trackEmbeddingService.backfill(body ?? {});
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("retention/cleanup")
  @RequireStepUp()
  @AdminAudit("maintenance.retention_cleanup_run")
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
  @RequireStepUp()
  @AdminAudit("maintenance.erasures_run", (c) => ({ detail: { limit: auditNumber(auditBody(c).limit) } }))
  async runDueAccountErasures(@Body() body: RunDueErasuresDto) {
    return this.maintenanceService.runDueAccountErasures(body ?? {});
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("analytics/warehouse/load")
  @AdminAudit("maintenance.analytics_warehouse_loaded", (c) => ({ detail: { eventFamily: auditRef(auditBody(c).eventFamily), runId: auditRef(auditBody(c).runId), dryRun: auditBoolean(auditBody(c).dryRun) } }))
  async loadAnalyticsWarehouse(@Body() body: AnalyticsWarehouseLoadDto) {
    return this.maintenanceService.loadAnalyticsWarehouse(body ?? {});
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Post("analytics/warehouse/backfill")
  @AdminAudit("maintenance.analytics_warehouse_backfilled", (c) => ({ detail: { eventFamily: auditRef(auditBody(c).eventFamily), runId: auditRef(auditBody(c).runId), dryRun: auditBoolean(auditBody(c).dryRun) } }))
  async backfillAnalyticsWarehouse(@Body() body: AnalyticsWarehouseLoadDto) {
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
  @AdminAudit("maintenance.community_cohorts_generated", (c) => ({ detail: { minimumSize: auditNumber(auditBody(c).minimumSize) } }))
  async generateCommunityCohorts(@Body() body: CommunityCohortGenerationDto) {
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
  @AdminAudit("community_moderation.queue_viewed", (c) => ({ detail: { status: auditCode(c.query.status, ["open", "resolved", "dismissed"] as const) } }))
  async getCommunityModerationQueue(@Query("status") status?: string, @Query("limit") limit?: string) {
    return this.maintenanceService.getCommunityModerationQueue({ status, limit });
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @Roles("admin")
  @Patch("community/moderation/reports/:reportId")
  @RequireStepUp()
  @AdminAudit("community_moderation.report_resolved", (c) => ({
    detail: {
      reportId: auditRef(c.params.reportId),
      action: auditCode(auditBody(c).action, ["no_action", "delete_message", "remove_member", "ban_member", "pause_room", "archive_room"] as const),
    },
  }))
  async resolveCommunityModerationReport(
    @Req() req: any,
    @Param("reportId") reportId: string,
    @Body() body: ResolveCommunityModerationReportDto,
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
  @RequireStepUp()
  @AdminAudit("maintenance.releases_wiped")
  wipeReleases() {
    return this.maintenanceService.wipeReleases();
  }
}
