/**
 * The one-signature purchase of a crate quote (#1964), as a sequence of steps
 * with every wallet and network action injected, so the guarantees are tested
 * without a wallet:
 *
 * - nothing is sent for a quote that is not open, expired, for another buyer,
 *   network or marketplace, or incomplete;
 * - every line is checked against the chain first, and lines that no longer
 *   hold are left out, never bought;
 * - when lines were left out, nothing is sent until the DJ confirms the rest;
 * - a batch is never built from zero lines;
 * - the lines that were left out are reported to settlement, so a line that
 *   was not bought is never charged or recorded as bought.
 *
 * Money stays in bigint units throughout (see `onchainCheckout.ts`).
 */

import type { Address } from "viem";
import {
  CRATE_SETTLE_RETRY_DELAYS_MS,
  isRetryableSettleError,
  purchaseFailureMessage,
  quoteBatchLines,
  quoteBlocker,
  type QuoteBlocker,
} from "./crateQuote";
import type { PreflightDrop, PreflightResult } from "./crateQuotePreflight";
import type {
  CrateQuote,
  CrateQuoteSettleDropReason,
  SettleCrateQuoteBody,
  SettleCrateQuoteResult,
} from "./crates";
import {
  buildCrateBatchPlan,
  type CrateBatchLine,
  type CrateBatchPlan,
} from "./onchainCheckout";

export type PurchaseStage = "checking" | "confirming_drops" | "signing" | "settling";

export type SettlementOutcome =
  | { kind: "final"; quote: CrateQuote }
  /** No receipt yet, or the settle call could not be answered: retry later. */
  | { kind: "pending"; quote: CrateQuote | null; error: unknown }
  /** The backend refused the settlement for good (a conflict or a bad request). */
  | { kind: "rejected"; error: unknown };

export type PurchaseOutcome =
  | { kind: "blocked"; blocker: QuoteBlocker }
  | { kind: "nothing_to_buy"; dropped: PreflightDrop[] }
  | { kind: "cancelled"; dropped: PreflightDrop[] }
  | { kind: "not_sent"; message: string; error: unknown }
  | {
      kind: "sent";
      transactionHash: string;
      dropped: PreflightDrop[];
      settlement: SettlementOutcome;
    };

export type PurchaseDeps = {
  quote: CrateQuote;
  buyerAddress: string | null;
  chainId: number;
  /** The marketplace this app is configured for. */
  marketplaceAddress: string | null;
  now: () => number;
  preflight: (lines: CrateBatchLine[]) => Promise<PreflightResult>;
  /** Asks the DJ whether to go on without the left-out lines. */
  confirmDropped: (dropped: PreflightDrop[], keep: CrateBatchLine[]) => Promise<boolean>;
  /** Signs and sends the batch; resolves with the transaction hash. */
  send: (plan: CrateBatchPlan) => Promise<string>;
  settle: (body: SettleCrateQuoteBody) => Promise<SettleCrateQuoteResult>;
  sleep: (ms: number) => Promise<void>;
  onStage?: (stage: PurchaseStage) => void;
  isCancelled?: () => boolean;
};

/** Whether a line to buy is exactly the line the quote offered. */
function isQuotedLine(offered: CrateBatchLine | undefined, line: CrateBatchLine): boolean {
  return (
    offered !== undefined
    && offered.listingId === line.listingId
    && offered.amount === line.amount
    && offered.totalUnits === line.totalUnits
    && offered.paymentToken.toLowerCase() === line.paymentToken.toLowerCase()
  );
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

const CHECK_FAILED_TEXT =
  "We could not check your purchase against the network. Nothing was charged. Please try again.";

function settleDrops(dropped: readonly PreflightDrop[]): NonNullable<SettleCrateQuoteBody["dropped"]> {
  return dropped.map((entry) => ({
    quoteLineId: entry.quoteLineId,
    reason: entry.reason satisfies CrateQuoteSettleDropReason,
  }));
}

/**
 * Asks settlement about a sent transaction until the quote is final: right
 * away, then after each delay. A 202 (no receipt yet) and a settle call that
 * could not be answered both keep trying; a conflict or bad request stops.
 */
export async function settleWithBackoff(input: {
  settle: () => Promise<SettleCrateQuoteResult>;
  sleep: (ms: number) => Promise<void>;
  delaysMs?: readonly number[];
  isCancelled?: () => boolean;
}): Promise<SettlementOutcome> {
  const delays = input.delaysMs ?? CRATE_SETTLE_RETRY_DELAYS_MS;
  let lastQuote: CrateQuote | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      const result = await input.settle();
      lastQuote = result.quote;
      lastError = null;
      const done =
        result.status === 200
        && (result.quote.status === "settled"
          || result.quote.status === "partial"
          || result.quote.status === "failed");
      if (done) return { kind: "final", quote: result.quote };
    } catch (error) {
      if (!isRetryableSettleError(error)) return { kind: "rejected", error };
      lastError = error;
    }
    if (attempt === delays.length || input.isCancelled?.()) break;
    await input.sleep(delays[attempt]);
    if (input.isCancelled?.()) break;
  }
  return { kind: "pending", quote: lastQuote, error: lastError };
}

export async function runCrateQuotePurchase(deps: PurchaseDeps): Promise<PurchaseOutcome> {
  const { quote } = deps;
  const blockerNow = () =>
    quoteBlocker({
      quote,
      buyerAddress: deps.buyerAddress,
      chainId: deps.chainId,
      marketplaceAddress: deps.marketplaceAddress,
      nowMs: deps.now(),
    });

  const blocked = blockerNow();
  if (blocked) return { kind: "blocked", blocker: blocked };

  const lines = quoteBatchLines(quote);

  // 1. Check every line against the chain before asking for any signature.
  deps.onStage?.("checking");
  let checked: PreflightResult;
  try {
    checked = await deps.preflight(lines);
  } catch (error) {
    return { kind: "not_sent", message: CHECK_FAILED_TEXT, error };
  }

  // Only lines of this quote, exactly as quoted, can ever be bought.
  const quoted = new Map(lines.map((line) => [line.quoteLineId, line]));
  const keep = checked.keep;
  for (const line of keep) {
    if (!isQuotedLine(quoted.get(line.quoteLineId), line)) {
      return {
        kind: "not_sent",
        message: CHECK_FAILED_TEXT,
        error: new Error(`Line ${line.quoteLineId} is not part of this quote`),
      };
    }
  }
  const dropped = checked.dropped;
  if (keep.length === 0) return { kind: "nothing_to_buy", dropped };

  // 2. Lines that no longer hold: the DJ decides about the rest, never us.
  if (dropped.length > 0) {
    deps.onStage?.("confirming_drops");
    const proceed = await deps.confirmDropped(dropped, keep);
    if (!proceed) return { kind: "cancelled", dropped };
  }

  // The wait for that answer can outlast the quote.
  const blockedLater = blockerNow();
  if (blockedLater) return { kind: "blocked", blocker: blockedLater };
  if (deps.isCancelled?.()) return { kind: "cancelled", dropped };

  // 3. One batch, one signature.
  let plan: CrateBatchPlan;
  try {
    plan = buildCrateBatchPlan({
      marketplaceAddress: quote.marketplaceAddress as Address,
      lines: keep,
    });
  } catch (error) {
    return { kind: "not_sent", message: CHECK_FAILED_TEXT, error };
  }

  deps.onStage?.("signing");
  let transactionHash: string;
  try {
    transactionHash = await deps.send(plan);
    if (!TX_HASH.test(transactionHash)) {
      throw new Error("The wallet did not return a transaction hash");
    }
  } catch (error) {
    return { kind: "not_sent", message: purchaseFailureMessage(error), error };
  }

  // 4. Report what was sent, and which lines were left out of it.
  deps.onStage?.("settling");
  const body: SettleCrateQuoteBody = { transactionHash, dropped: settleDrops(dropped) };
  const settlement = await settleWithBackoff({
    settle: () => deps.settle(body),
    sleep: deps.sleep,
    isCancelled: deps.isCancelled,
  });
  return { kind: "sent", transactionHash, dropped, settlement };
}
