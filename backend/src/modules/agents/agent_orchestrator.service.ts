import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { AgentMixerService } from "./agent_mixer.service";
import { AgentNegotiatorService } from "./agent_negotiator.service";
import { AgentRecommendationService } from "./agent_recommendation.service";
import { GenerationService } from "../generation/generation.service";
import { getAgentTrackLimit } from "./agent_runtime.config";

const COST_PER_GENERATION = 0.06;
const SPARSE_CATALOG_THRESHOLD = 3; // trigger generation if fewer than this many matches

export interface AgentOrchestratorInput {
  sessionId: string;
  userId: string;
  recentTrackIds: string[];
  budgetRemainingUsd: number;
  /** Budget for AI generation ($0.06/clip). Defaults to $1.00. */
  generationBudgetUsd?: number;
  preferences: {
    mood?: string;
    energy?: "low" | "medium" | "high";
    genres?: string[];
    stemTypes?: string[];
    learnedGenreWeights?: Record<string, number>;
    allowExplicit?: boolean;
    licenseType?: "personal" | "remix" | "commercial";
  };
}

export interface OrchestratedTrack {
  trackId: string;
  mixPlan: any;
  negotiation: any;
  /** True if this track was AI-generated (not from catalog) */
  generated?: boolean;
  /** Generation job ID for AI-generated tracks */
  generationJobId?: string;
}

@Injectable()
export class AgentOrchestratorService {
  private readonly logger = new Logger(AgentOrchestratorService.name);

  constructor(
    private readonly recommendations: AgentRecommendationService,
    private readonly mixer: AgentMixerService,
    private readonly negotiator: AgentNegotiatorService,
    private readonly eventBus: EventBus,
    private readonly generationService: GenerationService
  ) { }

  async orchestrate(input: AgentOrchestratorInput): Promise<{
    status: string;
    tracks: OrchestratedTrack[];
    generationsUsed?: number;
    generationSpendUsd?: number;
  }> {
    const selection = await this.recommendations.recommend({
      sessionId: input.sessionId,
      userId: input.userId,
      recentTrackIds: input.recentTrackIds,
      budgetRemainingUsd: input.budgetRemainingUsd,
      preferences: input.preferences,
      limit: getAgentTrackLimit(),
    });

    const selectedCount = selection.selected?.length ?? 0;
    let generationBudgetLeft = input.generationBudgetUsd ?? 1.0;
    let generationsUsed = 0;
    let generationSpendUsd = 0;

    // If catalog is sparse and generation budget is available, generate filler
    if (selectedCount < SPARSE_CATALOG_THRESHOLD && generationBudgetLeft >= COST_PER_GENERATION) {
      const fillCount = Math.min(
        SPARSE_CATALOG_THRESHOLD - selectedCount,
        Math.floor(generationBudgetLeft / COST_PER_GENERATION)
      );

      this.logger.log(
        `Catalog sparse (${selectedCount} tracks). Generating ${fillCount} fill track(s).`
      );

      for (let i = 0; i < fillCount; i++) {
        try {
          const genPrompt = this.buildGenerationPrompt(input.preferences, i);
          const result = await this.generationService.createGeneration(
            {
              prompt: genPrompt,
              negativePrompt: "silence, noise, harsh distortion",
              artistId: process.env.AGENT_ARTIST_ID ?? "agent",
            },
            input.userId
          );

          generationsUsed++;
          generationSpendUsd += COST_PER_GENERATION;
          generationBudgetLeft -= COST_PER_GENERATION;

          this.eventBus.publish({
            eventName: "agent.generation_triggered",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            sessionId: input.sessionId,
            jobId: result.jobId,
            prompt: genPrompt,
            costUsd: COST_PER_GENERATION,
            reason: "sparse_catalog",
          });
        } catch (err: any) {
          this.logger.warn(`Generation fill failed: ${err.message}`);
          break; // Stop generating on failure (likely rate limited)
        }
      }
    }

    if (selectedCount === 0 && generationsUsed === 0) {
      this.eventBus.publish({
        eventName: "agent.decision_made",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        sessionId: input.sessionId,
        trackId: "",
        reason: "no_tracks",
      });
      return { status: "no_tracks", tracks: [], generationsUsed: 0, generationSpendUsd: 0 };
    }

    if (selectedCount > 0) {
      this.eventBus.publish({
        eventName: "agent.selection",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        sessionId: input.sessionId,
        trackId: selection.selected[0]?.id,
        candidates: selection.candidates,
        count: selection.selected.length,
        strategy: selection.strategy,
        cohortInfluence: cohortInfluenceFromRecommendations(selection.selected),
      });
    }

    // Process each selected catalog track through mixer + negotiator
    const tracks: OrchestratedTrack[] = [];
    let budgetLeft = input.budgetRemainingUsd;
    let previousTrackId = input.recentTrackIds[0];

    for (const track of selection.selected ?? []) {
      const mixPlan = this.mixer.plan({
        trackId: track.id,
        previousTrackId,
        mood: input.preferences.mood,
        energy: input.preferences.energy,
      });

      this.eventBus.publish({
        eventName: "agent.mix_planned",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        sessionId: input.sessionId,
        trackId: track.id,
        trackTitle: track.title ?? "Unknown",
        transition: mixPlan.transition,
      });

      const negotiation = await this.negotiator.negotiate({
        trackId: track.id,
        licenseType: input.preferences.licenseType,
        budgetRemainingUsd: budgetLeft,
        stemTypes: input.preferences.stemTypes,
      });

      this.eventBus.publish({
        eventName: "agent.negotiated",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        sessionId: input.sessionId,
        trackId: track.id,
        trackTitle: track.title ?? "Unknown",
        licenseType: negotiation.licenseType,
        priceUsd: negotiation.priceUsd,
        reason: negotiation.reason,
      });

      if (negotiation.allowed) {
        budgetLeft -= negotiation.priceUsd;
        tracks.push({
          trackId: track.id,
          mixPlan,
          negotiation: {
            ...negotiation,
            recommendation: (track as any).agentRecommendation,
          },
        });
      }

      previousTrackId = track.id;

      if (budgetLeft <= 0) break;
    }

    // Final decision event
    this.eventBus.publish({
      eventName: "agent.decision_made",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId: input.sessionId,
      trackCount: tracks.length,
      totalSpend: tracks.reduce((sum, t) => sum + t.negotiation.priceUsd, 0),
      generationsUsed,
      generationSpendUsd,
      reason: tracks.length > 0 || generationsUsed > 0 ? "approved" : "all_rejected",
    });

    return {
      status: tracks.length > 0 || generationsUsed > 0 ? "approved" : "all_rejected",
      tracks,
      generationsUsed,
      generationSpendUsd,
    };
  }

  private buildGenerationPrompt(
    prefs: AgentOrchestratorInput["preferences"],
    index: number
  ): string {
    const parts: string[] = [];

    if (prefs.genres?.length) {
      parts.push(prefs.genres[index % prefs.genres.length]);
    }
    if (prefs.mood) {
      parts.push(`${prefs.mood} mood`);
    }
    if (prefs.energy) {
      parts.push(`${prefs.energy} energy`);
    }

    if (parts.length === 0) {
      return "Generate an atmospheric ambient track with warm pads";
    }

    return `Generate a 30-second track: ${parts.join(", ")}`;
  }
}

function cohortInfluenceFromRecommendations(selected: Array<{ agentRecommendation?: { signals?: Array<{ label: string; reason: string }> } }>) {
  const cohortSignals = selected.flatMap((track) =>
    track.agentRecommendation?.signals?.filter((signal) => signal.label === "cohort_context") ?? [],
  );
  const reasonCodes = [...new Set(cohortSignals.map((signal) => signal.reason).filter(Boolean))];
  return {
    appliedCount: reasonCodes.length,
    cohortIds: [],
    cohortTypes: [...new Set(reasonCodes.map((reason) => reason.split(":", 1)[0]).filter(Boolean))],
    reasonCodes,
  };
}
