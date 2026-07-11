import { Injectable, Optional } from "@nestjs/common";
import { ToolRegistry } from "./tools/tool_registry";
import { expandAgentTasteQueries } from "./agent_taste_expansion";
import { AgentAudioFeatureService, AgentAudioFeatures } from "./agent_audio_feature.service";
import { AgentBigQueryTasteSignalService, AgentTasteScore } from "./agent_bigquery_taste_signal.service";
import { CommunityCohortService } from "../community/community_cohort.service";
import { DiscoveryRankingService } from "../recommendations/discovery-ranking.service";
import {
  hasSignal,
  TasteMemoryPolicy,
  TasteMemoryService,
} from "../recommendations/taste_memory.service";
import { resolveCreditedArtistName } from "../shared/artist_attribution";

export interface AgentSelectorInput {
  userId?: string;
  queries?: string[];
  recentTrackIds: string[];
  allowExplicit?: boolean;
  useEmbeddings?: boolean;
  limit?: number;
  energy?: "low" | "medium" | "high";
  learnedGenreWeights?: Record<string, number>;
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
  release?: { genre?: string | null; title?: string | null };
  agentRecommendation?: {
    score: number;
    matchedQueries: string[];
    signals: AgentSelectionSignal[];
    explanation: string[];
    audioFeatures?: AgentAudioFeatures;
    trace?: Record<string, unknown>;
  };
}

@Injectable()
export class AgentSelectorService {
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
        allCandidates = ordered;
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

    const ranked = await this.rankingService.rank(
      allCandidates.map((track: any) => ({
        id: track.id,
        title: track.title,
        artist: track.artist ?? null,
        hasListing: track.hasListing,
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
        learnedGenreWeights: input.learnedGenreWeights ?? {},
        similarityScores,
        bigQueryTasteScores,
        cohortContext,
        recentTrackIds: input.recentTrackIds,
        energy: input.energy,
        tastePolicy: policy,
        audioFeaturesByTrack,
      },
    );

    const byId2 = new Map(allCandidates.map((track) => [track.id, track]));
    const scored = ranked.map((entry) => {
      const track = byId2.get(entry.id)!;
      return {
        ...track,
        agentRecommendation: {
          score: entry.score,
          matchedQueries: track.matchedQueries,
          signals: entry.signals,
          explanation: entry.explanation,
          ...(entry.audioFeatures ? { audioFeatures: entry.audioFeatures } : {}),
          ...(entry.trace ? { trace: entry.trace } : {}),
        },
      };
    });

    const rejected = scored
      .filter((track) => input.recentTrackIds.includes(track.id))
      .map((track) => ({
        trackId: track.id,
        reason: "recently_played",
      }));

    const fresh = scored.filter(
      (track) => !input.recentTrackIds.includes(track.id)
    );
    const selected = fresh.slice(0, limit);

    return {
      candidates: scored.map((track) => track.id),
      selected,
      rejected,
      reason: selected.length > 0 ? "ranked_shortlist" : "all_candidates_recently_played",
    };
  }

}

function isHiddenTasteQuery(policy: TasteMemoryPolicy | undefined, query: string) {
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


