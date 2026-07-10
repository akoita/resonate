/**
 * Per-path generation COGS model (#1421, RFC docs/rfc/generation-cost-model.md).
 *
 * Replaces the two flat `$0.06/30s` constants (catalog `COST_PER_30_SECONDS`
 * and remix `REMIX_GENERATION_COST_PER_30_SECONDS_USD`) with a typed, per-path,
 * env-overridable cost map. The two generation paths are structurally
 * different (a hosted Lyria API vs. a self-hosted Stable Audio GPU with cold
 * starts), so a single blended rate is a guess — this structure lets a real
 * per-path rate plus a fixed per-request floor be filled in from measured
 * cloud billing later.
 *
 * BEHAVIOR-PRESERVING: every default is `costPer30sUsd: 0.06, fixedFloorUsd: 0`
 * and `estimateGenerationCostUsd` reproduces the previous
 * `+((durationSeconds / 30) * 0.06).toFixed(2)` arithmetic exactly (linear, NOT
 * ceil-rounded — the sell price rounds up per 30s block, the internal cost
 * estimate does not). Until a real rate is configured via env, the returned
 * value is identical to the pre-refactor cost, including for sub-30s durations
 * (e.g. 15s → 0.03).
 *
 * Env overrides (read from process.env, the same source ConfigService reads,
 * mirroring the GENERATION_PRICE_CENTS_PER_30S pattern):
 *   GENERATION_COST_<PATH>_PER_30S_USD  — per-30s USD rate for a path
 *   GENERATION_COST_<PATH>_FLOOR_USD    — fixed per-request USD floor for a path
 * where <PATH> is the path key uppercased with non-alphanumerics collapsed to
 * `_` (e.g. `stable-audio-3-medium` → `STABLE_AUDIO_3_MEDIUM`, `default` →
 * `DEFAULT`).
 */

/** Known provider/model path keys. Arbitrary strings resolve to the default. */
export const GENERATION_COST_PATHS = [
  "lyria-002",
  "lyria-3-pro-preview",
  "stable-audio-3-medium",
  "remix-stub",
] as const;

export type GenerationCostPath = (typeof GENERATION_COST_PATHS)[number];

export interface GenerationCostModelEntry {
  /** USD per 30 seconds of generated audio. */
  costPer30sUsd: number;
  /** Fixed USD charged once per request (warm-up/model-load amortization). */
  fixedFloorUsd: number;
}

const DEFAULT_COST_PER_30S_USD = 0.06;
const DEFAULT_FIXED_FLOOR_USD = 0;

const DEFAULT_ENTRY: GenerationCostModelEntry = {
  costPer30sUsd: DEFAULT_COST_PER_30S_USD,
  fixedFloorUsd: DEFAULT_FIXED_FLOOR_USD,
};

/**
 * Base (pre-env) per-path model. Every entry currently equals the historical
 * flat rate so the refactor is behavior-preserving; real per-path numbers are
 * filled in here (or via env) once telemetry is reconciled against billing.
 */
const BASE_COST_MODEL: Record<string, GenerationCostModelEntry> = {
  "lyria-002": { ...DEFAULT_ENTRY },
  "lyria-3-pro-preview": { ...DEFAULT_ENTRY },
  "stable-audio-3-medium": { ...DEFAULT_ENTRY },
  "remix-stub": { ...DEFAULT_ENTRY },
  default: { ...DEFAULT_ENTRY },
};

/**
 * Wall-clock (ms) beyond which a self-hosted GPU generation is treated as a
 * cold start (best-effort; the GPU scale-to-zero worker loads the model on a
 * cold call, adding minutes of billed time with no output). Env-tunable.
 */
const DEFAULT_COLD_START_WALLCLOCK_MS = 120_000;

function envKeyForPath(path: string): string {
  return path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

function envNonNegativeNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Resolve the effective cost-model entry for a path: the base entry (or the
 * `default` entry for an unknown path) with any matching env override applied.
 */
export function resolveGenerationCostModel(
  path: string | null | undefined,
): GenerationCostModelEntry {
  const key = typeof path === "string" && path.length > 0 ? path : "default";
  const base = BASE_COST_MODEL[key] ?? BASE_COST_MODEL.default;
  const envKey = envKeyForPath(key);
  const costPer30sUsd =
    envNonNegativeNumber(`GENERATION_COST_${envKey}_PER_30S_USD`) ??
    base.costPer30sUsd;
  const fixedFloorUsd =
    envNonNegativeNumber(`GENERATION_COST_${envKey}_FLOOR_USD`) ??
    base.fixedFloorUsd;
  return { costPer30sUsd, fixedFloorUsd };
}

/**
 * Estimated internal COGS in USD for one generation on `path` lasting
 * `durationSeconds`. Linear in duration and rounded to cents, matching the
 * previous catalog/remix cost functions exactly when defaults are in effect:
 *   +((durationSeconds / 30) * costPer30sUsd + fixedFloorUsd).toFixed(2)
 */
export function estimateGenerationCostUsd(
  path: string | null | undefined,
  durationSeconds: number,
): number {
  const model = resolveGenerationCostModel(path);
  return +(
    (durationSeconds / 30) * model.costPer30sUsd +
    model.fixedFloorUsd
  ).toFixed(2);
}

/**
 * Best-effort cold-start classification for a settled generation. Only the
 * self-hosted Stable Audio GPU path has a cold-start concept; the hosted Lyria
 * API and the deterministic remix stub never cold-start. Returns null when the
 * path is unknown or wall-clock was not measured, so callers store an honest
 * "unknown" rather than a fabricated boolean.
 */
export function inferColdStart(
  path: string | null | undefined,
  wallClockMs: number | null | undefined,
): boolean | null {
  if (typeof path !== "string" || path.length === 0) return null;
  if (path.startsWith("lyria") || path === "remix-stub") {
    return false;
  }
  if (path.startsWith("stable-audio")) {
    if (typeof wallClockMs !== "number" || !Number.isFinite(wallClockMs)) {
      return null;
    }
    const threshold =
      envNonNegativeNumber("GENERATION_COLD_START_WALLCLOCK_MS") ??
      DEFAULT_COLD_START_WALLCLOCK_MS;
    return wallClockMs >= threshold;
  }
  return null;
}
