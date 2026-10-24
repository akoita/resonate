import { prisma } from "../../db/prisma";

/**
 * #2172: the real split of a marketplace sale (royalty, platform fee, seller
 * proceeds).
 *
 * The `Sold` log carries only the gross (`totalPaid`), so `StemPurchase` is
 * created with its split amounts at "0" and `splitFinalizedAt` null: PENDING,
 * which is "not known yet", never "zero". The split is finalised from facts the
 * indexer already holds, plus one bounded chain read, and only when every part
 * of it is known:
 *
 * - royalty: the `RoyaltyPaid` log that precedes the `Sold` log in the same
 *   transaction (StemMarketplaceV2._buy emits it first, and only when the royalty
 *   is above zero). With no such log the royalty is proven zero by asking the
 *   StemNFT `royaltyInfo` at the Sold block; a non-zero answer means the log
 *   has not been indexed yet, so the sale stays pending.
 * - platform fee: `protocolFeeBps()` read at the Sold block. The contract keeps
 *   one rate that the owner can change, so the rate at the sale is pinned to its
 *   block, not read at "now".
 *
 * Nothing here moves money or changes a fee or a split: it only records what
 * the contract already did. Rounding mirrors the contract: the fee is
 * `floor(total * bps / 10000)` and the seller keeps the remainder.
 */

export const BPS_DENOMINATOR = 10_000n;

/** Chain reads the split needs; the production reader is built from the service's chain config. */
export interface MarketplaceSplitChainReader {
  /** `protocolFeeBps()` of the marketplace contract at `blockNumber`. */
  protocolFeeBpsAt(input: { chainId: number; marketplaceAddress: string; blockNumber: bigint }): Promise<bigint>;
  /** ERC-2981 `royaltyInfo(tokenId, salePrice)` amount of the StemNFT at `blockNumber`. */
  royaltyAmountAt(input: {
    chainId: number;
    stemNftAddress: string;
    tokenId: bigint;
    salePrice: bigint;
    blockNumber: bigint;
  }): Promise<bigint>;
}

export type SaleSplit = {
  protocolFee: bigint;
  royalty: bigint;
  seller: bigint;
};

/** The contract's arithmetic. Null when the parts do not fit the gross (never recorded as a split). */
export function computeSaleSplit(input: {
  totalPaid: bigint;
  protocolFeeBps: bigint;
  royaltyAmount: bigint;
}): SaleSplit | null {
  const { totalPaid, protocolFeeBps, royaltyAmount } = input;
  if (totalPaid < 0n || royaltyAmount < 0n || protocolFeeBps < 0n || protocolFeeBps > BPS_DENOMINATOR) return null;
  const protocolFee = (totalPaid * protocolFeeBps) / BPS_DENOMINATOR;
  const seller = totalPaid - royaltyAmount - protocolFee;
  if (seller < 0n) return null;
  return { protocolFee, royalty: royaltyAmount, seller };
}

export type SaleLogRow = {
  eventName: string;
  logIndex: number;
  contractAddress: string;
  args: unknown;
};

/**
 * The `RoyaltyPaid` log that belongs to the sale whose `Sold` log is at
 * `soldLogIndex`. A transaction can carry several purchases (a batched user
 * operation), so the royalty is the nearest earlier `RoyaltyPaid` for the same
 * token that comes after the previous `Sold` log of the same marketplace.
 */
export function selectRoyaltyForSale(input: {
  rows: SaleLogRow[];
  soldLogIndex: number;
  tokenId: bigint;
  marketplaceAddress: string;
}): { amount: bigint; recipient: string } | null {
  const marketplace = input.marketplaceAddress.toLowerCase();
  const own = input.rows.filter(
    (row) => row.contractAddress.toLowerCase() === marketplace && row.logIndex < input.soldLogIndex,
  );
  const previousSoldIndex = own
    .filter((row) => row.eventName === "Sold")
    .reduce((highest, row) => Math.max(highest, row.logIndex), -1);
  const candidates = own
    .filter((row) => row.eventName === "RoyaltyPaid" && row.logIndex > previousSoldIndex)
    .sort((left, right) => right.logIndex - left.logIndex);
  for (const row of candidates) {
    const args = (row.args ?? {}) as { tokenId?: unknown; recipient?: unknown; amount?: unknown };
    if (typeof args.tokenId !== "string" && typeof args.tokenId !== "number") continue;
    if (typeof args.recipient !== "string" || typeof args.amount !== "string") continue;
    try {
      if (BigInt(args.tokenId) !== input.tokenId) continue;
      return { amount: BigInt(args.amount), recipient: args.recipient };
    } catch {
      continue;
    }
  }
  return null;
}

export type SplitPendingReason =
  | "no_log_index"
  | "royalty_not_indexed"
  | "stem_nft_unknown"
  | "fee_unreadable"
  | "royalty_unreadable"
  | "split_inconsistent";

export type SplitFinalizationResult =
  | { state: "final"; split: SaleSplit; protocolFeeBps: number; royaltyRecipient: string | null }
  | { state: "pending"; reason: SplitPendingReason }
  | { state: "missing" };

type Logger = { warn(message: string): void };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Finalises one purchase's split, or leaves it pending (with the reason). Safe to
 * repeat: a final split is never rewritten.
 */
export async function finalizeMarketplaceSaleSplit(
  purchaseId: string,
  reader: MarketplaceSplitChainReader,
  logger: Logger,
  options: {
    /** Work out the outcome (including the chain reads) without writing it. */
    dryRun?: boolean;
  } = {},
): Promise<SplitFinalizationResult> {
  const purchase = await prisma.stemPurchase.findUnique({
    where: { id: purchaseId },
    include: { listing: { select: { tokenId: true, chainId: true, contractAddress: true } } },
  });
  if (!purchase) return { state: "missing" };

  const listing = purchase.listing;
  if (purchase.splitFinalizedAt) {
    return {
      state: "final",
      split: {
        protocolFee: BigInt(purchase.protocolFeePaid),
        royalty: BigInt(purchase.royaltyPaid),
        seller: BigInt(purchase.sellerReceived),
      },
      protocolFeeBps: purchase.protocolFeeBps ?? 0,
      royaltyRecipient: purchase.royaltyRecipient,
    };
  }
  // A row indexed before the Sold log position was recorded cannot be matched to
  // its RoyaltyPaid log: it stays pending rather than guessing.
  if (purchase.logIndex == null) return { state: "pending", reason: "no_log_index" };

  const totalPaid = BigInt(purchase.totalPaid);
  const rows = await prisma.contractEvent.findMany({
    where: {
      transactionHash: purchase.transactionHash,
      eventName: { in: ["RoyaltyPaid", "Sold"] },
      logIndex: { lt: purchase.logIndex },
    },
    select: { eventName: true, logIndex: true, contractAddress: true, args: true },
  });
  const royaltyLog = selectRoyaltyForSale({
    rows,
    soldLogIndex: purchase.logIndex,
    tokenId: listing.tokenId,
    marketplaceAddress: listing.contractAddress,
  });

  let royaltyAmount: bigint;
  let royaltyRecipient: string | null;
  if (royaltyLog) {
    royaltyAmount = royaltyLog.amount;
    royaltyRecipient = royaltyLog.recipient.toLowerCase();
  } else {
    // No RoyaltyPaid log: either the royalty really is zero (the contract then emits
    // none) or the log is not indexed yet. Ask the StemNFT before believing "zero".
    const mint = await prisma.stemNftMint.findFirst({
      where: { tokenId: listing.tokenId, chainId: listing.chainId },
      select: { contractAddress: true },
    });
    if (!mint) return { state: "pending", reason: "stem_nft_unknown" };
    try {
      const expected = await reader.royaltyAmountAt({
        chainId: listing.chainId,
        stemNftAddress: mint.contractAddress,
        tokenId: listing.tokenId,
        salePrice: totalPaid,
        blockNumber: purchase.blockNumber,
      });
      if (expected > 0n) return { state: "pending", reason: "royalty_not_indexed" };
    } catch (error) {
      logger.warn(`[Split] royalty lookup failed for purchase ${purchase.id}: ${errorMessage(error)}`);
      return { state: "pending", reason: "royalty_unreadable" };
    }
    royaltyAmount = 0n;
    royaltyRecipient = null;
  }

  let feeBps: bigint;
  try {
    feeBps = await reader.protocolFeeBpsAt({
      chainId: listing.chainId,
      marketplaceAddress: listing.contractAddress,
      blockNumber: purchase.blockNumber,
    });
  } catch (error) {
    logger.warn(`[Split] protocol fee read failed for purchase ${purchase.id}: ${errorMessage(error)}`);
    return { state: "pending", reason: "fee_unreadable" };
  }

  const split = computeSaleSplit({ totalPaid, protocolFeeBps: feeBps, royaltyAmount });
  if (!split) return { state: "pending", reason: "split_inconsistent" };

  if (options.dryRun) return { state: "final", split, protocolFeeBps: Number(feeBps), royaltyRecipient };

  await prisma.stemPurchase.updateMany({
    // Guarded so two concurrent finalisations of one sale write once.
    where: { id: purchase.id, splitFinalizedAt: null },
    data: {
      royaltyPaid: split.royalty.toString(),
      protocolFeePaid: split.protocolFee.toString(),
      sellerReceived: split.seller.toString(),
      protocolFeeBps: Number(feeBps),
      royaltyRecipient,
      splitFinalizedAt: new Date(),
    },
  });
  return { state: "final", split, protocolFeeBps: Number(feeBps), royaltyRecipient };
}

/**
 * Retries pending purchases: those of one transaction (a RoyaltyPaid log that
 * arrived after its Sold log), or the most recent pending ones. Never throws.
 */
export async function finalizePendingMarketplaceSplits(
  reader: MarketplaceSplitChainReader,
  logger: Logger,
  options: { transactionHash?: string; limit?: number } = {},
) {
  const pending = await prisma.stemPurchase.findMany({
    where: {
      splitFinalizedAt: null,
      logIndex: { not: null },
      ...(options.transactionHash ? { transactionHash: options.transactionHash } : {}),
    },
    orderBy: { purchasedAt: "desc" },
    take: options.limit ?? 25,
    select: { id: true },
  });
  let finalized = 0;
  for (const row of pending) {
    try {
      const result = await finalizeMarketplaceSaleSplit(row.id, reader, logger);
      if (result.state === "final") finalized += 1;
    } catch (error) {
      logger.warn(`[Split] could not finalize purchase ${row.id}: ${errorMessage(error)}`);
    }
  }
  return { attempted: pending.length, finalized };
}

export const SPLIT_BACKFILL_DEFAULT_LIMIT = 200;

export type SaleSplitBackfillReport = {
  dryRun: boolean;
  limit: number;
  /** Only sales purchased at or before this instant were considered; null when unbounded. */
  before: string | null;
  /** Pending sales (with a recorded Sold log position) examined in this run. */
  scanned: number;
  /** Dry run: sales that --apply would finalise. Apply: sales finalised by this run. */
  finalizable: number;
  /**
   * Sales that stay pending, by the reason the split could not be proven.
   * `no_log_index` counts the sales indexed before the Sold log position was
   * kept: they cannot be matched to their RoyaltyPaid log and are never
   * finalised by guessing (they are not part of `scanned`).
   */
  stillPending: Record<SplitPendingReason, number>;
  /** Sales that vanished or errored while being examined. */
  failed: number;
  /** Pending sales left for another run because of the limit. */
  deferred: number;
  /** Pass as `before` to continue with the sales this run did not reach; null when none remain. */
  nextBefore: string | null;
};

function emptyReasonCounts(): Record<SplitPendingReason, number> {
  return {
    no_log_index: 0,
    royalty_not_indexed: 0,
    stem_nft_unknown: 0,
    fee_unreadable: 0,
    royalty_unreadable: 0,
    split_inconsistent: 0,
  };
}

/**
 * #2344: one-off backfill of sales still pending (#2172), for sales indexed
 * before the split was derived. It reuses the exact finalisation logic of the
 * live path, so a sale is finalised only when the royalty and the fee rate are
 * both proven, and a final split is never rewritten: running it twice is safe.
 *
 * Dry run (the default) performs the same reads, including the chain reads, but
 * writes nothing. The newest sales are examined first; `before` (inclusive)
 * resumes from a previous run's `nextBefore`.
 */
export async function backfillPendingMarketplaceSplits(
  reader: MarketplaceSplitChainReader,
  logger: Logger,
  options: { apply?: boolean; limit?: number; before?: Date } = {},
): Promise<SaleSplitBackfillReport> {
  const apply = options.apply === true;
  const limit = options.limit ?? SPLIT_BACKFILL_DEFAULT_LIMIT;
  const scope = {
    splitFinalizedAt: null,
    ...(options.before ? { purchasedAt: { lte: options.before } } : {}),
  };
  const stillPending = emptyReasonCounts();
  stillPending.no_log_index = await prisma.stemPurchase.count({ where: { ...scope, logIndex: null } });

  const rows = await prisma.stemPurchase.findMany({
    where: { ...scope, logIndex: { not: null } },
    orderBy: [{ purchasedAt: "desc" }, { id: "asc" }],
    take: limit + 1,
    select: { id: true, purchasedAt: true },
  });
  const batch = rows.slice(0, limit);
  const hasMore = rows.length > limit;

  let finalizable = 0;
  let failed = 0;
  for (const row of batch) {
    try {
      const result = await finalizeMarketplaceSaleSplit(row.id, reader, logger, { dryRun: !apply });
      if (result.state === "final") finalizable += 1;
      else if (result.state === "pending") stillPending[result.reason] += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      logger.warn(`[Split] backfill could not examine purchase ${row.id}: ${errorMessage(error)}`);
    }
  }

  const oldest = batch.at(-1)?.purchasedAt;
  const deferred = hasMore
    ? (await prisma.stemPurchase.count({ where: { ...scope, logIndex: { not: null } } })) - batch.length
    : 0;
  return {
    dryRun: !apply,
    limit,
    before: options.before ? options.before.toISOString() : null,
    scanned: batch.length,
    finalizable,
    stillPending,
    failed,
    deferred,
    nextBefore: hasMore && oldest ? oldest.toISOString() : null,
  };
}
