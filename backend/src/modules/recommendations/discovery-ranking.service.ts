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
  hasSignal,
  scoreMultiplierForSignal,
  TasteMemoryPolicy,
} from "./taste_memory.service";
import {
  TASTE_EDIT_GENRES,
  TASTE_EDIT_GENRE_ALIASES,
  TASTE_EDIT_MOODS,
  TASTE_EDIT_MOOD_ALIASES,
} from "./taste_edit_vocabulary";

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
  /** Release identity for the durable first-listener exposure ledger. */
  releaseId?: string | null;
  /** True only when the bounded first-listener source supplied this candidate. */
  firstListenerEligible?: boolean;
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
  /**
   * Which kinds of embedding seed surfaced this candidate (#2003): a track the
   * listener saved or finished, or a note they wrote. Categorical; never the
   * seed id or text.
   */
  embeddingSources?: ReadonlyArray<"seed_track" | "listener_note">;
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
  /**
   * Requested tempo range in BPM (#2037, DJ). Boosts a candidate whose tempo
   * was measured and falls inside it; an inferred tempo never counts.
   */
  tempoBpm?: { min: number | null; max: number | null };
  /** Session intent as request context (DJ). Never stored as taste. */
  sessionIntent?: DiscoverySessionIntent;
  /**
   * Genres and moods this DJ session asked for itself (#2059): a preset or a
   * described session, before learned favourites and saved vibes are merged
   * in. A match ranks above learned taste (ADR-TE-2 rule 6). Home never sets it.
   */
  requestedTerms?: string[];
  /** Explicit, lane-local session request used by My Mix; absent on Home. */
  sessionRequest?: { genres: string[]; moods: string[] };
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

/** Weight of a declared "more of this" signal: above the learned-preference cap of 18. */
export const DECLARED_PREFERENCE_WEIGHT = 20;

/**
 * Weight of an embedding-neighbour signal (#2003): a modest tilt, below the
 * declared-preference weight (20) and the learned-preference cap (18), so a
 * neighbour never outranks a track that matches stated or learned taste.
 */
export const EMBEDDING_SIMILARITY_WEIGHT = 8;

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

    // A genre or mood the listener declared they want more of (#1961,
    // ADR-TE-5). It counts even with no learned history, and its weight sits
    // above the learned-preference cap: declared taste overrides inferred taste
    // (ADR-TE-2 rule 6). Hidden never reaches here; the policy stage drops it.
    const declaredBoost = declaredBoostMatch(context.tastePolicy, candidate);
    if (declaredBoost) {
      signals.push({
        label: "declared_preference",
        weight: DECLARED_PREFERENCE_WEIGHT,
        reason: `you asked for more ${declaredBoost}`,
      });
      explanation.push(DISCOVERY_EXPLANATION_VARIANTS.declared_taste);
    }

    const requestFit = sessionRequestMatch(candidate, context);
    if (requestFit) {
      signals.push({
        label: "session_request",
        weight: Math.round(DECLARED_PREFERENCE_WEIGHT * requestFit.multiplier),
        reason: requestFit.reason,
      });
      explanation.push(requestFit.explanation);
    }

    // Embedding neighbours of what the listener saved or finished, and of what
    // they wrote in a taste note (#2003, #2006). The signal is categorical: it
    // says the track sounds close to the listener's taste, not which track or
    // which words, so no history is exposed.
    const embeddingSources = candidate.embeddingSources ?? [];
    if (embeddingSources.includes("seed_track")) {
      signals.push({
        label: "embedding_similarity",
        weight: EMBEDDING_SIMILARITY_WEIGHT,
        reason: "close to music you engaged with",
      });
      explanation.push(DISCOVERY_EXPLANATIONS.similar_sound);
    }
    if (embeddingSources.includes("listener_note")) {
      signals.push({
        label: "declared_note_match",
        weight: EMBEDDING_SIMILARITY_WEIGHT,
        reason: "close to something you wrote",
      });
      explanation.push(DISCOVERY_EXPLANATION_VARIANTS.declared_taste);
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
          reason: audioFeatureReason(audioFeatures),
        });
        if (context.energy && audioFeatures.energyBand === context.energy) {
          signals.push({
            label: "energy_match",
            weight: 10,
            reason: `matches requested ${context.energy} energy`,
          });
          explanation.push(energyMatchExplanation(context.energy));
        }
        const tempoMatch = measuredTempoMatch(audioFeatures, context.tempoBpm);
        if (tempoMatch) {
          signals.push({
            label: "tempo_match",
            weight: TEMPO_MATCH_WEIGHT,
            reason: tempoMatch,
          });
          explanation.push(tempoMatch);
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

function sessionRequestMatch(
  candidate: DiscoveryCandidate,
  context: Pick<DiscoveryRankingContext, "sessionRequest" | "requestedTerms" | "tastePolicy">,
): { multiplier: number; reason: string; explanation: string } | undefined {
  // A lane's resolved request is authoritative for lane ordering, even when
  // this candidate does not match it. Falling through to the caller's ordinary
  // session request would let unrelated terms move candidates between lanes.
  if (context.sessionRequest !== undefined) {
    const match = laneSessionRequestMatch(candidate, context.sessionRequest, context.tastePolicy);
    return match
      ? {
          multiplier: match.multiplier,
          reason: "matches the current mix request",
          explanation: "Fits your current mix request.",
        }
      : undefined;
  }

  const match = requestedTermsMatch(candidate, context.requestedTerms, context.tastePolicy);
  return match
    ? {
        multiplier: match.multiplier,
        reason: `matches this session's request for ${match.term}`,
        explanation: DISCOVERY_EXPLANATIONS.session_fit,
      }
    : undefined;
}

function laneSessionRequestMatch(
  candidate: DiscoveryCandidate,
  request: DiscoveryRankingContext["sessionRequest"],
  policy?: TasteMemoryPolicy,
): { multiplier: number } | undefined {
  if (!request) return undefined;
  const releaseGenre = canonicalCatalogMetadata(candidate.release?.genre, TASTE_EDIT_GENRES, TASTE_EDIT_GENRE_ALIASES);
  const requestedGenres = new Set(request.genres.map((value) => canonicalCatalogMetadata(value, TASTE_EDIT_GENRES, TASTE_EDIT_GENRE_ALIASES)));
  if (releaseGenre && requestedGenres.has(releaseGenre)) {
    const multiplier = sessionRequestPolicyMultiplier(policy, "genre", candidate.release?.genre ?? "", releaseGenre);
    return multiplier > 0 ? { multiplier } : undefined;
  }
  const requestedMoods = new Set(request.moods.map((value) => canonicalCatalogMetadata(value, TASTE_EDIT_MOODS, TASTE_EDIT_MOOD_ALIASES)));
  for (const releaseMood of candidate.release?.moods ?? []) {
    const canonicalMood = canonicalCatalogMetadata(releaseMood, TASTE_EDIT_MOODS, TASTE_EDIT_MOOD_ALIASES);
    if (!canonicalMood || !requestedMoods.has(canonicalMood)) continue;
    const multiplier = sessionRequestPolicyMultiplier(policy, "mood", releaseMood, canonicalMood);
    if (multiplier > 0) return { multiplier };
  }
  return undefined;
}

function requestedTermsMatch(
  candidate: DiscoveryCandidate,
  requestedTerms: readonly string[] | undefined,
  policy?: TasteMemoryPolicy,
): { term: string; multiplier: number } | undefined {
  const terms = (requestedTerms ?? []).map((term) => term.trim()).filter(Boolean);
  const genre = candidate.release?.genre ?? "";
  const moods = candidate.release?.moods ?? [];
  for (const term of terms) {
    if (genre.toLowerCase().includes(term.toLowerCase())) {
      const canonicalGenre = canonicalCatalogMetadata(genre, TASTE_EDIT_GENRES, TASTE_EDIT_GENRE_ALIASES);
      const multiplier = sessionRequestPolicyMultiplier(policy, "genre", genre, canonicalGenre);
      return multiplier > 0 ? { term, multiplier } : undefined;
    }
    for (const mood of moods) {
      if (!mood.toLowerCase().includes(term.toLowerCase())) continue;
      const canonicalMood = canonicalCatalogMetadata(mood, TASTE_EDIT_MOODS, TASTE_EDIT_MOOD_ALIASES);
      const multiplier = sessionRequestPolicyMultiplier(policy, "mood", mood, canonicalMood);
      return multiplier > 0 ? { term, multiplier } : undefined;
    }
  }
  return undefined;
}

function sessionRequestPolicyMultiplier(
  policy: TasteMemoryPolicy | undefined,
  signalType: "genre" | "mood",
  rawValue: string,
  canonicalValue: string,
): number {
  const rawMultiplier = scoreMultiplierForSignal(policy, signalType, rawValue);
  const canonicalMultiplier = scoreMultiplierForSignal(policy, signalType, canonicalValue);
  if (rawMultiplier === 0 || canonicalMultiplier === 0) return 0;
  if (rawMultiplier < 1 || canonicalMultiplier < 1) return Math.min(rawMultiplier, canonicalMultiplier);
  return Math.max(rawMultiplier, canonicalMultiplier);
}

function canonicalCatalogMetadata(
  value: string | null | undefined,
  catalog: readonly string[],
  aliases: Readonly<Record<string, string>>,
): string {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  const canonical = catalog.find((term) => term.toLowerCase() === normalized);
  return (canonical ?? aliases[normalized] ?? "").toLowerCase();
}

/** Weight of a requested-tempo match (#2037): same size as the energy match. */
export const TEMPO_MATCH_WEIGHT = 10;

/**
 * `120–125 BPM match` when the track's MEASURED tempo is inside the requested
 * range, else undefined. The inferred tempo is a metadata hash, so it never
 * matches (#1960).
 */
function measuredTempoMatch(
  features: AgentAudioFeatures,
  range: DiscoveryRankingContext["tempoBpm"],
): string | undefined {
  if (!range || (range.min === null && range.max === null)) return undefined;
  if (features.featureSources?.tempo !== "measured") return undefined;
  const bpm = features.tempoBpm;
  if (typeof bpm !== "number" || !Number.isFinite(bpm)) return undefined;
  if (range.min !== null && bpm < range.min) return undefined;
  if (range.max !== null && bpm > range.max) return undefined;
  if (range.min !== null && range.max !== null) {
    return range.min === range.max
      ? `${Math.round(range.min)} BPM match`
      : `${Math.round(range.min)}\u2013${Math.round(range.max)} BPM match`;
  }
  return range.max !== null
    ? `under ${Math.round(range.max)} BPM match`
    : `over ${Math.round(range.min as number)} BPM match`;
}

/**
 * Reason string for the audio-features signal (#1960). A BPM is printed only
 * when it was measured; the inferred tempo is a metadata hash, so showing it
 * would present a fabricated number as fact.
 */
export function audioFeatureReason(features: AgentAudioFeatures): string {
  if (features.featureSources?.tempo === "measured") {
    return `${Math.round(features.tempoBpm)} BPM, ${features.energyBand} energy`;
  }
  return `${features.energyBand} energy`;
}

/** The boosted genre or mood this candidate carries, if the listener declared one. */
function declaredBoostMatch(
  policy: TasteMemoryPolicy | undefined,
  candidate: DiscoveryCandidate,
): string | null {
  if (!policy || policy.boosted.size === 0) return null;
  const genre = candidate.release?.genre;
  if (genre && hasSignal(policy.boosted, "genre", genre)) return genre;
  const mood = (candidate.release?.moods ?? []).find((value) =>
    hasSignal(policy.boosted, "mood", value),
  );
  return mood ?? null;
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
