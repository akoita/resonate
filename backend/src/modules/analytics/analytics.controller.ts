import { BadRequestException, Body, Controller, Get, Param, Post, Query, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AnalyticsAuthorizationService } from "./analytics_authorization.service";
import { AnalyticsIngestService } from "./analytics_ingest.service";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsEventInput, normalizeAnalyticsGeoDimension } from "./analytics_event";
import { AnalyticsWarehouseExportService } from "./analytics_warehouse";
import {
  AnalyticsInstrumentationService,
  PlaybackCompletedAnalyticsInput,
  PlaybackLifecycleAction,
  PlaybackLifecycleAnalyticsInput,
  ProductAnalyticsInput,
} from "./analytics_instrumentation.service";
import { pseudonymousAnalyticsActorId } from "./analytics_identity";
import { writeStructuredLog } from "../shared/structured_logging";

type PlaybackCompletedRequest = Partial<PlaybackCompletedAnalyticsInput>;
type PlaybackLifecycleRequest = Partial<PlaybackLifecycleAnalyticsInput>;
type ProductEventRequest = Partial<ProductAnalyticsInput> & {
  clientEventId?: unknown;
};
type AuthenticatedRequest = { user?: { userId?: string; role?: string } };

const PLAYBACK_LIFECYCLE_ACTIONS = new Set<PlaybackLifecycleAction>(["started", "heartbeat"]);
const REPEAT_MODES = new Set(["none", "one", "all"]);
const PRODUCT_EVENT_NAMES = new Set([
  "onboarding.started",
  "onboarding.step_viewed",
  "onboarding.step_completed",
  "onboarding.completed",
  "onboarding.abandoned",
  "playlist.created",
  "playlist.updated",
  "playlist.track_added",
  "playlist.track_removed",
  "playlist.played",
  "library.saved",
  "library.removed",
  "search.submitted",
  "search.result_clicked",
  "marketplace.listing_viewed",
  "marketplace.checkout_started",
  "marketplace.purchase_intent",
  "marketplace.owner_inventory_viewed",
  "artist.upload_started",
  "artist.upload_step_completed",
  "artist.catalog_viewed",
  "artist.action_card_impression",
  "artist.action_card_clicked",
  "wallet.connected",
  "wallet.faucet_requested",
  "wallet.budget_set",
  "agent.intent_viewed",
  "agent.intent_selected",
  "agent.session_started",
  "agent.session_stopped",
  "agent.next_pick_requested",
  "settings.updated",
  "taste_memory.settings_updated",
  "taste_memory.signal_hidden",
  "taste_memory.signal_restored",
  "taste_memory.reset",
  "community.profile_updated",
  "community.profile_visibility_updated",
  "community.profile_showcase_updated",
  "community.artist_tab_viewed",
  "community.room_selected",
  "community.room_join_clicked",
  "remix.cta_impression",
  "remix.cta_clicked",
  "remix.studio_opened",
  "remix.studio_saved",
  "remix.studio_action_unavailable",
  "shows.signal_created",
  "shows.campaign_created",
  "shows.campaign_visuals_updated",
  "shows.pledge_intent_created",
  "shows.pledge_submitted",
  "shows.pledge_confirmed",
  "shows.pledge_failed",
  "punchline.drop_viewed",
  "punchline.preview_played",
  "punchline.collect_started",
  "punchline.collect_completed",
  "punchline.moment_shared",
  "recommendation.served",
  "recommendation.clicked",
]);

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

  @Get("agent/quality")
  async getAgentQualityDashboard(
    @Query("days") days: string | undefined,
    @Request() req: any
  ) {
    this.analyticsAuthorizationService.assertCanReadAgentQualityDashboard(req.user);
    return this.analyticsService.getAgentQualityDashboard(Number(days ?? 30));
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
  async recordPlaybackCompleted(
    @Body() body: PlaybackCompletedRequest,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.analyticsInstrumentationService.recordPlaybackCompleted(
      {
        ...normalizePlaybackCompletedRequest(body),
        actorId: pseudonymousAnalyticsActorId(req.user?.userId),
        actorUserId: req.user?.userId,
      },
    );
  }

  @Post("playback/event")
  async recordPlaybackEvent(
    @Body() body: PlaybackLifecycleRequest,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.analyticsInstrumentationService.recordPlaybackLifecycle(
      {
        ...normalizePlaybackLifecycleRequest(body),
        actorId: pseudonymousAnalyticsActorId(req.user?.userId),
        actorUserId: req.user?.userId,
      },
    );
  }

  @Post("product/event")
  async recordProductEvent(
    @Body() body: ProductEventRequest,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.analyticsInstrumentationService.recordProductEvent(
      {
        ...normalizeProductEventRequest(body),
        actorId: pseudonymousAnalyticsActorId(req.user?.userId),
        actorUserId: req.user?.userId,
      },
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
  const initiator = normalizePlaybackInitiator(body.initiator);
  const agentOriginated = typeof body.agentOriginated === "boolean" ? body.agentOriginated : undefined;
  const agentSessionId = typeof body.agentSessionId === "string" ? body.agentSessionId.trim() : undefined;
  const playbackCommandId = typeof body.playbackCommandId === "string" ? body.playbackCommandId.trim() : undefined;
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
    initiator,
    agentOriginated,
    agentSessionId: agentSessionId || undefined,
    playbackCommandId: playbackCommandId || undefined,
    geo: normalizeAnalyticsGeoDimension(body.geo),
    completionRatio,
    durationMs,
  };
}

function normalizePlaybackLifecycleRequest(body: PlaybackLifecycleRequest): PlaybackLifecycleAnalyticsInput {
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const trackId = typeof body.trackId === "string" ? body.trackId.trim() : "";
  const artistId = typeof body.artistId === "string" ? body.artistId.trim() : undefined;
  const releaseId = typeof body.releaseId === "string" ? body.releaseId.trim() : undefined;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : undefined;
  const playbackInstanceId =
    typeof body.playbackInstanceId === "string" ? body.playbackInstanceId.trim() : undefined;
  const source = typeof body.source === "string" ? body.source.trim() : undefined;
  const initiator = normalizePlaybackInitiator(body.initiator);
  const agentOriginated = typeof body.agentOriginated === "boolean" ? body.agentOriginated : undefined;
  const agentSessionId = typeof body.agentSessionId === "string" ? body.agentSessionId.trim() : undefined;
  const playbackCommandId = typeof body.playbackCommandId === "string" ? body.playbackCommandId.trim() : undefined;
  const positionMs = optionalNonNegativeNumber(body.positionMs, "positionMs");
  const durationMs = optionalNonNegativeNumber(body.durationMs, "durationMs");
  const heartbeatIntervalMs = optionalNonNegativeNumber(body.heartbeatIntervalMs, "heartbeatIntervalMs");
  const queueIndex = optionalNonNegativeInteger(body.queueIndex, "queueIndex");
  const queueLength = optionalNonNegativeInteger(body.queueLength, "queueLength");
  const repeatMode = typeof body.repeatMode === "string" ? body.repeatMode.trim() : undefined;

  if (!PLAYBACK_LIFECYCLE_ACTIONS.has(action as PlaybackLifecycleAction)) {
    throw new BadRequestException("action must be one of: started, heartbeat");
  }
  if (!trackId) {
    throw new BadRequestException("trackId is required");
  }
  if (repeatMode !== undefined && !REPEAT_MODES.has(repeatMode)) {
    throw new BadRequestException("repeatMode must be one of: none, one, all");
  }
  if (body.shuffle !== undefined && typeof body.shuffle !== "boolean") {
    throw new BadRequestException("shuffle must be a boolean");
  }

  return {
    action: action as PlaybackLifecycleAction,
    trackId,
    artistId: artistId || undefined,
    releaseId: releaseId || undefined,
    sessionId: sessionId || undefined,
    playbackInstanceId: playbackInstanceId || undefined,
    source: source || "web_player",
    initiator,
    agentOriginated,
    agentSessionId: agentSessionId || undefined,
    playbackCommandId: playbackCommandId || undefined,
    geo: normalizeAnalyticsGeoDimension(body.geo),
    positionMs,
    durationMs,
    heartbeatIntervalMs,
    queueIndex,
    queueLength,
    repeatMode: repeatMode as PlaybackLifecycleAnalyticsInput["repeatMode"],
    shuffle: body.shuffle,
  };
}

function normalizePlaybackInitiator(value: unknown) {
  if (value === "listener" || value === "external_agent" || value === "ai_dj") {
    return value;
  }
  return undefined;
}

function optionalNonNegativeNumber(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined;
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new BadRequestException(`${fieldName} must be a non-negative number`);
  }
  return numericValue;
}

function optionalNonNegativeInteger(value: unknown, fieldName: string) {
  const numericValue = optionalNonNegativeNumber(value, fieldName);
  if (numericValue === undefined) {
    return undefined;
  }
  if (!Number.isInteger(numericValue)) {
    throw new BadRequestException(`${fieldName} must be a non-negative integer`);
  }
  return numericValue;
}

function normalizeProductEventRequest(body: ProductEventRequest): ProductAnalyticsInput {
  const eventName = typeof body.eventName === "string" ? body.eventName.trim() : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : undefined;
  const traceId = typeof body.traceId === "string" ? body.traceId.trim() : undefined;
  const subjectType = typeof body.subjectType === "string" ? body.subjectType.trim() : undefined;
  const subjectId = typeof body.subjectId === "string" ? body.subjectId.trim() : undefined;
  const source = typeof body.source === "string" ? body.source.trim() : undefined;
  const clientEventId = typeof body.clientEventId === "string" ? body.clientEventId.trim() : undefined;

  if (!PRODUCT_EVENT_NAMES.has(eventName)) {
    logProductAnalyticsRejection("unsupported_event_name", eventName);
    throw new BadRequestException("eventName is not an allowed product analytics event");
  }
  if ((subjectType && !subjectId) || (!subjectType && subjectId)) {
    logProductAnalyticsRejection("invalid_subject_pair", eventName);
    throw new BadRequestException("subjectType and subjectId must be provided together");
  }

  return {
    eventName,
    sessionId: sessionId || undefined,
    traceId: traceId || undefined,
    subjectType: subjectType || undefined,
    subjectId: subjectId || undefined,
    source: source || "web_app",
    geo: normalizeAnalyticsGeoDimension(body.geo),
    payload: sanitizeProductPayload(body.payload),
    sourceRefs: clientEventId ? { clientEventId } : undefined,
  };
}

function logProductAnalyticsRejection(reason: string, eventName: string) {
  writeStructuredLog(
    {
      level: "warn",
      event: "analytics_product_event_rejected",
      message: "Rejected product analytics event payload",
      reason,
      eventName: eventName || "missing",
      endpoint: "POST /analytics/product/event",
    },
    console.warn,
  );
}

function sanitizeProductPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload).slice(0, 50)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) {
      continue;
    }
    if (isBlockedAnalyticsPayloadKey(key)) {
      continue;
    }
    const sanitizedValue = sanitizeProductPayloadValue(value);
    if (sanitizedValue !== undefined) {
      sanitized[key] = sanitizedValue;
    }
  }
  return sanitized;
}

function isBlockedAnalyticsPayloadKey(key: string) {
  return /(^|_)(ip|rawIp|latitude|longitude|lat|lng|gps|geo)(_|$)/i.test(key);
}

function sanitizeProductPayloadValue(value: unknown): string | number | boolean | Array<string | number | boolean> | undefined {
  if (typeof value === "string") {
    return value.slice(0, 240);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    const values = value
      .map((entry) => sanitizeProductPayloadValue(entry))
      .filter((entry): entry is string | number | boolean => ["string", "number", "boolean"].includes(typeof entry));
    return values.slice(0, 20);
  }
  return undefined;
}
