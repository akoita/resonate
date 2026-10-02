/**
 * Crate Digger contract types (#1962, docs/rfc/taste-engine.md §5.1–5.2).
 *
 * The filters are the contract: a text request, a reference-track request and
 * a request built from edited filter chips all resolve to the same
 * {@link CrateFilters} structure, and the response always returns the filters
 * it ran with. Nothing in this file reads payment, placement or partner data;
 * listings and prices are crate FILTERS chosen by the DJ, never ranking inputs
 * (ADR-TE-2 rule 6).
 */

/** Stem types a DJ can require. `vocals` also covers "acapella". */
export const CRATE_STEM_TYPES = [
  "vocals",
  "drums",
  "bass",
  "piano",
  "guitar",
  "other",
] as const;
export type CrateStemType = (typeof CRATE_STEM_TYPES)[number];

/** License tiers a crate line can be filtered on (Prisma `LicenseType`). */
export const CRATE_LICENSE_TYPES = [
  "personal",
  "remix",
  "commercial",
  "sync",
  "sample",
  "broadcast",
] as const;
export type CrateLicenseType = (typeof CRATE_LICENSE_TYPES)[number];

/** Default and bounds for how many lines a crate request asks for. */
export const CRATE_DEFAULT_COUNT = 8;
export const CRATE_MIN_COUNT = 1;
export const CRATE_MAX_COUNT = 25;

/** Longest request text accepted; longer input is rejected with 400. */
export const CRATE_REQUEST_MAX_TEXT_LENGTH = 500;

export type CrateNumberRange = {
  /** Inclusive lower bound, or null for open. */
  min: number | null;
  /** Inclusive upper bound, or null for open. */
  max: number | null;
};

export type CrateFilters = {
  /** How many lines the DJ asked for (CRATE_MIN_COUNT..CRATE_MAX_COUNT). */
  count: number;
  /** Measured full-mix tempo range in BPM. */
  bpm: CrateNumberRange | null;
  /**
   * Requested keys as Camelot codes ("8A", "11B"). When
   * `includeCamelotNeighbors` is true the search also accepts each code's
   * neighbours (same number other letter, ±1 number same letter).
   */
  keys: string[];
  includeCamelotNeighbors: boolean;
  /** Measured energy range on the 0..1 composite (measured_track_features.ts). */
  energy: CrateNumberRange | null;
  /** Stem types every line must have as a current stem. */
  requiredStems: CrateStemType[];
  /** License tier every line must offer, or null for any. */
  licenseType: CrateLicenseType | null;
  /** Maximum indicative total in USD for the whole crate, or null. */
  maxTotalUsd: number | null;
  /** Maximum indicative price in USD per line, or null. */
  maxPerItemUsd: number | null;
  /** Only tracks whose artist is a verified human creator. */
  verifiedHumanOnly: boolean;
  /**
   * Whether fully AI-generated recordings (aiDisclosureLevel ALL) may appear.
   * Default false: they appear only when the request allows them.
   */
  allowFullyAi: boolean;
  /** Genre and mood terms matched against release genre and moods. */
  genres: string[];
  moods: string[];
};

/** Filter keys reported in coverage gaps and recorded as unmet demand. */
export const CRATE_FILTER_KEYS = [
  "bpm",
  "keys",
  "energy",
  "requiredStems",
  "licenseType",
  "maxPerItemUsd",
  "maxTotalUsd",
  "verifiedHumanOnly",
  "genres",
  "moods",
] as const;
export type CrateFilterKey = (typeof CRATE_FILTER_KEYS)[number];

export type CrateRequestSource = "text" | "reference_track" | "filters";

export type CrateParseResult = {
  filters: CrateFilters;
  /**
   * Phrases of the request text that mapped to no filter, shown honestly to
   * the DJ. Bounded (at most 10 entries, 120 chars each).
   */
  unparsed: string[];
  /** Which parser produced the filters. */
  strategy: "deterministic" | "model-assisted";
};

/** The facts about one candidate track the filters and ordering read. */
export type CrateCandidateFacts = {
  trackId: string;
  artistId: string | null;
  genre: string | null;
  moods: string[];
  aiDisclosureLevel: string | null;
  tempoBpm: number | null;
  camelot: string | null;
  energy: number | null;
  /** Current stem types of the track (lower-case, without `original`). */
  stemTypes: string[];
  /** License tiers the track offers through an active listing. */
  listedLicenseTypes: string[];
  /**
   * Indicative USD price per license tier for this track (cheapest current
   * stem price for that tier), from StemPricing. The binding price comes
   * from the quote (#1964).
   */
  indicativePriceUsd: Partial<Record<CrateLicenseType, number>>;
  verifiedHuman: boolean;
};

export type CrateCoverageGap = {
  filter: CrateFilterKey;
  /**
   * How many more lines the crate could have had if only this filter were
   * relaxed (candidates passing every other filter but failing this one,
   * capped at the missing count).
   */
  wouldAdd: number;
};

export type CrateCoverage = {
  requested: number;
  found: number;
  /** Filters that left gaps, largest first; empty when the crate is full. */
  gaps: CrateCoverageGap[];
};
