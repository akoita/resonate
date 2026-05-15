import { Injectable, Optional } from "@nestjs/common";
import { ToolRegistry } from "./tools/tool_registry";
import { expandAgentTasteQueries } from "./agent_taste_expansion";
import { AgentAudioFeatureService, AgentAudioFeatures } from "./agent_audio_feature.service";

export interface AgentSelectorInput {
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
    @Optional()
    private readonly audioFeatures?: AgentAudioFeatureService,
  ) { }

  async select(input: AgentSelectorInput) {
    const originalQueries = (input.queries ?? []).filter(Boolean);
    const queries = expandAgentTasteQueries(originalQueries);
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

    const scored = await Promise.all(
      allCandidates.map((track) => this.scoreCandidate(track, {
        originalQueries,
        expandedQueries: queries,
        learnedGenreWeights: input.learnedGenreWeights ?? {},
        similarityScore: similarityScores.get(track.id) ?? 0,
        recent: input.recentTrackIds.includes(track.id),
        energy: input.energy,
      })),
    );

    const rejected = scored
      .filter((track) => input.recentTrackIds.includes(track.id))
      .map((track) => ({
        trackId: track.id,
        reason: "recently_played",
      }));

    // Stable-sort: relevance score first, then listed tracks, then learned taste.
    const learnedGenreWeights = input.learnedGenreWeights ?? {};
    scored.sort((a: any, b: any) => {
      const aScore = a.agentRecommendation?.score ?? 0;
      const bScore = b.agentRecommendation?.score ?? 0;
      if (aScore !== bScore) return bScore - aScore;
      const aListed = a.hasListing ? 1 : 0;
      const bListed = b.hasListing ? 1 : 0;
      if (aListed !== bListed) return bListed - aListed;
      const aGenre = a.release?.genre;
      const bGenre = b.release?.genre;
      const aWeight = aGenre ? learnedGenreWeights[aGenre] ?? 0 : 0;
      const bWeight = bGenre ? learnedGenreWeights[bGenre] ?? 0 : 0;
      return bWeight - aWeight;
    });

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

  private async scoreCandidate(
    track: AgentCandidateTrack & { matchedQueries: string[] },
    context: {
      originalQueries: string[];
      expandedQueries: string[];
      learnedGenreWeights: Record<string, number>;
      similarityScore: number;
      recent: boolean;
      energy?: "low" | "medium" | "high";
    },
  ): Promise<AgentCandidateTrack> {
    const signals: AgentSelectionSignal[] = [];
    const explanation: string[] = [];
    const genre = track.release?.genre ?? "";

    if (track.matchedQueries.length > 0) {
      const exact = track.matchedQueries.some((query) =>
        context.originalQueries.some((original) => original.toLowerCase() === query.toLowerCase())
      );
      signals.push({
        label: exact ? "taste_match" : "expanded_taste_match",
        weight: exact ? 40 : 28,
        reason: exact
          ? `matches selected taste ${track.matchedQueries[0]}`
          : `matches nearby taste ${track.matchedQueries[0]}`,
      });
      explanation.push(exact ? "Selected vibe match" : "Nearby vibe match");
    }

    if (track.hasListing) {
      signals.push({ label: "listed", weight: 14, reason: "has active stem listing" });
      explanation.push("Purchasable stem available");
    }

    const learnedWeight = genre ? context.learnedGenreWeights[genre] ?? 0 : 0;
    if (learnedWeight > 0) {
      signals.push({
        label: "learned_preference",
        weight: Math.min(18, learnedWeight * 2),
        reason: `learned preference for ${genre}`,
      });
      explanation.push("Boosted by learned taste");
    } else if (learnedWeight < 0) {
      signals.push({
        label: "negative_preference",
        weight: Math.max(-18, learnedWeight * 2),
        reason: `negative feedback for ${genre}`,
      });
    }

    if (context.similarityScore > 0) {
      signals.push({
        label: "semantic_similarity",
        weight: Math.round(context.similarityScore * 12),
        reason: "ranked by text embedding similarity",
      });
      explanation.push("Semantic similarity");
    }

    const featureResult = await this.audioFeatures?.getOrCreate(track.id);
    const audioFeatures = featureResult?.status === "ok" ? featureResult.features : undefined;
    if (audioFeatures) {
      signals.push({
        label: "audio_features",
        weight: Math.round(audioFeatures.confidence * 10),
        reason: `${audioFeatures.energyBand} energy, ${audioFeatures.tempoBpm} BPM`,
      });
      if (context.energy && audioFeatures.energyBand === context.energy) {
        signals.push({
          label: "energy_match",
          weight: 10,
          reason: `matches requested ${context.energy} energy`,
        });
        explanation.push(`${context.energy} energy match`);
      }
    }

    if (context.recent) {
      signals.push({ label: "recently_played", weight: -100, reason: "recent session duplicate" });
    }

    const score = Math.max(0, Math.round(signals.reduce((sum, signal) => sum + signal.weight, 0)));
    return {
      ...track,
      agentRecommendation: {
        score,
        matchedQueries: track.matchedQueries,
        signals,
        explanation: explanation.length ? explanation : ["Catalog candidate"],
        ...(audioFeatures ? { audioFeatures } : {}),
      },
    };
  }
}
