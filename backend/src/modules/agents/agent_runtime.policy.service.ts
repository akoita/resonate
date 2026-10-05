import { Injectable, Logger, Optional } from "@nestjs/common";
import { CommunityCohortService } from "../community/community_cohort.service";
import { DISCOVERY_EXPLANATIONS } from "../recommendations/discovery-explanations";
import {
  applyFirstListenerReservationOutcome,
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
import { FirstListenerDiscoveryService } from "../recommendations/first_listener_discovery.service";
import { FIRST_LISTENER_CANDIDATE_LIMIT } from "../recommendations/first_listener.contracts";
import { resolveCreditedArtistName } from "../shared/artist_attribution";
import { AgentLearningService } from "./agent_learning.service";
import { expandAgentTasteQueries } from "./agent_taste_expansion";
import {
  buildAgentRecommendationQueries,
  deterministicSelectorInput,
  requestedTermsFor,
} from "./deterministic_recommendation.adapter";
import { getAgentTrackLimit } from "./agent_runtime.config";
import type {
  AgentAudioFeatureService,
  AgentAudioFeatures,
} from "./agent_audio_feature.service";
import {
  requestCoverageFor,
  type AgentRequestCoveragePick,
} from "./agent_session_request";
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
 *     every surface);
 *  5. when fewer picks than the selection target (`getAgentTrackLimit()`)
 *     remain, fills the rest from the deterministic selector, called as the
 *     rule-based adapter calls it, so the model alone never decides how many
 *     tracks a request returns. A fill-in is never a fresh placement (those
 *     need a reservation), never repeats a pick, and keeps the diversity cap;
 *     it adds nothing the selector did not itself return (ADR-TE-4). An empty
 *     model reply (`llm_no_track_selected`) is filled the same way;
 *  6. measures how well the final picks matched the session the listener
 *     described (#2037) and returns it as `requestCoverage`, so the live feed,
 *     Next Pick and unmet-demand records see it on this path too. The requested
 *     terms, tempo and audio features also reach the ranking in step 2, so each
 *     pick's score and explanation reflect the request.
 *
 * It never reorders the model's picks; fill-ins follow them. A model pick that qualifies as a
 * discovery pick (verified human artist the listener never played) is
 * labeled one in place. A one-track call with no known session history never
 * swaps: its reserve is only the "at least one" floor, so it would replace
 * every single-track pick.
 *
 * Fail-open: when the ranking core or metadata lookup is unavailable, ordinary
 * model picks pass through; any unverified discovery annotations are stripped.
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
    // Authoritative fresh-source check and placement reservation for runtime picks.
    @Optional() private readonly firstListenerDiscovery?: FirstListenerDiscoveryService,
    // Per-pick audio features for the request's energy and tempo (#2037).
    @Optional() private readonly audioFeatures?: AgentAudioFeatureService,
  ) {}

  async apply(
    input: AgentRuntimeInput,
    result: AgentRuntimeResult,
  ): Promise<AgentRuntimeResult> {
    if (!this.ranking || !this.policyContext) {
      return stripUnverifiedDiscoveryAnnotations(result);
    }
    const picks = picksOf(result);
    // An empty model reply is still owed its target; any other empty result
    // (an error, a stub runtime) has nothing to filter or fill.
    const emptyReply = picks.length === 0 && result.reason === "llm_no_track_selected";
    if (picks.length === 0 && !emptyReply) return result;

    try {
      return await this.filterPicks(input, result, picks);
    } catch (error) {
      if (emptyReply) {
        this.logger.warn(`Runtime top-up unavailable for an empty reply: ${String(error)}`);
        return result;
      }
      this.logger.warn(
        `Runtime policy step unavailable; passing picks through: ${String(error)}`,
      );
      return stripUnverifiedDiscoveryAnnotations(result);
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

    const [taste, candidatesById, sessionArtistKeys] = await Promise.all([
      this.tasteMemory?.getPolicy(userId),
      policyContext.loadTrackCandidates(ordered.map((pick) => pick.trackId)),
      policyContext.artistKeysForTracks(input.recentTrackIds),
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
    let freshCandidates: Awaited<ReturnType<FirstListenerDiscoveryService["getFreshCandidates"]>> = [];
    let freshLookupFailed = false;
    if (userId && this.firstListenerDiscovery && known.length > FIRST_LISTENER_CANDIDATE_LIMIT) {
      freshLookupFailed = true;
    } else if (userId && this.firstListenerDiscovery && known.length > 0) {
      try {
        freshCandidates = await this.firstListenerDiscovery.getFreshCandidates({
          userId,
          allowExplicit: input.preferences.allowExplicit ?? false,
          trackIds: known.map((pick) => pick.trackId),
        });
      } catch (error) {
        freshLookupFailed = true;
        this.logger.warn(`First-listener eligibility unavailable: ${String(error)}`);
      }
    }
    const freshByTrackId = new Map(freshCandidates.map((candidate) => [candidate.id, candidate]));
    const candidates: DiscoveryCandidate[] = known.map((pick) => {
      const candidate = candidatesById.get(pick.trackId)!;
      const fresh = freshByTrackId.get(pick.trackId);
      return {
        ...candidate,
        ...(fresh
          ? {
              artistId: fresh.release.artistId,
              releaseId: fresh.releaseId,
              firstListenerEligible: true,
            }
          : {}),
        matchedQueries: matchedQueriesFor(candidate, expandedQueries),
      };
    });

    const audioFeaturesByTrack = await this.loadAudioFeatures(
      known.map((pick) => pick.trackId),
    );

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
      tempoBpm: input.preferences.tempoBpm,
      ...requestedTermsFor(input.preferences),
      audioFeaturesByTrack,
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
      .map(
        (id) =>
          sessionArtistKeys.get(id) ?? discoveryArtistKey({ id, artistId: null }),
      );

    const exploration = await this.loadExplorationContext(input, known, candidatesById);
    const policyOptions = {
      limit: inModelOrder.length,
      tastePolicy: taste,
      priorSessionArtistKeys,
      // If freshness could not be checked, no runtime pick can safely receive
      // discovery privilege for this request.
      verifiedHumanArtistIds: freshLookupFailed
        ? new Set<string>()
        : exploration.verifiedHumanArtistIds,
      playedArtistIds: exploration.playedArtistIds,
      priorExplorationCount: exploration.priorExplorationCount,
    };
    let policyResult = applyDiscoveryPolicy(inModelOrder, policyOptions);

    const firstListenerPicks = policyResult.items.filter(
      (entry) => entry.firstListenerEligible && entry.reasonCode === "discovery_pick",
    );
    if (firstListenerPicks.length > 0 && userId && this.firstListenerDiscovery) {
      let reservedReleaseIds = new Set<string>();
      try {
        reservedReleaseIds = await this.firstListenerDiscovery.reservePlacements(
          userId,
          firstListenerPicks.flatMap((entry) =>
            entry.releaseId ? [{ trackId: entry.id, releaseId: entry.releaseId }] : [],
          ),
          { allowExplicit: input.preferences.allowExplicit ?? false },
        );
      } catch (error) {
        this.logger.warn(`First-listener placement unavailable: ${String(error)}`);
      }
      policyResult = applyFirstListenerReservationOutcome(
        inModelOrder,
        policyResult,
        reservedReleaseIds,
        policyOptions,
      );
    }

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
    let discoveryFacts: AgentRequestCoveragePick | undefined;
    let discoveryTrackId: string | undefined;
    // Artist keys of picks the candidate lookup does not know (the swapped-in one).
    const extraArtistKeys = new Map<string, string>();
    const artistKeyOf = (trackId: string) =>
      extraArtistKeys.get(trackId) ??
      discoveryArtistKey(candidatesById.get(trackId) ?? { id: trackId, artistId: null });
    const sessionWindowKeys = priorSessionArtistKeys.slice(
      -(DISCOVERY_POLICY_DEFAULTS.sessionWindow - 1),
    );
    if (
      surviving.length > 0 &&
      served < reserved &&
      canSwapForDiscovery(surviving.length, exploration.priorExplorationCount)
    ) {
      const swapped = await this.swapInDiscoveryPick(input, surviving, [
        ...sessionWindowKeys,
        ...surviving.slice(0, -1).map((entry) => artistKeyOf(entry.trackId)),
      ]);
      if (swapped) {
        surviving = swapped.picks;
        discoveryFacts = swapped.discoveryFacts;
        discoveryTrackId = swapped.picks[swapped.picks.length - 1].trackId;
        extraArtistKeys.set(discoveryTrackId, swapped.discoveryArtistKey);
        injected = true;
      }
    }

    // The model decides which tracks fit, not how many: fill up to the target.
    const topUp = await this.topUpPicks(
      input,
      surviving,
      artistKeyOf,
      priorSessionArtistKeys,
    );
    surviving = [...surviving, ...topUp.picks];

    const dropped = {
      ...policyResult.dropped,
      unknown: ordered.length - known.length,
    };
    const explorationAccounting = {
      reserved,
      served: served + (injected ? 1 : 0),
      injected,
    };
    const policy = {
      dropped,
      exploration: explorationAccounting,
      toppedUp: topUp.picks.length,
    };

    if (surviving.length === 0) {
      // An empty model reply nothing could fill stays the model's own rejection.
      if (picks.length === 0) return result;
      return {
        status: "rejected",
        reason: "no_policy_eligible_picks",
        reasoning: result.reasoning,
        latencyMs: result.latencyMs,
        policy,
      };
    }

    // Coverage of the final picks: the swapped-in discovery pick and the
    // fill-ins carry the facts of the selector's own track.
    const facts = surviving.map((pick) =>
      pick.trackId === discoveryTrackId && discoveryFacts
        ? discoveryFacts
        : topUp.facts.get(pick.trackId) ??
          coverageFactsFor(
            candidatesById.get(pick.trackId),
            audioFeaturesByTrack.get(pick.trackId),
          ),
    );
    const coverage = requestCoverageFor(input.preferences.request, facts);

    const [first] = surviving;
    return {
      ...result,
      ...(picks.length === 0
        ? { status: "approved" as const, reason: "llm_no_track_selected_topped_up" }
        : {}),
      trackId: first.trackId,
      licenseType: first.licenseType,
      priceUsd: first.priceUsd,
      picks: surviving,
      policy,
      ...(coverage ? { requestCoverage: coverage.coverage } : {}),
    };
  }

  /** Audio features for the picked tracks; a failed lookup just omits that track. */
  private async loadAudioFeatures(
    trackIds: string[],
  ): Promise<Map<string, AgentAudioFeatures>> {
    const byTrack = new Map<string, AgentAudioFeatures>();
    const service = this.audioFeatures;
    if (!service) return byTrack;
    await Promise.all(
      trackIds.map(async (trackId) => {
        try {
          const featureResult = await service.getOrCreate(trackId);
          if (featureResult?.status === "ok") {
            byTrack.set(trackId, featureResult.features);
          }
        } catch (error) {
          this.logger.warn(`Audio features unavailable for a pick: ${String(error)}`);
        }
      }),
    );
    return byTrack;
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
   * pick (and the facts coverage reads from it) for the same listener, session
   * and preferences, or returns undefined
   * when the selector has none that fits (not already picked, within the
   * artist cap given `otherArtistKeys`). Fails open.
   */
  private async swapInDiscoveryPick(
    input: AgentRuntimeInput,
    surviving: LlmTrackPick[],
    otherArtistKeys: string[],
  ): Promise<
    | {
        picks: LlmTrackPick[];
        discoveryFacts: AgentRequestCoveragePick;
        discoveryArtistKey: string;
      }
    | undefined
  > {
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
        tempoBpm: input.preferences.tempoBpm,
        // The runtime reserves only the final replacement, after all selector
        // constraints identify the one track that will actually be returned.
        reserveFirstListenerPlacements: false,
      });
      const pickedIds = new Set(surviving.map((entry) => entry.trackId));
      const artistCounts = new Map<string, number>();
      for (const key of otherArtistKeys) {
        artistCounts.set(key, (artistCounts.get(key) ?? 0) + 1);
      }
      const discovery = selection.selected.find((track: any) => {
        if (track.agentRecommendation?.reasonCode !== "discovery_pick") return false;
        if (pickedIds.has(track.id)) return false;
        const key = selectorTrackArtistKey(track);
        return (artistCounts.get(key) ?? 0) < DISCOVERY_POLICY_DEFAULTS.maxPerArtist;
      });
      if (!discovery) return undefined;

      if (this.firstListenerDiscovery && input.userId) {
        const authoritative = await this.firstListenerDiscovery.getFreshCandidates({
          userId: input.userId,
          allowExplicit: input.preferences.allowExplicit ?? false,
          trackIds: [discovery.id],
        });
        const fresh = authoritative.find((candidate) => candidate.id === discovery.id);
        if (fresh) {
          const reserved = await this.firstListenerDiscovery.reservePlacements(
            input.userId,
            [{ trackId: fresh.id, releaseId: fresh.releaseId }],
            { allowExplicit: input.preferences.allowExplicit ?? false },
          );
          if (!reserved.has(fresh.releaseId)) return undefined;
        } else if (discovery.firstListenerEligible) {
          // The source's earlier result is stale; never return it with fresh
          // discovery privilege after a failed authoritative recheck.
          return undefined;
        }
      } else if (discovery.firstListenerEligible) {
        return undefined;
      }

      const replaced = surviving[surviving.length - 1];
      const recommendation = discovery.agentRecommendation!;
      return {
        picks: [
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
        ],
        discoveryFacts: coverageFactsFor(
          discovery,
          recommendation.audioFeatures as AgentAudioFeatures | undefined,
        ),
        discoveryArtistKey: selectorTrackArtistKey(discovery),
      };
    } catch (error) {
      this.logger.warn(`Discovery pick unavailable for LLM picks: ${String(error)}`);
      return undefined;
    }
  }

  /**
   * Fills the page up to `getAgentTrackLimit()` from the deterministic
   * selector, called as the rule-based adapter calls it. Walks its ranked
   * shortlist in order and takes a track that is not already picked, is not a
   * fresh placement (those need a reservation, never handed out here) and keeps
   * the artist cap given the page and, on the strict pass, the session's last
   * tracks (a relaxed or widened pass already dropped that window on purpose).
   * `recentTrackIds` is the input's own, so the selector's session rules are
   * unchanged. Fails open: any error adds nothing.
   */
  private async topUpPicks(
    input: AgentRuntimeInput,
    picks: LlmTrackPick[],
    artistKeyOf: (trackId: string) => string,
    priorSessionArtistKeys: string[],
  ): Promise<{ picks: LlmTrackPick[]; facts: Map<string, AgentRequestCoveragePick> }> {
    const none = { picks: [], facts: new Map<string, AgentRequestCoveragePick>() };
    const target = getAgentTrackLimit();
    const need = target - picks.length;
    if (need <= 0 || !this.selector) return none;
    try {
      const selection = await this.selector.select({
        ...deterministicSelectorInput({
          userId: input.userId,
          recentTrackIds: input.recentTrackIds,
          preferences: input.preferences,
          limit: Math.min(50, target + picks.length),
        }),
        // A fresh placement needs a reservation; fill-ins never take one.
        reserveFirstListenerPlacements: false,
      });
      const pickedIds = new Set(picks.map((entry) => entry.trackId));
      const artistCounts = new Map<string, number>();
      const count = (key: string) =>
        artistCounts.set(key, (artistCounts.get(key) ?? 0) + 1);
      for (const entry of picks) count(artistKeyOf(entry.trackId));
      if (!selection.fallback) {
        for (const key of priorSessionArtistKeys.slice(
          -(DISCOVERY_POLICY_DEFAULTS.sessionWindow - 1),
        )) {
          count(key);
        }
      }

      const added: LlmTrackPick[] = [];
      const facts = new Map<string, AgentRequestCoveragePick>();
      for (const track of selection.selected) {
        if (added.length >= need) break;
        const recommendation = track.agentRecommendation;
        if (!recommendation || pickedIds.has(track.id) || track.firstListenerEligible) {
          continue;
        }
        const key = selectorTrackArtistKey(track);
        if ((artistCounts.get(key) ?? 0) >= DISCOVERY_POLICY_DEFAULTS.maxPerArtist) {
          continue;
        }
        count(key);
        pickedIds.add(track.id);
        added.push({
          trackId: track.id,
          licenseType: input.preferences.licenseType ?? "personal",
          // Not a model-negotiated price; buy mode negotiates it separately.
          priceUsd: 0,
          score: recommendation.score,
          explanation: recommendation.explanation,
          reasonCode: recommendation.reasonCode,
          signals: recommendation.signals,
        });
        facts.set(
          track.id,
          coverageFactsFor(track, recommendation.audioFeatures as AgentAudioFeatures | undefined),
        );
      }
      if (added.length > 0) {
        this.logger.log(
          `Topped up ${added.length} LLM pick(s) to reach target ${target} from the ranked selector`,
        );
      }
      return { picks: added, facts };
    } catch (error) {
      this.logger.warn(`Top-up unavailable for LLM picks: ${String(error)}`);
      return none;
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

/** The diversity-cap key of a track the selector returned, by credited artist (#2092). */
function selectorTrackArtistKey(track: any): string {
  return discoveryArtistKey({
    id: track.id,
    artistId: track.release?.artistId ?? null,
    artist: track.artist ?? null,
    release: {
      artistDisplayName: resolveCreditedArtistName({
        trackArtist: track.artist ?? null,
        primaryArtist: track.release?.primaryArtist ?? null,
        accountDisplayName: track.release?.artist?.displayName ?? null,
      }),
    },
  });
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

/**
 * What the request filters read about a pick (#2037): genre and moods from the
 * release, energy and tempo from the audio features. The tempo only counts when
 * measured; the inferred tempo is a metadata hash.
 */
function coverageFactsFor(
  track: { release?: { genre?: string | null; moods?: string[] | null } | null } | undefined,
  features: AgentAudioFeatures | undefined,
): AgentRequestCoveragePick {
  return {
    genre: track?.release?.genre ?? null,
    moods: track?.release?.moods ?? [],
    energyBand: features?.energyBand,
    tempoBpm: features?.tempoBpm,
    tempoMeasured: features?.featureSources?.tempo === "measured",
  };
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

/** The model cannot supply a discovery claim when the policy did not verify it. */
function stripUnverifiedDiscoveryAnnotations(result: AgentRuntimeResult): AgentRuntimeResult {
  if (!result.picks?.length) return result;
  let changed = false;
  const picks = result.picks.map((pick) => {
    const containsDiscoveryExplanation = pick.explanation?.some(
      (line) => line === DISCOVERY_EXPLANATIONS.discovery_pick,
    );
    if (pick.reasonCode !== "discovery_pick" && !containsDiscoveryExplanation) {
      return pick;
    }
    changed = true;
    const ordinary = { ...pick };
    delete ordinary.score;
    delete ordinary.explanation;
    delete ordinary.reasonCode;
    delete ordinary.signals;
    return ordinary;
  });
  return changed ? { ...result, picks } : result;
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
