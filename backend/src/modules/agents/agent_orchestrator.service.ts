import { Injectable, Logger, Optional } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { HabitOrderingService } from "./habit_ordering.service";
import { AgentMixerService } from "./agent_mixer.service";
import type { AgentAudioFeatures } from "./agent_audio_feature.service";
import { AgentRecommendationService } from "./agent_recommendation.service";
import type { MixCoverage, MyMixPreferences, ResolvedMyMixPlan } from "./agent_my_mix";
import { getAgentTrackLimit } from "./agent_runtime.config";
import type { AgentRuntimeFallback } from "./agent_runtime.types";
import type { SessionSeed } from "./agent_session_seed";
import type { DiscoveryLevel } from "../recommendations/discovery-policy";
import {
  requestCoverageFor,
  requestCoverageForScope,
  effectiveEnergyBand,
  requestMatchesFor,
  requestScopeFor,
  tierMatchesRequest,
  type AgentRequestCoveragePick,
  type AgentRequestCoverage,
  type AgentRequestHeldBack,
  type AgentSessionRequest,
  type AgentSessionTempoRange,
} from "./agent_session_request";

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
    /** Every mood the listener described (#2037); also search queries. */
    moods?: string[];
    /** Requested tempo range in BPM (#2037); boosts measured tempo only. */
    tempoBpm?: AgentSessionTempoRange;
    /** Listening filters parsed from the listener's words (#2037), for coverage. */
    request?: AgentSessionRequest;
    /** The listener's sentence and the artists it named (#2241); see AgentRuntimeInput. */
    requestText?: string;
    artists?: string[];
    /** The session's seed (#2244); see AgentRuntimeInput. */
    seed?: SessionSeed;
    /** Request-first selection (#2316): allow marked off-request tracks to fill a short batch. */
    fillSimilar?: boolean;
    /** "New artists" (#2249): only artists the listener has never interacted with. */
    newArtists?: boolean;
    /** The Discovery control (#2327): Familiar, Mixed (default) or New; sets the exploration share. */
    discovery?: DiscoveryLevel;
    /** The session's own genres (#2059), before learned favourites and saved vibes join `genres`. */
    sessionGenres?: string[];
    myMix?: MyMixPreferences | null;
  };
  /** Trusted server-resolved lane plan. */
  myMixPlan?: ResolvedMyMixPlan;
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
  /** Whether the pick satisfies every filter of the described session (#2312); absent without filters. */
  requestMatch?: boolean;
  recommendation?: any;
}

export interface OrchestratedTrack {
  trackId: string;
  mixPlan: any;
  /** Internal-only selector assignment; excluded from commerce normalization and events. */
  mixLaneId?: string;
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
    private readonly eventBus: EventBus,
    @Optional() private readonly habitOrdering?: HabitOrderingService,
  ) { }

  async orchestrate(
    input: AgentOrchestratorInput,
    options: {
      /** Set by the executor when the LLM runtime failed and the rules curate instead (#2075). */
      runtimeFallback?: AgentRuntimeFallback;
    } = {},
  ): Promise<{
    status: string;
    tracks: OrchestratedTrack[];
    /** Tracks requested minus tracks returned. Never filled by generation. */
    shortfall: number;
    /** How well the picks matched the listener's described session (#2037); absent without filters. */
    requestCoverage?: AgentRequestCoverage;
    /** Echo of the fallback the executor passed in; absent in configured rules mode (#2075). */
    runtimeFallback?: AgentRuntimeFallback;
    /**
     * Why nothing was returned (#2056): the selector's categorical reason, so
     * the listener can tell "nothing matches" from "everything matching was played".
     */
    reason?: string;
    mixCoverage?: MixCoverage;
  }> {
    const { runtimeFallback } = options;
    const fallbackFields = runtimeFallback ? { runtimeFallback } : {};
    const requestedLimit = getAgentTrackLimit();
    const selection = await this.recommendations.recommend({
      sessionId: input.sessionId,
      userId: input.userId,
      recentTrackIds: input.recentTrackIds,
      preferences: input.preferences,
      limit: requestedLimit,
      myMixPlan: input.myMixPlan,
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
        curatedBy: "rules",
        ...fallbackFields,
        shortfall,
        unmetIntent: buildUnmetIntent(input.preferences),
      });
      return {
        status: "no_tracks",
        tracks: [],
        shortfall,
        ...fallbackFields,
        ...(selection.reason ? { reason: selection.reason } : {}),
        ...(selection.mixCoverage ? { mixCoverage: selection.mixCoverage } : {}),
      };
    }

    // Reorder the policy-approved batch before planning each transition.
    // Future tempo/Camelot sequencing (#1971) can refine tracks within lane runs.
    const ordered = input.myMixPlan && input.myMixPlan.orderingVariant !== "neutral" && this.habitOrdering
      ? await this.habitOrdering.orderMyMix(input.userId, input.sessionId, selection.selected, input.myMixPlan)
      : selection.selected;

    if (selectedCount > 0) {
      this.eventBus.publish({
        eventName: "agent.selection",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        sessionId: input.sessionId,
        trackId: ordered[0]?.id,
        candidates: selection.candidates,
        count: selection.selected.length,
        strategy: selection.strategy,
        cohortInfluence: cohortInfluenceFromRecommendations(selection.selected),
      });
    }

    // Plan the mix for every selected catalog track. Listening picks are not
    // priced, negotiated, or limited by budget.
    const tracks: OrchestratedTrack[] = [];
    // Per pick, by the same predicates as the coverage below (#2312); absent
    // when the request has no filters.
    const selectedForMatch = selection.selected ?? [];
    // A request-first session (#2316) is judged against its effective request
    // (preset and picker genres included), and a pick belongs to it unless it is
    // a marked off-request pick the listener allowed.
    const scope = input.myMixPlan ? undefined : requestScopeFor(input.preferences);
    const matchFlags = scope
      ? selectedForMatch.map((track: { requestTier?: "A" | "B" | "C" }) =>
          track.requestTier ? tierMatchesRequest(track.requestTier) : true,
        )
      : requestMatchesFor(input.preferences.request, selectedForMatch.map(coverageFactsOf));
    const requestMatchById = new Map<string, boolean>(
      matchFlags ? selectedForMatch.map((track: { id: string }, index: number) => [track.id, matchFlags[index]]) : [],
    );
    let previousTrackId = input.recentTrackIds[0];

    for (const track of ordered ?? []) {
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
        ...(track.mixLaneId ? { mixLaneId: track.mixLaneId } : {}),
        pick: {
          licenseType: input.preferences.licenseType ?? "personal",
          priceUsd: 0,
          reason: "selected",
          ...(requestMatchById.has(track.id) ? { requestMatch: requestMatchById.get(track.id) } : {}),
          recommendation: (track as any).agentRecommendation,
        },
      });

      previousTrackId = track.id;
    }

    // Final decision event. A sparse selection returns fewer tracks with an
    // explicit shortfall; audio is never generated to fill it.
    const shortfall = Math.max(0, requestedLimit - tracks.length);
    const status = tracks.length > 0 ? "approved" : "all_rejected";
    const coverage = scope
      ? requestCoverageForScope(
          scope,
          (selection.selected ?? []).map((track: CoverageSource) => coverageFactsOf(track)),
          selection.heldBack,
          {
            ...(selection.capRelaxed ? { capRelaxed: selection.capRelaxed } : {}),
            ...(shortfall > 0 && selection.shortfallReason ? { shortfallReason: selection.shortfallReason } : {}),
          },
        )
      : buildRequestCoverage(input.preferences.request, selection.selected ?? [], selection.heldBack);
    this.eventBus.publish({
      eventName: "agent.decision_made",
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      sessionId: input.sessionId,
      trackCount: tracks.length,
      reason: status,
      curatedBy: "rules",
      ...fallbackFields,
      ...(shortfall > 0
        ? { shortfall, unmetIntent: buildUnmetIntent(input.preferences) }
        : {}),
      ...(coverage
        ? {
            coverage: coverage.coverage,
            ...(coverage.summary ? { coverageSummary: coverage.summary } : {}),
          }
        : {}),
    });

    return {
      status,
      tracks,
      shortfall,
      ...fallbackFields,
      ...(coverage ? { requestCoverage: coverage.coverage } : {}),
      ...(selection.mixCoverage ? { mixCoverage: selection.mixCoverage } : {}),
    };
  }
}

/**
 * Coverage of the selected tracks against the listener's described session
 * (#2037): genre and moods from the release, energy from the audio features,
 * and tempo only when it was measured (the inferred tempo is a metadata hash).
 * Undefined without a request, without filters, or without picks.
 */
function buildRequestCoverage(
  rawRequest: unknown,
  selected: CoverageSource[],
  heldBack?: AgentRequestHeldBack,
): { coverage: AgentRequestCoverage; summary: string } | undefined {
  return requestCoverageFor(rawRequest, selected.map(coverageFactsOf), heldBack);
}

type CoverageSource = {
  release?: { genre?: string | null; moods?: string[] | null };
  descriptor?: { families?: string[] | null; energyBand?: string | null } | null;
  agentRecommendation?: { audioFeatures?: AgentAudioFeatures };
};

/**
 * What the request filters read about a selected track. One function feeds
 * both coverage and the per-pick `requestMatch` (#2312), so they agree. The
 * descriptor families let "African" satisfy a "World" request like the LLM path.
 */
function coverageFactsOf(track: CoverageSource): AgentRequestCoveragePick {
  const features = track.agentRecommendation?.audioFeatures;
  return {
    genre: track.release?.genre ?? null,
    descriptorFamilies: track.descriptor?.families ?? [],
    moods: track.release?.moods ?? [],
    energyBand: effectiveEnergyBand(features, track.descriptor?.energyBand),
    tempoBpm: features?.tempoBpm,
    tempoMeasured: features?.featureSources?.tempo === "measured",
  };
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
