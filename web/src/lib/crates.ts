/**
 * Crate Digger client types and pure helpers (#1963, docs/rfc/taste-engine.md
 * section 5.1-5.3).
 *
 * The types mirror `backend/src/modules/crates/crate.types.ts`,
 * `crate.dto.ts` and `crate_ordering.ts`. Everything here is pure: no
 * network, no storage beyond the small SSR-safe session handoff at the bottom.
 * Prices are indicative; the quote (#1964) sets the final price.
 */

export const CRATE_STEM_TYPES = ["vocals", "drums", "bass", "piano", "guitar", "other"] as const;
export type CrateStemType = (typeof CRATE_STEM_TYPES)[number];

export const CRATE_LICENSE_TYPES = [
  "personal",
  "remix",
  "commercial",
  "sync",
  "sample",
  "broadcast",
] as const;
export type CrateLicenseType = (typeof CRATE_LICENSE_TYPES)[number];

export const CRATE_DEFAULT_COUNT = 8;
export const CRATE_MIN_COUNT = 1;
export const CRATE_MAX_COUNT = 25;
export const CRATE_REQUEST_MAX_TEXT_LENGTH = 500;
export const CRATE_TITLE_MAX_LENGTH = 80;

export type CrateNumberRange = {
  min: number | null;
  max: number | null;
};

export type CrateFilters = {
  count: number;
  bpm: CrateNumberRange | null;
  keys: string[];
  includeCamelotNeighbors: boolean;
  energy: CrateNumberRange | null;
  requiredStems: CrateStemType[];
  licenseType: CrateLicenseType | null;
  maxTotalUsd: number | null;
  maxPerItemUsd: number | null;
  verifiedHumanOnly: boolean;
  allowFullyAi: boolean;
  genres: string[];
  moods: string[];
};

export type CrateFilterKey =
  | "bpm"
  | "keys"
  | "energy"
  | "requiredStems"
  | "licenseType"
  | "maxPerItemUsd"
  | "maxTotalUsd"
  | "verifiedHumanOnly"
  | "genres"
  | "moods";

export type CrateRequestSource = "text" | "reference_track" | "filters";

export type CrateCoverageGap = {
  filter: CrateFilterKey;
  wouldAdd: number;
};

export type CrateCoverage = {
  requested: number;
  found: number;
  gaps: CrateCoverageGap[];
};

export type CrateHarmonicRelation = "same" | "neighbor" | "clash" | "unknown";

/** What changes going from one line to the next (backend `CrateTransitionFacts`). */
export type CrateTransitionFacts = {
  harmonic: CrateHarmonicRelation;
  /** Next line minus this line in BPM, or null when either tempo is unknown. */
  bpmDelta: number | null;
  /** Next line minus this line on the 0..1 energy composite, or null. */
  energyDelta: number | null;
};

export type CrateLineStem = {
  type: string;
  qualityScore: number | null;
};

export type CrateLicenseOption = {
  licenseType: string;
  listed: boolean;
  indicativePriceUsd: number | null;
  standardTerms: boolean;
  grants: string[];
};

export type CrateItemDto = {
  position: number;
  locked: boolean;
  trackId: string;
  title: string;
  artistId: string | null;
  artistName: string | null;
  available: boolean;
  tempoBpm: number | null;
  camelot: string | null;
  energy: number | null;
  stemTypes: string[];
  listedLicenseTypes: string[];
  indicativePriceUsd: Partial<Record<CrateLicenseType, number>>;
  linePriceUsd: number | null;
  verifiedHuman: boolean;
  aiDisclosureLevel: string | null;
  explanation?: string[];
  transitionToNext: CrateTransitionFacts | null;
  /** The stem the transition preview plays, or null when there is none. */
  originalStemId: string | null;
  stems: CrateLineStem[];
  licenseOptions: CrateLicenseOption[];
};

export type CrateEntitlementDecision = { allowed: boolean; reason: string; policyVersion: string };

/**
 * One server-made decision per gated feature (#1966). The page reads these and
 * never hard-codes who may do what.
 */
export type CrateEntitlements = {
  pro: CrateEntitlementDecision;
  export: CrateEntitlementDecision;
  watch: CrateEntitlementDecision;
};

/* ------------------------------------------------------------------ */
/* Watching (#1967)                                                    */
/* ------------------------------------------------------------------ */

/** Mirrors `CrateWatchDto` in `crate.dto.ts`. `mode` is what is in effect now. */
export type CrateWatchMode = "off" | "notify";

export type CrateWatchMatch = {
  trackId: string;
  /** The release page that plays the track; null when unknown. */
  releaseId: string | null;
  title: string;
  artistName: string | null;
  matchedAt: string;
};

export type CrateWatch = {
  mode: CrateWatchMode;
  /**
   * When watching ends. With `mode` "off" a non-null value is when a watch that
   * ran out ended.
   */
  expiresAt: string | null;
  /** This UTC month's counts, read on demand. */
  summary: { month: string; matches: number; notified: number };
  /** Newest first, at most 20, only tracks still publicly playable. */
  recentMatches: CrateWatchMatch[];
};

export type UpdateCrateWatchBody = { mode: CrateWatchMode; expiresInDays?: number };

export type CrateStatus = "draft" | "saved";

export type CrateDto = {
  id: string;
  status: string;
  title: string | null;
  filters: CrateFilters;
  createdAt: string;
  updatedAt: string;
  entitlements: CrateEntitlements;
  watch: CrateWatch;
  items: CrateItemDto[];
};

/* ------------------------------------------------------------------ */
/* Quote and settlement receipts (#1964)                               */
/* ------------------------------------------------------------------ */

/** Mirrors `backend/src/modules/crates/crate_quote.dto.ts`. */
export type CrateQuoteStatus = "open" | "submitted" | "settled" | "partial" | "failed";
export type CrateQuoteItemStatus = "quoted" | "dropped" | "settled" | "failed";

/** Why the browser left a quoted stem out of the transaction it sent. */
export const CRATE_QUOTE_SETTLE_DROP_REASONS = [
  "simulation_failed",
  "insufficient_balance",
  "listing_changed",
  "deselected",
] as const;
export type CrateQuoteSettleDropReason = (typeof CRATE_QUOTE_SETTLE_DROP_REASONS)[number];

export type CrateQuoteReceipt = {
  transactionHash: string;
  logIndex: number;
  totalPaidUnits: string;
  purchaseId: string | null;
};

export type CrateQuoteItem = {
  quoteLineId: string;
  stemId: string;
  stemType: string;
  status: CrateQuoteItemStatus | string;
  reason: string | null;
  listingId: string | null;
  tokenId: string | null;
  paymentToken: string | null;
  symbol: string | null;
  decimals: number | null;
  /** Total price in payment-token units, as a decimal string (parse with BigInt). */
  totalUnits: string | null;
  total: string | null;
  totalUsd: string | null;
  artistShareUnits: string | null;
  platformFeeUnits: string | null;
  receipt: CrateQuoteReceipt | null;
};

export type CrateQuoteRights = {
  licenseType: string;
  standardTerms: boolean;
  grants: string[];
};

export type CrateQuoteLine = {
  position: number;
  trackId: string;
  title: string | null;
  artistName: string | null;
  licenseType: string;
  rights: CrateQuoteRights;
  items: CrateQuoteItem[];
};

export type CrateQuoteTotal = {
  paymentToken: string;
  symbol: string;
  decimals: number;
  totalUnits: string;
  total: string;
  totalUsd: string | null;
};

export type CrateQuote = {
  id: string;
  crateId: string;
  status: CrateQuoteStatus | string;
  chainId: number;
  marketplaceAddress: string;
  buyerAddress: string;
  expiresAt: string;
  transactionHash: string | null;
  lines: CrateQuoteLine[];
  totals: CrateQuoteTotal[];
  totalUsd: string | null;
  budgetUsd: number | null;
  overBudget: boolean;
};

/** A per-line choice sent back to the quote route. */
export type CrateQuoteLineRequest = {
  trackId: string;
  licenseType?: CrateLicenseType;
  stemTypes?: CrateStemType[];
};

export type CreateCrateQuoteBody = {
  /** The smart account the page will sign with. Always sent. */
  buyerAddress: string;
  /** Omitted: every line of the crate. Given: only these lines. */
  lines?: CrateQuoteLineRequest[];
};

export type SettleCrateQuoteBody = {
  transactionHash: string;
  dropped?: Array<{ quoteLineId: string; reason: CrateQuoteSettleDropReason }>;
};

/** 200 when the quote reached a final state, 202 while the transaction is pending. */
export type SettleCrateQuoteResult = { status: 200 | 202; quote: CrateQuote };

/** `GET /crates/:id`: the crate plus its most recent quote (any status), or null. */
export type GetCrateResponse = { crate: CrateDto; latestQuote?: CrateQuote | null };

export type CrateRequestInfo = {
  id: string;
  source: CrateRequestSource;
  parserStrategy: "deterministic" | "model-assisted";
  unparsed: string[];
};

export type CreateCrateResponse = {
  crate: CrateDto;
  request: CrateRequestInfo;
  coverage: CrateCoverage;
};

export type CrateListEntry = {
  id: string;
  title: string | null;
  status: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

/** Exactly one of `text`, `referenceTrackId` and `filters`, plus an optional count. */
export type CreateCrateRequestBody =
  | { text: string; count?: number }
  | { referenceTrackId: string; count?: number }
  | { filters: CrateFilters };

export type UpdateCrateBody = {
  title?: string | null;
  status?: CrateStatus;
  items?: Array<{ trackId: string; locked?: boolean }>;
  watch?: UpdateCrateWatchBody;
};

/* ------------------------------------------------------------------ */
/* Filter chips                                                        */
/* ------------------------------------------------------------------ */

export type FilterChip = {
  /** Stable key passed to {@link removeChip}. */
  key: string;
  label: string;
};

function formatRange(range: CrateNumberRange, unit: string, digits = 0): string | null {
  const { min, max } = range;
  const fmt = (n: number) => (digits > 0 ? n.toFixed(digits) : String(Math.round(n)));
  if (min !== null && max !== null) return `${fmt(min)}-${fmt(max)}${unit}`;
  if (min !== null) return `${fmt(min)}+${unit}`;
  if (max !== null) return `up to ${fmt(max)}${unit}`;
  return null;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** The editable chips the DJ sees for the filters a crate ran with. */
export function filterChips(filters: CrateFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.bpm) {
    const label = formatRange(filters.bpm, " BPM");
    if (label) chips.push({ key: "bpm", label });
  }
  for (const key of filters.keys) {
    chips.push({ key: `key:${key}`, label: `Key ${key}` });
  }
  if (filters.keys.length > 0 && filters.includeCamelotNeighbors) {
    chips.push({ key: "neighbors", label: "Neighboring keys included" });
  }
  if (filters.energy) {
    const label = formatRange(
      {
        min: filters.energy.min === null ? null : filters.energy.min * 100,
        max: filters.energy.max === null ? null : filters.energy.max * 100,
      },
      "%",
    );
    if (label) chips.push({ key: "energy", label: `Energy ${label}` });
  }
  for (const stem of filters.requiredStems) {
    chips.push({ key: `stem:${stem}`, label: `Has ${stem} stem` });
  }
  if (filters.licenseType) {
    chips.push({ key: "licenseType", label: `${titleCase(filters.licenseType)} license` });
  }
  if (filters.maxPerItemUsd !== null) {
    chips.push({ key: "maxPerItemUsd", label: `Up to ${formatUsd(filters.maxPerItemUsd)} per line` });
  }
  if (filters.maxTotalUsd !== null) {
    chips.push({ key: "maxTotalUsd", label: `Up to ${formatUsd(filters.maxTotalUsd)} total` });
  }
  if (filters.verifiedHumanOnly) {
    chips.push({ key: "verifiedHumanOnly", label: "Verified human artists only" });
  }
  if (filters.allowFullyAi) {
    chips.push({ key: "allowFullyAi", label: "Fully AI-generated tracks allowed" });
  }
  for (const genre of filters.genres) {
    chips.push({ key: `genre:${genre}`, label: titleCase(genre) });
  }
  for (const mood of filters.moods) {
    chips.push({ key: `mood:${mood}`, label: `${titleCase(mood)} mood` });
  }
  return chips;
}

/** The filters with one chip removed. Unknown keys return the filters unchanged. */
export function removeChip(filters: CrateFilters, chipKey: string): CrateFilters {
  if (chipKey === "bpm") return { ...filters, bpm: null };
  if (chipKey === "energy") return { ...filters, energy: null };
  if (chipKey === "licenseType") return { ...filters, licenseType: null };
  if (chipKey === "maxPerItemUsd") return { ...filters, maxPerItemUsd: null };
  if (chipKey === "maxTotalUsd") return { ...filters, maxTotalUsd: null };
  if (chipKey === "verifiedHumanOnly") return { ...filters, verifiedHumanOnly: false };
  if (chipKey === "allowFullyAi") return { ...filters, allowFullyAi: false };
  if (chipKey === "neighbors") return { ...filters, includeCamelotNeighbors: false };
  if (chipKey.startsWith("key:")) {
    const code = chipKey.slice(4);
    const keys = filters.keys.filter((key) => key !== code);
    return {
      ...filters,
      keys,
      includeCamelotNeighbors: keys.length === 0 ? false : filters.includeCamelotNeighbors,
    };
  }
  if (chipKey.startsWith("stem:")) {
    const stem = chipKey.slice(5);
    return { ...filters, requiredStems: filters.requiredStems.filter((s) => s !== stem) };
  }
  if (chipKey.startsWith("genre:")) {
    const genre = chipKey.slice(6);
    return { ...filters, genres: filters.genres.filter((g) => g !== genre) };
  }
  if (chipKey.startsWith("mood:")) {
    const mood = chipKey.slice(5);
    return { ...filters, moods: filters.moods.filter((m) => m !== mood) };
  }
  return filters;
}

/** The filters with the BPM range replaced; a fully open range clears the filter. */
export function withBpmRange(
  filters: CrateFilters,
  min: number | null,
  max: number | null,
): CrateFilters {
  if (min === null && max === null) return { ...filters, bpm: null };
  return { ...filters, bpm: { min, max } };
}

export function clampCount(value: number): number {
  if (!Number.isFinite(value)) return CRATE_DEFAULT_COUNT;
  return Math.min(CRATE_MAX_COUNT, Math.max(CRATE_MIN_COUNT, Math.round(value)));
}

export function filtersEqual(a: CrateFilters, b: CrateFilters): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ------------------------------------------------------------------ */
/* Line editing                                                        */
/* ------------------------------------------------------------------ */

function renumber(items: CrateItemDto[]): CrateItemDto[] {
  return items.map((item, position) => (item.position === position ? item : { ...item, position }));
}

/**
 * Move the line at `from` towards `to`. A locked line never moves and locked
 * lines never leave their positions: the moved line lands on the nearest free
 * (unlocked) slot at or beyond `to` in the direction of travel, and the
 * unlocked lines in between shift around the locked ones. Returns the same
 * array reference when nothing can move.
 */
export function moveLine(items: CrateItemDto[], from: number, to: number): CrateItemDto[] {
  if (from === to) return items;
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return items;
  if (items[from].locked) return items;

  const free: number[] = [];
  items.forEach((item, index) => {
    if (!item.locked) free.push(index);
  });

  let target: number | undefined;
  if (to > from) {
    target = free.find((index) => index >= to);
  } else {
    for (let i = free.length - 1; i >= 0; i -= 1) {
      if (free[i] <= to) {
        target = free[i];
        break;
      }
    }
  }
  if (target === undefined || target === from) return items;

  const order = free.map((index) => items[index]);
  const fromRank = free.indexOf(from);
  const toRank = free.indexOf(target);
  const [moved] = order.splice(fromRank, 1);
  order.splice(toRank, 0, moved);

  const next = items.slice();
  free.forEach((slot, rank) => {
    next[slot] = order[rank];
  });
  return renumber(next);
}

/** Whether the line at `index` can move one step up (-1) or down (+1). */
export function canMoveLine(items: CrateItemDto[], index: number, delta: -1 | 1): boolean {
  return moveLine(items, index, index + delta) !== items;
}

export function toggleLock(items: CrateItemDto[], trackId: string): CrateItemDto[] {
  return items.map((item) => (item.trackId === trackId ? { ...item, locked: !item.locked } : item));
}

export function removeLine(items: CrateItemDto[], trackId: string): CrateItemDto[] {
  return renumber(items.filter((item) => item.trackId !== trackId));
}

/** The `items` body for `PATCH /crates/:id`: the full new order with lock state. */
export function patchItemsPayload(
  items: CrateItemDto[],
): Array<{ trackId: string; locked: boolean }> {
  return items.map((item) => ({ trackId: item.trackId, locked: item.locked }));
}

/** True when the order, lock state or membership differs from the saved crate. */
export function itemsChanged(saved: CrateItemDto[], draft: CrateItemDto[]): boolean {
  if (saved.length !== draft.length) return true;
  return saved.some(
    (item, index) => item.trackId !== draft[index].trackId || item.locked !== draft[index].locked,
  );
}

/* ------------------------------------------------------------------ */
/* Transition facts for the order on screen                            */
/* ------------------------------------------------------------------ */

const CAMELOT_PATTERN = /^(0?[1-9]|1[0-2])\s*([ab])$/i;

function parseCamelot(code: string | null): { number: number; letter: "A" | "B" } | null {
  if (code === null) return null;
  const match = CAMELOT_PATTERN.exec(code.trim());
  if (!match) return null;
  return { number: Number(match[1]), letter: match[2].toUpperCase() === "A" ? "A" : "B" };
}

function wheelWrap(position: number): number {
  return ((((position - 1) % 12) + 12) % 12) + 1;
}

/**
 * Client mirror of the backend's harmonic relation (`crate_camelot.ts`):
 * the same code is `same`; the other ring at the same number and the adjacent
 * numbers on the same ring are `neighbor`; anything else `clash`.
 */
export function harmonicRelation(a: string | null, b: string | null): CrateHarmonicRelation {
  const left = parseCamelot(a);
  const right = parseCamelot(b);
  if (!left || !right) return "unknown";
  if (left.number === right.number && left.letter === right.letter) return "same";
  if (left.number === right.number) return "neighbor";
  if (
    left.letter === right.letter &&
    (wheelWrap(left.number - 1) === right.number || wheelWrap(left.number + 1) === right.number)
  ) {
    return "neighbor";
  }
  return "clash";
}

type TransitionSide = Pick<CrateItemDto, "camelot" | "tempoBpm" | "energy">;

function finiteOrNull(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * What changes going from line `a` to line `b`, derived from the order on
 * screen so a reorder never leaves a stale server value behind.
 */
export function transitionFacts(a: TransitionSide, b: TransitionSide): CrateTransitionFacts {
  const tempoA = finiteOrNull(a.tempoBpm);
  const tempoB = finiteOrNull(b.tempoBpm);
  const energyA = finiteOrNull(a.energy);
  const energyB = finiteOrNull(b.energy);
  return {
    harmonic: harmonicRelation(a.camelot, b.camelot),
    bpmDelta: tempoA === null || tempoB === null ? null : Math.round((tempoB - tempoA) * 10) / 10,
    energyDelta:
      energyA === null || energyB === null ? null : Math.round((energyB - energyA) * 1000) / 1000,
  };
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

const GAP_LABELS: Record<CrateFilterKey, string> = {
  bpm: "BPM range",
  keys: "Key match",
  energy: "Energy range",
  requiredStems: "Required stems",
  licenseType: "License type",
  maxPerItemUsd: "Per-line price cap",
  maxTotalUsd: "Total budget",
  verifiedHumanOnly: "Verified-human filter",
  genres: "Genre",
  moods: "Mood",
};

export type CoverageSummary = {
  headline: string;
  complete: boolean;
  gaps: string[];
};

/** "3 of 8 found" plus one plain-language phrase per filter that held lines back. */
export function coverageSummary(coverage: CrateCoverage): CoverageSummary {
  const complete = coverage.found >= coverage.requested;
  const gaps = complete
    ? []
    : coverage.gaps
        .filter((gap) => gap.wouldAdd > 0)
        .map((gap) => `${GAP_LABELS[gap.filter] ?? gap.filter} held back ${gap.wouldAdd}`);
  return {
    headline: `${coverage.found} of ${coverage.requested} found`,
    complete,
    gaps,
  };
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

export function formatBpm(bpm: number | null): string {
  return bpm === null ? "BPM unknown" : `${Math.round(bpm * 10) / 10} BPM`;
}

export function formatEnergy(energy: number | null): string {
  return energy === null ? "Energy unknown" : `Energy ${Math.round(energy * 100)}%`;
}

/** Stem quality is a 0-100 score (rounded mean of curator ratings). */
export function formatStemQuality(score: number | null): string | null {
  if (score === null || !Number.isFinite(score)) return null;
  return `${Math.round(Math.min(100, Math.max(0, score)))}/100`;
}

export const NO_STANDARD_TERMS_TEXT = "No standard terms yet — check the listing before buying";
export const INDICATIVE_PRICE_TEXT = "Price is indicative; the quote sets the final price";

const HARMONIC_TEXT: Record<CrateHarmonicRelation, string> = {
  same: "Same key",
  neighbor: "Neighboring key",
  clash: "Keys clash",
  unknown: "Key unknown",
};

function signed(value: number, digits: number, unit: string): string {
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${rounded}${unit}`;
}

/** A short phrase for what changes into the next line. */
export function describeTransition(facts: CrateTransitionFacts): string {
  const parts = [HARMONIC_TEXT[facts.harmonic] ?? HARMONIC_TEXT.unknown];
  if (facts.bpmDelta !== null) parts.push(`${signed(facts.bpmDelta, 1, " BPM")}`);
  if (facts.energyDelta !== null) parts.push(`energy ${signed(facts.energyDelta * 100, 0, "%")}`);
  return parts.join(", ");
}

/* ------------------------------------------------------------------ */
/* Creation handoff (coverage is only returned when a crate is built)  */
/* ------------------------------------------------------------------ */

export type CrateCreationNotes = {
  coverage: CrateCoverage;
  unparsed: string[];
  parserStrategy: "deterministic" | "model-assisted";
};

const CREATION_KEY_PREFIX = "resonate.crate.creation.";

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): SessionStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Remember what the response said so the crate page can show it once. */
export function storeCrateCreationNotes(
  crateId: string,
  response: Pick<CreateCrateResponse, "coverage" | "request">,
  store: SessionStore | null = sessionStore(),
): void {
  if (!store) return;
  const notes: CrateCreationNotes = {
    coverage: response.coverage,
    unparsed: response.request.unparsed,
    parserStrategy: response.request.parserStrategy,
  };
  try {
    store.setItem(`${CREATION_KEY_PREFIX}${crateId}`, JSON.stringify(notes));
  } catch {
    // Storage full or blocked: the banner is a nicety, never required.
  }
}

export function readCrateCreationNotes(
  crateId: string,
  store: SessionStore | null = sessionStore(),
): CrateCreationNotes | null {
  if (!store) return null;
  try {
    const raw = store.getItem(`${CREATION_KEY_PREFIX}${crateId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CrateCreationNotes;
    if (!parsed || typeof parsed !== "object" || !parsed.coverage) return null;
    return {
      coverage: parsed.coverage,
      unparsed: Array.isArray(parsed.unparsed) ? parsed.unparsed : [],
      parserStrategy: parsed.parserStrategy === "model-assisted" ? "model-assisted" : "deterministic",
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Export to rekordbox or Serato (#1965)                               */
/* ------------------------------------------------------------------ */

export type CrateExportFormat = "rekordbox" | "serato";
export type CrateExportSkipReason = "not_purchased" | "no_export_right";

/** One stem the DJ owns under a standard license; mirrors `crate_export.dto.ts`. */
export type CrateExportEntry = {
  position: number;
  trackId: string;
  stemId: string;
  stemType: string;
  title: string;
  artistName: string;
  licenseType: "personal" | "remix" | "commercial";
  /** The name to save the downloaded stem under; the export files point at it. */
  fileName: string;
  bpm: number | null;
  key: string | null;
  camelot: string | null;
  firstBeatSec: number | null;
  hasCue: boolean;
};

export type CrateExportSkipped = {
  position: number;
  trackId: string;
  title: string;
  reason: CrateExportSkipReason;
};

export type CrateExportManifest = {
  entries: CrateExportEntry[];
  skipped: CrateExportSkipped[];
  notes: string[];
};

/* ------------------------------------------------------------------ */
/* API errors                                                          */
/* ------------------------------------------------------------------ */

type ErrorLike = { message?: unknown; status?: unknown; details?: unknown };

/** The backend's own `code` (`invalid_items`, `pro_required`, `line_locked`...) when present. */
export function crateErrorCode(error: unknown): string | null {
  const details = (error as ErrorLike | null)?.details;
  if (details && typeof details === "object" && "code" in details) {
    const code = (details as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

/** A person-readable message for a failed crate call. */
export function crateErrorMessage(error: unknown, fallback: string): string {
  const code = crateErrorCode(error);
  if (code === "pro_required") return "This needs Crate Digger Pro.";
  if (code === "line_locked") return "That line is locked. Unlock it to swap it.";
  if (code === "crate_not_saved") return "Save the crate to watch it.";
  if (code === "line_exists") return "Already in that crate.";
  if (code === "crate_full") return "That crate is full. Remove a line to make room.";
  if (code === "track_not_found") return "That track is no longer available.";
  if (code === "invalid_watch_expiry") return "Pick a watch length between 1 and 365 days.";
  const details = (error as ErrorLike | null)?.details;
  if (details && typeof details === "object" && "message" in details) {
    const message = (details as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    if (Array.isArray(message) && message.length > 0) return message.join(", ");
  }
  return fallback;
}

export function crateErrorStatus(error: unknown): number | null {
  const status = (error as ErrorLike | null)?.status;
  return typeof status === "number" ? status : null;
}
