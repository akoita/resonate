import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Request,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Response } from "express";
import { AnalyticsAuthorizationService } from "./analytics_authorization.service";
import {
  ANALYTICS_CONSENT_POLICY_VERSION,
  AnalyticsConsentService,
} from "./analytics_consent.service";
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
type ConsentRequest = { productAnalytics?: unknown; policyVersion?: unknown };

// #1772: the basis stamped on client-emitted telemetry that was collected after
// an explicit grant. Server-emitted domain records keep their own basis.
const CLIENT_TELEMETRY_CONSENT_BASIS = "consent";
const CONSENT_REFUSED_RESPONSE = { recorded: false, reason: "consent_not_granted" } as const;
const MAX_POLICY_VERSION_LENGTH = 100;

const PLAYBACK_LIFECYCLE_ACTIONS = new Set<PlaybackLifecycleAction>(["started", "heartbeat"]);
const REPEAT_MODES = new Set(["none", "one", "all"]);
const PRODUCT_EVENT_NAMES = new Set([
  "player.action_impression",
  "player.action_selected",
  "player.segment_loop_enabled",
  "player.segment_loop_updated",
  "player.segment_loop_disabled",
  "player.repeat_count_set",
  "player.repeat_count_updated",
  "player.repeat_count_cleared",
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
  "playlist.shared",
  "library.saved",
  "library.removed",
  "player.track_shared",
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
    private readonly analyticsConsentService: AnalyticsConsentService,
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

  /**
   * #1772: these three routes are the browser telemetry surface, so they are
   * consent-gated at ingest rather than in the client. Refusal is not a client
   * error — the route answers 202 with `recorded: false` so the client can stop
   * emitting, and nothing is written.
   */
  @Post("playback/completed")
  async recordPlaybackCompleted(
    @Body() body: PlaybackCompletedRequest,
    @Request() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const normalized = normalizePlaybackCompletedRequest(body);
    if (!(await this.analyticsConsentService.isProductAnalyticsAllowed(req.user?.userId))) {
      return refuseClientTelemetry(res);
    }
    return this.analyticsInstrumentationService.recordPlaybackCompleted(
      {
        ...normalized,
        actorId: pseudonymousAnalyticsActorId(req.user?.userId),
        actorUserId: req.user?.userId,
        consentBasis: CLIENT_TELEMETRY_CONSENT_BASIS,
      },
    );
  }

  @Post("playback/event")
  async recordPlaybackEvent(
    @Body() body: PlaybackLifecycleRequest,
    @Request() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const normalized = normalizePlaybackLifecycleRequest(body);
    if (!(await this.analyticsConsentService.isProductAnalyticsAllowed(req.user?.userId))) {
      return refuseClientTelemetry(res);
    }
    return this.analyticsInstrumentationService.recordPlaybackLifecycle(
      {
        ...normalized,
        actorId: pseudonymousAnalyticsActorId(req.user?.userId),
        actorUserId: req.user?.userId,
        consentBasis: CLIENT_TELEMETRY_CONSENT_BASIS,
      },
    );
  }

  @Post("product/event")
  async recordProductEvent(
    @Body() body: ProductEventRequest,
    @Request() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const actorId = pseudonymousAnalyticsActorId(req.user?.userId);
    const normalized = normalizeProductEventRequest(body);
    if (!(await this.analyticsConsentService.isProductAnalyticsAllowed(req.user?.userId))) {
      return refuseClientTelemetry(res);
    }
    return this.analyticsInstrumentationService.recordProductEvent(
      {
        ...normalized,
        ...defaultProductEventSubject(normalized, actorId),
        actorId,
        actorUserId: req.user?.userId,
        consentBasis: CLIENT_TELEMETRY_CONSENT_BASIS,
      },
    );
  }

  /**
   * The consent decision is read and written strictly for `req.user.userId`.
   * No user id is accepted from the body or the query string: an endpoint that
   * can be pointed at another account is a way to switch off someone else's
   * privacy choice.
   */
  @Get("consent")
  async getConsent(@Request() req: AuthenticatedRequest) {
    const decision = await this.analyticsConsentService.getDecision(requireUserId(req));
    // `currentPolicyVersion` lets a client notice its consent text is outdated
    // before it asks the person anything.
    return { ...decision, currentPolicyVersion: ANALYTICS_CONSENT_POLICY_VERSION };
  }

  /**
   * The client must declare which version of the consent text it displayed. A
   * mismatch is a 409, not a silent write: a browser showing outdated text must
   * reload and re-ask rather than have the person's answer recorded against
   * wording they never saw. What gets stored is always the server's constant.
   */
  @Put("consent")
  async updateConsent(@Body() body: ConsentRequest, @Request() req: AuthenticatedRequest) {
    const userId = requireUserId(req);
    if (typeof body?.productAnalytics !== "boolean") {
      throw new BadRequestException("productAnalytics must be a boolean");
    }
    const policyVersion = typeof body?.policyVersion === "string" ? body.policyVersion.trim() : "";
    if (!policyVersion || policyVersion.length > MAX_POLICY_VERSION_LENGTH) {
      throw new BadRequestException("policyVersion is required");
    }
    if (policyVersion !== ANALYTICS_CONSENT_POLICY_VERSION) {
      throw new ConflictException({
        error: "policy_version_stale",
        currentVersion: ANALYTICS_CONSENT_POLICY_VERSION,
      });
    }
    const decision = await this.analyticsConsentService.record(userId, body.productAnalytics);
    return { ...decision, currentPolicyVersion: ANALYTICS_CONSENT_POLICY_VERSION };
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

function refuseClientTelemetry(res: Response) {
  res.status(202);
  return CONSENT_REFUSED_RESPONSE;
}

function requireUserId(req: AuthenticatedRequest) {
  const userId = req.user?.userId?.trim();
  if (!userId) {
    throw new UnauthorizedException("Missing authenticated user for analytics consent");
  }
  return userId;
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
  const playerAction = eventName === "player.action_impression" || eventName === "player.action_selected";
  if (playerAction && (subjectType !== "track" || !subjectId)) {
    throw new BadRequestException("Player action events require a track subject");
  }

  return {
    eventName,
    sessionId: sessionId || undefined,
    traceId: traceId || undefined,
    subjectType: subjectType || undefined,
    subjectId: subjectId || undefined,
    source: playerAction ? "player" : source || "web_app",
    geo: normalizeAnalyticsGeoDimension(body.geo),
    payload: playerAction
      ? normalizePlayerActionPayload(eventName, body.payload)
      : eventName === "player.track_shared"
        ? normalizeTrackSharePayload(sanitizeProductPayload(body.payload))
        : eventName === "playlist.shared"
          ? normalizePlaylistSharePayload(sanitizeProductPayload(body.payload))
          : normalizePlayerControlPayload(eventName, sanitizeProductPayload(body.payload)),
    sourceRefs: clientEventId ? { clientEventId } : undefined,
  };
}

function defaultProductEventSubject(
  input: ProductAnalyticsInput,
  actorId: string | undefined,
): Pick<ProductAnalyticsInput, "subjectType" | "subjectId"> {
  if (
    actorId &&
    !input.subjectType &&
    !input.subjectId &&
    (input.eventName === "wallet.connected" || input.eventName === "wallet.faucet_requested")
  ) {
    return { subjectType: "user_wallet", subjectId: actorId };
  }
  return { subjectType: input.subjectType, subjectId: input.subjectId };
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

function normalizePlayerActionPayload(eventName: string, value: unknown): Record<string, unknown> {
  const keys = new Set(["save", "add_to_playlist", "inspect_stems", "buy_license", "remix", "artist_room", "shows_campaign", "collect_drop"]);
  const statuses = new Set(["available", "disabled", "planned"]);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Player action payload is required");
  }
  const payload = value as Record<string, unknown>;
  if (eventName === "player.action_selected") {
    if (typeof payload.actionKey !== "string" || !keys.has(payload.actionKey) || payload.actionStatus !== "available") {
      throw new BadRequestException("Invalid selected player action");
    }
    return { actionKey: payload.actionKey, actionStatus: payload.actionStatus, source: "player" };
  }
  const { actionKeys, actionStatuses } = payload;
  if (!Array.isArray(actionKeys) || !Array.isArray(actionStatuses)
      || actionKeys.length === 0 || actionKeys.length > keys.size
      || actionKeys.length !== actionStatuses.length
      || new Set(actionKeys).size !== actionKeys.length
      || !actionKeys.every((key) => typeof key === "string" && keys.has(key))
      || !actionStatuses.every((status) => typeof status === "string" && statuses.has(status))) {
    throw new BadRequestException("Invalid player action impression");
  }
  return { actionKeys, actionStatuses, source: "player" };
}

const TRACK_SHARE_CHANNELS = new Set(["x", "facebook", "reddit", "native", "copy"]);

/** `player.track_shared` carries identifiers and an enum channel only — no free text. */
function normalizeTrackSharePayload(payload: Record<string, unknown>) {
  if (typeof payload.channel !== "string" || !TRACK_SHARE_CHANNELS.has(payload.channel)) {
    throw new BadRequestException("Invalid share channel");
  }
  const allowed = new Set(["channel", "trackId", "releaseId"]);
  return Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => allowed.has(key) && typeof value === "string"),
  );
}

const PLAYLIST_SHARE_CHANNELS = new Set(["copy_link"]);
// Playlist ids are UUIDs; an id-shaped token keeps prose out of the field.
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** `playlist.shared` carries the playlist id and an enum channel only — no free text. */
function normalizePlaylistSharePayload(payload: Record<string, unknown>) {
  if (typeof payload.channel !== "string" || !PLAYLIST_SHARE_CHANNELS.has(payload.channel)) {
    throw new BadRequestException("Invalid share channel");
  }
  const playlistId = typeof payload.playlistId === "string" ? payload.playlistId.trim() : "";
  if (!PLAYLIST_ID_PATTERN.test(playlistId)) {
    throw new BadRequestException("playlistId is required");
  }
  return { playlistId, channel: payload.channel };
}

function normalizePlayerControlPayload(eventName: string, payload: Record<string, unknown>) {
  const segment = eventName.startsWith("player.segment_loop_");
  if (!segment && !eventName.startsWith("player.repeat_count_")) return payload;
  const fields = segment ? ["startMs", "endMs", "segmentDurationMs"] : ["configured", "remaining"];
  for (const field of fields) {
    if (typeof payload[field] !== "number" || !Number.isFinite(payload[field]) || (payload[field] as number) < 0) {
      throw new BadRequestException(`Invalid ${field}`);
    }
  }
  if (segment) {
    if ((payload.endMs as number) <= (payload.startMs as number)
        || Math.abs((payload.endMs as number) - (payload.startMs as number) - (payload.segmentDurationMs as number)) > 1) {
      throw new BadRequestException("Invalid segment range");
    }
  } else if (!["track", "queue"].includes(payload.target as string)
      || !Number.isSafeInteger(payload.configured) || (payload.configured as number) < 1
      || !Number.isSafeInteger(payload.remaining) || (payload.remaining as number) > (payload.configured as number)) {
    throw new BadRequestException("Invalid finite repeat plan");
  }
  const allowed = new Set([...fields, ...(!segment ? ["target"] : []), "trackId", "artistId", "releaseId", "playbackInstanceId", "queueLength", "shuffle"]);
  return Object.fromEntries(Object.entries(payload).filter(([key]) => allowed.has(key)));
}
