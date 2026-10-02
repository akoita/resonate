import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { AgentMixerService } from "./agent_mixer.service";
import { AgentRecommendationService } from "./agent_recommendation.service";
import { getAgentTrackLimit } from "./agent_runtime.config";

export interface AgentOrchestratorInput {
  sessionId: string;
  userId: string;
  recentTrackIds: string[];
  /**
   * Retained for wire compatibility with the runtime contract only. Listening
   * runs are neither priced nor budget-limited (ADR-TE-1): it never reduces
   * how many tracks are selected.
   */
  budgetRemainingUsd?: number;
  preferences: {
    mood?: string;
    energy?: "low" | "medium" | "high";
    genres?: string[];
    stemTypes?: string[];
    learnedGenreWeights?: Record<string, number>;
    allowExplicit?: boolean;
    licenseType?: "personal" | "remix" | "commercial";
    /** Session intent context for ranking (#1456 WS-9). */
    sessionIntent?: string;
    sessionIntentName?: string;
    queueStyle?: string;
  };
}

/**
 * The DJ's record of one pick. Listening picks are never priced or negotiated
 * (ADR-TE-1: purchases go through Crate Digger quotes), so `priceUsd` is always
 * 0 and `licenseType` exists only for type compatibility.
 */
export interface OrchestratedPick {
  licenseType: "personal" | "remix" | "commercial";
  priceUsd: 0;
  reason: "selected";
  recommendation?: any;
}

export interface OrchestratedTrack {
  trackId: string;
  mixPlan: any;
  pick: OrchestratedPick;
}

/**
 * What the listener asked for, recorded when the catalog could not fill the
 * requested track count. Agents never generate audio to fill a shortfall
 * (ADR-TE-4); the unmet intent is the signal instead.
 */
export interface AgentUnmetIntent {
  genres?: string[];
  mood?: string;
  energy?: string;
}

@Injectable()
export class AgentOrchestratorService {
  private readonly logger = new Logger(AgentOrchestratorService.name);

  constructor(
    private readonly recommendations: AgentRecommendationService,
    private readonly mixer: AgentMixerService,
    private readonly eventBus: EventBus
  ) { }

  async orchestrate(input: AgentOrchestratorInput): Promise<{
    status: string;
    tracks: OrchestratedTrack[];
    /** Tracks requested minus tracks returned. Never filled by generation. */
    shortfall: number;
  }> {
    const requestedLimit = getAgentTrackLimit();
    const selection = await this.recommendations.recommend({
      sessionId: input.sessionId,
      userId: input.userId,
      recentTrackIds: input.recentTrackIds,
      preferences: input.preferences,
      limit: requestedLimit,
    });

    const selectedCount = selection.selected?.length ?? 0;

    if (selectedCount === 0) {
      const shortfall = requestedLimit;
      this.logger.log(`Catalog returned no tracks; shortfall ${shortfall}.`);
      this.eventBus.publish({
        eventName: "agent.decision_made",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        sessionId: input.sessionId,
        trackId: "",
        reason: "no_tracks",
        shortfall,
        unmetIntent: buildUnmetIntent(input.preferences),
      });
      return { status: "no_tracks", tracks: [], shortfall };
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

    // Plan the mix for every selected catalog track. Listening picks are not
    // priced, negotiated, or limited by budget.
    const tracks: OrchestratedTrack[] = [];
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

      tracks.push({
        trackId: track.id,
        mixPlan,
        pick: {
          licenseType: input.preferences.licenseType ?? "personal",
          priceUsd: 0,
          reason: "selected",
          recommendation: (track as any).agentRecommendation,
        },
      });

      previousTrackId = track.id;
    }

    // Final decision event. A sparse selection returns fewer tracks with an
    // explicit shortfall; audio is never generated to fill it.
    const shortfall = Math.max(0, requestedLimit - tracks.length);
    const status = tracks.length > 0 ? "approved" : "all_rejected";
    this.eventBus.publish({
      eventName: "agent.decision_made",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId: input.sessionId,
      trackCount: tracks.length,
      reason: status,
      ...(shortfall > 0
        ? { shortfall, unmetIntent: buildUnmetIntent(input.preferences) }
        : {}),
    });

    return { status, tracks, shortfall };
  }
}

function buildUnmetIntent(
  prefs: AgentOrchestratorInput["preferences"],
): AgentUnmetIntent {
  return {
    ...(prefs.genres?.length ? { genres: [...prefs.genres] } : {}),
    ...(prefs.mood ? { mood: prefs.mood } : {}),
    ...(prefs.energy ? { energy: prefs.energy } : {}),
  };
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
