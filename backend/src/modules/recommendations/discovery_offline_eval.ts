import { meanOverRankable, ndcgAtK, recallAtK } from "./rankingMetrics";

/**
 * Offline evaluation of the discovery ranker against held-out implicit
 * feedback (#1455 WS-8, reusing the #978 signal table
 * `user_track_signal_training`). Pure and injectable so it is unit-testable;
 * `backend/scripts/eval_discovery_ranker.ts` wires the real ranker and data.
 *
 * Method, per listener:
 *  1. Sort positive signals (weight > 0) by time; hold out the LAST
 *     `holdoutFraction` of the distinct positive tracks (at least one, and the
 *     listener needs at least two positive tracks).
 *  2. Everything strictly before the first held-out signal is the train
 *     history: it is what the ranker may learn from.
 *  3. Candidates = the shared candidate pool minus tracks already in the train
 *     history (an already-played track is not a recommendation).
 *  4. Rank the candidates, then score recall@k (binary) and NDCG@k (graded by
 *     the summed positive signal weight) against the held-out tracks.
 *
 * Caveat: the candidate pool is the set of tracks seen in the sample, so the
 * metrics are sampled-ranking metrics. Compare rankers on the same sample;
 * do not read the absolute values as production recall.
 */

export interface TrainingSignal {
  userId: string;
  trackId: string;
  /** Signed implicit-feedback weight (`signal_weight` in the training table). */
  weight: number;
  occurredAt: Date;
}

export interface EvalCandidate {
  id: string;
  genre?: string | null;
}

export interface UserSplit {
  userId: string;
  train: TrainingSignal[];
  heldOut: TrainingSignal[];
}

export interface RankerInput {
  userId: string;
  candidates: EvalCandidate[];
  trainSignals: TrainingSignal[];
  /** Genre -> learned weight from the train history, clipped to [-9, 9]. */
  learnedGenreWeights: Record<string, number>;
}

export type EvalRanker = (input: RankerInput) => Promise<string[]>;

export interface EvalMetrics {
  recallAtK: number | null;
  ndcgAtK: number | null;
  evaluatedUsers: number;
}

export interface DiscoveryEvalOptions {
  k: number;
  holdoutFraction: number;
  maxUsers: number;
}

export const DEFAULT_EVAL_OPTIONS: DiscoveryEvalOptions = {
  k: 10,
  holdoutFraction: 0.3,
  maxUsers: 500,
};

/** Temporal split per listener; listeners without two positive tracks are dropped. */
export function splitSignalsByTime(
  signals: readonly TrainingSignal[],
  holdoutFraction: number,
): UserSplit[] {
  const byUser = new Map<string, TrainingSignal[]>();
  for (const signal of signals) {
    const list = byUser.get(signal.userId) ?? [];
    list.push(signal);
    byUser.set(signal.userId, list);
  }

  const splits: UserSplit[] = [];
  for (const [userId, list] of [...byUser.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...list].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const positives = sorted.filter((signal) => signal.weight > 0);
    // Distinct positive tracks, in order of first positive signal.
    const positiveTracks = [...new Set(positives.map((signal) => signal.trackId))];
    if (positiveTracks.length < 2) continue;
    const holdoutCount = Math.min(
      positiveTracks.length - 1,
      Math.max(1, Math.ceil(positiveTracks.length * holdoutFraction)),
    );
    const heldOutTracks = new Set(positiveTracks.slice(-holdoutCount));
    const firstHeldOutAt = Math.min(
      ...positives.filter((signal) => heldOutTracks.has(signal.trackId)).map((signal) => signal.occurredAt.getTime()),
    );
    splits.push({
      userId,
      train: sorted.filter((signal) => signal.occurredAt.getTime() < firstHeldOutAt),
      heldOut: positives.filter((signal) => heldOutTracks.has(signal.trackId)),
    });
  }
  return splits;
}

/** Sum of positive weights per held-out track (graded relevance). */
export function heldOutRelevance(heldOut: readonly TrainingSignal[]): Map<string, number> {
  const relevance = new Map<string, number>();
  for (const signal of heldOut) {
    if (signal.weight > 0) relevance.set(signal.trackId, (relevance.get(signal.trackId) ?? 0) + signal.weight);
  }
  return relevance;
}

/**
 * Learned genre weights from train signals, in the scale the ranker's
 * `learned_preference` signal expects (it doubles and caps at 18, so the
 * weights are clipped to [-9, 9]).
 */
export function learnGenreWeights(
  train: readonly TrainingSignal[],
  genreByTrack: ReadonlyMap<string, string | null | undefined>,
): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const signal of train) {
    const genre = genreByTrack.get(signal.trackId);
    if (!genre) continue;
    weights[genre] = (weights[genre] ?? 0) + signal.weight;
  }
  for (const genre of Object.keys(weights)) {
    weights[genre] = Math.max(-9, Math.min(9, weights[genre]));
  }
  return weights;
}

export async function evaluateRanker(input: {
  splits: readonly UserSplit[];
  candidates: readonly EvalCandidate[];
  ranker: EvalRanker;
  options?: Partial<DiscoveryEvalOptions>;
}): Promise<EvalMetrics> {
  const options = { ...DEFAULT_EVAL_OPTIONS, ...input.options };
  const genreByTrack = new Map(input.candidates.map((candidate) => [candidate.id, candidate.genre] as const));
  const recalls: Array<number | null> = [];
  const ndcgs: Array<number | null> = [];

  for (const split of input.splits.slice(0, options.maxUsers)) {
    const relevance = heldOutRelevance(split.heldOut);
    const trainTracks = new Set(split.train.map((signal) => signal.trackId));
    const candidates = input.candidates.filter((candidate) => !trainTracks.has(candidate.id));
    const candidateIds = new Set(candidates.map((candidate) => candidate.id));
    // Held-out tracks outside the candidate pool cannot be ranked: skip them
    // from the relevant set rather than counting an unreachable miss.
    const reachable = new Map([...relevance].filter(([trackId]) => candidateIds.has(trackId)));
    if (reachable.size === 0) {
      recalls.push(null);
      ndcgs.push(null);
      continue;
    }
    const ranked = await input.ranker({
      userId: split.userId,
      candidates,
      trainSignals: split.train,
      learnedGenreWeights: learnGenreWeights(split.train, genreByTrack),
    });
    recalls.push(recallAtK(ranked, new Set(reachable.keys()), options.k));
    ndcgs.push(ndcgAtK(ranked, reachable, options.k));
  }

  return {
    recallAtK: meanOverRankable(recalls),
    ndcgAtK: meanOverRankable(ndcgs),
    evaluatedUsers: recalls.filter((value) => value !== null).length,
  };
}

/** Popularity baseline: most positive-weighted tracks across all listeners' train history. */
export function popularityRanker(splits: readonly UserSplit[]): EvalRanker {
  const popularity = new Map<string, number>();
  for (const split of splits) {
    for (const signal of split.train) {
      if (signal.weight > 0) popularity.set(signal.trackId, (popularity.get(signal.trackId) ?? 0) + signal.weight);
    }
  }
  return async ({ candidates }) =>
    [...candidates]
      .sort((a, b) => (popularity.get(b.id) ?? 0) - (popularity.get(a.id) ?? 0) || a.id.localeCompare(b.id))
      .map((candidate) => candidate.id);
}

/** Deterministic pseudo-random baseline (seeded), for a sanity floor. */
export function seededRandomRanker(seed = 1): EvalRanker {
  return async ({ candidates, userId }) => {
    let state = seed;
    for (const char of userId) state = (state * 31 + char.charCodeAt(0)) >>> 0;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    return candidates
      .map((candidate) => ({ id: candidate.id, key: next() }))
      .sort((a, b) => a.key - b.key)
      .map((entry) => entry.id);
  };
}
