import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import {
  PlaybackCommandAction,
  PlaybackConfirmationMode,
  PlaybackIntentsService,
  PlaybackIntentOutcome,
  PlaybackSource,
} from "./playback_intents.service";
import { SessionsService } from "./sessions.service";

@Controller("sessions")
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly playbackIntentsService?: PlaybackIntentsService,
  ) {}

  @UseGuards(AuthGuard("jwt"))
  @Post("start")
  start(
    @Body()
    body: {
      userId: string;
      budgetCapUsd: number;
      preferences?: {
        mood?: string;
        energy?: "low" | "medium" | "high";
        genres?: string[];
        allowExplicit?: boolean;
        licenseType?: "personal" | "remix" | "commercial";
        sessionIntent?: string;
        sessionIntentName?: string;
        queueStyle?: string;
        source?: string;
      };
    }
  ) {
    return this.sessionsService.startSession(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("stop")
  stop(@Body() body: { sessionId: string }) {
    return this.sessionsService.stopSession(body.sessionId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("play")
  play(@Body() body: { sessionId: string; trackId: string; priceUsd: number }) {
    return this.sessionsService.playTrack(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("agent/next")
  agentNext(
    @Body()
    body: {
      sessionId: string;
      preferences?: {
        mood?: string;
        energy?: "low" | "medium" | "high";
        genres?: string[];
        allowExplicit?: boolean;
        licenseType?: "personal" | "remix" | "commercial";
        sessionIntent?: string;
        sessionIntentName?: string;
        queueStyle?: string;
        source?: string;
      };
    }
  ) {
    return this.sessionsService.agentNext(body);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("playlist")
  playlist(@Query("limit") limit?: string) {
    const parsed = limit ? Number(limit) : 10;
    return this.sessionsService.getPlaylist(Number.isNaN(parsed) ? 10 : parsed);
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("playback/capabilities")
  playbackCapabilities(@Request() req: AuthenticatedPlaybackRequest) {
    return this.playbackIntents().capabilitiesForOwner(authenticatedUserId(req));
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("playback/capabilities")
  createPlaybackCapability(
    @Body()
    body: {
      scopes?: unknown;
      allowedSources?: unknown;
      confirmationMode?: unknown;
      expiresAt?: unknown;
      rateLimitPerMinute?: unknown;
    },
    @Request() req: AuthenticatedPlaybackRequest,
  ) {
    return this.playbackIntents().createCapability(authenticatedUserId(req), {
      scopes: Array.isArray(body.scopes) ? body.scopes as any : undefined,
      allowedSources: Array.isArray(body.allowedSources)
        ? body.allowedSources.map(normalizePlaybackSource).filter(Boolean) as PlaybackSource[]
        : undefined,
      confirmationMode: normalizePlaybackConfirmationMode(body.confirmationMode),
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
      rateLimitPerMinute: typeof body.rateLimitPerMinute === "number" ? body.rateLimitPerMinute : undefined,
    });
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("playback/capabilities/:capabilityId/revoke")
  revokePlaybackCapability(
    @Param("capabilityId") capabilityId: string,
    @Request() req: AuthenticatedPlaybackRequest,
  ) {
    return this.playbackIntents().revokeCapability(authenticatedUserId(req), capabilityId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("playback/device")
  registerPlaybackDevice(
    @Body()
    body: {
      deviceId?: unknown;
      label?: unknown;
      active?: unknown;
      supports?: unknown;
      currentTrackId?: unknown;
      state?: unknown;
    },
    @Request() req: AuthenticatedPlaybackRequest,
  ) {
    return this.playbackIntents().registerDevice(authenticatedUserId(req), {
      deviceId: typeof body.deviceId === "string" ? body.deviceId : undefined,
      label: typeof body.label === "string" ? body.label : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      supports: Array.isArray(body.supports) ? body.supports as any : undefined,
      currentTrackId: typeof body.currentTrackId === "string" ? body.currentTrackId : undefined,
      state: body.state === "playing" || body.state === "paused" || body.state === "idle" ? body.state : undefined,
    });
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("playback/resolve")
  resolvePlaybackIntent(
    @Body()
    body: {
      query?: unknown;
      constraints?: unknown;
      capabilityId?: unknown;
      initiator?: unknown;
      sessionId?: unknown;
    },
    @Request() req: AuthenticatedPlaybackRequest,
  ) {
    return this.playbackIntents().resolve(authenticatedUserId(req), {
      query: typeof body.query === "string" ? body.query : undefined,
      constraints: sanitizePlaybackConstraints(body.constraints),
      capabilityId: typeof body.capabilityId === "string" ? body.capabilityId : undefined,
      initiator: normalizePlaybackInitiator(body.initiator),
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
    });
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("playback/queue")
  queuePlaybackIntent(
    @Body() body: PlaybackCommandRequestBody,
    @Request() req: AuthenticatedPlaybackRequest,
  ) {
    return this.playbackIntents().requestQueue(authenticatedUserId(req), sanitizePlaybackCommandBody(body));
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("playback/play")
  playPlaybackIntent(
    @Body() body: PlaybackCommandRequestBody,
    @Request() req: AuthenticatedPlaybackRequest,
  ) {
    return this.playbackIntents().requestPlay(authenticatedUserId(req), sanitizePlaybackCommandBody(body));
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("playback/control")
  controlPlaybackIntent(
    @Body() body: PlaybackCommandRequestBody & { action?: unknown },
    @Request() req: AuthenticatedPlaybackRequest,
  ) {
    return this.playbackIntents().requestControl(authenticatedUserId(req), {
      ...sanitizePlaybackCommandBody(body),
      action: normalizePlaybackControlAction(body.action),
    });
  }

  @UseGuards(AuthGuard("jwt"))
  @Post("playback/commands/:commandId/confirm")
  confirmPlaybackCommand(
    @Param("commandId") commandId: string,
    @Body()
    body: {
      deviceId?: unknown;
      outcome?: unknown;
      status?: unknown;
      currentTrackId?: unknown;
      reason?: unknown;
    },
    @Request() req: AuthenticatedPlaybackRequest,
  ) {
    return this.playbackIntents().confirmCommand(authenticatedUserId(req), {
      commandId,
      deviceId: typeof body.deviceId === "string" ? body.deviceId : undefined,
      outcome: normalizePlaybackOutcome(body.outcome),
      status: typeof body.status === "string" ? body.status as any : undefined,
      currentTrackId: typeof body.currentTrackId === "string" ? body.currentTrackId : undefined,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    });
  }

  @UseGuards(AuthGuard("jwt"))
  @Get("playback/status")
  playbackStatus(
    @Query("commandId") commandId: string | undefined,
    @Request() req: AuthenticatedPlaybackRequest,
  ) {
    return this.playbackIntents().status(authenticatedUserId(req), commandId);
  }

  private playbackIntents() {
    if (!this.playbackIntentsService) {
      throw new Error("PlaybackIntentsService is not configured");
    }
    return this.playbackIntentsService;
  }
}

type AuthenticatedPlaybackRequest = { user?: { userId?: string; sub?: string } };

type PlaybackCommandRequestBody = {
  trackIds?: unknown;
  deviceId?: unknown;
  sessionId?: unknown;
  capabilityId?: unknown;
  source?: unknown;
  initiator?: unknown;
  agentOriginated?: unknown;
};

function authenticatedUserId(req: AuthenticatedPlaybackRequest) {
  const userId = req.user?.userId || req.user?.sub;
  if (!userId) {
    throw new Error("Authenticated user id is missing");
  }
  return userId;
}

function sanitizePlaybackConstraints(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const constraints = value as Record<string, unknown>;
  return {
    maxTracks: typeof constraints.maxTracks === "number" ? constraints.maxTracks : undefined,
    explicit: typeof constraints.explicit === "boolean" ? constraints.explicit : undefined,
    source: normalizePlaybackSource(constraints.source),
    genres: Array.isArray(constraints.genres) ? constraints.genres as any : undefined,
    mood: typeof constraints.mood === "string" ? constraints.mood : undefined,
  };
}

function sanitizePlaybackCommandBody(body: PlaybackCommandRequestBody) {
  return {
    trackIds: Array.isArray(body.trackIds) ? body.trackIds as string[] : undefined,
    deviceId: typeof body.deviceId === "string" ? body.deviceId : undefined,
    sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
    capabilityId: typeof body.capabilityId === "string" ? body.capabilityId : undefined,
    source: normalizePlaybackSource(body.source),
    initiator: normalizePlaybackInitiator(body.initiator),
    agentOriginated: typeof body.agentOriginated === "boolean" ? body.agentOriginated : undefined,
  };
}

function normalizePlaybackInitiator(value: unknown): "listener" | "external_agent" | "ai_dj" | undefined {
  if (value === "listener" || value === "external_agent" || value === "ai_dj") {
    return value;
  }
  return undefined;
}

function normalizePlaybackOutcome(value: unknown): PlaybackIntentOutcome {
  if (
    value === "queued" ||
    value === "playing" ||
    value === "confirmation_required" ||
    value === "no_active_device" ||
    value === "blocked_by_policy" ||
    value === "unavailable"
  ) {
    return value;
  }
  return "unavailable";
}

function normalizePlaybackSource(value: unknown): PlaybackSource | undefined {
  if (value === "resonate_catalog" || value === "library" || value === "purchased" || value === "preview") {
    return value;
  }
  return undefined;
}

function normalizePlaybackConfirmationMode(value: unknown): PlaybackConfirmationMode | undefined {
  if (value === "propose_only" || value === "queue_with_confirmation" || value === "remote_control_when_active") {
    return value;
  }
  return undefined;
}

function normalizePlaybackControlAction(value: unknown): PlaybackCommandAction | undefined {
  if (value === "pause" || value === "resume" || value === "skip" || value === "seek" || value === "stop") {
    return value;
  }
  return undefined;
}
