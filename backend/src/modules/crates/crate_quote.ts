import {
  CRATE_LICENSE_TYPES,
  type CrateLicenseType,
  type CrateStemType,
} from "./crate.types";
import type { MarketplaceListing, MarketplaceSoldLog } from "./crate_marketplace_reader";

/**
 * Pure rules of the crate quote (#1964, docs/rfc/taste-engine.md §5.4).
 *
 * No database, no chain, no clock of its own: the service loads the facts and
 * these functions decide. Money stays in bigint payment-token units; USD only
 * ever comes from `decoratePaymentAmount` (passed in as {@link DecorateUnits})
 * and is only added and compared here, never converted.
 *
 * Business model: ADR-BM-6 Line 3 (marketplace take-rate, 10%), phase 2. The
 * fee, royalty and seller split come from the contract's `quoteBuy`; nothing
 * here computes or changes them.
 */

/** How long a quote stays open (the offer the DJ approves). */
export const CRATE_QUOTE_TTL_MS = 10 * 60 * 1000;

/** Most crate lines one quote covers, and most stem types asked per line. */
export const CRATE_QUOTE_MAX_LINES = 25;
export const CRATE_QUOTE_MAX_STEM_TYPES = 6;

/** Units of every stem bought; one per stem today. */
export const CRATE_QUOTE_UNITS_PER_STEM = 1n;

export const CRATE_QUOTE_STATUSES = ["open", "submitted", "settled", "partial", "failed"] as const;
export type CrateQuoteStatus = (typeof CRATE_QUOTE_STATUSES)[number];

export const CRATE_QUOTE_LINE_STATUSES = ["quoted", "dropped", "settled", "failed"] as const;
export type CrateQuoteLineStatus = (typeof CRATE_QUOTE_LINE_STATUSES)[number];

/** Why the quote itself left a stem out (fixed codes; never free text). */
export const CRATE_QUOTE_DROP_REASONS = [
  "not_listed",
  "sold_out",
  "expired",
  "own_listing",
  "unverifiable",
  "token_not_supported",
] as const;
export type CrateQuoteDropReason = (typeof CRATE_QUOTE_DROP_REASONS)[number];

/** Why the DJ's browser left a quoted stem out of the transaction it sent. */
export const CRATE_QUOTE_SETTLE_DROP_REASONS = [
  "simulation_failed",
  "insufficient_balance",
  "listing_changed",
  "deselected",
] as const;
export type CrateQuoteSettleDropReason = (typeof CRATE_QUOTE_SETTLE_DROP_REASONS)[number];

/** Why a quoted stem did not settle. */
export const CRATE_QUOTE_FAIL_REASONS = ["transaction_reverted", "not_in_transaction"] as const;
export type CrateQuoteFailReason = (typeof CRATE_QUOTE_FAIL_REASONS)[number];

/** The tier a line falls back to when the track has no active listing at all. */
export const CRATE_QUOTE_FALLBACK_TIER: CrateLicenseType = "personal";

const TIER_ORDER = new Map<string, number>(CRATE_LICENSE_TYPES.map((tier, index) => [tier, index]));

function tierRank(tier: string): number {
  return TIER_ORDER.get(tier) ?? CRATE_LICENSE_TYPES.length;
}

// ---------------------------------------------------------------------------
// Listing candidates
// ---------------------------------------------------------------------------

/** A database listing as the quote sees it. */
export type QuoteListingCandidate = {
  /** `StemListing.id`. */
  id: string;
  licenseType: string;
  /** `pricePerUnit` as stored (raw units; may use a stale payment token). */
  pricePerUnitUnits: bigint;
  /** Canonical USD of one unit from the stored listing, or null when unknown. */
  canonicalUsd: string | null;
  listedAt: Date;
};

/**
 * Orders candidates cheapest first: known USD before unknown, lower USD first,
 * then (when USD is unknown) lower raw units, then newest listing, then id so
 * the order is total and deterministic.
 */
export function compareListingCandidates(
  a: QuoteListingCandidate,
  b: QuoteListingCandidate,
): number {
  const aUsd = a.canonicalUsd === null ? null : usdToScaled(a.canonicalUsd);
  const bUsd = b.canonicalUsd === null ? null : usdToScaled(b.canonicalUsd);
  if (aUsd !== null && bUsd !== null) {
    if (aUsd !== bUsd) return aUsd < bUsd ? -1 : 1;
  } else if (aUsd !== null) {
    return -1;
  } else if (bUsd !== null) {
    return 1;
  } else if (a.pricePerUnitUnits !== b.pricePerUnitUnits) {
    return a.pricePerUnitUnits < b.pricePerUnitUnits ? -1 : 1;
  }
  const newest = b.listedAt.getTime() - a.listedAt.getTime();
  if (newest !== 0) return newest;
  return a.id.localeCompare(b.id);
}

/** The listing to quote for one stem at one tier: the cheapest, newest on a tie. */
export function pickListing<T extends QuoteListingCandidate>(candidates: readonly T[]): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (best === null || compareListingCandidates(candidate, best) < 0) best = candidate;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Default tier and stems
// ---------------------------------------------------------------------------

/**
 * The tier of one line: the DJ's per-line choice, else the crate's license
 * filter, else the cheapest tier the track lists (compared by the canonical USD
 * of its cheapest listing; ties in {@link CRATE_LICENSE_TYPES} order). A track
 * with no active listing at all falls back to {@link CRATE_QUOTE_FALLBACK_TIER}
 * so its stems can still be reported as not listed.
 */
export function chooseQuoteTier(input: {
  lineLicenseType?: CrateLicenseType | null;
  filterLicenseType?: CrateLicenseType | null;
  listings: readonly QuoteListingCandidate[];
}): CrateLicenseType {
  if (input.lineLicenseType) return input.lineLicenseType;
  if (input.filterLicenseType) return input.filterLicenseType;

  let bestTier: CrateLicenseType | null = null;
  let bestListing: QuoteListingCandidate | null = null;
  for (const tier of CRATE_LICENSE_TYPES) {
    const cheapest = pickListing(input.listings.filter((listing) => listing.licenseType === tier));
    if (cheapest === null) continue;
    if (bestListing === null || compareCheapestAcrossTiers(cheapest, bestListing) < 0) {
      bestTier = tier;
      bestListing = cheapest;
    }
  }
  return bestTier ?? CRATE_QUOTE_FALLBACK_TIER;
}

/** Price order across tiers: ignores recency, so a tie keeps the earlier tier. */
function compareCheapestAcrossTiers(a: QuoteListingCandidate, b: QuoteListingCandidate): number {
  const aUsd = a.canonicalUsd === null ? null : usdToScaled(a.canonicalUsd);
  const bUsd = b.canonicalUsd === null ? null : usdToScaled(b.canonicalUsd);
  if (aUsd !== null && bUsd !== null) return aUsd === bUsd ? 0 : aUsd < bUsd ? -1 : 1;
  if (aUsd !== null) return -1;
  if (bUsd !== null) return 1;
  if (a.pricePerUnitUnits === b.pricePerUnitUnits) return 0;
  return a.pricePerUnitUnits < b.pricePerUnitUnits ? -1 : 1;
}

/**
 * The stem types to quote for one line: the DJ's per-line choice, else the
 * crate's required stems when it has any, else every stem type of the track
 * that has an active listing at the tier. When none is listed at the tier, every
 * stem type of the track, so the DJ sees the line with each stem reported as
 * not listed instead of the line vanishing. Sorted and de-duplicated.
 */
export function chooseQuoteStemTypes(input: {
  lineStemTypes?: readonly CrateStemType[] | null;
  filterRequiredStems: readonly CrateStemType[];
  /** Stem types of the track with an active listing at the chosen tier. */
  listedAtTier: readonly string[];
  /** Every current stem type of the track (never original or master). */
  trackStemTypes: readonly string[];
}): string[] {
  const chosen =
    input.lineStemTypes && input.lineStemTypes.length > 0
      ? input.lineStemTypes
      : input.filterRequiredStems.length > 0
        ? input.filterRequiredStems
        : input.listedAtTier.length > 0
          ? input.listedAtTier
          : input.trackStemTypes;
  return [...new Set(chosen.map((type) => type.toLowerCase()))].sort();
}

// ---------------------------------------------------------------------------
// Drop classification
// ---------------------------------------------------------------------------

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Why an on-chain listing cannot be bought, or null when it can. A cancelled or
 * fully sold listing is deleted by the contract (seller zero); the contract
 * accepts a buy while `now <= expiry`; it refuses the seller buying their own.
 */
export function classifyChainListing(input: {
  listing: Pick<MarketplaceListing, "seller" | "amount" | "expiry">;
  buyerAddress: string;
  nowSeconds: number;
  units?: bigint;
}): CrateQuoteDropReason | null {
  const { listing } = input;
  const units = input.units ?? CRATE_QUOTE_UNITS_PER_STEM;
  if (listing.seller.toLowerCase() === ZERO_ADDRESS || listing.amount < units) return "sold_out";
  if (input.nowSeconds > listing.expiry) return "expired";
  if (listing.seller.toLowerCase() === input.buyerAddress.toLowerCase()) return "own_listing";
  return null;
}

// ---------------------------------------------------------------------------
// USD arithmetic (display only)
// ---------------------------------------------------------------------------

/** Decimal places USD strings are compared and added with. */
const USD_SCALE = 12;

/** A canonical USD decimal string as an integer count of 10^-12 dollars. */
export function usdToScaled(usd: string): bigint {
  const trimmed = usd.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) throw new Error("Invalid USD amount");
  const scaledFraction = fraction.padEnd(USD_SCALE, "0").slice(0, USD_SCALE);
  const value = BigInt(whole || "0") * 10n ** BigInt(USD_SCALE) + BigInt(scaledFraction || "0");
  return negative ? -value : value;
}

/** Inverse of {@link usdToScaled}, without trailing zeros. */
export function scaledToUsd(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const base = 10n ** BigInt(USD_SCALE);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(USD_SCALE, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Sum of USD strings; null as soon as one amount is unknown. */
export function sumUsd(amounts: ReadonlyArray<string | null>): string | null {
  let total = 0n;
  for (const amount of amounts) {
    if (amount === null) return null;
    total += usdToScaled(amount);
  }
  return scaledToUsd(total);
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

/** Formats raw units of a payment token and prices them in USD (may be null). */
export type DecorateUnits = (
  paymentToken: string,
  units: string,
) => { symbol: string; decimals: number; total: string; totalUsd: string | null };

export type QuoteTotal = {
  paymentToken: string;
  symbol: string;
  decimals: number;
  totalUnits: string;
  total: string;
  totalUsd: string | null;
};

export type QuoteTotals = {
  totals: QuoteTotal[];
  /** Sum over every token, or null when any token's USD value is unknown. */
  totalUsd: string | null;
  /** The crate's `maxTotalUsd`, as the DJ set it. */
  budgetUsd: number | null;
  /** True only when both sides are known and the total exceeds the budget. */
  overBudget: boolean;
};

/**
 * Totals per payment token (each priced from its own summed units) and overall
 * in USD, against the crate's budget. Tokens are ordered by address so the
 * response is stable.
 */
export function aggregateQuoteTotals(
  items: ReadonlyArray<{ paymentToken: string; totalUnits: bigint }>,
  budgetUsd: number | null,
  decorate: DecorateUnits,
): QuoteTotals {
  const unitsByToken = new Map<string, bigint>();
  for (const item of items) {
    unitsByToken.set(item.paymentToken, (unitsByToken.get(item.paymentToken) ?? 0n) + item.totalUnits);
  }
  const totals: QuoteTotal[] = [...unitsByToken.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([paymentToken, units]) => {
      const decorated = decorate(paymentToken, units.toString());
      return {
        paymentToken,
        symbol: decorated.symbol,
        decimals: decorated.decimals,
        totalUnits: units.toString(),
        total: decorated.total,
        totalUsd: decorated.totalUsd,
      };
    });

  const totalUsd = totals.length === 0 ? "0" : sumUsd(totals.map((total) => total.totalUsd));
  const budget = budgetUsd === null || !Number.isFinite(budgetUsd) ? null : budgetUsd.toFixed(USD_SCALE);
  return {
    totals,
    totalUsd,
    budgetUsd: budget === null ? null : budgetUsd,
    overBudget: totalUsd !== null && budget !== null && usdToScaled(totalUsd) > usdToScaled(budget),
  };
}

// ---------------------------------------------------------------------------
// Settlement receipts
// ---------------------------------------------------------------------------

export type ReceiptLine = {
  id: string;
  listingId: bigint;
  amount: bigint;
};

export type ReceiptMatch = {
  lineId: string;
  log: MarketplaceSoldLog;
};

/**
 * Matches quoted lines to the buyer's `Sold` logs. Logs for any other buyer are
 * ignored (a batch from someone else's account is not this DJ's purchase).
 * Lines are taken in the order given, each takes the first unused log with its
 * listing id and amount, and a log is never used twice: two lines for one
 * listing and one log settle one line and leave the other unmatched.
 */
export function matchReceipts(
  lines: readonly ReceiptLine[],
  logs: readonly MarketplaceSoldLog[],
  buyerAddress: string,
): { matched: ReceiptMatch[]; unmatched: string[] } {
  const buyer = buyerAddress.toLowerCase();
  const available = logs
    .filter((log) => log.buyer.toLowerCase() === buyer)
    .slice()
    .sort((a, b) => a.logIndex - b.logIndex);
  const used = new Set<number>();

  const matched: ReceiptMatch[] = [];
  const unmatched: string[] = [];
  for (const line of lines) {
    const index = available.findIndex(
      (log, position) =>
        !used.has(position) && log.listingId === line.listingId && log.amount === line.amount,
    );
    if (index === -1) {
      unmatched.push(line.id);
      continue;
    }
    used.add(index);
    matched.push({ lineId: line.id, log: available[index] });
  }
  return { matched, unmatched };
}

/**
 * The quote's status once its transaction is mined: "settled" when every
 * quoted line settled, "partial" when some did, "failed" when none did (or
 * nothing was left to buy).
 */
export function settlementStatus(
  settledLines: number,
  quotedLines: number,
): Extract<CrateQuoteStatus, "settled" | "partial" | "failed"> {
  if (quotedLines > 0 && settledLines === quotedLines) return "settled";
  if (settledLines > 0) return "partial";
  return "failed";
}

/** Whether a string is a 32-byte transaction hash. */
export function isTransactionHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}
