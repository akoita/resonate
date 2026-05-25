import { BadRequestException, Injectable } from "@nestjs/common";
import { AnalyticsEventInput } from "./analytics_event";
import { AnalyticsCatalogMetadataService } from "./analytics_catalog_metadata.service";
import { AnalyticsIngestService } from "./analytics_ingest.service";

export type PlaybackLifecycleAction = "started" | "heartbeat";

interface PlaybackCatalogAnalyticsInput {
  trackId: string;
  artistId?: string;
  releaseId?: string;
  sessionId?: string;
  source?: string;
  actorId?: string;
}

export interface PlaybackCompletedAnalyticsInput extends PlaybackCatalogAnalyticsInput {
  completionRatio: number;
  durationMs?: number;
}

export interface PlaybackLifecycleAnalyticsInput extends PlaybackCatalogAnalyticsInput {
  action: PlaybackLifecycleAction;
  playbackInstanceId?: string;
  positionMs?: number;
  durationMs?: number;
  heartbeatIntervalMs?: number;
  queueIndex?: number;
  queueLength?: number;
  repeatMode?: "none" | "one" | "all";
  shuffle?: boolean;
}

export interface ProductAnalyticsInput {
  eventName: string;
  actorId?: string;
  sessionId?: string;
  traceId?: string;
  subjectType?: string;
  subjectId?: string;
  source?: string;
  payload?: Record<string, unknown>;
  sourceRefs?: Record<string, string>;
}

export interface LibrarySavedAnalyticsInput {
  userCohortId: string;
  trackId: string;
  releaseId?: string;
  source?: string;
}

export interface CommerceSettledAnalyticsInput {
  paymentId: string;
  artistId?: string;
  trackId?: string;
  sessionId?: string;
  canonicalAmountUsd: number;
  settlementAsset?: string;
  txHash?: string;
}

export interface RightsRouteDecidedAnalyticsInput {
  releaseId: string;
  artistId: string;
  route: string;
  evidenceTypes?: string[];
  decisionReason?: string;
}

export interface AgentRecommendationSelectedAnalyticsInput {
  agentId: string;
  sessionId?: string;
  trackId: string;
  strategy: string;
  candidateCount: number;
}

export interface GenerationCreatedAnalyticsInput {
  generationId: string;
  userId: string;
  trackId?: string;
  artistId?: string;
  model?: string;
  promptPolicy?: string;
  consentBasis?: string;
}

@Injectable()
export class AnalyticsInstrumentationService {
  constructor(
    private readonly ingestService: AnalyticsIngestService,
    private readonly catalogMetadataService?: AnalyticsCatalogMetadataService,
  ) {}

  async recordPlaybackCompleted(input: PlaybackCompletedAnalyticsInput) {
    const catalog = await this.resolvePlaybackCatalog(input);

    return this.emit({
      eventName: "playback.completed",
      producer: "playback-service",
      privacyTier: "pseudonymous",
      subjectType: "track",
      subjectId: input.trackId,
      actorId: input.actorId,
      sessionId: input.sessionId,
      payload: {
        trackId: input.trackId,
        artistId: catalog.artistId,
        releaseId: catalog.releaseId,
        completionRatio: input.completionRatio,
        durationMs: input.durationMs,
        source: input.source,
      },
      sourceRefs: {
        ...(input.actorId ? { actorId: input.actorId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        trackId: input.trackId,
        ...(catalog.releaseId ? { releaseId: catalog.releaseId } : {}),
      },
    });
  }

  async recordPlaybackLifecycle(input: PlaybackLifecycleAnalyticsInput) {
    const catalog = await this.resolvePlaybackCatalog(input);

    return this.emit({
      eventName: `playback.${input.action}`,
      producer: "playback-service",
      privacyTier: "pseudonymous",
      subjectType: "track",
      subjectId: input.trackId,
      actorId: input.actorId,
      sessionId: input.sessionId,
      payload: {
        action: input.action,
        trackId: input.trackId,
        artistId: catalog.artistId,
        releaseId: catalog.releaseId,
        playbackInstanceId: input.playbackInstanceId,
        positionMs: input.positionMs,
        durationMs: input.durationMs,
        heartbeatIntervalMs: input.heartbeatIntervalMs,
        source: input.source,
        queueIndex: input.queueIndex,
        queueLength: input.queueLength,
        repeatMode: input.repeatMode,
        shuffle: input.shuffle,
      },
      sourceRefs: {
        ...(input.actorId ? { actorId: input.actorId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.playbackInstanceId ? { playbackInstanceId: input.playbackInstanceId } : {}),
        action: input.action,
        trackId: input.trackId,
        ...(catalog.releaseId ? { releaseId: catalog.releaseId } : {}),
        ...(input.positionMs !== undefined ? { positionMs: String(input.positionMs) } : {}),
      },
    });
  }

  async recordProductEvent(input: ProductAnalyticsInput) {
    return this.emit({
      eventName: input.eventName,
      producer: "web-app",
      privacyTier: "pseudonymous",
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      actorId: input.actorId,
      sessionId: input.sessionId,
      traceId: input.traceId,
      payload: {
        ...(input.payload ?? {}),
        source: input.source ?? "web_app",
      },
      sourceRefs: {
        ...(input.actorId ? { actorId: input.actorId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.subjectId ? { subjectId: input.subjectId } : {}),
        ...(input.sourceRefs ?? {}),
      },
    });
  }

  private async resolvePlaybackCatalog(input: PlaybackCatalogAnalyticsInput) {
    const inputArtistId = input.artistId?.trim();
    const inputReleaseId = input.releaseId?.trim();
    const shouldResolveCatalog = !inputArtistId || !inputReleaseId;
    const metadata = shouldResolveCatalog
      ? await this.catalogMetadataService?.findTracks([input.trackId])
      : undefined;
    const catalogTrack = metadata?.get(input.trackId);
    const artistId = inputArtistId || catalogTrack?.artistId?.trim();
    if (!artistId) {
      throw new BadRequestException("artistId is required or trackId must reference a catalog track");
    }

    return {
      artistId,
      releaseId: catalogTrack?.releaseId?.trim() || inputReleaseId || undefined,
    };
  }

  async recordLibrarySaved(input: LibrarySavedAnalyticsInput) {
    return this.emit({
      eventName: "library.saved",
      producer: "library-service",
      privacyTier: "pseudonymous",
      subjectType: "track",
      subjectId: input.trackId,
      actorId: input.userCohortId,
      payload: {
        userCohortId: input.userCohortId,
        trackId: input.trackId,
        releaseId: input.releaseId,
        source: input.source,
      },
      sourceRefs: { userCohortId: input.userCohortId, trackId: input.trackId },
    });
  }

  async recordCommerceSettled(input: CommerceSettledAnalyticsInput) {
    return this.emit({
      eventName: "commerce.settled",
      producer: "payments-service",
      privacyTier: "pseudonymous",
      subjectType: input.trackId ? "track" : undefined,
      subjectId: input.trackId,
      sessionId: input.sessionId,
      payload: {
        paymentId: input.paymentId,
        artistId: input.artistId,
        trackId: input.trackId,
        canonicalAmountUsd: input.canonicalAmountUsd,
        settlementAsset: input.settlementAsset,
        txHash: input.txHash,
      },
      sourceRefs: {
        paymentId: input.paymentId,
        ...(input.txHash ? { txHash: input.txHash } : {}),
      },
    });
  }

  async recordRightsRouteDecided(input: RightsRouteDecidedAnalyticsInput) {
    return this.emit({
      eventName: "rights.route_decided",
      producer: "rights-service",
      privacyTier: "pseudonymous",
      subjectType: "release",
      subjectId: input.releaseId,
      payload: {
        releaseId: input.releaseId,
        artistId: input.artistId,
        route: input.route,
        evidenceTypes: input.evidenceTypes ?? [],
        decisionReason: input.decisionReason,
      },
      sourceRefs: { releaseId: input.releaseId },
    });
  }

  async recordAgentRecommendationSelected(input: AgentRecommendationSelectedAnalyticsInput) {
    return this.emit({
      eventName: "agent.recommendation_selected",
      producer: "agent-runtime",
      privacyTier: "pseudonymous",
      subjectType: "track",
      subjectId: input.trackId,
      actorId: input.agentId,
      sessionId: input.sessionId,
      payload: {
        agentId: input.agentId,
        sessionId: input.sessionId,
        trackId: input.trackId,
        strategy: input.strategy,
        candidateCount: input.candidateCount,
      },
      sourceRefs: input.sessionId
        ? { agentId: input.agentId, sessionId: input.sessionId, trackId: input.trackId }
        : undefined,
    });
  }

  async recordGenerationCreated(input: GenerationCreatedAnalyticsInput) {
    return this.emit({
      eventName: "generation.created",
      producer: "generation-service",
      privacyTier: "personal",
      consentBasis: input.consentBasis ?? "platform_analytics:v1",
      subjectType: "generation",
      subjectId: input.generationId,
      actorId: input.userId,
      payload: {
        generationId: input.generationId,
        userId: input.userId,
        trackId: input.trackId,
        artistId: input.artistId,
        model: input.model,
        promptPolicy: input.promptPolicy,
      },
      sourceRefs: { generationId: input.generationId },
    });
  }

  private emit(input: AnalyticsEventInput) {
    return this.ingestService.ingest({
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      environment: process.env.NODE_ENV === "production" ? "prod" : "dev",
      ...input,
    });
  }
}
