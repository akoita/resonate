/**
 * Offline ranking-quality metrics for the discovery ranker (#1455 WS-8,
 * docs/rfc/discovery-intelligence.md WS-8).
 *
 * Pure functions with no I/O, so the same code scores the offline evaluation
 * script and any unit-level replay. All metrics look only at the first `k`
 * distinct ids of a ranked list (a repeated id counts once, at its first
 * position) and return a value in [0, 1].
 *
 * Empty relevant set: a user with no held-out positives has nothing to recall,
 * so the metrics return 0 rather than NaN. Aggregate with `meanOverRankable`
 * to skip such users instead of letting them drag the mean toward zero.
 */

/** Graded relevance per id; ids missing from the map, or <= 0, are not relevant. */
export type RelevanceByTrack =
  | ReadonlyMap<string, number>
  | Readonly<Record<string, number>>;

function asRelevanceMap(relevance: RelevanceByTrack): ReadonlyMap<string, number> {
  return relevance instanceof Map
    ? relevance
    : new Map(Object.entries(relevance as Record<string, number>));
}

function topK(ranked: readonly string[], k: number): string[] {
  const limit = Number.isFinite(k) ? Math.floor(k) : 0;
  if (limit <= 0) return [];
  const seen = new Set<string>();
  const top: string[] = [];
  for (const id of ranked) {
    if (seen.has(id)) continue;
    seen.add(id);
    top.push(id);
    if (top.length >= limit) break;
  }
  return top;
}

/**
 * recall@k: the share of relevant ids that appear in the first `k` ranked
 * entries. `k` larger than the list simply scores the whole list.
 */
export function recallAtK(
  ranked: readonly string[],
  relevant: ReadonlySet<string> | readonly string[],
  k: number,
): number {
  const relevantSet = relevant instanceof Set ? relevant : new Set(relevant);
  if (relevantSet.size === 0) return 0;
  const hits = topK(ranked, k).filter((id) => relevantSet.has(id)).length;
  return hits / relevantSet.size;
}

/**
 * NDCG@k with linear gain: DCG = sum(rel_i / log2(i + 2)) over the first `k`
 * ranked entries (i from 0), normalized by the DCG of the ideal ordering of
 * all relevant ids. Pass graded relevance for graded NDCG, or use
 * `binaryRelevance` for the binary case.
 */
export function ndcgAtK(
  ranked: readonly string[],
  relevanceByTrack: RelevanceByTrack,
  k: number,
): number {
  const relevance = asRelevanceMap(relevanceByTrack);
  const gain = (id: string) => {
    const value = relevance.get(id);
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  };
  const discount = (index: number) => 1 / Math.log2(index + 2);

  const dcg = topK(ranked, k).reduce((sum, id, index) => sum + gain(id) * discount(index), 0);

  const limit = Number.isFinite(k) ? Math.floor(k) : 0;
  const ideal = [...relevance.keys()]
    .map(gain)
    .filter((value) => value > 0)
    .sort((a, b) => b - a)
    .slice(0, Math.max(0, limit));
  const idcg = ideal.reduce((sum, value, index) => sum + value * discount(index), 0);
  return idcg === 0 ? 0 : dcg / idcg;
}

/** Binary relevance map (every id gets gain 1) for `ndcgAtK`. */
export function binaryRelevance(relevant: Iterable<string>): Map<string, number> {
  return new Map([...relevant].map((id) => [id, 1] as [string, number]));
}

/**
 * Mean of per-user metric values, skipping users that had nothing to rank
 * against (`null`). Returns null when no user was rankable.
 */
export function meanOverRankable(values: ReadonlyArray<number | null>): number | null {
  const usable = values.filter((value): value is number => value !== null);
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}
