/**
 * Crate quote client helpers (#1964, docs/rfc/taste-engine.md section 5.4).
 *
 * Pure: no network, no wallet, no React. Money stays in bigint payment-token
 * units; USD only ever arrives as a decimal string from the backend and is
 * formatted here, never converted. Every user-facing string is plain and short.
 *
 * Business model: ADR-BM-6 Line 3 (marketplace take-rate), phase 2. Nothing
 * here computes or changes a fee; the split shown comes from the quote.
 */

import type { Address } from "viem";
import {
  CRATE_LICENSE_TYPES,
  CRATE_QUOTE_SETTLE_DROP_REASONS,
  CRATE_STEM_TYPES,
  crateErrorCode,
  crateErrorMessage,
  crateErrorStatus,
  formatUsd,
  type CrateItemDto,
  type CrateLicenseType,
  type CrateQuote,
  type CrateQuoteItem,
  type CrateQuoteLine,
  type CrateQuoteLineRequest,
  type CrateQuoteSettleDropReason,
  type CrateStemType,
} from "./crates";
import { formatListingPrice } from "./listingPricing";
import type { CrateBatchLine } from "./onchainCheckout";
import type { PaymentAsset } from "./payments";

/** A quote buys one unit of each stem (mirrors the backend). */
export const CRATE_QUOTE_UNITS_PER_STEM = 1n;

/** Settle retries while the transaction has no receipt: 2s, 4s, 8s, 16s. */
export const CRATE_SETTLE_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000] as const;

/* ------------------------------------------------------------------ */
/* Plain-language reasons                                              */
/* ------------------------------------------------------------------ */

const QUOTE_DROP_TEXT: Record<string, string> = {
  not_listed: "Not for sale at this license",
  sold_out: "Sold out",
  expired: "The listing has expired",
  own_listing: "This is your own listing",
  unverifiable: "Could not be checked right now",
  token_not_supported: "Paid in a currency we do not support yet",
};

const SETTLE_DROP_TEXT: Record<string, string> = {
  simulation_failed: "Left out: it would have failed",
  insufficient_balance: "Left out: not enough balance",
  listing_changed: "Left out: the listing changed",
  deselected: "Left out: you chose not to buy it",
};

const FAIL_TEXT: Record<string, string> = {
  transaction_reverted: "The purchase did not go through",
  transaction_before_quote: "The transaction was sent before this quote",
  not_in_transaction: "Not part of the purchase",
};

/** Why a stem is not (or was not) bought, from any of the backend's reason codes. */
export function crateReasonText(reason: string | null | undefined): string {
  if (!reason) return "Not available";
  return QUOTE_DROP_TEXT[reason] ?? SETTLE_DROP_TEXT[reason] ?? FAIL_TEXT[reason] ?? "Not available";
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export const WALLET_CHANGED_TEXT = "Your wallet changed. Sign in again, then get a new quote.";

const QUOTE_ERROR_TEXT: Record<string, string> = {
  no_wallet: "You need a wallet to buy. Sign in again to set one up.",
  wallet_mismatch: WALLET_CHANGED_TEXT,
  marketplace_unavailable: "The marketplace is not available right now. Please try again soon.",
  transaction_already_used: "That transaction was already used for another quote.",
  already_submitted: "This quote was already used for a different transaction. Get a new quote.",
  invalid_lines: "Those lines cannot be quoted. Get a new quote.",
  invalid_buyer_address: WALLET_CHANGED_TEXT,
  invalid_dropped: "Some lines could not be matched to this quote. Get a new quote.",
  invalid_transaction_hash: "The transaction could not be read. Please try again.",
};

export const RATE_LIMIT_TEXT =
  "You are doing that a bit too quickly. Please wait a moment and try again.";

/** A plain message for a failed quote or settle call. */
export function crateQuoteErrorMessage(error: unknown, fallback: string): string {
  const code = crateErrorCode(error);
  if (code && QUOTE_ERROR_TEXT[code]) return QUOTE_ERROR_TEXT[code];
  if (crateErrorStatus(error) === 429) return RATE_LIMIT_TEXT;
  return crateErrorMessage(error, fallback);
}

/**
 * Whether a failed settle call is worth retrying: the chain could not be read
 * (503), the server hiccuped (5xx), the call was rate limited (429), or there
 * was no answer at all. Conflicts and bad requests never get better.
 */
export function isRetryableSettleError(error: unknown): boolean {
  const status = crateErrorStatus(error);
  if (status === null) return true;
  return status === 429 || status >= 500;
}

/**
 * Whether a wallet failure is the DJ backing out (a cancelled passkey prompt or
 * a refused signature), as opposed to the bundler or the network failing.
 */
export function isWalletCancellation(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "NotAllowedError" || name === "AbortError") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /not allowed|cancel|reject|denied|declined|user closed|aborted/i.test(message);
}

export const NOTHING_CHARGED_TEXT = "Nothing was charged. Your quote is still open.";

/**
 * What to tell the DJ when sending the batch failed. A cancelled prompt is a
 * clean "nothing was charged". Any other failure may have happened after the
 * network accepted the purchase (for example a timeout while waiting for the
 * receipt), so it does not promise that.
 */
export function purchaseFailureMessage(error: unknown): string {
  if (isWalletCancellation(error)) return `You cancelled. ${NOTHING_CHARGED_TEXT}`;
  return "We could not finish your purchase. Your quote is still open and nothing is recorded as bought. If your wallet shows a charge, check your wallet activity before buying again.";
}

/* ------------------------------------------------------------------ */
/* Money display                                                       */
/* ------------------------------------------------------------------ */

/** Formats raw token units with the token's own symbol and decimals. */
export function formatTokenUnits(units: bigint, symbol: string, decimals: number): string {
  // formatListingPrice only reads the symbol and decimals of the asset.
  return formatListingPrice({
    priceUnits: units,
    asset: { symbol, decimals } as PaymentAsset,
  });
}

/** Parses a non-negative integer string (the backend's units) into a bigint, or null. */
export function parseUnits(value: string | null | undefined): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

/**
 * A canonical USD decimal string as dollars and cents, rounded half up, using
 * integer math only. Anything above zero but below a cent reads "under $0.01".
 */
export function formatUsdDecimal(usd: string | null | undefined): string {
  if (typeof usd !== "string" || !/^\d+(\.\d+)?$/.test(usd.trim())) return "price unknown";
  const [whole, fraction = ""] = usd.trim().split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
  if (micros === 0n) return "$0.00";
  if (micros < 10_000n) return "under $0.01";
  const cents = (micros + 5_000n) / 10_000n;
  const dollars = cents / 100n;
  const remainder = (cents % 100n).toString().padStart(2, "0");
  return `$${dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${remainder}`;
}

/** "Over your $20.00 budget" for an over-budget quote, else null. */
export function overBudgetText(quote: Pick<CrateQuote, "overBudget" | "budgetUsd">): string | null {
  if (!quote.overBudget || quote.budgetUsd === null) return null;
  return `Over your ${formatUsd(quote.budgetUsd)} budget`;
}

/* ------------------------------------------------------------------ */
/* Expiry                                                              */
/* ------------------------------------------------------------------ */

export function quoteExpiresAtMs(quote: Pick<CrateQuote, "expiresAt">): number {
  const ms = Date.parse(quote.expiresAt);
  return Number.isFinite(ms) ? ms : 0;
}

/** An unreadable expiry counts as expired: a quote is only good while we can tell. */
export function isQuoteExpired(quote: Pick<CrateQuote, "expiresAt">, nowMs: number): boolean {
  return quoteExpiresAtMs(quote) <= nowMs;
}

/** "9:41" until the quote expires; "Expired" at or after the expiry. */
export function formatCountdown(quote: Pick<CrateQuote, "expiresAt">, nowMs: number): string {
  const remaining = quoteExpiresAtMs(quote) - nowMs;
  if (remaining <= 0) return "Expired";
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/* ------------------------------------------------------------------ */
/* Buyer account                                                       */
/* ------------------------------------------------------------------ */

/**
 * The account the page signs with: the kernel account when it is loaded, else
 * the stored smart account, else the sign-in address. The same order every
 * other purchase flow uses, so the quote is priced for the buyer who signs.
 */
export function resolveBuyerAddress(input: {
  kernelAddress?: string | null;
  smartAccountAddress?: string | null;
  address?: string | null;
}): string | null {
  const candidate = input.kernelAddress || input.smartAccountAddress || input.address || null;
  return candidate && /^0x[0-9a-fA-F]{40}$/.test(candidate) ? candidate : null;
}

/* ------------------------------------------------------------------ */
/* Reading a quote                                                     */
/* ------------------------------------------------------------------ */

export function isQuotedItem(item: CrateQuoteItem): boolean {
  return item.status === "quoted";
}

export type QuotedStem = {
  line: CrateQuoteLine;
  item: CrateQuoteItem;
};

/** Every stem still on offer, in quote order (crate position, then stem). */
export function quotedStems(quote: CrateQuote): QuotedStem[] {
  const stems: QuotedStem[] = [];
  for (const line of quote.lines) {
    for (const item of line.items) {
      if (isQuotedItem(item)) stems.push({ line, item });
    }
  }
  return stems;
}

export class IncompleteQuoteError extends Error {
  constructor(quoteLineId: string) {
    super(`Quote line ${quoteLineId} is missing its listing or price`);
    this.name = "IncompleteQuoteError";
  }
}

/**
 * The quote's buyable stems as batch lines, in quote order. A quoted stem
 * without a listing, a payment token or a price cannot be bought safely, so
 * the whole quote is refused instead of buying part of it silently.
 */
export function quoteBatchLines(quote: CrateQuote): CrateBatchLine[] {
  return quotedStems(quote).map(({ item }) => {
    const listingId = parseUnits(item.listingId);
    const totalUnits = parseUnits(item.totalUnits);
    if (
      listingId === null
      || totalUnits === null
      || totalUnits <= 0n
      || !item.paymentToken
      || !/^0x[0-9a-fA-F]{40}$/.test(item.paymentToken)
    ) {
      throw new IncompleteQuoteError(item.quoteLineId);
    }
    return {
      quoteLineId: item.quoteLineId,
      listingId,
      amount: CRATE_QUOTE_UNITS_PER_STEM,
      paymentToken: item.paymentToken as Address,
      totalUnits,
    };
  });
}

export type QuoteBlocker =
  | "not_open"
  | "expired"
  | "wallet_changed"
  | "wrong_network"
  | "wrong_marketplace"
  | "nothing_to_buy"
  | "incomplete";

const BLOCKER_TEXT: Record<QuoteBlocker, string> = {
  not_open: "This quote was already used. Get a new quote.",
  expired: "This quote has expired. Get a new quote.",
  wallet_changed: WALLET_CHANGED_TEXT,
  wrong_network: "This quote is for a different network. Get a new quote.",
  wrong_marketplace: "This quote is for a different marketplace. Get a new quote.",
  nothing_to_buy: "Nothing in this quote can be bought.",
  incomplete: "This quote is incomplete. Get a new quote.",
};

export function quoteBlockerText(blocker: QuoteBlocker): string {
  return BLOCKER_TEXT[blocker];
}

/**
 * The first reason this quote must not be signed for right now, or null. Run
 * before the confirm step and again before anything is sent: a quote is only
 * approved for the buyer, network and marketplace it was priced for.
 */
export function quoteBlocker(input: {
  quote: CrateQuote;
  buyerAddress: string | null;
  chainId: number;
  marketplaceAddress: string | null;
  nowMs: number;
}): QuoteBlocker | null {
  const { quote } = input;
  if (quote.status !== "open") return "not_open";
  if (isQuoteExpired(quote, input.nowMs)) return "expired";
  if (!input.buyerAddress || quote.buyerAddress.toLowerCase() !== input.buyerAddress.toLowerCase()) {
    return "wallet_changed";
  }
  if (quote.chainId !== input.chainId) return "wrong_network";
  if (
    !input.marketplaceAddress
    || quote.marketplaceAddress.toLowerCase() !== input.marketplaceAddress.toLowerCase()
  ) {
    return "wrong_marketplace";
  }
  if (quotedStems(quote).length === 0) return "nothing_to_buy";
  try {
    quoteBatchLines(quote);
  } catch {
    return "incomplete";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Per-line choices (tier and stems) and re-quoting                    */
/* ------------------------------------------------------------------ */

export type LineChoice = {
  licenseType: CrateLicenseType;
  stemTypes: CrateStemType[];
};

function asLicense(value: string): CrateLicenseType | null {
  return (CRATE_LICENSE_TYPES as readonly string[]).includes(value) ? (value as CrateLicenseType) : null;
}

function asStem(value: string): CrateStemType | null {
  return (CRATE_STEM_TYPES as readonly string[]).includes(value) ? (value as CrateStemType) : null;
}

/** The stem types a line was quoted for (any status), in canonical order. */
export function lineStemTypes(line: CrateQuoteLine): CrateStemType[] {
  const present = new Set(line.items.map((item) => item.stemType.toLowerCase()));
  return CRATE_STEM_TYPES.filter((type) => present.has(type));
}

/** Tier and stems of each quoted line, keyed by track. */
export function choicesFromQuote(quote: CrateQuote): Map<string, LineChoice> {
  const choices = new Map<string, LineChoice>();
  for (const line of quote.lines) {
    const licenseType = asLicense(line.licenseType);
    if (!licenseType) continue;
    choices.set(line.trackId, { licenseType, stemTypes: lineStemTypes(line) });
  }
  return choices;
}

/** The body lines of a re-quote: every quoted line, with its tier and stems. */
export function lineRequestsFromChoices(
  quote: CrateQuote,
  choices: ReadonlyMap<string, LineChoice>,
): CrateQuoteLineRequest[] {
  return quote.lines.map((line) => {
    const choice = choices.get(line.trackId);
    const request: CrateQuoteLineRequest = { trackId: line.trackId };
    if (choice) {
      request.licenseType = choice.licenseType;
      if (choice.stemTypes.length > 0) request.stemTypes = [...choice.stemTypes];
    }
    return request;
  });
}

/** New choices with one line's tier changed. */
export function withTier(
  choices: ReadonlyMap<string, LineChoice>,
  trackId: string,
  licenseType: CrateLicenseType,
): Map<string, LineChoice> {
  const next = new Map(choices);
  const current = next.get(trackId);
  next.set(trackId, { licenseType, stemTypes: current?.stemTypes ?? [] });
  return next;
}

/**
 * New choices with one stem switched on or off. The last stem of a line cannot
 * be switched off (an empty list would mean "every stem" to the backend); to
 * leave a track out, remove it from the crate.
 */
export function withStemToggled(
  choices: ReadonlyMap<string, LineChoice>,
  trackId: string,
  stemType: CrateStemType,
): Map<string, LineChoice> {
  const next = new Map(choices);
  const current = next.get(trackId);
  if (!current) return next;
  const has = current.stemTypes.includes(stemType);
  if (has && current.stemTypes.length === 1) return next;
  const stemTypes = has
    ? current.stemTypes.filter((type) => type !== stemType)
    : CRATE_STEM_TYPES.filter((type) => type === stemType || current.stemTypes.includes(type));
  next.set(trackId, { licenseType: current.licenseType, stemTypes });
  return next;
}

/** The tiers the DJ may pick for a line: the listed ones, plus the one quoted. */
export function tierChoices(crateItem: CrateItemDto | undefined, quoted: string): CrateLicenseType[] {
  const tiers = new Set<string>();
  for (const option of crateItem?.licenseOptions ?? []) {
    if (option.listed) tiers.add(option.licenseType);
  }
  tiers.add(quoted);
  return CRATE_LICENSE_TYPES.filter((tier) => tiers.has(tier));
}

/** Every stem type of a line the DJ can switch on: the track's own, plus those quoted. */
export function stemChoices(crateItem: CrateItemDto | undefined, line: CrateQuoteLine): CrateStemType[] {
  const types = new Set<string>(lineStemTypes(line));
  for (const stem of crateItem?.stems ?? []) {
    const type = asStem(stem.type.toLowerCase());
    if (type) types.add(type);
  }
  return CRATE_STEM_TYPES.filter((type) => types.has(type));
}

/* ------------------------------------------------------------------ */
/* Display rows                                                        */
/* ------------------------------------------------------------------ */

export function titleCase(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

/** "0.5 USDC" for an item's price, or null when it was not priced. */
export function itemPriceText(item: CrateQuoteItem): string | null {
  const units = parseUnits(item.totalUnits);
  if (units === null || !item.symbol || item.decimals === null) return null;
  return formatTokenUnits(units, item.symbol, item.decimals);
}

/** The artist side and the platform fee of an item, formatted from its units. */
export function itemSplitText(
  item: CrateQuoteItem,
): { artist: string; platform: string } | null {
  const artist = parseUnits(item.artistShareUnits);
  const platform = parseUnits(item.platformFeeUnits);
  if (artist === null || platform === null || !item.symbol || item.decimals === null) return null;
  return {
    artist: formatTokenUnits(artist, item.symbol, item.decimals),
    platform: formatTokenUnits(platform, item.symbol, item.decimals),
  };
}

export type ReceiptRow = {
  quoteLineId: string;
  trackTitle: string;
  artistName: string | null;
  stemType: string;
  outcome: "settled" | "failed" | "dropped";
  /** Plain reason for a failed or dropped stem. */
  reason: string | null;
  /** The transaction that carried the purchase, when there is one. */
  transactionHash: string | null;
  price: string | null;
};

/** Receipts per stem once the purchase was sent: settled, failed or left out. */
export function receiptRows(quote: CrateQuote): ReceiptRow[] {
  const rows: ReceiptRow[] = [];
  for (const line of quote.lines) {
    for (const item of line.items) {
      if (item.status !== "settled" && item.status !== "failed" && item.status !== "dropped") continue;
      rows.push({
        quoteLineId: item.quoteLineId,
        trackTitle: line.title?.trim() || "Untitled track",
        artistName: line.artistName,
        stemType: item.stemType,
        outcome: item.status as ReceiptRow["outcome"],
        reason: item.status === "settled" ? null : crateReasonText(item.reason),
        transactionHash: item.receipt?.transactionHash ?? quote.transactionHash,
        price: itemPriceText(item),
      });
    }
  }
  return rows;
}

/** Whether the quote has gone past "open": there is something to show as a receipt. */
export function hasReceipts(quote: CrateQuote): boolean {
  return quote.status === "settled" || quote.status === "partial" || quote.status === "failed";
}

export function quoteSummaryText(quote: CrateQuote): string {
  const settled = quote.lines.reduce(
    (count, line) => count + line.items.filter((item) => item.status === "settled").length,
    0,
  );
  switch (quote.status) {
    case "settled":
      return `Bought ${settled} ${settled === 1 ? "stem" : "stems"}.`;
    case "partial":
      return `Bought ${settled} ${settled === 1 ? "stem" : "stems"}. The rest were not bought and you were not charged for them.`;
    case "failed":
      return "Nothing was bought.";
    case "submitted":
      return "Still confirming your purchase.";
    default:
      return "";
  }
}

export function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

/** What a quote line id stands for on screen: "Track title" and the stem. */
export function stemLabel(
  quote: CrateQuote,
  quoteLineId: string,
): { trackTitle: string; stemType: string; item: CrateQuoteItem } | null {
  for (const line of quote.lines) {
    for (const item of line.items) {
      if (item.quoteLineId === quoteLineId) {
        return { trackTitle: line.title?.trim() || "Untitled track", stemType: item.stemType, item };
      }
    }
  }
  return null;
}

/**
 * What the given stems cost, per payment token, formatted from their units
 * (bigint sums, never floats), in the order tokens first appear.
 */
export function totalsForStems(quote: CrateQuote, quoteLineIds: readonly string[]): string[] {
  const sums = new Map<string, { symbol: string; decimals: number; units: bigint }>();
  for (const id of quoteLineIds) {
    const item = stemLabel(quote, id)?.item;
    const units = parseUnits(item?.totalUnits);
    if (!item || units === null || !item.paymentToken || !item.symbol || item.decimals === null) continue;
    const key = item.paymentToken.toLowerCase();
    const sum = sums.get(key);
    if (sum) sum.units += units;
    else sums.set(key, { symbol: item.symbol, decimals: item.decimals, units });
  }
  return [...sums.values()].map((sum) => formatTokenUnits(sum.units, sum.symbol, sum.decimals));
}

/* ------------------------------------------------------------------ */
/* A sent purchase that is not settled yet (survives a closed page)    */
/* ------------------------------------------------------------------ */

export type PendingSettle = {
  transactionHash: string;
  dropped: Array<{ quoteLineId: string; reason: CrateQuoteSettleDropReason }>;
};

type PendingStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PENDING_KEY_PREFIX = "resonate.crate.pending-settle.";

function browserStore(): PendingStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Remember the transaction of a quote the moment it was sent, before the
 * backend has been told. If the page closes in between, the quote still reads
 * `open`; this record lets the panel finish settling it instead of offering the
 * same stems for purchase a second time.
 */
export function storePendingSettle(
  quoteId: string,
  pending: PendingSettle,
  store: PendingStore | null = browserStore(),
): void {
  if (!store) return;
  try {
    store.setItem(`${PENDING_KEY_PREFIX}${quoteId}`, JSON.stringify(pending));
  } catch {
    // Storage full or blocked: the in-memory state still guards this visit.
  }
}

export function readPendingSettle(
  quoteId: string,
  store: PendingStore | null = browserStore(),
): PendingSettle | null {
  if (!store) return null;
  try {
    const raw = store.getItem(`${PENDING_KEY_PREFIX}${quoteId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingSettle> | null;
    if (!parsed || typeof parsed.transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(parsed.transactionHash)) {
      return null;
    }
    const dropped = Array.isArray(parsed.dropped)
      ? parsed.dropped.filter(
          (entry) =>
            entry
            && typeof entry.quoteLineId === "string"
            && (CRATE_QUOTE_SETTLE_DROP_REASONS as readonly string[]).includes(entry.reason),
        )
      : [];
    return { transactionHash: parsed.transactionHash, dropped };
  } catch {
    return null;
  }
}

export function clearPendingSettle(quoteId: string, store: PendingStore | null = browserStore()): void {
  if (!store) return;
  try {
    store.removeItem(`${PENDING_KEY_PREFIX}${quoteId}`);
  } catch {
    // Nothing to do: a stale record only offers "Check again".
  }
}
