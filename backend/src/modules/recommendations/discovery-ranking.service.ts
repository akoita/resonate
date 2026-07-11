import { Injectable, Optional } from "@nestjs/common";
import { AgentAudioFeatures } from "../agents/agent_audio_feature.service";
import {
  AgentBigQueryTasteSignalService,
  AgentTasteScore,
} from "../agents/agent_bigquery_taste_signal.service";
import { CommunityCohortDiscoveryContext } from "../community/community_cohort.service";
import {
  scoreMultiplierForSignal,
  TasteMemoryPolicy,
} from "./taste_memory.service";

/**
 * The unified discovery scoring core (#1448 WS-1, RFC
 * docs/rfc/discovery-intelligence.md §3).
 *
 * Extracted from `agent_selector.service.ts` so the Home feed
 * (`GET /recommendations/:userId`) and the AI DJ rank with ONE brain instead
 * of two divergent code paths. The service is deliberately dependency-light:
 * every external signal source (warehouse taste, audio features) is an
 * `@Optional()` injection, and a missing source simply contributes no signal —
 * that is what keeps the deterministic-fallback guarantee (RFC §4) honest.
 *
 * Inputs are pre-gathered candidates (each caller owns its own candidate
 * sources — RFC §3.2) plus the personalization context; output is the ranked
 * list with weighted signals AND human-readable explanations, so both the DJ's
 * signal traces and the Home feed's `reasons` strings derive from one place.
 */

export interface DiscoverySignal {
  label: string;
  weight: number;
  reason: string;
}

export interface DiscoveryCandidate {
  id: string;
  title?: string | null;
  artist?: string | null;
  hasListing?: boolean;
  release?: {
    genre?: string | null;
    title?: string | null;
    moods?: string[] | null;
    artistDisplayName?: string | null;
  };
  /** Which taste queries surfaced this candidate (caller-provided). */
  matchedQueries?: string[];
}

export interface DiscoveryRankingContext {
  /** The user's own selected taste queries (pre-hidden-filtering). */
  originalQueries: string[];
  /** Expanded query set actually used to gather candidates. */
  expandedQueries: string[];
  learnedGenreWeights?: Record<string, number>;
  /** 0..1 embedding-similarity per track id, when the caller computed one. */
  similarityScores?: Map<string, number>;
  /** Warehouse taste scores per track id, when available + consented. */
  bigQueryTasteScores?: Map<string, AgentTasteScore>;
  cohortContext?: CommunityCohortDiscoveryContext[];
  recentTrackIds?: string[];
  energy?: "low" | "medium" | "high";
  tastePolicy?: TasteMemoryPolicy;
  /**
   * Caller-prefetched audio features per track id (the DJ provides these;
   * the Home feed omits them). Kept as data, not a service dependency, so the
   * core stays pure and shareable across modules without DI coupling.
   */
  audioFeaturesByTrack?: Map<string, AgentAudioFeatures>;
}

export interface RankedDiscoveryCandidate extends DiscoveryCandidate {
  score: number;
  signals: DiscoverySignal[];
  /** Human sentences for UI surfaces ("Boosted by learned taste"). */
  explanation: string[];
  audioFeatures?: AgentAudioFeatures;
  trace?: Record<string, unknown>;
  recentlyPlayed: boolean;
}

const ANALYTICS_EXPLANATION_BY_TYPE = {
  taste_fit: "Learned listening pattern fit",
  intent_fit: "Fits this session intent",
  novelty_fit: "Fresh pick based on replay and skip patterns",
  commerce_fit: "Strong save or purchase signal",
} as const;

@Injectable()
export class DiscoveryRankingService {
  constructor(
    @Optional()
    private readonly bigQueryTasteSignals?: AgentBigQueryTasteSignalService,
  ) {}

  /**
   * Fetch warehouse taste scores for a candidate set, when the signal service
   * is wired and the caller established consent. Never throws — a warehouse
   * outage contributes an empty map (deterministic fallback).
   */
  async fetchWarehouseTasteScores(
    userId: string,
    trackIds: string[],
  ): Promise<Map<string, AgentTasteScore>> {
    try {
      return (
        (await this.bigQueryTasteSignals?.scoreTracks({ userId, trackIds })) ??
        new Map()
      );
    } catch {
      return new Map();
    }
  }

  /** Rank candidates with the unified signal core. Highest score first. */
  async rank(
    candidates: DiscoveryCandidate[],
    context: DiscoveryRankingContext,
  ): Promise<RankedDiscoveryCandidate[]> {
    const recent = context.recentTrackIds ?? [];
    const scored = await Promise.all(
      candidates.map((candidate) =>
        this.scoreCandidate(candidate, context, recent.includes(candidate.id)),
      ),
    );
    const learnedGenreWeights = context.learnedGenreWeights ?? {};
    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const aListed = a.hasListing ? 1 : 0;
      const bListed = b.hasListing ? 1 : 0;
      if (aListed !== bListed) return bListed - aListed;
      const aWeight = a.release?.genre
        ? learnedGenreWeights[a.release.genre] ?? 0
        : 0;
      const bWeight = b.release?.genre
        ? learnedGenreWeights[b.release.genre] ?? 0
        : 0;
      return bWeight - aWeight;
    });
    return scored;
  }

  private async scoreCandidate(
    candidate: DiscoveryCandidate,
    context: DiscoveryRankingContext,
    recentlyPlayed: boolean,
  ): Promise<RankedDiscoveryCandidate> {
    const signals: DiscoverySignal[] = [];
    const explanation: string[] = [];
    const genre = candidate.release?.genre ?? "";
    const matchedQueries = candidate.matchedQueries ?? [];

    if (matchedQueries.length > 0) {
      const exact = matchedQueries.some((query) =>
        context.originalQueries.some(
          (original) => original.toLowerCase() === query.toLowerCase(),
        ),
      );
      signals.push({
        label: exact ? "taste_match" : "expanded_taste_match",
        weight: exact ? 40 : 28,
        reason: exact
          ? `matches selected taste ${matchedQueries[0]}`
          : `matches nearby taste ${matchedQueries[0]}`,
      });
      explanation.push(exact ? "Selected vibe match" : "Nearby vibe match");
    }

    if (candidate.hasListing) {
      signals.push({
        label: "listed",
        weight: 14,
        reason: "has active stem listing",
      });
      explanation.push("Purchasable stem available");
    }

    const learnedGenreWeights = context.learnedGenreWeights ?? {};
    const learnedWeight = genre ? learnedGenreWeights[genre] ?? 0 : 0;
    const learnedMultiplier = scoreMultiplierForSignal(
      context.tastePolicy,
      "genre",
      genre,
    );
    if (learnedWeight > 0 && learnedMultiplier > 0) {
      signals.push({
        label: "learned_preference",
        weight: Math.min(18, learnedWeight * 2 * learnedMultiplier),
        reason: `learned preference for ${genre}`,
      });
      explanation.push(
        learnedMultiplier < 1
          ? "Lightly boosted by learned taste"
          : "Boosted by learned taste",
      );
    } else if (learnedWeight < 0) {
      signals.push({
        label: "negative_preference",
        weight: Math.max(-18, learnedWeight * 2),
        reason: `negative feedback for ${genre}`,
      });
    }

    const similarity = context.similarityScores?.get(candidate.id) ?? 0;
    if (similarity > 0) {
      signals.push({
        label: "semantic_similarity",
        weight: Math.round(similarity * 12),
        reason: "ranked by text embedding similarity",
      });
      explanation.push("Semantic similarity");
    }

    const tasteScore = context.bigQueryTasteScores?.get(candidate.id);
    if (tasteScore) {
      const weight = Math.round(tasteScore.score * 20);
      if (weight > 0) {
        const analytics = analyticsTasteExplanation(tasteScore.explanation);
        signals.push({
          label: "bigquery_taste_score",
          weight,
          reason: analytics.signalReason,
        });
        explanation.push(...analytics.listenerReasons);
      }
    }

    const cohortMatches = matchingCohortContexts(
      candidate,
      context.cohortContext ?? [],
    );
    for (const cohort of cohortMatches) {
      signals.push({
        label: "cohort_context",
        weight: 12,
        reason: cohort.reasonCode,
      });
      explanation.push(cohort.explanation);
    }

    const audioFeatures = context.audioFeaturesByTrack?.get(candidate.id);
    {
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
    }

    if (recentlyPlayed) {
      signals.push({
        label: "recently_played",
        weight: -100,
        reason: "recent session duplicate",
      });
    }

    const score = Math.max(
      0,
      Math.round(signals.reduce((sum, signal) => sum + signal.weight, 0)),
    );
    return {
      ...candidate,
      score,
      signals,
      explanation: explanation.length ? explanation : ["Catalog candidate"],
      recentlyPlayed,
      ...(audioFeatures ? { audioFeatures } : {}),
      ...(tasteScore ? { trace: { bigQueryTasteScore: tasteScore } } : {}),
    };
  }
}

/** Cohort matching shared by both surfaces (moved from the two copies). */
export function matchingCohortContexts(
  candidate: DiscoveryCandidate,
  cohorts: CommunityCohortDiscoveryContext[],
) {
  if (cohorts.length === 0) return [];
  const haystack = [
    candidate.title ?? "",
    candidate.release?.title ?? "",
    candidate.release?.genre ?? "",
    ...(candidate.release?.moods ?? []),
    candidate.artist ?? "",
    candidate.release?.artistDisplayName ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return cohorts.filter((cohort) =>
    cohort.queryHints.some((hint) => haystack.includes(hint.toLowerCase())),
  );
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
