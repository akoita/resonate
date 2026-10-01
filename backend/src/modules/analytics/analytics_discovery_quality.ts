import type { AnalyticsFactRow } from "./analytics_warehouse";

/**
 * Per-surface and per-variant discovery quality (#1455 WS-8).
 *
 * Pure aggregation over warehouse fact rows; no I/O and no listener identity.
 * Surfaces are `home:<railId>` (Home rails) and `dj` (AI DJ sessions).
 *
 * Attribution:
 *  - `recommendation.served` / `recommendation.clicked` carry `railId`.
 *  - `playback.started|completed|skipped` and `library.saved` are attributed
 *    to `home:<railId>` when they carry a `railId` (the web forwards the rail a
 *    play came from), otherwise to `dj` when the caller classified the fact as
 *    part of an AI DJ session. Anything else is not a discovery-surface fact.
 *  - DJ impressions are accepted picks (`agent.next_pick_requested` with
 *    status `ok` and a track, or `agent.recommendation_selected`); the DJ has
 *    no click, so its clicks and click-through rate are 0.
 *
 * Definitions (all fractions in [0, 1], 0 on a zero denominator):
 *   clickThroughRate = clicks / impressions
 *   skipRate         = skips / plays          (explicit `playback.skipped`)
 *   completionRate   = completions / plays    (`playback.completed`, 30 s rule)
 *   saveRate         = saves / plays
 *
 * Variants come from the `rankerVariant` / `experimentKey` dimensions. A fact
 * without a variant is `unattributed`; it is reported but never compared.
 */

export const UNATTRIBUTED_VARIANT = "unattributed";
export const COMPARISON_BASELINE_VARIANT = "baseline";
const ROW_LIMIT = 100;

export interface DiscoveryRates {
  clickThroughRate: number;
  skipRate: number;
  completionRate: number;
  saveRate: number;
}

export interface DiscoveryCounts {
  impressions: number;
  clicks: number;
  plays: number;
  completions: number;
  skips: number;
  saves: number;
}

export type DiscoverySurfaceRow = { surface: string } & DiscoveryCounts & DiscoveryRates;

export type DiscoveryVariantRow = {
  experimentKey: string | null;
  surface: string;
  variant: string;
} & DiscoveryCounts &
  DiscoveryRates;

export interface DiscoveryVariantExposure {
  experimentKey: string | null;
  /** "home" or "dj": where recommendations were generated. */
  surface: string;
  variant: string;
  generations: number;
}

export interface DiscoveryVariantComparison {
  experimentKey: string | null;
  surface: string;
  variant: string;
  baselineVariant: typeof COMPARISON_BASELINE_VARIANT;
  sampleSize: {
    baselineImpressions: number;
    variantImpressions: number;
    baselinePlays: number;
    variantPlays: number;
  };
  /** variant minus baseline, in rate points (0.01 = one percentage point). */
  deltas: DiscoveryRates;
}

export interface DiscoveryQualityReport {
  surfaceBreakdown: DiscoverySurfaceRow[];
  variantBreakdown: DiscoveryVariantRow[];
  variantExposure: DiscoveryVariantExposure[];
  comparison: {
    baselineVariant: typeof COMPARISON_BASELINE_VARIANT;
    note: string;
    rows: DiscoveryVariantComparison[];
  };
}

const HOME_EVENTS = new Set(["recommendation.served", "recommendation.clicked"]);
const OUTCOME_EVENTS = new Set([
  "playback.started",
  "playback.completed",
  "playback.skipped",
  "library.saved",
]);
const DISCOVERY_ONLY_EVENTS = new Set([
  "recommendation.generated",
  "recommendation.served",
  "recommendation.clicked",
  "playback.started",
  "playback.skipped",
]);

function str(fact: AnalyticsFactRow, key: string): string | undefined {
  const value = fact.dimensions[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(fact: AnalyticsFactRow, key: string): number | undefined {
  const value = fact.dimensions[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Facts only the discovery report reads (kept out of the legacy DJ metrics). */
export function isDiscoveryOnlyFact(fact: AnalyticsFactRow): boolean {
  const eventName = str(fact, "eventName");
  return Boolean(eventName && DISCOVERY_ONLY_EVENTS.has(eventName));
}

/** True when a fact can feed the Home part of the report on its own. */
export function isHomeDiscoveryFact(fact: AnalyticsFactRow): boolean {
  const eventName = str(fact, "eventName");
  if (!eventName) return false;
  if (eventName === "recommendation.generated") return true;
  if (HOME_EVENTS.has(eventName)) return true;
  return OUTCOME_EVENTS.has(eventName) && Boolean(str(fact, "railId"));
}

function rate(numerator: number, denominator: number) {
  return denominator <= 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function emptyCounts(): DiscoveryCounts {
  return { impressions: 0, clicks: 0, plays: 0, completions: 0, skips: 0, saves: 0 };
}

function ratesOf(counts: DiscoveryCounts): DiscoveryRates {
  return {
    clickThroughRate: rate(counts.clicks, counts.impressions),
    skipRate: rate(counts.skips, counts.plays),
    completionRate: rate(counts.completions, counts.plays),
    saveRate: rate(counts.saves, counts.plays),
  };
}

function isAcceptedPick(fact: AnalyticsFactRow, eventName: string) {
  if (eventName === "agent.recommendation_selected") return true;
  return (
    eventName === "agent.next_pick_requested" &&
    str(fact, "status") === "ok" &&
    Boolean(str(fact, "trackId") ?? fact.trackId)
  );
}

interface Attribution {
  surface: string;
  apply: (counts: DiscoveryCounts, count: number, fact: AnalyticsFactRow) => void;
}

function attribute(
  fact: AnalyticsFactRow,
  eventName: string,
  isDj: boolean,
): Attribution | null {
  const railId = str(fact, "railId");
  const home = railId ? `home:${railId}` : null;
  switch (eventName) {
    case "recommendation.served":
      return home
        ? {
            surface: home,
            apply: (counts, count, f) => {
              counts.impressions += num(f, "itemCount") ?? count;
            },
          }
        : null;
    case "recommendation.clicked":
      return home ? { surface: home, apply: (counts, count) => void (counts.clicks += count) } : null;
    case "playback.started":
      return surfaceFor(home, isDj, (counts, count) => void (counts.plays += count));
    case "playback.completed":
      return surfaceFor(home, isDj, (counts, count) => void (counts.completions += count));
    case "playback.skipped":
      return surfaceFor(home, isDj, (counts, count) => void (counts.skips += count));
    case "library.saved":
      return surfaceFor(home, isDj, (counts, count) => void (counts.saves += count));
    default:
      if (isDj && isAcceptedPick(fact, eventName)) {
        return { surface: "dj", apply: (counts, count) => void (counts.impressions += count) };
      }
      return null;
  }
}

function surfaceFor(
  home: string | null,
  isDj: boolean,
  apply: Attribution["apply"],
): Attribution | null {
  if (home) return { surface: home, apply };
  if (isDj) return { surface: "dj", apply };
  return null;
}

/**
 * @param facts every fact in the window (agent and Home facts may be mixed)
 * @param djFacts the subset the dashboard classified as AI DJ session facts
 */
export function buildDiscoveryQualityReport(
  facts: readonly AnalyticsFactRow[],
  djFacts: ReadonlySet<AnalyticsFactRow>,
): DiscoveryQualityReport {
  const bySurface = new Map<string, DiscoveryCounts>();
  const byVariant = new Map<
    string,
    { experimentKey: string | null; surface: string; variant: string; counts: DiscoveryCounts }
  >();
  const exposure = new Map<string, DiscoveryVariantExposure>();

  for (const fact of facts) {
    const eventName = str(fact, "eventName");
    if (!eventName) continue;
    const count = fact.count || 1;
    const variant = str(fact, "rankerVariant") ?? UNATTRIBUTED_VARIANT;
    const experimentKey = str(fact, "experimentKey") ?? null;

    if (eventName === "recommendation.generated") {
      const surface = str(fact, "surface") ?? "home";
      const key = JSON.stringify([experimentKey, surface, variant]);
      const row = exposure.get(key) ?? { experimentKey, surface, variant, generations: 0 };
      row.generations += count;
      exposure.set(key, row);
      continue;
    }

    const attribution = attribute(fact, eventName, djFacts.has(fact));
    if (!attribution) continue;

    const surfaceCounts = bySurface.get(attribution.surface) ?? emptyCounts();
    attribution.apply(surfaceCounts, count, fact);
    bySurface.set(attribution.surface, surfaceCounts);

    const variantKey = JSON.stringify([experimentKey, attribution.surface, variant]);
    const variantRow = byVariant.get(variantKey) ?? {
      experimentKey,
      surface: attribution.surface,
      variant,
      counts: emptyCounts(),
    };
    attribution.apply(variantRow.counts, count, fact);
    byVariant.set(variantKey, variantRow);
  }

  const surfaceBreakdown: DiscoverySurfaceRow[] = [...bySurface.entries()]
    .map(([surface, counts]) => ({ surface, ...counts, ...ratesOf(counts) }))
    .sort((a, b) => b.impressions - a.impressions || b.plays - a.plays || a.surface.localeCompare(b.surface))
    .slice(0, ROW_LIMIT);

  const allVariantRows: DiscoveryVariantRow[] = [...byVariant.values()]
    .map((row) => ({
      experimentKey: row.experimentKey,
      surface: row.surface,
      variant: row.variant,
      ...row.counts,
      ...ratesOf(row.counts),
    }))
    .sort(
      (a, b) =>
        String(a.experimentKey).localeCompare(String(b.experimentKey)) ||
        a.surface.localeCompare(b.surface) ||
        a.variant.localeCompare(b.variant),
    );

  const comparisonRows: DiscoveryVariantComparison[] = [];
  for (const baseline of allVariantRows.filter((row) => row.variant === COMPARISON_BASELINE_VARIANT)) {
    for (const row of allVariantRows) {
      if (
        row.experimentKey !== baseline.experimentKey ||
        row.surface !== baseline.surface ||
        row.variant === COMPARISON_BASELINE_VARIANT ||
        row.variant === UNATTRIBUTED_VARIANT
      ) {
        continue;
      }
      comparisonRows.push({
        experimentKey: row.experimentKey,
        surface: row.surface,
        variant: row.variant,
        baselineVariant: COMPARISON_BASELINE_VARIANT,
        sampleSize: {
          baselineImpressions: baseline.impressions,
          variantImpressions: row.impressions,
          baselinePlays: baseline.plays,
          variantPlays: row.plays,
        },
        deltas: {
          clickThroughRate: round(row.clickThroughRate - baseline.clickThroughRate),
          skipRate: round(row.skipRate - baseline.skipRate),
          completionRate: round(row.completionRate - baseline.completionRate),
          saveRate: round(row.saveRate - baseline.saveRate),
        },
      });
    }
  }

  return {
    surfaceBreakdown,
    variantBreakdown: allVariantRows.slice(0, ROW_LIMIT),
    variantExposure: [...exposure.values()].sort(
      (a, b) =>
        String(a.experimentKey).localeCompare(String(b.experimentKey)) ||
        a.surface.localeCompare(b.surface) ||
        a.variant.localeCompare(b.variant),
    ),
    comparison: {
      baselineVariant: COMPARISON_BASELINE_VARIANT,
      note:
        "Descriptive differences only (variant minus baseline); sample sizes are reported and no significance test is applied.",
      rows: comparisonRows.slice(0, ROW_LIMIT),
    },
  };
}

function round(value: number) {
  return Number(value.toFixed(4));
}
