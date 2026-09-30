import { Injectable, Logger, Optional } from "@nestjs/common";
import { CommunityCohortService } from "../community/community_cohort.service";
import {
  applyDiscoveryPolicy,
  DISCOVERY_POLICY_DEFAULTS,
  discoveryArtistKey,
} from "../recommendations/discovery-policy";
import { DiscoveryPolicyContextService } from "../recommendations/discovery-policy-context.service";
import {
  DiscoveryCandidate,
  DiscoveryRankingService,
  RankedDiscoveryCandidate,
} from "../recommendations/discovery-ranking.service";
import { RecommendationsService } from "../recommendations/recommendations.service";
import { TasteMemoryService } from "../recommendations/taste_memory.service";
import { AgentLearningService } from "./agent_learning.service";
import { expandAgentTasteQueries } from "./agent_taste_expansion";
import { buildAgentRecommendationQueries } from "./deterministic_recommendation.adapter";
import { AgentSelectorService, isHiddenTasteQuery } from "./agent_selector.service";
import type {
  AgentRuntimeInput,
  AgentRuntimeResult,
  LlmTrackPick,
} from "./runtime/agent_runtime.adapter";

/**
 * Policy step for LLM runtime picks (#1456 WS-9, ADR-TE-2,
 * docs/rfc/taste-engine.md §3.4).
 *
 * The deterministic selector and Home run the shared policy stage in their own
 * pipelines. The ADK / Vertex runtimes pick tracks themselves through
 * `catalog_search`, so their picks get the same stage here, at the one place
 * both callers (`AgentConfigController.startSession` and
 * `SessionsService.agentNext`) reach the runtime: `AgentRuntimeService.run`.
 *
 * What it does, in order:
 *  1. loads the picked tracks' metadata in one batched query;
 *  2. scores them with the shared `DiscoveryRankingService` and the same
 *     context the selector builds (shared taste profile, taste policy, session
 *     intent and mood, recent and served tracks), so each pick carries the same
 *     `signals`, `explanation` and `reasonCode` Home gives that track;
 *  3. applies rule 1 (hidden), rule 2 (fully AI-generated), rule 3
 *     (exploration share, session mode), rule 4 (diversity cap, session mode)
 *     and rule 5 (a categorical reason on every pick);
 *  4. when rule 3 reserves a discovery slot that none of the model's picks can
 *     fill, swaps the model's last pick for the deterministic selector's
 *     discovery pick for the same listener and session (ADR-TE-2 rule 3 on
 *     every surface). This is the only pick the step ever adds.
 *
 * It never reorders the model's picks. A model pick that qualifies as a
 * discovery pick (verified human artist the listener never played) is
 * labeled one in place. A one-track call with no known session history never
 * swaps: its reserve is only the "at least one" floor, so it would replace
 * every single-track pick.
 *
 * Fail-open: when the ranking core or metadata lookup is unavailable, the
 * result passes through unchanged (the model's own picks, as before).
 */
@Injectable()
export class AgentRuntimePolicyService {
  private readonly logger = new Logger(AgentRuntimePolicyService.name);

  constructor(
    @Optional() private readonly ranking?: DiscoveryRankingService,
    @Optional() private readonly policyContext?: DiscoveryPolicyContextService,
    @Optional() private readonly tasteMemory?: TasteMemoryService,
    @Optional() private readonly learning?: AgentLearningService,
    @Optional() private readonly recommendations?: RecommendationsService,
    @Optional() private readonly cohorts?: CommunityCohortService,
    // Source of the discovery pick when the model's picks have none.
    @Optional() private readonly selector?: AgentSelectorService,
  ) {}

  async apply(
    input: AgentRuntimeInput,
    result: AgentRuntimeResult,
  ): Promise<AgentRuntimeResult> {
    if (!this.ranking || !this.policyContext) return result;
    const picks = picksOf(result);
    if (picks.length === 0) return result;

    try {
      return await this.filterPicks(input, result, picks);
    } catch (error) {
      this.logger.warn(
        `Runtime policy step unavailable; passing picks through: ${String(error)}`,
      );
      return result;
    }
  }

  private async filterPicks(
    input: AgentRuntimeInput,
    result: AgentRuntimeResult,
    picks: LlmTrackPick[],
  ): Promise<AgentRuntimeResult> {
    const ranking = this.ranking!;
    const policyContext = this.policyContext!;
    const userId = input.userId;

    // One pick per track, in the model's order.
    const seen = new Set<string>();
    const ordered = picks.filter((pick) => {
      if (!pick.trackId || seen.has(pick.trackId)) return false;
      seen.add(pick.trackId);
      return true;
    });

    const [taste, candidatesById, sessionArtists] = await Promise.all([
      this.tasteMemory?.getPolicy(userId),
      policyContext.loadTrackCandidates(ordered.map((pick) => pick.trackId)),
      policyContext.artistIdsForTracks(input.recentTrackIds),
    ]);

    const originalQueries = buildAgentRecommendationQueries(input.preferences)
      .filter(Boolean)
      .filter((query) => !isHiddenTasteQuery(taste, query));
    const expandedQueries = expandAgentTasteQueries(originalQueries);
    const learnedGenreWeights = await this.resolveLearnedGenreWeights(
      input,
      taste,
    );
    const servedHistory = await this.resolveServedHistory(userId);
    const cohortContext = userId
      ? (await this.cohorts?.getDiscoveryContextForUser(userId)) ?? []
      : [];
    const canUseWarehouseTaste = userId
      ? (await this.tasteMemory?.canUseTasteForSocialMatching(userId)) ?? false
      : false;

    // Unknown ids (the model invented one) cannot be ranked or explained.
    const known = ordered.filter((pick) => candidatesById.has(pick.trackId));
    const candidates: DiscoveryCandidate[] = known.map((pick) => {
      const candidate = candidatesById.get(pick.trackId)!;
      return {
        ...candidate,
        matchedQueries: matchedQueriesFor(candidate, expandedQueries),
      };
    });

    const bigQueryTasteScores = canUseWarehouseTaste
      ? await ranking.fetchWarehouseTasteScores(
          userId,
          candidates.map((candidate) => candidate.id),
        )
      : undefined;

    const scored = await ranking.rank(candidates, {
      originalQueries,
      expandedQueries,
      learnedGenreWeights,
      bigQueryTasteScores,
      cohortContext,
      recentTrackIds: [...new Set([...input.recentTrackIds, ...servedHistory])],
      energy: input.preferences.energy,
      sessionIntent: {
        intent: input.preferences.sessionIntent,
        mood: input.preferences.mood,
        queueStyle: input.preferences.queueStyle,
      },
      tastePolicy: taste,
    });

    // `rank` sorts by score; the policy must see the model's order.
    const rankedById = new Map(scored.map((entry) => [entry.id, entry]));
    const inModelOrder = known.map(
      (pick) => rankedById.get(pick.trackId)!,
    ) as RankedDiscoveryCandidate[];

    // recentTrackIds is newest-first; the policy wants chronological order.
    const priorSessionArtistKeys = [...input.recentTrackIds]
      .reverse()
      .map((id) =>
        discoveryArtistKey({ id, artistId: sessionArtists.get(id) ?? null }),
      );

    const exploration = await this.loadExplorationContext(input, known, candidatesById);
    const policyResult = applyDiscoveryPolicy(inModelOrder, {
      limit: inModelOrder.length,
      tastePolicy: taste,
      priorSessionArtistKeys,
      verifiedHumanArtistIds: exploration.verifiedHumanArtistIds,
      playedArtistIds: exploration.playedArtistIds,
      priorExplorationCount: exploration.priorExplorationCount,
    });

    const pickById = new Map(known.map((pick) => [pick.trackId, pick]));
    let surviving: LlmTrackPick[] = policyResult.items.map((entry) => ({
      ...pickById.get(entry.id)!,
      score: entry.score,
      explanation: entry.explanation,
      reasonCode: entry.reasonCode,
      signals: entry.signals,
    }));

    const { reserved, served } = policyResult.exploration;
    let injected = false;
    if (
      surviving.length > 0 &&
      served < reserved &&
      canSwapForDiscovery(surviving.length, exploration.priorExplorationCount)
    ) {
      const artistKeyOf = (trackId: string) =>
        discoveryArtistKey(
          candidatesById.get(trackId) ?? { id: trackId, artistId: null },
        );
      const swapped = await this.swapInDiscoveryPick(input, surviving, [
        ...priorSessionArtistKeys.slice(-(DISCOVERY_POLICY_DEFAULTS.sessionWindow - 1)),
        ...surviving.slice(0, -1).map((entry) => artistKeyOf(entry.trackId)),
      ]);
      if (swapped) {
        surviving = swapped;
        injected = true;
      }
    }
    const dropped = {
      ...policyResult.dropped,
      unknown: ordered.length - known.length,
    };
    const explorationAccounting = {
      reserved,
      served: served + (injected ? 1 : 0),
      injected,
    };

    if (surviving.length === 0) {
      return {
        status: "rejected",
        reason: "no_policy_eligible_picks",
        reasoning: result.reasoning,
        latencyMs: result.latencyMs,
        policy: { dropped, exploration: explorationAccounting },
      };
    }

    const [first] = surviving;
    return {
      ...result,
      trackId: first.trackId,
      licenseType: first.licenseType,
      priceUsd: first.priceUsd,
      picks: surviving,
      policy: { dropped, exploration: explorationAccounting },
    };
  }

  /**
   * Rule 3 lookups for the model's picks: verified-human and played artists,
   * and how many of the session's prior tracks were discovery picks. Fails
   * open like the selector: a lookup error only disables exploration.
   */
  private async loadExplorationContext(
    input: AgentRuntimeInput,
    known: LlmTrackPick[],
    candidatesById: Map<string, DiscoveryCandidate>,
  ): Promise<{
    verifiedHumanArtistIds?: ReadonlySet<string>;
    playedArtistIds?: ReadonlySet<string>;
    priorExplorationCount?: number;
  }> {
    const policyContext = this.policyContext!;
    const artistIds = known
      .map((pick) => candidatesById.get(pick.trackId)?.artistId)
      .filter((id): id is string => !!id);
    let verifiedHumanArtistIds: ReadonlySet<string> | undefined;
    let playedArtistIds: ReadonlySet<string> | undefined;
    let priorExplorationCount: number | undefined;
    try {
      const context = await policyContext.loadContext(input.userId, artistIds);
      verifiedHumanArtistIds = context.verifiedHumanArtistIds;
      playedArtistIds = context.playedArtistIds;
    } catch (error) {
      this.logger.warn(`Discovery policy context unavailable: ${String(error)}`);
    }
    // Unknown (undefined) on failure, never 0: see `priorExplorationCount`.
    try {
      if (input.userId) {
        priorExplorationCount = await policyContext.countDiscoveryPicks(
          input.userId,
          input.recentTrackIds.slice(0, DISCOVERY_POLICY_DEFAULTS.sessionWindow - 1),
        );
      }
    } catch (error) {
      this.logger.warn(`Prior discovery picks unavailable: ${String(error)}`);
    }
    return { verifiedHumanArtistIds, playedArtistIds, priorExplorationCount };
  }

  /**
   * Replaces the model's last pick with the deterministic selector's discovery
   * pick for the same listener, session and preferences, or returns undefined
   * when the selector has none that fits (not already picked, within the
   * artist cap given `otherArtistKeys`). Fails open.
   */
  private async swapInDiscoveryPick(
    input: AgentRuntimeInput,
    surviving: LlmTrackPick[],
    otherArtistKeys: string[],
  ): Promise<LlmTrackPick[] | undefined> {
    if (!this.selector) return undefined;
    try {
      const queries = buildAgentRecommendationQueries(input.preferences);
      const selection = await this.selector.select({
        userId: input.userId,
        queries,
        recentTrackIds: input.recentTrackIds,
        allowExplicit: input.preferences.allowExplicit,
        useEmbeddings: queries.length > 0,
        // Same page size, so the selector reserves the same exploration share.
        limit: surviving.length,
        energy: input.preferences.energy,
        learnedGenreWeights: input.preferences.learnedGenreWeights,
        sessionIntent: input.preferences.sessionIntent,
        mood: input.preferences.mood,
        queueStyle: input.preferences.queueStyle,
      });
      const pickedIds = new Set(surviving.map((entry) => entry.trackId));
      const artistCounts = new Map<string, number>();
      for (const key of otherArtistKeys) {
        artistCounts.set(key, (artistCounts.get(key) ?? 0) + 1);
      }
      const discovery = selection.selected.find((track: any) => {
        if (track.agentRecommendation?.reasonCode !== "discovery_pick") return false;
        if (pickedIds.has(track.id)) return false;
        const key = discoveryArtistKey({
          id: track.id,
          artistId: track.release?.artistId ?? null,
        });
        return (artistCounts.get(key) ?? 0) < DISCOVERY_POLICY_DEFAULTS.maxPerArtist;
      });
      if (!discovery) return undefined;

      const replaced = surviving[surviving.length - 1];
      const recommendation = discovery.agentRecommendation!;
      return [
        ...surviving.slice(0, -1),
        {
          trackId: discovery.id,
          licenseType: replaced.licenseType,
          // Not a model-negotiated price; buy mode negotiates it separately.
          priceUsd: 0,
          score: recommendation.score,
          explanation: recommendation.explanation,
          reasonCode: recommendation.reasonCode,
          signals: recommendation.signals,
        },
      ];
    } catch (error) {
      this.logger.warn(`Discovery pick unavailable for LLM picks: ${String(error)}`);
      return undefined;
    }
  }

  /** The shared profile's weights, else the caller's (same rule as the DJ selector). */
  private async resolveLearnedGenreWeights(
    input: AgentRuntimeInput,
    taste: Awaited<ReturnType<TasteMemoryService["getPolicy"]>> | undefined,
  ): Promise<Record<string, number>> {
    if (input.userId && this.learning) {
      try {
        const profile = await this.learning.resolveTasteProfile(
          input.userId,
          [],
          taste,
        );
        if (Object.keys(profile.genreWeights).length > 0) {
          return profile.genreWeights;
        }
      } catch (error) {
        this.logger.warn(`Shared taste profile unavailable: ${String(error)}`);
      }
    }
    return input.preferences.learnedGenreWeights ?? {};
  }

  private async resolveServedHistory(userId?: string): Promise<string[]> {
    if (!userId || !this.recommendations) return [];
    try {
      return await this.recommendations.getServedHistory(userId);
    } catch {
      return [];
    }
  }
}

/**
 * A swap is allowed when the page's own share earns a discovery slot, or the
 * session's prior discovery count is known (then the policy paces it to about
 * one in five session tracks). A one-track call with an unknown count only
 * reaches the "at least one" floor and must not always be a discovery pick.
 */
function canSwapForDiscovery(pageSize: number, priorExplorationCount?: number) {
  if (priorExplorationCount !== undefined) return true;
  return Math.round(pageSize * DISCOVERY_POLICY_DEFAULTS.explorationShare) >= 1;
}

/** The picks of an adapter result; legacy single-track results included. */
function picksOf(result: AgentRuntimeResult): LlmTrackPick[] {
  if (result.picks && result.picks.length > 0) return result.picks;
  if (result.trackId) {
    return [
      {
        trackId: result.trackId,
        licenseType: result.licenseType ?? "personal",
        priceUsd: result.priceUsd ?? 0,
      },
    ];
  }
  return [];
}

/**
 * Which taste queries a picked track matches: genre, moods, or title contain
 * the query (case-insensitive), the same substring semantics Home uses.
 */
function matchedQueriesFor(candidate: DiscoveryCandidate, queries: string[]) {
  const haystack = [
    candidate.title ?? "",
    candidate.release?.title ?? "",
    candidate.release?.genre ?? "",
    ...(candidate.release?.moods ?? []),
  ].map((value) => value.toLowerCase());
  return queries.filter((query) =>
    haystack.some((value) => value.includes(query.toLowerCase())),
  );
}
