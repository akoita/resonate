import { Injectable, Logger, Optional } from "@nestjs/common";
import { CommunityCohortService } from "../community/community_cohort.service";
import { applyDiscoveryPolicy, discoveryArtistKey } from "../recommendations/discovery-policy";
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
import { isHiddenTasteQuery } from "./agent_selector.service";
import type {
  AgentRuntimeInput,
  AgentRuntimeResult,
  LlmTrackPick,
} from "./runtime/agent_runtime.adapter";

/**
 * Filter-only policy step for LLM runtime picks (#1456 WS-9, ADR-TE-2,
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
 *  3. applies rule 1 (hidden), rule 2 (fully AI-generated), rule 4 (diversity
 *     cap, session mode) and rule 5 (a categorical reason on every pick).
 *
 * It never reorders the model's picks and reserves no exploration slot: rule 3
 * is enforced on the deterministic and Home paths, and on LLM paths only
 * through the catalog the model can search (a known limitation).
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

    // No verified-human set is passed on purpose: no exploration slot is
    // reserved for model picks, and nothing is relabeled a discovery pick.
    const policyResult = applyDiscoveryPolicy(inModelOrder, {
      limit: inModelOrder.length,
      tastePolicy: taste,
      priorSessionArtistKeys,
    });

    const pickById = new Map(known.map((pick) => [pick.trackId, pick]));
    const surviving: LlmTrackPick[] = policyResult.items.map((entry) => ({
      ...pickById.get(entry.id)!,
      score: entry.score,
      explanation: entry.explanation,
      reasonCode: entry.reasonCode,
      signals: entry.signals,
    }));
    const dropped = {
      ...policyResult.dropped,
      unknown: ordered.length - known.length,
    };

    if (surviving.length === 0) {
      return {
        status: "rejected",
        reason: "no_policy_eligible_picks",
        reasoning: result.reasoning,
        latencyMs: result.latencyMs,
        policy: { dropped },
      };
    }

    const [first] = surviving;
    return {
      ...result,
      trackId: first.trackId,
      licenseType: first.licenseType,
      priceUsd: first.priceUsd,
      picks: surviving,
      policy: { dropped },
    };
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
