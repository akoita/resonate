import { expandCamelotKeys, normalizeCamelotCode } from "./crate_camelot";
import { crateGenreMatches, crateMoodMatches } from "./crate_filters";
import {
  CRATE_FILTER_KEYS,
  type CrateCandidateFacts,
  type CrateCoverage,
  type CrateCoverageGap,
  type CrateFilterKey,
  type CrateFilters,
  type CrateLicenseType,
  type CrateNumberRange,
} from "./crate.types";

/**
 * Crate filter evaluation, selection and honest coverage (#1962,
 * docs/rfc/taste-engine.md §5.2).
 *
 * Pure: the caller loads {@link CrateCandidateFacts}; nothing here reads a
 * database, payments, placements or partner data. Listings and prices are crate
 * FILTERS the DJ chose, never ranking inputs (ADR-TE-2 rule 6): this module
 * decides which ranked candidates pass and how many fit the budget, and never
 * reorders them.
 *
 * Unknown facts are never guessed. A track with no measured tempo fails a BPM
 * filter, a track with no known key fails a key filter, and a line with no
 * known price fails a per-item or total budget, so the crate only ever contains
 * lines that provably satisfy what the DJ asked for.
 */

/** Tolerance for comparing USD amounts. */
const EPSILON = 1e-9;

function isRangeActive(range: CrateNumberRange | null): range is CrateNumberRange {
  return range !== null && (range.min !== null || range.max !== null);
}

function inRange(value: number | null, range: CrateNumberRange): boolean {
  if (value === null || !Number.isFinite(value)) return false;
  if (range.min !== null && value < range.min) return false;
  if (range.max !== null && value > range.max) return false;
  return true;
}

function knownPrice(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Filter keys that constrain the request, in `CRATE_FILTER_KEYS` order.
 * `maxTotalUsd` is included when set; it is a crate-level filter that
 * {@link failedFilters} does not evaluate per candidate.
 */
export function activeCrateFilterKeys(filters: CrateFilters): CrateFilterKey[] {
  return CRATE_FILTER_KEYS.filter((key) => {
    switch (key) {
      case "bpm":
        return isRangeActive(filters.bpm);
      case "keys":
        return filters.keys.length > 0;
      case "energy":
        return isRangeActive(filters.energy);
      case "requiredStems":
        return filters.requiredStems.length > 0;
      case "licenseType":
        return filters.licenseType !== null;
      case "maxPerItemUsd":
        return filters.maxPerItemUsd !== null;
      case "maxTotalUsd":
        return filters.maxTotalUsd !== null;
      case "verifiedHumanOnly":
        return filters.verifiedHumanOnly;
      case "genres":
        return filters.genres.length > 0;
      case "moods":
        return filters.moods.length > 0;
    }
  });
}

/**
 * The indicative USD price of the candidate's line for this request, or null
 * when it is not known.
 *
 * With a requested license tier it is that tier's indicative price. With none
 * it is the cheapest known tier price, i.e. the least the DJ could pay to
 * license the track. A track with no indicative price at all has no known line
 * price; it is never treated as free.
 */
export function linePriceUsd(facts: CrateCandidateFacts, filters: CrateFilters): number | null {
  if (filters.licenseType !== null) {
    return knownPrice(facts.indicativePriceUsd[filters.licenseType]);
  }
  let cheapest: number | null = null;
  for (const price of Object.values(facts.indicativePriceUsd)) {
    const known = knownPrice(price);
    if (known !== null && (cheapest === null || known < cheapest)) cheapest = known;
  }
  return cheapest;
}

/**
 * Whether the track offers the requested license tier. A tier is offered when
 * the track has an active listing for it OR a stem price for it: listings are
 * what a DJ can buy today and StemPricing is what the artist has priced, and
 * either means the tier is on the table. Requiring a listing alone would hide
 * priced tracks whose listing is still being set up.
 */
function offersLicense(facts: CrateCandidateFacts, tier: CrateLicenseType): boolean {
  const listed = facts.listedLicenseTypes.some((type) => type.toLowerCase() === tier);
  return listed || knownPrice(facts.indicativePriceUsd[tier]) !== null;
}

/**
 * Fully AI-generated recordings (`aiDisclosureLevel` ALL, case-insensitive) are
 * not a filter key: they are a hard exclusion unless the request allows them.
 */
export function isExcludedAsFullyAi(facts: CrateCandidateFacts, filters: CrateFilters): boolean {
  if (filters.allowFullyAi) return false;
  return typeof facts.aiDisclosureLevel === "string"
    && facts.aiDisclosureLevel.trim().toUpperCase() === "ALL";
}

/**
 * The filters this candidate fails, in `CRATE_FILTER_KEYS` order. Evaluates
 * every filter except `maxTotalUsd`, which constrains the crate as a whole (see
 * {@link selectCrateLinesWithStats}). Pure; the same facts always give the same
 * answer.
 *
 * - bpm: a measured tempo inside the range.
 * - keys: a Camelot code among the requested keys, or their neighbours when
 *   `includeCamelotNeighbors`.
 * - energy: a measured energy inside the range.
 * - requiredStems: every requested stem is a current stem of the track.
 * - licenseType: the tier is listed or priced for the track.
 * - maxPerItemUsd: the line price is known and at most the limit.
 * - verifiedHumanOnly: the artist is a verified human.
 * - genres: the release genre matches any requested genre.
 * - moods: any track mood is a requested mood.
 */
export function failedFilters(facts: CrateCandidateFacts, filters: CrateFilters): CrateFilterKey[] {
  const failed: CrateFilterKey[] = [];

  if (isRangeActive(filters.bpm) && !inRange(facts.tempoBpm, filters.bpm)) failed.push("bpm");

  if (filters.keys.length > 0) {
    const accepted = expandCamelotKeys(filters.keys, filters.includeCamelotNeighbors);
    // Compare through the same normalization the request keys went through.
    const normalized = typeof facts.camelot === "string" ? normalizeCamelotCode(facts.camelot) : null;
    if (!normalized || !accepted.has(normalized)) failed.push("keys");
  }

  if (isRangeActive(filters.energy) && !inRange(facts.energy, filters.energy)) failed.push("energy");

  if (filters.requiredStems.length > 0) {
    const have = new Set(facts.stemTypes.map((stem) => stem.toLowerCase()));
    if (!filters.requiredStems.every((stem) => have.has(stem))) failed.push("requiredStems");
  }

  if (filters.licenseType !== null && !offersLicense(facts, filters.licenseType)) {
    failed.push("licenseType");
  }

  if (filters.maxPerItemUsd !== null) {
    const price = linePriceUsd(facts, filters);
    // An unknown price cannot be shown to fit, so it fails.
    if (price === null || price > filters.maxPerItemUsd + EPSILON) failed.push("maxPerItemUsd");
  }

  if (filters.verifiedHumanOnly && !facts.verifiedHuman) failed.push("verifiedHumanOnly");

  if (filters.genres.length > 0 && !crateGenreMatches(facts.genre, filters.genres)) {
    failed.push("genres");
  }

  if (filters.moods.length > 0 && !crateMoodMatches(facts.moods, filters.moods)) {
    failed.push("moods");
  }

  return failed;
}

export type CrateSelection<T> = {
  lines: T[];
  /**
   * Lines that passed every filter but were skipped only because they would
   * push the crate over `maxTotalUsd` (or had no known price while a total was
   * set). Feed this to {@link computeCoverage}.
   */
  budgetSkipped: number;
};

/**
 * Walks `rankedPassing` (already filtered, best first) and takes lines until
 * `filters.count` is reached, never exceeding `maxTotalUsd`. A line whose price
 * would push the total over the budget is skipped and the scan continues, so a
 * cheaper line further down can still fit. With a budget set, a line with no
 * known price is skipped. Deterministic; keeps the input order.
 */
export function selectCrateLinesWithStats<T extends { facts: CrateCandidateFacts }>(
  rankedPassing: T[],
  filters: CrateFilters,
): CrateSelection<T> {
  const lines: T[] = [];
  let budgetSkipped = 0;
  // Whole cents, so a long sum never drifts past the budget.
  let totalCents = 0;
  const budgetCents = filters.maxTotalUsd === null ? null : Math.round(filters.maxTotalUsd * 100);

  for (const line of rankedPassing) {
    if (lines.length >= filters.count) break;
    if (budgetCents !== null) {
      const price = linePriceUsd(line.facts, filters);
      const cents = price === null ? null : Math.round(price * 100);
      if (cents === null || totalCents + cents > budgetCents) {
        budgetSkipped += 1;
        continue;
      }
      totalCents += cents;
    }
    lines.push(line);
  }
  return { lines, budgetSkipped };
}

/** {@link selectCrateLinesWithStats} without the budget statistics. */
export function selectCrateLines<T extends { facts: CrateCandidateFacts }>(
  rankedPassing: T[],
  filters: CrateFilters,
): T[] {
  return selectCrateLinesWithStats(rankedPassing, filters).lines;
}

/**
 * Honest coverage: "3 of 8 found", and which filters stood in the way.
 *
 * `all` is every candidate considered (passing or not). When fewer lines were
 * found than requested, each active filter gets a gap whose `wouldAdd` is how
 * many more lines the crate could have had if only that filter were relaxed:
 * the candidates that fail that filter and no other (fully AI recordings the
 * request excludes never count), capped at the missing count. For
 * `maxTotalUsd`, which is not evaluated per candidate, it is `budgetSkipped`
 * (from {@link selectCrateLinesWithStats}) capped the same way: those lines
 * passed every other filter and only the budget kept them out. Zero entries are
 * omitted; gaps sort largest first, ties in `CRATE_FILTER_KEYS` order. A full
 * crate has no gaps, and an empty catalog reports 0 of N with no gaps.
 */
export function computeCoverage(
  all: CrateCandidateFacts[],
  selectedCount: number,
  filters: CrateFilters,
  budgetSkipped = 0,
): CrateCoverage {
  const requested = filters.count;
  const found = Math.max(0, Math.floor(selectedCount));
  if (found >= requested) return { requested, found, gaps: [] };

  const missing = requested - found;
  const failingOnly = new Map<CrateFilterKey, number>();
  for (const facts of all) {
    if (isExcludedAsFullyAi(facts, filters)) continue;
    const failed = failedFilters(facts, filters);
    if (failed.length === 1) failingOnly.set(failed[0], (failingOnly.get(failed[0]) ?? 0) + 1);
  }

  const gaps: CrateCoverageGap[] = [];
  for (const key of activeCrateFilterKeys(filters)) {
    const candidates = key === "maxTotalUsd" ? Math.max(0, budgetSkipped) : failingOnly.get(key) ?? 0;
    const wouldAdd = Math.min(missing, candidates);
    if (wouldAdd > 0) gaps.push({ filter: key, wouldAdd });
  }
  gaps.sort(
    (a, b) =>
      b.wouldAdd - a.wouldAdd
      || CRATE_FILTER_KEYS.indexOf(a.filter) - CRATE_FILTER_KEYS.indexOf(b.filter),
  );
  return { requested, found, gaps };
}
