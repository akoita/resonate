import { Injectable } from "@nestjs/common";
import { AnalyticsEventInput } from "./analytics_event";
import { AnalyticsIngestService } from "./analytics_ingest.service";

export interface PlaybackCompletedAnalyticsInput {
  trackId: string;
  artistId: string;
  sessionId?: string;
  source?: string;
  completionRatio: number;
  durationMs?: number;
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
  constructor(private readonly ingestService: AnalyticsIngestService) {}

  async recordPlaybackCompleted(input: PlaybackCompletedAnalyticsInput) {
    return this.emit({
      eventName: "playback.completed",
      producer: "playback-service",
      privacyTier: "pseudonymous",
      subjectType: "track",
      subjectId: input.trackId,
      sessionId: input.sessionId,
      payload: {
        trackId: input.trackId,
        artistId: input.artistId,
        completionRatio: input.completionRatio,
        durationMs: input.durationMs,
        source: input.source,
      },
      sourceRefs: input.sessionId ? { sessionId: input.sessionId, trackId: input.trackId } : undefined,
    });
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
