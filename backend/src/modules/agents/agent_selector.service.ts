import { Injectable, Logger, Optional } from "@nestjs/common";
import { ToolRegistry } from "./tools/tool_registry";
import { expandAgentTasteQueries } from "./agent_taste_expansion";
import { AgentAudioFeatureService, AgentAudioFeatures } from "./agent_audio_feature.service";
import { AgentBigQueryTasteSignalService, AgentTasteScore } from "./agent_bigquery_taste_signal.service";
import { CommunityCohortService } from "../community/community_cohort.service";
import {
  applyDiscoveryPolicy,
  DISCOVERY_POLICY_DEFAULTS,
  discoveryArtistKey,
} from "../recommendations/discovery-policy";
import { DiscoveryPolicyContextService } from "../recommendations/discovery-policy-context.service";
import { DiscoveryRankingService } from "../recommendations/discovery-ranking.service";
import { RecommendationsService } from "../recommendations/recommendations.service";
import {
  hasSignal,
  TasteMemoryPolicy,
  TasteMemoryService,
} from "../recommendations/taste_memory.service";
import type { DiscoveryReasonCode } from "../recommendations/discovery-explanations";
import { resolveCreditedArtistName } from "../shared/artist_attribution";
import { isPromotionEligible } from "../catalog/ai-disclosure.policy";
import { AgentLearningService } from "./agent_learning.service";

export interface AgentSelectorInput {
  userId?: string;
  queries?: string[];
  recentTrackIds: string[];
  allowExplicit?: boolean;
  useEmbeddings?: boolean;
  limit?: number;
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
}

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
  ) { }

  async select(input: AgentSelectorInput) {
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

    for (const query of queries.length > 0 ? queries : [""]) {
      const tool = this.tools.get("catalog.search");
      const result = await tool.run({
        query,
        limit: 20,
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

    let allCandidates = Array.from(byId.values());

    if (allCandidates.length === 0) {
      return {
        candidates: [],
        selected: [],
        rejected: [],
        reason: queries.length ? "no_matching_taste_candidates" : "empty_catalog",
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

    const ranked = await this.rankingService.rank(
      allCandidates.map((track: any) => ({
        id: track.id,
        title: track.title,
        artist: track.artist ?? null,
        hasListing: track.hasListing,
        // Artist identity + AI disclosure feed the policy stage: without an
        // artistId no DJ candidate can be an exploration pick.
        artistId: track.release?.artistId ?? null,
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
      })),
      {
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
        tastePolicy: policy,
        audioFeaturesByTrack,
      },
    );

    const byId2 = new Map(allCandidates.map((track) => [track.id, track]));
    const sessionTrackIds = new Set(input.recentTrackIds);
    const toAgentTrack = (entry: (typeof ranked)[number]) => {
      const track = byId2.get(entry.id)!;
      return {
        ...track,
        agentRecommendation: {
          score: entry.score,
          matchedQueries: track.matchedQueries,
          signals: entry.signals,
          explanation: entry.explanation,
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
    const policyResult = applyDiscoveryPolicy(fresh, {
      limit,
      tastePolicy: policy,
      verifiedHumanArtistIds: policyContext.verifiedHumanArtistIds,
      playedArtistIds: policyContext.playedArtistIds,
      priorSessionArtistKeys: policyContext.priorSessionArtistKeys,
      priorExplorationCount: policyContext.priorExplorationCount,
    });
    const selected = policyResult.items.map(toAgentTrack);
    const scored = ranked.map(toAgentTrack);

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

function buildSessionIntent(input: AgentSelectorInput) {
  const { sessionIntent: intent, mood, queueStyle } = input;
  if (!intent?.trim() && !mood?.trim() && !queueStyle?.trim()) return undefined;
  return { intent, mood, queueStyle };
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
