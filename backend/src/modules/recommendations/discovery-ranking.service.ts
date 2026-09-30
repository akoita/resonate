import { Injectable, Optional } from "@nestjs/common";
import { AgentAudioFeatures } from "../agents/agent_audio_feature.service";
import {
  AgentBigQueryTasteSignalService,
  AgentTasteScore,
} from "../agents/agent_bigquery_taste_signal.service";
import { CommunityCohortDiscoveryContext } from "../community/community_cohort.service";
import {
  analyticsExplanationSentence,
  classifyAnalyticsExplanation,
  DISCOVERY_EXPLANATION_VARIANTS,
  DISCOVERY_EXPLANATIONS,
  DiscoveryReasonCode,
  energyMatchExplanation,
  primaryReasonFor,
} from "./discovery-explanations";
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
 *
 * ADR-TE-2 rule 6 (no input through which ranking could be bought): nothing in
 * this file reads payment, placement, partner or commercial-availability data.
 * `hasListing` (an active stem listing) stays on the candidate as DATA only,
 * for the Crate Digger's explicit filter; it never contributes a signal, a
 * score, an explanation or a sort tiebreak. The policy stage that runs after
 * scoring lives in `discovery-policy.ts` (docs/rfc/taste-engine.md §3.4).
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
  /**
   * Data only (Crate Digger filter). NEVER a ranking input — see the file
   * comment and ADR-TE-2 rule 6.
   */
  hasListing?: boolean;
  /** Artist identity for the policy stage (exploration + diversity caps). */
  artistId?: string | null;
  /** Track AI disclosure level ("NONE" | "PARTLY" | "ALL" | "UNDECLARED"). */
  aiDisclosureLevel?: string | null;
  release?: {
    genre?: string | null;
    title?: string | null;
    moods?: string[] | null;
    artistDisplayName?: string | null;
  };
  /** Which taste queries surfaced this candidate (caller-provided). */
  matchedQueries?: string[];
}

/**
 * The listener's stated intent for THIS session (AI DJ session presets, next
 * pick preferences). Request context, never taste: it only tilts the ranking
 * of the current request and is not stored or learned from (docs/rfc/
 * taste-engine.md §4.2, "the shared ranker scores candidates with the intent
 * as context").
 */
export interface DiscoverySessionIntent {
  /** Preset intent, e.g. "Focus", "Hype", "Chill". */
  intent?: string;
  /** Requested mood; often mirrors the intent. */
  mood?: string;
  /**
   * Pacing style ("Stable pacing", "Fast cuts"). Carried for sequencing
   * (taste-engine RFC §4), not matched against track metadata.
   */
  queueStyle?: string;
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
  /** Session intent as request context (DJ). Never stored as taste. */
  sessionIntent?: DiscoverySessionIntent;
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
  /** Primary categorical reason (shared vocabulary, ADR-TE-2 rule 4). */
  reasonCode: DiscoveryReasonCode;
  audioFeatures?: AgentAudioFeatures;
  trace?: Record<string, unknown>;
  recentlyPlayed: boolean;
}

/** Weight of the session-intent signal: a tilt, below any taste match. */
export const SESSION_INTENT_FIT_WEIGHT = 12;

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
      explanation.push(
        exact
          ? DISCOVERY_EXPLANATIONS.taste_match
          : DISCOVERY_EXPLANATIONS.nearby_taste,
      );
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
          ? DISCOVERY_EXPLANATION_VARIANTS.learned_taste_light
          : DISCOVERY_EXPLANATIONS.learned_taste,
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
      explanation.push(DISCOVERY_EXPLANATIONS.similar_sound);
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

    const intentMatch = sessionIntentMatch(candidate, context.sessionIntent);
    if (intentMatch) {
      signals.push({
        label: "session_intent_fit",
        weight: SESSION_INTENT_FIT_WEIGHT,
        reason: `fits session intent ${intentMatch}`,
      });
      explanation.push(DISCOVERY_EXPLANATIONS.session_fit);
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
          explanation.push(energyMatchExplanation(context.energy));
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
      explanation: explanation.length
        ? explanation
        : [DISCOVERY_EXPLANATIONS.catalog],
      reasonCode: primaryReasonFor(signals),
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

/**
 * The first session-intent term (intent, then mood) found in the candidate's
 * title, release title, genre or moods. Same case-insensitive substring
 * semantics as the Home mood match, so both surfaces read a term the same way.
 * At most one signal fires per candidate even when intent and mood coincide.
 */
function sessionIntentMatch(
  candidate: DiscoveryCandidate,
  sessionIntent?: DiscoverySessionIntent,
): string | null {
  const terms = [sessionIntent?.intent, sessionIntent?.mood]
    .map((term) => term?.trim())
    .filter((term): term is string => !!term);
  if (terms.length === 0) return null;
  const haystack = [
    candidate.title ?? "",
    candidate.release?.title ?? "",
    candidate.release?.genre ?? "",
    ...(candidate.release?.moods ?? []),
  ].map((value) => value.toLowerCase());
  return (
    terms.find((term) =>
      haystack.some((value) => value.includes(term.toLowerCase())),
    ) ?? null
  );
}

function analyticsTasteExplanation(explanation?: string): {
  signalReason: string;
  listenerReasons: string[];
} {
  const listenerReasons = classifyAnalyticsExplanation(explanation).map(
    analyticsExplanationSentence,
  );
  return {
    signalReason: explanation ?? "precomputed warehouse taste fit",
    listenerReasons,
  };
}
