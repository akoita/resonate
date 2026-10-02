import {
  TASTE_EDIT_GENRE_ALIASES,
  TASTE_EDIT_GENRES,
  TASTE_EDIT_MOOD_ALIASES,
  TASTE_EDIT_MOODS,
} from "../recommendations/taste_edit_vocabulary";
import { parseKeyToCamelot } from "./crate_camelot";
import {
  CRATE_DEFAULT_COUNT,
  CRATE_LICENSE_TYPES,
  CRATE_MAX_COUNT,
  CRATE_MIN_COUNT,
  CRATE_STEM_TYPES,
  type CrateFilters,
  type CrateLicenseType,
  type CrateNumberRange,
  type CrateStemType,
} from "./crate.types";

/**
 * Crate filter defaults, vocabulary and sanitization (#1962,
 * docs/rfc/taste-engine.md §5.1).
 *
 * The filters are the contract: the text parser, the reference-track builder
 * and the client's edited chips all end in the same {@link CrateFilters}
 * structure, and anything that did not come from this server is run through
 * {@link sanitizeCrateFilters} first. Pure; no I/O.
 */

/** Tempo bounds a BPM filter may use (matches stem audio feature bounds). */
export const CRATE_BPM_MIN = 30;
export const CRATE_BPM_MAX = 300;
/** Most keys, genres and moods one request may carry. */
export const CRATE_MAX_KEYS = 6;
export const CRATE_MAX_GENRES = 5;
export const CRATE_MAX_MOODS = 5;
/** Largest USD amount a budget filter may carry. */
export const CRATE_MAX_PRICE_USD = 10_000;

/** The filters of a request that asked for nothing in particular. */
export function defaultCrateFilters(): CrateFilters {
  return {
    count: CRATE_DEFAULT_COUNT,
    bpm: null,
    keys: [],
    includeCamelotNeighbors: true,
    energy: null,
    requiredStems: [],
    licenseType: null,
    maxTotalUsd: null,
    maxPerItemUsd: null,
    verifiedHumanOnly: false,
    allowFullyAi: false,
    genres: [],
    moods: [],
  };
}

// ---------------------------------------------------------------------------
// Vocabulary (the taste-edit genre and mood lists)
// ---------------------------------------------------------------------------

/** Lower-case, with whitespace and hyphens interchangeable. */
export function normalizeCrateTerm(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, " ").trim();
}

function buildLookup(
  canonical: readonly string[],
  aliases: Readonly<Record<string, string>>,
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [alias, value] of Object.entries(aliases)) lookup.set(normalizeCrateTerm(alias), value);
  for (const value of canonical) lookup.set(normalizeCrateTerm(value), value);
  return lookup;
}

const GENRE_LOOKUP = buildLookup(TASTE_EDIT_GENRES, TASTE_EDIT_GENRE_ALIASES);
const MOOD_LOOKUP = buildLookup(TASTE_EDIT_MOODS, TASTE_EDIT_MOOD_ALIASES);

/** The catalog genre `value` names (alias-aware), or undefined. */
export function canonicalCrateGenre(value: string): string | undefined {
  return typeof value === "string" ? GENRE_LOOKUP.get(normalizeCrateTerm(value)) : undefined;
}

/** The catalog mood `value` names (alias-aware), or undefined. */
export function canonicalCrateMood(value: string): string | undefined {
  return typeof value === "string" ? MOOD_LOOKUP.get(normalizeCrateTerm(value)) : undefined;
}

/**
 * Whether a release's free-text genre satisfies any of the requested genres.
 * Case-insensitive and alias-aware: "dnb" satisfies "Drum & Bass". A release
 * genre that contains the requested genre as whole words also satisfies it
 * ("Afro House" and "Deep House" satisfy "House"), so a DJ asking for house is
 * not shut out of its sub-genres; the reverse does not hold.
 */
export function crateGenreMatches(releaseGenre: string | null, requested: string[]): boolean {
  if (typeof releaseGenre !== "string" || releaseGenre.trim() === "") return false;
  const raw = normalizeCrateTerm(releaseGenre);
  const canonical = canonicalCrateGenre(releaseGenre);
  const candidates = [raw, ...(canonical ? [normalizeCrateTerm(canonical)] : [])];
  return requested.some((genre) => {
    const wanted = normalizeCrateTerm(genre);
    if (!wanted) return false;
    return candidates.some((candidate) => ` ${candidate} `.includes(` ${wanted} `));
  });
}

/** Whether any of a track's moods is one of the requested moods. */
export function crateMoodMatches(trackMoods: string[], requested: string[]): boolean {
  const wanted = new Set(
    requested.map((mood) => normalizeCrateTerm(canonicalCrateMood(mood) ?? mood)),
  );
  return trackMoods.some(
    (mood) => typeof mood === "string" && wanted.has(normalizeCrateTerm(canonicalCrateMood(mood) ?? mood)),
  );
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

export type SanitizedCrateFilters = {
  filters: CrateFilters;
  /**
   * Fixed codes for values that were dropped, e.g. "invalid_key". Never echoes
   * the input. Each code appears once.
   */
  errors: string[];
};

const STEM_ALIASES: Readonly<Record<string, CrateStemType>> = {
  acapella: "vocals",
  acappella: "vocals",
  "a cappella": "vocals",
  vocal: "vocals",
  vox: "vocals",
  drum: "drums",
  guitars: "guitar",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function stemFrom(value: unknown): CrateStemType | null {
  if (typeof value !== "string") return null;
  const term = normalizeCrateTerm(value);
  if ((CRATE_STEM_TYPES as readonly string[]).includes(term)) return term as CrateStemType;
  return STEM_ALIASES[term] ?? null;
}

function sanitizeRange(
  raw: unknown,
  bounds: { min: number; max: number; places: number },
  code: string,
  errors: Set<string>,
): CrateNumberRange | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) {
    errors.add(code);
    return null;
  }
  const bound = (value: unknown): number | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.add(code);
      return null;
    }
    // Out-of-range values keep the DJ's intent at the nearest valid bound.
    return round(Math.min(bounds.max, Math.max(bounds.min, value)), bounds.places);
  };
  let min = bound(raw.min);
  let max = bound(raw.max);
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  return { min, max };
}

function sanitizePrice(raw: unknown, code: string, errors: Set<string>): number | null {
  if (raw === undefined || raw === null) return null;
  if (
    typeof raw !== "number"
    || !Number.isFinite(raw)
    || raw < 0
    || raw > CRATE_MAX_PRICE_USD
  ) {
    errors.add(code);
    return null;
  }
  return round(raw, 2);
}

function sanitizeBoolean(
  raw: unknown,
  fallback: boolean,
  code: string,
  errors: Set<string>,
): boolean {
  if (raw === undefined) return fallback;
  if (typeof raw !== "boolean") {
    errors.add(code);
    return fallback;
  }
  return raw;
}

function sanitizeList(
  raw: unknown,
  resolve: (value: string) => string | undefined,
  max: number,
  codes: { invalid: string; tooMany: string },
  errors: Set<string>,
): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.add(codes.invalid);
    return [];
  }
  const kept: string[] = [];
  for (const entry of raw) {
    const resolved = typeof entry === "string" ? resolve(entry) : undefined;
    if (!resolved) {
      errors.add(codes.invalid);
      continue;
    }
    if (kept.includes(resolved)) continue;
    if (kept.length >= max) {
      errors.add(codes.tooMany);
      continue;
    }
    kept.push(resolved);
  }
  return kept;
}

/**
 * Validates filters that crossed a trust boundary: edited chips from the
 * client, or a model's answer. Never throws and never echoes input. Anything
 * invalid falls back to the open default for that field and is reported by a
 * fixed code in `errors`; unknown properties are ignored.
 *
 * - `count` is rounded and clamped to CRATE_MIN_COUNT..CRATE_MAX_COUNT.
 * - Ranges clamp to bpm 30..300 and energy 0..1, swap when min > max, and are
 *   null when both bounds are open.
 * - `keys` must read as Camelot codes or musical keys (stored as codes), at
 *   most 6; `requiredStems`, `genres` and `moods` must be in their vocabulary
 *   (genres and moods the taste-edit lists, at most 5 each).
 * - Prices must be finite, 0..10000 USD.
 * - Booleans must be real booleans.
 */
export function sanitizeCrateFilters(raw: unknown): SanitizedCrateFilters {
  const filters = defaultCrateFilters();
  const errors = new Set<string>();
  if (!isRecord(raw)) {
    return { filters, errors: ["invalid_filters"] };
  }

  if (raw.count !== undefined && raw.count !== null) {
    if (typeof raw.count === "number" && Number.isFinite(raw.count)) {
      filters.count = Math.min(CRATE_MAX_COUNT, Math.max(CRATE_MIN_COUNT, Math.round(raw.count)));
    } else {
      errors.add("invalid_count");
    }
  }

  filters.bpm = sanitizeRange(
    raw.bpm,
    { min: CRATE_BPM_MIN, max: CRATE_BPM_MAX, places: 1 },
    "invalid_bpm",
    errors,
  );
  filters.keys = sanitizeList(
    raw.keys,
    (value) => parseKeyToCamelot(value) ?? undefined,
    CRATE_MAX_KEYS,
    { invalid: "invalid_key", tooMany: "too_many_keys" },
    errors,
  );
  filters.includeCamelotNeighbors = sanitizeBoolean(
    raw.includeCamelotNeighbors,
    true,
    "invalid_include_camelot_neighbors",
    errors,
  );
  filters.energy = sanitizeRange(raw.energy, { min: 0, max: 1, places: 2 }, "invalid_energy", errors);

  if (raw.requiredStems !== undefined && raw.requiredStems !== null) {
    if (Array.isArray(raw.requiredStems)) {
      const stems = new Set<CrateStemType>();
      for (const entry of raw.requiredStems) {
        const stem = stemFrom(entry);
        if (stem) stems.add(stem);
        else errors.add("invalid_stem");
      }
      // Canonical order, so equal requests give equal filters.
      filters.requiredStems = CRATE_STEM_TYPES.filter((stem) => stems.has(stem));
    } else {
      errors.add("invalid_stem");
    }
  }

  if (raw.licenseType !== undefined && raw.licenseType !== null) {
    const license = typeof raw.licenseType === "string" ? raw.licenseType.trim().toLowerCase() : "";
    if ((CRATE_LICENSE_TYPES as readonly string[]).includes(license)) {
      filters.licenseType = license as CrateLicenseType;
    } else {
      errors.add("invalid_license_type");
    }
  }

  filters.maxTotalUsd = sanitizePrice(raw.maxTotalUsd, "invalid_max_total_usd", errors);
  filters.maxPerItemUsd = sanitizePrice(raw.maxPerItemUsd, "invalid_max_per_item_usd", errors);
  filters.verifiedHumanOnly = sanitizeBoolean(
    raw.verifiedHumanOnly,
    false,
    "invalid_verified_human_only",
    errors,
  );
  filters.allowFullyAi = sanitizeBoolean(raw.allowFullyAi, false, "invalid_allow_fully_ai", errors);
  filters.genres = sanitizeList(
    raw.genres,
    canonicalCrateGenre,
    CRATE_MAX_GENRES,
    { invalid: "invalid_genre", tooMany: "too_many_genres" },
    errors,
  );
  filters.moods = sanitizeList(
    raw.moods,
    canonicalCrateMood,
    CRATE_MAX_MOODS,
    { invalid: "invalid_mood", tooMany: "too_many_moods" },
    errors,
  );

  return { filters, errors: [...errors] };
}
