import { BadRequestException, Body, Controller, Get, Param, Post, Query, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AnalyticsAuthorizationService } from "./analytics_authorization.service";
import { AnalyticsIngestService } from "./analytics_ingest.service";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsEventInput } from "./analytics_event";
import { AnalyticsWarehouseExportService } from "./analytics_warehouse";
import { AnalyticsInstrumentationService, PlaybackCompletedAnalyticsInput } from "./analytics_instrumentation.service";

type PlaybackCompletedRequest = Partial<PlaybackCompletedAnalyticsInput>;

@UseGuards(AuthGuard("jwt"))
@Controller("analytics")
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly analyticsAuthorizationService: AnalyticsAuthorizationService,
    private readonly analyticsIngestService: AnalyticsIngestService,
    private readonly warehouseExportService: AnalyticsWarehouseExportService,
    private readonly analyticsInstrumentationService: AnalyticsInstrumentationService,
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

  @Post("playback/completed")
  async recordPlaybackCompleted(@Body() body: PlaybackCompletedRequest) {
    return this.analyticsInstrumentationService.recordPlaybackCompleted(
      normalizePlaybackCompletedRequest(body),
    );
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

function normalizePlaybackCompletedRequest(body: PlaybackCompletedRequest): PlaybackCompletedAnalyticsInput {
  const trackId = typeof body.trackId === "string" ? body.trackId.trim() : "";
  const artistId = typeof body.artistId === "string" ? body.artistId.trim() : undefined;
  const releaseId = typeof body.releaseId === "string" ? body.releaseId.trim() : undefined;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : undefined;
  const source = typeof body.source === "string" ? body.source.trim() : undefined;
  const completionRatio = Number(body.completionRatio);
  const durationMs = body.durationMs === undefined ? undefined : Number(body.durationMs);

  if (!trackId) {
    throw new BadRequestException("trackId is required");
  }
  if (!Number.isFinite(completionRatio) || completionRatio < 0 || completionRatio > 1) {
    throw new BadRequestException("completionRatio must be a number between 0 and 1");
  }
  if (durationMs !== undefined && (!Number.isFinite(durationMs) || durationMs < 0)) {
    throw new BadRequestException("durationMs must be a non-negative number");
  }

  return {
    trackId,
    artistId: artistId || undefined,
    releaseId: releaseId || undefined,
    sessionId: sessionId || undefined,
    source: source || "web_player",
    completionRatio,
    durationMs,
  };
}
