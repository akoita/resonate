/**
 * Adaptive `eth_getLogs` block window shared by the on-chain indexers (#2218).
 *
 * RPC providers cap a single `eth_getLogs` call either by block range
 * ("eth_getLogs is limited to a 200 range") or by result count ("query
 * returned more than 10000 results"). An indexer that keeps up with the tip
 * only ever asks for a few blocks, so a cap below the configured window stays
 * hidden until the indexer falls behind; then every catch-up request is
 * rejected and the same oversized window is retried forever.
 *
 * `fetchWithAdaptiveWindow` retries the SAME `fromBlock` with a smaller window
 * when the provider rejects the range: it jumps to the limit stated in the
 * error when there is one, otherwise halves, down to one block. It returns the
 * `toBlock` it actually covered so callers advance their cursor only over
 * fetched blocks. Any other error is rethrown untouched.
 */

export type RangeLimitKind = "blocks" | "results";

export type RangeLimitError = {
  kind: RangeLimitKind;
  /** Block count the provider says it accepts, when the message states one. */
  statedLimit: number | null;
};

type WindowLogger = {
  warn(message: string): void;
  log(message: string): void;
};

/** Phrasings of a result-count / response-size limit (dense ranges). */
const RESULTS_LIMIT_PATTERNS = [
  /more than [\d,]+ (?:results|logs)/i,
  /response size (?:exceeded|is larger|too large)/i,
  /too many (?:results|logs)/i,
  /log response size/i,
];

/** Phrasings of a hard block-range cap. */
const BLOCK_RANGE_PATTERNS = [
  /limited to (?:a )?[\d,]+\s*(?:block )?range/i,
  /block range (?:is )?(?:too (?:large|wide|big)|limit|exceed)/i,
  /(?:range|block range) (?:is )?too (?:large|wide|big)/i,
  /exceeds? (?:the )?max(?:imum)? (?:block )?range/i,
  /max(?:imum)? block range/i,
  /up to (?:a )?[\d,.]+\s*[km]?\s*block range/i,
  /ranges? over [\d,]+ blocks/i,
  /too many blocks/i,
  /requested too many blocks/i,
];

function parseCount(raw: string): number | null {
  const match = /^([\d,.]+)\s*([km])?$/i.exec(raw.trim());
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const unit = match[2]?.toLowerCase();
  const value = unit === "k" ? base * 1_000 : unit === "m" ? base * 1_000_000 : base;
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Block count a provider says it accepts, or null when the message has none. */
function parseStatedLimit(message: string): number | null {
  // Suggested range, e.g. "this block range should work: [0x10, 0x2f]".
  const suggested = /\[\s*(0x[0-9a-f]+)\s*,\s*(0x[0-9a-f]+)\s*\]/i.exec(message);
  if (suggested) {
    const from = BigInt(suggested[1]);
    const to = BigInt(suggested[2]);
    if (to >= from && to - from < BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(to - from) + 1;
    }
  }
  const patterns = [
    /limited to (?:a )?([\d,]+)\s*(?:block )?range/i,
    /up to (?:a )?([\d,.]+\s*[km]?)\s*block range/i,
    /max(?:imum)? (?:block )?range(?: is| of)?[:\s]+([\d,]+)/i,
    /maximum is set to ([\d,]+)/i,
    /ranges? over ([\d,]+) blocks/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(message);
    if (match) {
      const value = parseCount(match[1]);
      if (value !== null) return value;
    }
  }
  return null;
}

/** Message text of an error and its `cause` chain (viem nests RPC details). */
function collectMessages(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "string") {
      parts.push(current);
      break;
    }
    if (typeof current !== "object") break;
    const record = current as Record<string, unknown>;
    for (const key of ["message", "details", "shortMessage"]) {
      if (typeof record[key] === "string") parts.push(record[key] as string);
    }
    current = record.cause;
  }
  return parts.join("\n");
}

/** Classify an `eth_getLogs` failure as a provider range limit, or null. */
export function detectRangeLimitError(error: unknown): RangeLimitError | null {
  const message = collectMessages(error);
  if (!message) return null;
  const statedLimit = parseStatedLimit(message);
  if (RESULTS_LIMIT_PATTERNS.some((pattern) => pattern.test(message))) {
    return { kind: "results", statedLimit };
  }
  if (BLOCK_RANGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return { kind: "blocks", statedLimit };
  }
  return null;
}

export type AdaptiveBlockWindowOptions = {
  /** Configured window; the window never grows above it. */
  configured: number;
  /** Name used in log lines, e.g. "contract indexer". */
  label: string;
  logger: WindowLogger;
  /**
   * Consecutive successful fetches before a window reduced by a result-count
   * limit doubles back toward its ceiling. Hard block-range caps never grow.
   */
  growAfterSuccesses?: number;
};

/** Per-process `eth_getLogs` window that shrinks on provider range limits. */
export class AdaptiveBlockWindow {
  private current: number;
  /** Largest window allowed now; lowered permanently by a hard block cap. */
  private ceiling: number;
  private successes = 0;
  private readonly growAfterSuccesses: number;

  constructor(private readonly options: AdaptiveBlockWindowOptions) {
    const configured = Math.max(1, Math.floor(options.configured));
    this.current = configured;
    this.ceiling = configured;
    this.growAfterSuccesses = Math.max(1, options.growAfterSuccesses ?? 100);
  }

  get size(): number {
    return this.current;
  }

  /**
   * Shrink after the provider rejected a span of `attemptedSpan` blocks (less
   * than the window when clamped at the chain tip). Returns false when that
   * span was already one block, so the caller surfaces the error instead of
   * looping.
   */
  shrink(limit: RangeLimitError, attemptedSpan: number): boolean {
    const base = Math.min(this.current, attemptedSpan);
    if (base <= 1) return false;
    const next =
      limit.statedLimit !== null && limit.statedLimit < base
        ? limit.statedLimit
        : Math.floor(base / 2);
    this.current = next;
    if (limit.kind === "blocks") this.ceiling = Math.min(this.ceiling, next);
    this.successes = 0;
    return true;
  }

  recordSuccess(): void {
    if (this.current >= this.ceiling) return;
    this.successes += 1;
    if (this.successes < this.growAfterSuccesses) return;
    this.successes = 0;
    const previous = this.current;
    this.current = Math.min(this.ceiling, this.current * 2);
    this.options.logger.log(
      `${this.options.label}: eth_getLogs window grew from ${previous} to ${this.current} blocks after ${this.growAfterSuccesses} successful batches`,
    );
  }

  warnShrunk(from: number, reason: string): void {
    this.options.logger.warn(
      `${this.options.label}: RPC rejected the eth_getLogs block range; window reduced from ${from} to ${this.current} blocks for this process (${reason})`,
    );
  }
}

/**
 * Fetch `[fromBlock, min(fromBlock + window - 1, maxToBlock)]`, shrinking the
 * window and retrying the same `fromBlock` while the provider rejects the
 * range. `fetch` must have no side effects worth keeping on failure: it may run
 * several times for one call. Returns the result and the `toBlock` covered.
 */
export async function fetchWithAdaptiveWindow<T>(
  window: AdaptiveBlockWindow,
  fromBlock: bigint,
  maxToBlock: bigint,
  fetch: (fromBlock: bigint, toBlock: bigint) => Promise<T>,
): Promise<{ result: T; toBlock: bigint }> {
  const startSize = window.size;
  let lastReason = "";
  for (;;) {
    const candidate = fromBlock + BigInt(window.size) - 1n;
    const toBlock = candidate > maxToBlock ? maxToBlock : candidate;
    try {
      const result = await fetch(fromBlock, toBlock);
      if (window.size < startSize) window.warnShrunk(startSize, lastReason);
      window.recordSuccess();
      return { result, toBlock };
    } catch (error) {
      const limit = detectRangeLimitError(error);
      const attemptedSpan = Number(toBlock - fromBlock) + 1;
      if (!limit || !window.shrink(limit, attemptedSpan)) {
        if (window.size < startSize) window.warnShrunk(startSize, lastReason);
        throw error;
      }
      lastReason =
        limit.statedLimit !== null
          ? `provider ${limit.kind} limit, stated ${limit.statedLimit}`
          : `provider ${limit.kind} limit, halved`;
    }
  }
}
