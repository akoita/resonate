/**
 * Hybrid retrieval for the AI DJ (#2242, plan A5): the pure parts.
 *
 * The selector gathers candidates from several sources (keyword, semantic,
 * audio-feature range, My Mix lane, seed), each with its own candidate budget
 * and its own failure mode, and fuses their rankings with reciprocal-rank
 * fusion BEFORE the shared ranking core. Nothing here touches the ranking
 * rules (ADR-TE-2), the taste policy, the explicit preference or the
 * AI-promotion filter: those stay authoritative after fusion.
 *
 * Shipped behind the ranker variant `hybrid_rrf_v1` (#2005): the assignment in
 * `discovery_experiment.ts` selects it; the default path is unchanged.
 */

export const HYBRID_RETRIEVAL_VARIANT = "hybrid_rrf_v1";

/**
 * Reciprocal-rank fusion constant. Each list contributes 1 / (RRF_K + rank)
 * (rank is 1-based). 60 is the value from the original RRF paper (Cormack,
 * Clarke and Buettcher, 2009): large enough that the top few ranks of one list
 * cannot drown a track the other lists agree on, small enough that rank still
 * matters. It is not tuned per catalog.
 */
export const RRF_K = 60;

export const RETRIEVAL_SOURCES = ["keyword", "semantic", "audio_range", "lane", "seed", "trending"] as const;
export type RetrievalSource = (typeof RETRIEVAL_SOURCES)[number];

/**
 * Default candidate budgets. `keyword` is per query and `lane` per lane (the
 * same 20 the keyword path always used); `semantic`, `audio_range`, `seed` and
 * `trending` are per request.
 */
export const DEFAULT_SOURCE_BUDGETS: Readonly<Record<RetrievalSource, number>> = {
  keyword: 20,
  semantic: 20,
  audio_range: 20,
  lane: 20,
  seed: 20,
  trending: 20,
};
/**
 * The most a "capped" source may add of the fused candidate list, in percent
 * (#2246): trending tracks only fill up to this share of the list, whatever
 * its budget. `AGENT_RETRIEVAL_TRENDING_MAX_SHARE_PERCENT`; 0 turns trending off.
 */
export const DEFAULT_TRENDING_MAX_SHARE_PERCENT = 20;
const MAX_TRENDING_SHARE_PERCENT = 50;
/**
 * Latency budget of the whole retrieval step; a source still running at the
 * deadline is cut off. 1500 ms proved too tight on a small staging database,
 * where keyword and semantic retrieval both overran it on every pick.
 */
export const DEFAULT_RETRIEVAL_TIMEOUT_MS = 5000;
/** Cap on the fused candidate list handed to the ranking core. */
export const DEFAULT_MAX_FUSED_CANDIDATES = 150;
const MAX_BUDGET = 50;

export interface HybridRetrievalConfig {
  budgets: Record<RetrievalSource, number>;
  timeoutMs: number;
  maxCandidates: number;
  /** Trending's cap as a share of the fused candidates, in percent (0 = off). */
  trendingMaxSharePercent: number;
}

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(value, max);
}

/**
 * Config from the environment:
 *  - `AGENT_RETRIEVAL_BUDGETS` = `keyword=20,semantic=20,audio_range=20,lane=20,seed=20,trending=20`
 *    (any subset; unknown names and invalid values are ignored; each 1..50);
 *  - `AGENT_RETRIEVAL_TIMEOUT_MS` (default 1500);
 *  - `AGENT_RETRIEVAL_MAX_CANDIDATES` (default 150).
 */
export function hybridRetrievalConfig(
  env: Record<string, string | undefined> = process.env,
): HybridRetrievalConfig {
  const budgets = { ...DEFAULT_SOURCE_BUDGETS };
  for (const part of (env.AGENT_RETRIEVAL_BUDGETS ?? "").split(",")) {
    const [name, value] = part.split("=").map((piece) => piece.trim());
    if (!name || value === undefined) continue;
    if (!(RETRIEVAL_SOURCES as readonly string[]).includes(name)) continue;
    budgets[name as RetrievalSource] = positiveInt(value, budgets[name as RetrievalSource], MAX_BUDGET);
  }
  return {
    budgets,
    timeoutMs: positiveInt(env.AGENT_RETRIEVAL_TIMEOUT_MS, DEFAULT_RETRIEVAL_TIMEOUT_MS, 30_000),
    maxCandidates: positiveInt(env.AGENT_RETRIEVAL_MAX_CANDIDATES, DEFAULT_MAX_FUSED_CANDIDATES, 500),
    trendingMaxSharePercent: sharePercent(
      env.AGENT_RETRIEVAL_TRENDING_MAX_SHARE_PERCENT,
      DEFAULT_TRENDING_MAX_SHARE_PERCENT,
    ),
  };
}

/** A whole percent 0..50; unset or invalid falls back to the default (0 is a valid "off"). */
function sharePercent(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(value, MAX_TRENDING_SHARE_PERCENT);
}

export interface RankedList {
  source: RetrievalSource;
  /** Track ids, best first. */
  ids: readonly string[];
}

export interface FusedEntry {
  id: string;
  score: number;
  /** Sources that returned the track (each once, in first-seen order). */
  sources: RetrievalSource[];
}

/**
 * Reciprocal-rank fusion. A track's score is the sum over every list that
 * contains it of 1 / (k + rank). Ties keep first-seen order (list order, then
 * rank), so the result is deterministic.
 */
export function reciprocalRankFusion(lists: readonly RankedList[], k: number = RRF_K): FusedEntry[] {
  const entries = new Map<string, FusedEntry>();
  for (const list of lists) {
    const seenInList = new Set<string>();
    list.ids.forEach((id) => {
      if (seenInList.has(id)) return;
      seenInList.add(id);
      const rank = seenInList.size;
      let entry = entries.get(id);
      if (!entry) {
        entry = { id, score: 0, sources: [] };
        entries.set(id, entry);
      }
      entry.score += 1 / (k + rank);
      if (!entry.sources.includes(list.source)) entry.sources.push(list.source);
    });
  }
  return [...entries.values()]
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (b.entry.score !== a.entry.score ? b.entry.score - a.entry.score : a.index - b.index))
    .map(({ entry }) => entry);
}

/**
 * Caps what one source may add on its own (#2246). Entries that ONLY that source
 * returned fill at most `maxSharePercent` of the kept list; an entry another
 * source also returned is that source's own find and is never counted or cut.
 * Entries keep their fused order, and the result is at most `maxCandidates`.
 * Pure and deterministic.
 */
export function capSourceShare(
  fused: readonly FusedEntry[],
  source: RetrievalSource,
  maxSharePercent: number,
  maxCandidates: number,
): { kept: FusedEntry[]; capped: number } {
  const onlyThisSource = (entry: FusedEntry) => entry.sources.length === 1 && entry.sources[0] === source;
  const others = fused.filter((entry) => !onlyThisSource(entry));
  const solo = fused.filter(onlyThisSource);
  const share = Math.min(Math.max(maxSharePercent, 0), 99) / 100;
  // solo / (solo + others) <= share, and solo + others <= maxCandidates.
  const allowedByOthers = Math.floor((share / (1 - share)) * Math.min(others.length, maxCandidates));
  const allowed = Math.min(solo.length, allowedByOthers, Math.floor(share * maxCandidates));
  const keptOthers = new Set(others.slice(0, Math.max(0, maxCandidates - allowed)));
  const keptSolo = new Set(solo.slice(0, allowed));
  const kept = fused.filter((entry) => keptOthers.has(entry) || keptSolo.has(entry));
  return { kept, capped: solo.length - keptSolo.size };
}

/** Why a source contributed nothing; the reason codes are the only thing logged. */
export type SourceStatus = "ok" | "error" | "timeout" | "skipped";
export type SourceReason = "tool_error" | "deadline_exceeded" | "not_requested" | "unavailable";

export interface SourceOutcome<T> {
  source: RetrievalSource;
  status: SourceStatus;
  reason?: SourceReason;
  durationMs: number;
  value?: T;
}

/**
 * Runs one source against the step deadline. Never throws: an error or a
 * timeout yields an outcome with no value, so it removes only that source's
 * candidates (fail open). A late result is ignored.
 */
export async function runSource<T>(
  source: RetrievalSource,
  run: () => Promise<T>,
  deadlineAt: number,
  now: () => number = Date.now,
): Promise<SourceOutcome<T>> {
  const startedAt = now();
  const remaining = Math.max(0, deadlineAt - startedAt);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), remaining);
  });
  try {
    const result = await Promise.race([run(), timeout]);
    if (result === "timeout") {
      return { source, status: "timeout", reason: "deadline_exceeded", durationMs: now() - startedAt };
    }
    return { source, status: "ok", durationMs: now() - startedAt, value: result as T };
  } catch {
    return { source, status: "error", reason: "tool_error", durationMs: now() - startedAt };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Audio-range retrieval parameters, from the request (never from learned taste). */
export interface AudioRangeRequest {
  energy?: "low" | "medium" | "high";
  tempoBpm?: { min: number | null; max: number | null };
}

/** True when the request names a measured audio quality worth retrieving by. */
export function hasAudioRangeRequest(request: AudioRangeRequest): boolean {
  const tempo = request.tempoBpm;
  return Boolean(request.energy) || (tempo != null && (tempo.min != null || tempo.max != null));
}

/** What the retrieval step did, returned on the selection for coverage and explanations. */
/** Every hybrid source that ran failed; carries what each one did so the fallback can log it. */
export class HybridRetrievalUnavailableError extends Error {
  constructor(readonly sources: RetrievalReport["sources"]) {
    super("Hybrid retrieval unavailable: every source failed");
    this.name = "HybridRetrievalUnavailableError";
  }
}

export interface RetrievalReport {
  variant: string;
  sources: Array<{
    source: RetrievalSource;
    status: SourceStatus;
    reason?: SourceReason;
    candidates: number;
    durationMs: number;
  }>;
  /** Candidates only that source contributed: a source that widens the request is visible here. */
  onlyFrom: Partial<Record<RetrievalSource, number>>;
  fused: number;
  truncated: number;
  /** Candidates only a capped source (trending, #2246) found that its share cap left out. */
  capped?: Partial<Record<RetrievalSource, number>>;
}
