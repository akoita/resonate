import { createHash } from "crypto";

/**
 * Minimal deterministic holdout / variant assignment for the discovery ranker
 * (#1455 WS-8, docs/rfc/discovery-intelligence.md WS-8).
 *
 * This slice only RECORDS and REPORTS which variant a listener was in. Every
 * variant runs the same ranker today; a variant name does not change ranking
 * behavior until a later slice maps it to a concrete ranker option.
 *
 * Config (env `DISCOVERY_RANKER_EXPERIMENT`), one format:
 *
 *     <experimentKey>:<variantA>=<percent>,<variantB>=<percent>
 *
 * e.g. `ranker_v2:candidate=10,holdout=5`. Percentages are whole numbers that
 * sum to at most 100; the remainder is the `baseline` variant. Names and the
 * key are `[a-z0-9_-]`, 1..40 chars. Unset, empty, or any malformed value means
 * no experiment: every listener is `baseline` and no experiment key is
 * recorded, so default behavior is unchanged.
 *
 * Bucketing: bucket = first 32 bits of sha256(`${experimentKey}:${userId}`)
 * mod 100. The same listener always lands in the same bucket for a key, and a
 * new key reshuffles everyone. Variants occupy consecutive bucket ranges in
 * the order written; buckets beyond their total belong to `baseline`.
 *
 * Privacy: only the variant label and the experiment key are ever recorded on
 * events. The bucket is derived on demand and never stored or reported.
 */

export const DISCOVERY_EXPERIMENT_ENV = "DISCOVERY_RANKER_EXPERIMENT";
export const BASELINE_VARIANT = "baseline";

export interface DiscoveryExperimentVariant {
  name: string;
  percent: number;
}

export interface DiscoveryExperimentConfig {
  key: string;
  variants: DiscoveryExperimentVariant[];
}

export interface DiscoveryVariantAssignment {
  rankerVariant: string;
  /** Null when no experiment is configured. */
  experimentKey: string | null;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Parses the env format; returns null (no experiment) for anything invalid. */
export function parseDiscoveryExperiment(
  raw: string | undefined | null,
): DiscoveryExperimentConfig | null {
  const text = raw?.trim();
  if (!text) return null;
  const separator = text.indexOf(":");
  if (separator <= 0) return null;
  const key = text.slice(0, separator).trim();
  if (!NAME_PATTERN.test(key)) return null;

  const variants: DiscoveryExperimentVariant[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const part of text.slice(separator + 1).split(",")) {
    const [name, percentText, ...extra] = part.split("=").map((piece) => piece.trim());
    if (extra.length > 0 || !name || percentText === undefined) return null;
    if (!NAME_PATTERN.test(name) || name === BASELINE_VARIANT || seen.has(name)) return null;
    if (!/^\d{1,3}$/.test(percentText)) return null;
    const percent = Number(percentText);
    if (percent < 0 || percent > 100) return null;
    seen.add(name);
    total += percent;
    variants.push({ name, percent });
  }
  if (variants.length === 0 || total > 100) return null;
  return { key, variants };
}

/** Deterministic bucket in [0, 100) for a listener under an experiment key. */
export function discoveryBucket(experimentKey: string, userId: string): number {
  const digest = createHash("sha256").update(`${experimentKey}:${userId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/** Variant for a listener under an explicit config; `baseline` past the ranges. */
export function assignDiscoveryVariant(
  userId: string | null | undefined,
  config: DiscoveryExperimentConfig | null,
): DiscoveryVariantAssignment {
  const id = userId?.trim();
  if (!config || !id) {
    return { rankerVariant: BASELINE_VARIANT, experimentKey: config?.key ?? null };
  }
  const bucket = discoveryBucket(config.key, id);
  let upper = 0;
  for (const variant of config.variants) {
    upper += variant.percent;
    if (bucket < upper) {
      return { rankerVariant: variant.name, experimentKey: config.key };
    }
  }
  return { rankerVariant: BASELINE_VARIANT, experimentKey: config.key };
}

let cachedRaw: string | undefined;
let cachedConfig: DiscoveryExperimentConfig | null = null;

/** Config from `DISCOVERY_RANKER_EXPERIMENT`; re-parsed only when the value changes. */
export function discoveryExperimentFromEnv(
  env: Record<string, string | undefined> = process.env,
): DiscoveryExperimentConfig | null {
  const raw = env[DISCOVERY_EXPERIMENT_ENV];
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedConfig = parseDiscoveryExperiment(raw);
  }
  return cachedConfig;
}

/** The listener's variant under the environment-configured experiment. */
export function discoveryVariantForUser(
  userId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): DiscoveryVariantAssignment {
  return assignDiscoveryVariant(userId, discoveryExperimentFromEnv(env));
}
