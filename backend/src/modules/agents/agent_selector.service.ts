import { Injectable, Optional } from "@nestjs/common";
import { ToolRegistry } from "./tools/tool_registry";
import { expandAgentTasteQueries } from "./agent_taste_expansion";
import { AgentAudioFeatureService, AgentAudioFeatures } from "./agent_audio_feature.service";
import { AgentBigQueryTasteSignalService, AgentTasteScore } from "./agent_bigquery_taste_signal.service";
import {
  hasSignal,
  scoreMultiplierForSignal,
  TasteMemoryPolicy,
  TasteMemoryService,
} from "../recommendations/taste_memory.service";

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

const ANALYTICS_EXPLANATION_BY_TYPE = {
  taste_fit: "Learned listening pattern fit",
  intent_fit: "Fits this session intent",
  novelty_fit: "Fresh pick based on replay and skip patterns",
  commerce_fit: "Strong save or purchase signal",
} as const;

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
    @Optional()
    private readonly bigQueryTasteSignals?: AgentBigQueryTasteSignalService,
    @Optional()
    private readonly tasteMemoryService?: TasteMemoryService,
  ) { }

  async select(input: AgentSelectorInput) {
    const policy = input.userId ? await this.tasteMemoryService?.getPolicy(input.userId) : undefined;
    const originalQueries = (input.queries ?? [])
      .filter(Boolean)
      .filter((query) => !isHiddenTasteQuery(policy, query));
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

    const canUseWarehouseTaste = input.userId
      ? await this.tasteMemoryService?.canUseTasteForSocialMatching(input.userId) ?? true
      : false;
    const bigQueryTasteScores = input.userId && canUseWarehouseTaste
      ? await this.bigQueryTasteSignals?.scoreTracks({
        userId: input.userId,
        trackIds: allCandidates.map((track) => track.id),
      }) ?? new Map<string, AgentTasteScore>()
      : new Map<string, AgentTasteScore>();

    const scored = await Promise.all(
      allCandidates.map((track) => this.scoreCandidate(track, {
        originalQueries,
        expandedQueries: queries,
        learnedGenreWeights: input.learnedGenreWeights ?? {},
        similarityScore: similarityScores.get(track.id) ?? 0,
        bigQueryTasteScore: bigQueryTasteScores.get(track.id),
        recent: input.recentTrackIds.includes(track.id),
        energy: input.energy,
        tastePolicy: policy,
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
      bigQueryTasteScore?: AgentTasteScore;
      recent: boolean;
      energy?: "low" | "medium" | "high";
      tastePolicy?: TasteMemoryPolicy;
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
    const learnedMultiplier = scoreMultiplierForSignal(context.tastePolicy, "genre", genre);
    if (learnedWeight > 0 && learnedMultiplier > 0) {
      signals.push({
        label: "learned_preference",
        weight: Math.min(18, learnedWeight * 2 * learnedMultiplier),
        reason: `learned preference for ${genre}`,
      });
      explanation.push(learnedMultiplier < 1 ? "Lightly boosted by learned taste" : "Boosted by learned taste");
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

    if (context.bigQueryTasteScore) {
      const weight = Math.round(context.bigQueryTasteScore.score * 20);
      if (weight > 0) {
        const analyticsExplanation = analyticsTasteExplanation(context.bigQueryTasteScore.explanation);
        signals.push({
          label: "bigquery_taste_score",
          weight,
          reason: analyticsExplanation.signalReason,
        });
        explanation.push(...analyticsExplanation.listenerReasons);
      }
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
        ...(context.bigQueryTasteScore
          ? {
            trace: {
              bigQueryTasteScore: context.bigQueryTasteScore,
            },
          }
          : {}),
      },
    };
  }
}

function isHiddenTasteQuery(policy: TasteMemoryPolicy | undefined, query: string) {
  return hasSignal(policy?.hidden ?? new Map(), "genre", query)
    || hasSignal(policy?.hidden ?? new Map(), "mood", query)
    || hasSignal(policy?.hidden ?? new Map(), "intent", query)
    || hasSignal(policy?.hidden ?? new Map(), "scene", query);
}

function analyticsTasteExplanation(explanation?: string): {
  signalReason: string;
  listenerReasons: string[];
} {
  const normalized = explanation?.toLowerCase() ?? "";
  const types: Array<keyof typeof ANALYTICS_EXPLANATION_BY_TYPE> = [];

  if (/\b(intent|mood|vibe|focus|chill|hype|zen|session)\b/.test(normalized)) {
    types.push("intent_fit");
  }

  if (/\b(save|playlist|purchase|bought|commerce|listing|x402)\b/.test(normalized)) {
    types.push("commerce_fit");
  }

  if (/\b(skips?|replays?|repeats?|fresh|novel|new|recent)\b/.test(normalized)) {
    types.push("novelty_fit");
  }

  if (types.length === 0 || /\b(taste|listen|listening|pattern|signal|score|similar)\b/.test(normalized)) {
    types.unshift("taste_fit");
  }

  const listenerReasons = Array.from(new Set(types)).slice(0, 3).map((type) => ANALYTICS_EXPLANATION_BY_TYPE[type]);
  return {
    signalReason: explanation ?? "precomputed warehouse taste fit",
    listenerReasons,
  };
}
