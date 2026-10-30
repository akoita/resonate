import { Injectable, Logger, Optional } from "@nestjs/common";
import { CommunityCohortService } from "../community/community_cohort.service";
import { DISCOVERY_EXPLANATIONS } from "../recommendations/discovery-explanations";
import {
  applyFirstListenerReservationOutcome,
  applyDiscoveryPolicy,
  DISCOVERY_POLICY_DEFAULTS,
  discoveryArtistKey,
  explorationShareFor,
  isDiscoveryLevel,
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
import { resolveCreditedArtistName, resolveCreditedArtistNames } from "../shared/artist_attribution";
import { AgentLearningService } from "./agent_learning.service";
import { expandAgentTasteQueries } from "./agent_taste_expansion";
import {
  buildAgentRecommendationQueries,
  deterministicSelectorInput,
  requestedTermsFor,
  tasteQueriesFor,
} from "./deterministic_recommendation.adapter";
import { getAgentTrackLimit } from "./agent_runtime.config";
import type {
  AgentAudioFeatureService,
  AgentAudioFeatures,
} from "./agent_audio_feature.service";
import {
  requestCoverageFor,
  requestCoverageForScope,
  requestMatchesFor,
  requestScopeFor,
  requestTierOf,
  constrainsCatalog,
  effectiveEnergyBand,
  tierMatchesRequest,
  withoutSeedEvidence,
  type AgentRequestCapRelaxed,
  type AgentRequestCoverageNotes,
  type AgentRequestCoveragePick,
  type AgentRequestScope,
  type RequestTier,
} from "./agent_session_request";
import { AgentSelectorService, HeldBack, isHiddenTasteQuery } from "./agent_selector.service";
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
 *  7. request-first selection (#2316), when the session carries a request: a
 *     model pick outside the request (tier C) is dropped unless the listener
 *     allowed similar sounds (counted in `policy.dropped.offRequest` and
 *     logged); the top-up follows the selector's tier order and the same
 *     padding rule, relaxing the per-artist cap for matching tracks before it
 *     settles for a shorter batch; Home impressions no longer demote picks and
 *     only exploration from tiers A and B is labelled discovery.
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
    // Request-first selection (#2316): undefined without a request of its own.
    const scope = requestScopeFor(input.preferences);

    // One pick per track, in the model's order.
    const seen = new Set<string>();
    const ordered = picks.filter((pick) => {
      if (!pick.trackId || seen.has(pick.trackId)) return false;
      seen.add(pick.trackId);
      return true;
    });

    const [taste, candidatesById, sessionArtistKeys] = await Promise.all([
      this.tasteMemory?.getPolicy(userId),
      scope
        ? policyContext.loadTrackCandidates(ordered.map((pick) => pick.trackId), { performerCap: true })
        : policyContext.loadTrackCandidates(ordered.map((pick) => pick.trackId)),
      scope
        ? policyContext.artistKeysForTracks(input.recentTrackIds, true)
        : policyContext.artistKeysForTracks(input.recentTrackIds),
    ]);

    const originalQueries = buildAgentRecommendationQueries(input.preferences)
      .filter(Boolean)
      .filter((query) => !isHiddenTasteQuery(taste, query));
    const expandedQueries = expandAgentTasteQueries(originalQueries);
    const learnedGenreWeights = await this.resolveLearnedGenreWeights(
      input,
      taste,
    );
    // A request-first session does not read Home impressions; what the listener
    // PLAYED recently steps down gently inside its tier instead (#2316).
    const servedHistory = scope ? [] : await this.resolveServedHistory(userId);
    const playedTrackIds = scope ? await this.resolvePlayedHistory(userId) : [];
    const cohortContext = userId
      ? (await this.cohorts?.getDiscoveryContextForUser(userId)) ?? []
      : [];
    const canUseWarehouseTaste = userId
      ? (await this.tasteMemory?.canUseTasteForSocialMatching(userId)) ?? false
      : false;

    // Unknown ids (the model invented one) cannot be ranked or explained.
    const recognised = ordered.filter((pick) => candidatesById.has(pick.trackId));
    // The listener's explicit setting holds for model picks too (#2454): the
    // model's tools hide explicit tracks, and this enforces it if a model names
    // one anyway. Dropped picks are counted in `policy.dropped.explicit`.
    const known =
      input.preferences.allowExplicit === true
        ? recognised
        : recognised.filter((pick) => candidatesById.get(pick.trackId)?.explicit !== true);
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
      ...(scope ? { playedTrackIds } : {}),
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
    let inModelOrder = known.map(
      (pick) => rankedById.get(pick.trackId)!,
    ) as RankedDiscoveryCandidate[];

    // Request-first selection (#2316): the same predicate that tiers the
    // selector's candidates tiers the model's picks, descriptor families
    // included. A pick outside the request is dropped unless the listener
    // allowed similar sounds; the rule-based top-up below then fills the batch
    // from the matching tracks, in tier order.
    const tierByTrackId = new Map<string, RequestTier>();
    let offRequestDropped = 0;
    if (scope) {
      const verifiable = withoutSeedEvidence(scope);
      for (const entry of inModelOrder) {
        tierByTrackId.set(
          entry.id,
          requestTierOf(verifiable, coverageFactsFor(candidatesById.get(entry.id), audioFeaturesByTrack.get(entry.id))),
        );
      }
      if (!scope.fillSimilar) {
        const onRequest = inModelOrder.filter((entry) => tierByTrackId.get(entry.id) !== "C");
        offRequestDropped = inModelOrder.length - onRequest.length;
        if (offRequestDropped > 0) {
          this.logger.log(`Dropped ${offRequestDropped} model pick(s) outside the request`);
          inModelOrder = onRequest;
        }
      }
    }

    // recentTrackIds is newest-first; the policy wants chronological order.
    const priorSessionArtistKeys = [...input.recentTrackIds]
      .reverse()
      .map(
        (id) =>
          sessionArtistKeys.get(id) ?? discoveryArtistKey({ id, artistId: null }),
      );

    const exploration = await this.loadExplorationContext(input, known, candidatesById);
    const explorationShare = explorationShareFor(input.preferences.discovery);
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
      // The Discovery control (#2327): Familiar reserves nothing, New reserves more.
      explorationShare,
      // A discovery label needs a pick that belongs to the request (#2316).
      ...(scope
        ? {
            explorationAllowedIds: new Set(
              inModelOrder.filter((entry) => tierByTrackId.get(entry.id) !== "C").map((entry) => entry.id),
            ),
          }
        : {}),
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
      canSwapForDiscovery(surviving.length, exploration.priorExplorationCount, explorationShare)
    ) {
      const swapped = await this.swapInDiscoveryPick(input, scope, surviving, [
        ...sessionWindowKeys,
        ...surviving.slice(0, -1).map((entry) => artistKeyOf(entry.trackId)),
      ]);
      if (swapped) {
        surviving = swapped.picks;
        discoveryFacts = swapped.discoveryFacts;
        discoveryTrackId = swapped.picks[swapped.picks.length - 1].trackId;
        if (swapped.discoveryTier) tierByTrackId.set(discoveryTrackId, swapped.discoveryTier);
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
    for (const [trackId, tier] of topUp.tiers) tierByTrackId.set(trackId, tier);

    const dropped = {
      ...policyResult.dropped,
      unknown: ordered.length - recognised.length,
      ...(recognised.length > known.length ? { explicit: recognised.length - known.length } : {}),
      ...(scope ? { offRequest: offRequestDropped } : {}),
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
    // A request-first session reports against its effective request, the cap
    // relaxation and a short batch (#2316); otherwise the described request only.
    const targetCount = getAgentTrackLimit();
    const notes: AgentRequestCoverageNotes = {
      ...(topUp.capRelaxed ? { capRelaxed: topUp.capRelaxed } : {}),
      ...(constrainsCatalog(scope) && !scope?.fillSimilar && surviving.length < targetCount
        ? { shortfallReason: "catalog_short" as const }
        : {}),
    };
    const coverage = scope
      ? requestCoverageForScope(scope, facts, topUp.heldBack, notes)
      : requestCoverageFor(input.preferences.request, facts, topUp.heldBack);
    // Per pick, by the same predicates (#2312); absent when the request has no filters.
    // A request-first pick belongs to the request unless it is a marked off-request pick (#2316).
    const requestMatches = scope
      ? surviving.map((pick) => tierMatchesRequest(tierByTrackId.get(pick.trackId) ?? "A"))
      : requestMatchesFor(input.preferences.request, facts);
    const finalPicks = requestMatches
      ? surviving.map((pick, index) => ({ ...pick, requestMatch: requestMatches[index] }))
      : surviving;

    const [first] = surviving;
    return {
      ...result,
      ...(picks.length === 0
        ? { status: "approved" as const, reason: "llm_no_track_selected_topped_up" }
        : {}),
      trackId: first.trackId,
      licenseType: first.licenseType,
      priceUsd: first.priceUsd,
      picks: finalPicks,
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
    scope: AgentRequestScope | undefined,
    surviving: LlmTrackPick[],
    otherArtistKeys: string[],
  ): Promise<
    | {
        picks: LlmTrackPick[];
        discoveryFacts: AgentRequestCoveragePick;
        discoveryArtistKey: string;
        discoveryTier?: RequestTier;
      }
    | undefined
  > {
    if (!this.selector) return undefined;
    try {
      const queries = buildAgentRecommendationQueries(input.preferences);
      const selection = await this.selector.select({
        userId: input.userId,
        sessionId: input.sessionId,
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
        // The same Discovery level, so the replacement is chosen under the same share (#2327).
        ...(isDiscoveryLevel(input.preferences.discovery) ? { discovery: input.preferences.discovery } : {}),
        // The discovery pick belongs to the request too (#2316).
        ...(scope
          ? {
              requestScope: scope,
              ...(tasteQueriesFor(input.preferences).length > 0
                ? { tasteQueries: tasteQueriesFor(input.preferences) }
                : {}),
            }
          : {}),
      });
      const pickedIds = new Set(surviving.map((entry) => entry.trackId));
      const artistCounts = new Map<string, number>();
      for (const key of otherArtistKeys) {
        artistCounts.set(key, (artistCounts.get(key) ?? 0) + 1);
      }
      const discovery = selection.selected.find((track: any) => {
        if (track.agentRecommendation?.reasonCode !== "discovery_pick") return false;
        if (pickedIds.has(track.id)) return false;
        if (track.requestTier === "C") return false;
        const key = selectorTrackArtistKey(track, Boolean(scope));
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
        discoveryArtistKey: selectorTrackArtistKey(discovery, Boolean(scope)),
        ...(discovery.requestTier ? { discoveryTier: discovery.requestTier as RequestTier } : {}),
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
  ): Promise<{
    picks: LlmTrackPick[];
    facts: Map<string, AgentRequestCoveragePick>;
    /** Request-first selection (#2316): the tier of each fill-in. */
    tiers: Map<string, RequestTier>;
    /** Strong matches the selector left out (artist cap, explicit preference). */
    heldBack?: HeldBack;
    /** Request-first selection (#2316): the artist cap was relaxed for matching fill-ins. */
    capRelaxed?: AgentRequestCapRelaxed;
  }> {
    const none = {
      picks: [],
      facts: new Map<string, AgentRequestCoveragePick>(),
      tiers: new Map<string, RequestTier>(),
    };
    const target = getAgentTrackLimit();
    const need = target - picks.length;
    if (need <= 0 || !this.selector) return none;
    try {
      const selection = await this.selector.select({
        ...deterministicSelectorInput({
          userId: input.userId,
          sessionId: input.sessionId,
          recentTrackIds: input.recentTrackIds,
          preferences: input.preferences,
          limit: Math.min(50, target + picks.length),
        }),
        // A fresh placement needs a reservation; fill-ins never take one.
        reserveFirstListenerPlacements: false,
      });
      const scope = requestScopeFor(input.preferences);
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
      const tiers = new Map<string, RequestTier>();
      const relaxedKeys = new Map<string, { tracks: number; artist: string }>();
      const eligible = (selection.selected as any[]).filter((track) => {
        const recommendation = track.agentRecommendation;
        return Boolean(recommendation) && !track.firstListenerEligible;
      });
      const take = (track: any, relaxed: boolean) => {
        const recommendation = track.agentRecommendation;
        const key = selectorTrackArtistKey(track, Boolean(scope));
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
        if (track.requestTier) tiers.set(track.id, track.requestTier);
        if (relaxed) {
          const held = relaxedKeys.get(key);
          relaxedKeys.set(key, {
            tracks: artistCounts.get(key) ?? 0,
            artist: held?.artist ?? creditedNameOf(track),
          });
        }
      };
      const withinCap = (track: any) =>
        (artistCounts.get(selectorTrackArtistKey(track, Boolean(scope))) ?? 0) < DISCOVERY_POLICY_DEFAULTS.maxPerArtist;

      // Pass 1: the selector's order, under the artist cap. Request-first sessions
      // leave tier C for the end, so a matching track is never behind an off-request one.
      for (const track of eligible) {
        if (added.length >= need) break;
        if (pickedIds.has(track.id)) continue;
        if (track.requestTier === "C") continue;
        if (!withinCap(track)) continue;
        take(track, false);
      }
      // Pass 2 (request-first only, #2316): matching tracks the cap held back
      // come before a short batch, one more per artist at a time, and well before any tier C.
      if (scope) {
        for (
          let level = DISCOVERY_POLICY_DEFAULTS.maxPerArtist + 1;
          added.length < need && eligible.some((track) => !pickedIds.has(track.id) && track.requestTier !== "C");
          level += 1
        ) {
          for (const track of eligible) {
            if (added.length >= need) break;
            if (pickedIds.has(track.id) || track.requestTier === "C") continue;
            if ((artistCounts.get(selectorTrackArtistKey(track, Boolean(scope))) ?? 0) >= level) continue;
            take(track, true);
          }
        }
      }
      // Pass 3: marked off-request tracks, only when the selector offered them (padding allowed).
      for (const track of eligible) {
        if (added.length >= need) break;
        if (pickedIds.has(track.id) || track.requestTier !== "C") continue;
        if (!withinCap(track)) continue;
        take(track, false);
      }
      if (added.length > 0) {
        this.logger.log(
          `Topped up ${added.length} LLM pick(s) to reach target ${target} from the ranked selector`,
        );
      }
      const top = [...relaxedKeys.values()].sort((a, b) => b.tracks - a.tracks)[0];
      const capRelaxed: AgentRequestCapRelaxed | undefined =
        relaxedKeys.size > 0
          ? { artists: relaxedKeys.size, ...(top?.artist ? { top: { artist: top.artist, tracks: top.tracks } } : {}) }
          : undefined;
      return {
        picks: added,
        facts,
        tiers,
        ...(selection.heldBack ? { heldBack: selection.heldBack } : {}),
        ...(capRelaxed ? { capRelaxed } : {}),
      };
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

  /** The tracks the listener recently played (#2316); fails open to none. */
  private async resolvePlayedHistory(userId?: string): Promise<string[]> {
    if (!userId || !this.policyContext) return [];
    try {
      return await this.policyContext.recentPlayedTrackIds(userId);
    } catch (error) {
      this.logger.warn(`Played history unavailable: ${String(error)}`);
      return [];
    }
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
function selectorTrackArtistKey(track: any, performerCap = false): string {
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
      // Request-first: the cap keys on the performer, never the uploader account (#2316).
      ...(performerCap ? { creditedArtistName: creditedNameOf(track) || null } : {}),
    },
  });
}

/** The performer a selector track is credited to, or "" when it has no credit (#2316). */
function creditedNameOf(track: any): string {
  return (
    resolveCreditedArtistNames({
      trackArtist: track.artist ?? null,
      primaryArtist: track.release?.primaryArtist ?? null,
    })[0] ?? ""
  );
}

/**
 * A swap is allowed when the page's own share earns a discovery slot, or the
 * session's prior discovery count is known (then the policy paces it to about
 * one in five session tracks). A one-track call with an unknown count only
 * reaches the "at least one" floor and must not always be a discovery pick.
 */
function canSwapForDiscovery(
  pageSize: number,
  priorExplorationCount?: number,
  share: number = DISCOVERY_POLICY_DEFAULTS.explorationShare,
) {
  if (share <= 0) return false;
  if (priorExplorationCount !== undefined) return true;
  return Math.round(pageSize * share) >= 1;
}

/**
 * What the request filters read about a pick (#2037): genre and moods from the
 * release, energy and tempo from the audio features. The tempo only counts when
 * measured; the inferred tempo is a metadata hash.
 */
function coverageFactsFor(
  track:
    | {
        release?: { genre?: string | null; moods?: string[] | null } | null;
        descriptor?: { families?: string[] | null; energyBand?: string | null } | null;
        /** A ranking candidate (`loadTrackCandidates`) carries the families directly. */
        descriptorFamilies?: readonly string[] | null;
        /** ... and the descriptor's energy band. */
        descriptorEnergyBand?: string | null;
      }
    | undefined,
  features: AgentAudioFeatures | undefined,
): AgentRequestCoveragePick {
  return {
    genre: track?.release?.genre ?? null,
    descriptorFamilies: track?.descriptor?.families ?? track?.descriptorFamilies ?? [],
    moods: track?.release?.moods ?? [],
    energyBand: effectiveEnergyBand(features, track?.descriptor?.energyBand ?? track?.descriptorEnergyBand),
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
