import { Injectable, Logger, Optional } from "@nestjs/common";
import { ToolRegistry } from "./tools/tool_registry";
import { expandAgentTasteQueries } from "./agent_taste_expansion";
import { AgentAudioFeatureService, AgentAudioFeatures } from "./agent_audio_feature.service";
import { AgentBigQueryTasteSignalService, AgentTasteScore } from "./agent_bigquery_taste_signal.service";
import { CommunityCohortService } from "../community/community_cohort.service";
import {
  applyFirstListenerReservationOutcome,
  applyDiscoveryPolicy,
  DISCOVERY_POLICY_DEFAULTS,
  discoveryArtistKey,
} from "../recommendations/discovery-policy";
import { DiscoveryPolicyContextService } from "../recommendations/discovery-policy-context.service";
import { DiscoveryRankingService } from "../recommendations/discovery-ranking.service";
import { RecommendationsService } from "../recommendations/recommendations.service";
import { FirstListenerDiscoveryService } from "../recommendations/first_listener_discovery.service";
import { FIRST_LISTENER_CANDIDATE_LIMIT } from "../recommendations/first_listener.contracts";
import {
  hasSignal,
  TasteMemoryPolicy,
  TasteMemoryService,
} from "../recommendations/taste_memory.service";
import type { DiscoveryReasonCode } from "../recommendations/discovery-explanations";
import { resolveCreditedArtistName } from "../shared/artist_attribution";
import { isPromotionEligible } from "../catalog/ai-disclosure.policy";
import { AgentLearningService } from "./agent_learning.service";
import {
  buildMixCoverage,
  matchingMyMixLaneIds,
  MixCoverage,
  ResolvedMyMixPlan,
} from "./agent_my_mix";

// Expanded catalog queries can return many candidates; keep the freshness
// check bounded and suppress discovery if the full candidate pool will not fit.
const FIRST_LISTENER_VALIDATION_LIMIT = 200;

export interface AgentSelectorInput {
  userId?: string;
  queries?: string[];
  recentTrackIds: string[];
  allowExplicit?: boolean;
  useEmbeddings?: boolean;
  limit?: number;
  /** Let a caller reserve only the fresh placement it actually returns. */
  reserveFirstListenerPlacements?: boolean;
  energy?: "low" | "medium" | "high";
  /**
   * Learned genre weights from the caller. The selector prefers the shared
   * resolver's weights for `userId` (one taste profile for Home and the DJ,
   * #1456) and uses these only when no stored profile resolves.
   */
  learnedGenreWeights?: Record<string, number>;
  /** Session intent (preset) as ranking context; never stored as taste. */
  sessionIntent?: string;
  /** Requested mood; matched like the intent when it is not already a query. */
  mood?: string;
  queueStyle?: string;
  /**
   * Requested tempo range in BPM (#2037). A ranking boost on tracks whose tempo
   * was measured; never a filter, and an inferred tempo never counts.
   */
  tempoBpm?: { min: number | null; max: number | null };
  /**
   * Listening sessions only (#2056): when the strict pass finds nothing, drop
   * the per-session artist window (keeping two per artist per pick), then, mid
   * session and only once the matching tracks are used up, widen to the whole
   * catalog. A session track is never repeated, and hidden taste, AI content
   * and exploration rules are never relaxed.
   */
  fallback?: boolean;
  /**
   * Genres and moods the session itself asked for (#2059), before learned
   * favourites and saved vibes are merged into `queries`. Matches rank above
   * learned taste; the merged queries still fill the remaining slots.
   */
  requestedTerms?: string[];
  /** Server-resolved session-only My Mix plan. */
  myMixPlan?: ResolvedMyMixPlan;
}

/**
 * One selection pass. `strict` is the normal pass; `relaxed` drops the "two
 * per artist per 10 session tracks" window but keeps the per-pick cap;
 * `widened` is `relaxed` plus the newest catalog-wide tracks.
 */
type SelectionPass = "strict" | "relaxed" | "widened";

/** How many newest catalog-wide tracks a widened pass adds. */
const CATALOG_WIDE_CANDIDATES = 50;

export interface AgentSelectionSignal {
  label: string;
  weight: number;
  reason: string;
}

export interface AgentCandidateTrack {
  id: string;
  title?: string | null;
  hasListing?: boolean;
  release?: {
    genre?: string | null;
    title?: string | null;
    moods?: string[] | null;
    artistId?: string | null;
  };
  releaseId?: string;
  /** Private internal assignment used only for response coverage. */
  mixLaneId?: string;
  /** Internal marker used by runtime injection before returning a fresh pick. */
  firstListenerEligible?: boolean;
  agentRecommendation?: {
    score: number;
    matchedQueries: string[];
    signals: AgentSelectionSignal[];
    explanation: string[];
    /** Primary categorical reason from the shared discovery vocabulary. */
    reasonCode?: DiscoveryReasonCode;
    audioFeatures?: AgentAudioFeatures;
    trace?: Record<string, unknown>;
  };
}

export interface AgentSelectionResult {
  candidates: string[];
  selected: AgentCandidateTrack[];
  rejected: Array<{ trackId: string; reason: string }>;
  reason: string;
  fallback?: "relaxed_artist_window" | "widened";
  mixCoverage?: MixCoverage;
  policy?: {
    dropped: { hidden: number; aiGenerated: number; diversity: number };
    exploration: { reserved: number; served: number };
  };
}

@Injectable()
export class AgentSelectorService {
  private readonly logger = new Logger(AgentSelectorService.name);

  constructor(
    private readonly tools: ToolRegistry,
    // The unified scoring core (#1448 WS-1) shared with the Home feed.
    private readonly rankingService: DiscoveryRankingService,
    @Optional()
    private readonly audioFeatures?: AgentAudioFeatureService,
    @Optional()
    private readonly bigQueryTasteSignals?: AgentBigQueryTasteSignalService,
    @Optional()
    private readonly tasteMemoryService?: TasteMemoryService,
    @Optional()
    private readonly communityCohortService?: CommunityCohortService,
    // Policy-stage lookups (verified humans, played artists, session artists).
    // Absent in lightweight unit wiring: the policy then runs with empty sets.
    @Optional()
    private readonly policyContext?: DiscoveryPolicyContextService,
    // Shared taste profile resolver (same one Home uses).
    @Optional()
    private readonly learning?: AgentLearningService,
    // Shared served-history source (same one Home reads and writes).
    @Optional()
    private readonly recommendations?: RecommendationsService,
    // Bounded fresh-release source and transactional placement reservation.
    @Optional()
    private readonly firstListenerDiscovery?: FirstListenerDiscoveryService,
  ) { }

  /**
   * The ranked, policy-checked shortlist for one request. With `fallback`
   * (listening sessions, #2056) an empty strict pass is retried, so a small
   * catalog does not dead-end after one pick; `fallback` on the result says
   * which pass served:
   *  1. `relaxed_artist_window`: same matching tracks, without the per-session
   *     artist window (two per artist per pick still holds);
   *  2. `widened`: mid session only, once the strict pass found matching
   *     tracks and every one is used up, the newest catalog-wide tracks too.
   * A request nothing in the catalog matches is never widened: the session
   * says so and the gap stays recorded as unmet demand (ADR-TE-4).
   */
  async select(input: AgentSelectorInput): Promise<AgentSelectionResult> {
    const strict = await this.selectPass(input, "strict");
    // Nothing matched at all: no relaxation can help, and widening would hide the gap.
    if (!input.fallback || strict.selected.length > 0 || strict.candidates.length === 0) return strict;
    const relaxed = await this.selectPass(input, "relaxed");
    if (relaxed.selected.length > 0) return { ...relaxed, fallback: "relaxed_artist_window" as const };
    if (input.recentTrackIds.length === 0) return strict;
    const widened = await this.selectPass(input, "widened");
    if (widened.selected.length > 0) return { ...widened, fallback: "widened" as const };
    return strict;
  }

  private async selectPass(input: AgentSelectorInput, pass: SelectionPass): Promise<AgentSelectionResult> {
    const policy = input.userId ? await this.tasteMemoryService?.getPolicy(input.userId) : undefined;
    const originalQueries = (input.queries ?? [])
      .filter(Boolean)
      .filter((query) => !isHiddenTasteQuery(policy, query));
    const cohortContext = input.userId
      ? await this.communityCohortService?.getDiscoveryContextForUser(input.userId) ?? []
      : [];
    const cohortQueries = cohortContext.flatMap((cohort) => cohort.queryHints);
    const queries = expandAgentTasteQueries(uniqueCaseInsensitive([...originalQueries, ...cohortQueries]));
    const limit = input.limit ?? 5;

    // Gather candidates from all vibes/queries
    const byId = new Map<string, AgentCandidateTrack & { matchedQueries: string[] }>();

    // A widened pass also searches the whole catalog ("" = newest tracks).
    const searchQueries = queries.length === 0 || pass === "widened" ? [...queries, ""] : queries;
    for (const query of searchQueries) {
      const tool = this.tools.get("catalog.search");
      const result = await tool.run({
        query,
        limit: query === "" && pass === "widened" ? CATALOG_WIDE_CANDIDATES : 20,
        allowExplicit: input.allowExplicit ?? false,
      });
      const items = (result.items as any[]) ?? [];
      for (const item of items) {
        // Defense in depth for alternate/mock catalog tools: ADR-BM-5 keeps
        // fully generated music out of AI DJ promotion even when a candidate
        // source forgets to apply the database filter.
        if (!isPromotionEligible(item.aiDisclosureLevel ?? item.aiDisclosure?.level)) {
          continue;
        }
        const existing = byId.get(item.id);
        if (existing) {
          if (query && !existing.matchedQueries.includes(query)) {
            existing.matchedQueries.push(query);
          }
        } else {
          byId.set(item.id, {
            ...item,
            matchedQueries: query ? [query] : [],
          });
        }
      }
    }

    const firstListenerCandidates = input.userId && this.firstListenerDiscovery
      ? await this.firstListenerDiscovery
          .getFreshCandidates({
            userId: input.userId,
            allowExplicit: input.allowExplicit ?? false,
          })
          .catch(() => [])
      : [];
    const firstListenerTrackIds = new Set(firstListenerCandidates.map((track) => track.id));
    for (const track of firstListenerCandidates) {
      const existing = byId.get(track.id);
      if (!existing) {
        byId.set(track.id, { ...track, matchedQueries: [] });
      } else {
        byId.set(track.id, {
          ...existing,
          releaseId: track.releaseId,
          release: { ...existing.release, ...track.release },
        });
      }
    }

    let firstListenerVerificationComplete = true;
    if (input.userId && this.firstListenerDiscovery) {
      const ordinaryTrackIds = [...byId.keys()].filter((trackId) => !firstListenerTrackIds.has(trackId));
      if (ordinaryTrackIds.length > FIRST_LISTENER_VALIDATION_LIMIT) {
        firstListenerVerificationComplete = false;
      } else {
        for (let offset = 0; offset < ordinaryTrackIds.length; offset += FIRST_LISTENER_CANDIDATE_LIMIT) {
          const trackIds = ordinaryTrackIds.slice(
            offset,
            offset + FIRST_LISTENER_CANDIDATE_LIMIT,
          );
          try {
            const validated = await this.firstListenerDiscovery.getFreshCandidates({
              userId: input.userId,
              allowExplicit: input.allowExplicit ?? false,
              trackIds,
            });
            for (const track of validated) firstListenerTrackIds.add(track.id);
          } catch {
            firstListenerVerificationComplete = false;
            break;
          }
        }
      }
    }

    let allCandidates = Array.from(byId.values());
    const laneMatchesByCandidateId = new Map<string, string[]>();
    if (input.myMixPlan) {
      for (const track of allCandidates) {
        laneMatchesByCandidateId.set(
          track.id,
          matchingMyMixLaneIds(input.myMixPlan.lanes, track.release),
        );
      }
      // Sources such as cohort expansion and first-listener discovery may add
      // unrelated tracks. They cannot satisfy a lane or trigger fallback.
      // The established widened pass remains available after matching catalog
      // candidates have all been consumed during a session.
      if (pass !== "widened") {
        allCandidates = allCandidates.filter(
          (track) => (laneMatchesByCandidateId.get(track.id)?.length ?? 0) > 0,
        );
      }
    }

    if (allCandidates.length === 0) {
      return {
        candidates: [],
        selected: [],
        rejected: [],
        reason: queries.length ? "no_matching_taste_candidates" : "empty_catalog",
        ...(input.myMixPlan ? { mixCoverage: buildMixCoverage(input.myMixPlan, new Map()) } : {}),
      };
    }

    const similarityScores = new Map<string, number>();
    // Optionally rank by embedding similarity to the combined query
    if (input.useEmbeddings && allCandidates.length > 1 && queries.length > 0) {
      const combinedQuery = queries.join(" ");
      const ranked = await this.tools.get("embeddings.similarity").run({
        query: combinedQuery,
        candidates: allCandidates.map((track) => track.id),
      });
      const rankedIds = (ranked.ranked as { trackId: string }[]) ?? [];
      rankedIds.forEach((entry, index) => {
        similarityScores.set(entry.trackId, Math.max(0, 1 - index / Math.max(1, rankedIds.length)));
      });
      const ordered = rankedIds
        .map((entry) => allCandidates.find((track) => track.id === entry.trackId))
        .filter(Boolean) as any[];
      if (ordered.length) {
        // Embedding coverage can be partial (a candidate may have no current
        // vector yet); keep those after the ranked ones in their original
        // order instead of dropping them (#1452).
        const rankedSet = new Set(ordered.map((track) => track.id));
        allCandidates = [
          ...ordered,
          ...allCandidates.filter((track) => !rankedSet.has(track.id)),
        ];
      }
    }

    const canUseWarehouseTaste = input.userId
      ? await this.tasteMemoryService?.canUseTasteForSocialMatching(input.userId) ?? true
      : false;
    const bigQueryTasteScores = input.userId && canUseWarehouseTaste
      ? await this.bigQueryTasteSignals?.scoreTracks({
        userId: input.userId,
        trackIds: allCandidates.map((track) => track.id),
      }) ?? new Map<string, AgentTasteScore>()
      : new Map<string, AgentTasteScore>();

    // #1448 WS-1: scoring is delegated to the shared DiscoveryRankingService
    // (one core for the DJ and the Home feed). The DJ pre-fetches per-track
    // audio features and passes every signal as data — the core is pure.
    const audioFeaturesByTrack = new Map<string, AgentAudioFeatures>();
    if (this.audioFeatures) {
      await Promise.all(
        allCandidates.map(async (track) => {
          const featureResult = await this.audioFeatures?.getOrCreate(track.id);
          if (featureResult?.status === "ok") {
            audioFeaturesByTrack.set(track.id, featureResult.features);
          }
        }),
      );
    }

    // One taste profile and one served-history source for the DJ and Home
    // (#1456 WS-9). Both fail open: a read error contributes nothing.
    const learnedGenreWeights = await this.resolveLearnedGenreWeights(
      input,
      policy,
    );
    const servedHistory = await this.resolveServedHistory(input.userId);
    const sessionIntent = buildSessionIntent(input);

    const rankingCandidates = allCandidates.map((track: any) => ({
        id: track.id,
        title: track.title,
        artist: track.artist ?? null,
        hasListing: track.hasListing,
        // Artist identity + AI disclosure feed the policy stage: without an
        // artistId no DJ candidate can be an exploration pick.
        artistId: track.release?.artistId ?? null,
        releaseId: track.releaseId ?? null,
        firstListenerEligible:
          firstListenerVerificationComplete &&
          firstListenerTrackIds.has(track.id) &&
          aiDisclosureLevelOf(track) !== "ALL",
        aiDisclosureLevel: aiDisclosureLevelOf(track),
        release: {
          genre: track.release?.genre ?? null,
          title: track.release?.title ?? null,
          moods: track.release?.moods ?? null,
          // Credited artist (#1492), not the uploader/manager account label.
          // catalog.search does not include release.primaryArtist / release.artist,
          // so in practice this resolves to the Track.artist scalar; the helper
          // still applies the canonical order for whatever fields are present.
          artistDisplayName: resolveCreditedArtistName({
            trackArtist: track.artist ?? null,
            primaryArtist: track.release?.primaryArtist ?? null,
            accountDisplayName: track.release?.artist?.displayName ?? null,
          }),
        },
        matchedQueries: track.matchedQueries ?? [],
      }));
    const rankingContext = {
        originalQueries,
        expandedQueries: queries,
        learnedGenreWeights,
        similarityScores,
        bigQueryTasteScores,
        cohortContext,
        // Tracks the listener was already served (Home impressions) are
        // demoted like recent plays, but only this session's own tracks are
        // hard-excluded below.
        recentTrackIds: [...new Set([...input.recentTrackIds, ...servedHistory])],
        energy: input.energy,
        tempoBpm: input.tempoBpm,
        sessionIntent,
        requestedTerms: input.requestedTerms,
        tastePolicy: policy,
        audioFeaturesByTrack,
      };
    const ranked = await this.rankingService.rank(rankingCandidates, rankingContext);
    const laneCandidateOrderByLaneId = new Map<string, string[]>();
    if (input.myMixPlan) {
      for (const lane of input.myMixPlan.lanes) {
        const laneGenres = Object.keys(lane.genreWeights);
        const laneMoods = Object.keys(lane.moodWeights);
        const laneQueries = [...laneGenres, ...laneMoods];
        const expandedLaneQueries = expandAgentTasteQueries(laneQueries);
        const laneQueryKeys = new Set(expandedLaneQueries.map(normalizeQuery));
        const ordinaryRequestQueryKeys = new Set(
          expandAgentTasteQueries(input.requestedTerms ?? [])
            .map(normalizeQuery)
            .filter((query) => !laneQueryKeys.has(query)),
        );
        // Request terms are also catalog retrieval queries. Remove request-only
        // matches here so their generic expanded-taste signal cannot influence
        // lane allocation; lane terms that overlap are retained.
        const laneCandidates = rankingCandidates
          .filter((candidate) =>
            (laneMatchesByCandidateId.get(candidate.id) ?? []).includes(lane.id),
          )
          .map((candidate) => ({
            ...candidate,
            matchedQueries: (candidate.matchedQueries ?? []).filter(
              (query: string) => !ordinaryRequestQueryKeys.has(normalizeQuery(query)),
            ),
          }));
        if (laneCandidates.length === 0) {
          laneCandidateOrderByLaneId.set(lane.id, []);
          continue;
        }
        const laneRanked = await this.rankingService.rank(laneCandidates, {
          ...rankingContext,
          originalQueries: laneQueries,
          expandedQueries: expandedLaneQueries,
          sessionRequest: { genres: laneGenres, moods: laneMoods },
          sessionIntent: buildSessionIntent(input, laneMoods[0]),
          energy: lane.energyBand ?? input.energy,
        });
        laneCandidateOrderByLaneId.set(lane.id, laneRanked.map((candidate) => candidate.id));
      }
    }

    const byId2 = new Map(allCandidates.map((track) => [track.id, track]));
    const sessionTrackIds = new Set(input.recentTrackIds);
    const toAgentTrack = (entry: (typeof ranked)[number]) => {
      const track = byId2.get(entry.id)!;
      const mixLaneId = policyResult.laneAssignments?.get(track.id);
      const lane = mixLaneId
        ? input.myMixPlan?.lanes.find((candidate) => candidate.id === mixLaneId)
        : undefined;
      return {
        ...track,
        ...(mixLaneId ? { mixLaneId } : {}),
        ...(input.reserveFirstListenerPlacements === false
          ? { firstListenerEligible: Boolean(entry.firstListenerEligible) }
          : {}),
        agentRecommendation: {
          score: entry.score,
          matchedQueries: track.matchedQueries,
          signals: entry.signals,
          explanation: lane
            ? [`Selected for your ${lane.label} mix.`, ...entry.explanation]
            : entry.explanation,
          reasonCode: entry.reasonCode,
          ...(entry.audioFeatures ? { audioFeatures: entry.audioFeatures } : {}),
          ...(entry.trace ? { trace: entry.trace } : {}),
        },
      };
    };

    const rejected = ranked
      .filter((entry) => sessionTrackIds.has(entry.id))
      .map((entry) => ({
        trackId: entry.id,
        reason: "recently_played",
      }));

    // The policy stage (ADR-TE-2, docs/rfc/taste-engine.md §3.4) runs after
    // scoring on every surface: hidden taste, AI, exploration share, diversity
    // cap (per 10 session tracks), categorical reason.
    const fresh = ranked.filter((entry) => !sessionTrackIds.has(entry.id));
    const policyContext = await this.loadPolicyContext(input, fresh);
    const policyOptions = {
      limit,
      tastePolicy: policy,
      verifiedHumanArtistIds: firstListenerVerificationComplete
        ? policyContext.verifiedHumanArtistIds
        : new Set<string>(),
      playedArtistIds: policyContext.playedArtistIds,
      // Relaxed and widened passes keep two per artist per pick but drop the session window.
      priorSessionArtistKeys: pass === "strict" ? policyContext.priorSessionArtistKeys : undefined,
      priorExplorationCount: policyContext.priorExplorationCount,
      ...(input.myMixPlan
        ? {
            laneQuotas: input.myMixPlan.lanes.map((lane) => ({
              id: lane.id,
              requested: lane.requested,
              strength: lane.allocationWeight,
            })),
            laneMatchesByCandidateId,
            laneCandidateOrderByLaneId,
          }
        : {}),
    };
    let policyInput = fresh;
    let policyResult = applyDiscoveryPolicy(policyInput, policyOptions);
    const firstListenerPicks = policyResult.items.filter(
      (entry) => entry.firstListenerEligible && entry.reasonCode === "discovery_pick",
    );
    if (
      input.reserveFirstListenerPlacements !== false &&
      firstListenerPicks.length > 0 &&
      this.firstListenerDiscovery &&
      input.userId
    ) {
      try {
        const reserved = await this.firstListenerDiscovery.reservePlacements(
          input.userId,
          firstListenerPicks.flatMap((entry) =>
            entry.releaseId
              ? [{ trackId: entry.id, releaseId: entry.releaseId }]
              : [],
          ),
          { allowExplicit: input.allowExplicit ?? false },
        );
        policyResult = applyFirstListenerReservationOutcome(
          policyInput,
          policyResult,
          reserved,
          policyOptions,
        );
      } catch {
        policyInput = fresh.filter((entry) => !entry.firstListenerEligible);
        policyResult = applyDiscoveryPolicy(policyInput, policyOptions);
      }
    }
    const selected = policyResult.items.map(toAgentTrack);
    const scored = ranked.map(toAgentTrack);
    const mixCoverage = input.myMixPlan
      ? buildMixCoverage(
          input.myMixPlan,
          new Map(
            selected.flatMap((track) =>
              track.mixLaneId ? [[track.id, track.mixLaneId] as const] : [],
            ),
          ),
        )
      : undefined;

    return {
      candidates: scored.map((track) => track.id),
      selected,
      rejected,
      reason:
        selected.length > 0
          ? "ranked_shortlist"
          : fresh.length > 0
            ? "no_policy_eligible_candidates"
            : "all_candidates_recently_played",
      ...(mixCoverage ? { mixCoverage } : {}),
      policy: {
        dropped: policyResult.dropped,
        exploration: policyResult.exploration,
      },
    };
  }

  /**
   * The shared learned genre weights for this listener: the same persisted
   * `AgentConfig.learnedTasteProfile` Home ranks with. The caller-provided
   * weights are the fallback when no stored profile resolves (or no resolver
   * is wired), so the deterministic path never depends on this read.
   */
  private async resolveLearnedGenreWeights(
    input: AgentSelectorInput,
    policy: TasteMemoryPolicy | undefined,
  ): Promise<Record<string, number>> {
    if (input.userId && this.learning) {
      try {
        const profile = await this.learning.resolveTasteProfile(
          input.userId,
          [],
          policy,
        );
        if (Object.keys(profile.genreWeights).length > 0) {
          return profile.genreWeights;
        }
      } catch (error) {
        this.logger.warn(`Shared taste profile unavailable: ${String(error)}`);
      }
    }
    return input.learnedGenreWeights ?? {};
  }

  /** Home's served-history (`RecommendationProfile.servedTrackIds`). */
  private async resolveServedHistory(userId?: string): Promise<string[]> {
    if (!userId || !this.recommendations) return [];
    try {
      return await this.recommendations.getServedHistory(userId);
    } catch (error) {
      this.logger.warn(`Served history unavailable: ${String(error)}`);
      return [];
    }
  }

  /**
   * Policy lookups for the fresh candidates plus the artist keys of the
   * session so far (oldest first, as `applyDiscoveryPolicy` expects). Fails
   * open: a lookup error leaves the sets empty, which only disables
   * exploration; AI, hidden and diversity rules do not depend on it.
   */
  private async loadPolicyContext(
    input: AgentSelectorInput,
    fresh: Array<Parameters<typeof discoveryArtistKey>[0]>,
  ) {
    let verifiedHumanArtistIds: ReadonlySet<string> = new Set<string>();
    let playedArtistIds: ReadonlySet<string> = new Set<string>();
    let sessionArtists = new Map<string, string>();
    // Unknown until counted: the policy then takes the share over the page
    // alone instead of inflating the reserve late in a session.
    let priorExplorationCount: number | undefined;
    if (this.policyContext) {
      try {
        const artistIds = fresh
          .map((entry) => entry.artistId)
          .filter((id): id is string => !!id);
        const [context, artistsByTrack] = await Promise.all([
          this.policyContext.loadContext(input.userId, artistIds),
          this.policyContext.artistIdsForTracks(input.recentTrackIds),
        ]);
        verifiedHumanArtistIds = context.verifiedHumanArtistIds;
        playedArtistIds = context.playedArtistIds;
        sessionArtists = artistsByTrack;
      } catch (error) {
        this.logger.warn(`Discovery policy context unavailable: ${String(error)}`);
      }
      // Same prior window the policy uses for the diversity cap (last 9).
      // Counted separately so a failure here leaves the count unknown
      // (undefined) without discarding the rest of the context.
      // An anonymous caller has no signal history to count, so it stays
      // unknown rather than a misleading 0.
      try {
        if (input.userId) {
          priorExplorationCount = await this.policyContext.countDiscoveryPicks(
            input.userId,
            input.recentTrackIds.slice(
              0,
              DISCOVERY_POLICY_DEFAULTS.sessionWindow - 1,
            ),
          );
        }
      } catch (error) {
        this.logger.warn(`Prior discovery picks unavailable: ${String(error)}`);
      }
    }
    // recentTrackIds is newest-first; the policy wants chronological order.
    const priorSessionArtistKeys = [...input.recentTrackIds]
      .reverse()
      .map((id) =>
        discoveryArtistKey({ id, artistId: sessionArtists.get(id) ?? null }),
      );
    return {
      verifiedHumanArtistIds,
      playedArtistIds,
      priorSessionArtistKeys,
      priorExplorationCount,
    };
  }

}

function buildSessionIntent(input: AgentSelectorInput, moodOverride?: string) {
  const { sessionIntent: intent, mood, queueStyle } = input;
  const selectedMood = moodOverride ?? mood;
  if (!intent?.trim() && !selectedMood?.trim() && !queueStyle?.trim()) return undefined;
  return { intent, mood: selectedMood, queueStyle };
}

/** Upper-case disclosure level from either catalog.search shape. */
function aiDisclosureLevelOf(item: {
  aiDisclosureLevel?: unknown;
  aiDisclosure?: { level?: unknown };
}): string | null {
  const level = item.aiDisclosureLevel ?? item.aiDisclosure?.level;
  return typeof level === "string" ? level.toUpperCase() : null;
}

/**
 * Only `hidden` filters the DJ's own taste queries. Declared boosts (#1961)
 * reach the DJ through the shared ranking core (`scoreMultiplierForSignal` and
 * the declared-preference signal), not by rewriting the listener's queries, and
 * the session's energy stays the session's own request context.
 */
export function isHiddenTasteQuery(policy: TasteMemoryPolicy | undefined, query: string) {
  return hasSignal(policy?.hidden ?? new Map(), "genre", query)
    || hasSignal(policy?.hidden ?? new Map(), "mood", query)
    || hasSignal(policy?.hidden ?? new Map(), "intent", query)
    || hasSignal(policy?.hidden ?? new Map(), "scene", query);
}

function uniqueCaseInsensitive(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

function normalizeQuery(query: string) {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}
