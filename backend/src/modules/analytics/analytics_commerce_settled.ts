import { createHash } from "crypto";
import { formatUnits } from "viem";
import { prisma } from "../../db/prisma";
import type { CommerceSettledEvent } from "../../events/event_types";
import type { EventBus } from "../shared/event_bus";
import { resolvePaymentAssetForToken } from "../payments/payment-asset-metadata";
import type { AnalyticsEventInput } from "./analytics_event";
import { pseudonymousAnalyticsActorId } from "./analytics_identity";

/**
 * #1894: live `commerce.settled` facts.
 *
 * One fact per real settlement, emitted server-side by the rail that recorded
 * it:
 * - marketplace rail: a NEW StemPurchase row (the single writer is the
 *   `contract.stem_sold` handler; it also covers batched purchases and
 *   contract-backed x402 `buyFor` sales, whose Sold log lands here);
 * - x402 rail: an X402Settlement in its final settled state that did NOT go
 *   through the marketplace contract (contract-backed rows are counted by the
 *   marketplace rail, so counting them here would double count).
 *
 * The idempotency key becomes a deterministic analytics eventId, so a replay
 * of the same settlement upserts onto the same AnalyticsEvent row.
 */

/** X402Settlement statuses that mean the buyer paid and received the good. */
export const X402_FINAL_SETTLEMENT_STATUSES: ReadonlySet<string> = new Set(["download_granted", "collected"]);

export function marketplaceCommerceSettlementKey(chainId: number, transactionHash: string, logIndex: number) {
  return `commerce.settled:marketplace:${chainId}:${transactionHash.toLowerCase()}:${logIndex}`;
}

export function x402CommerceSettlementKey(settlementId: string) {
  return `commerce.settled:x402:${settlementId}`;
}

export function commerceSettledEventId(settlementKey: string) {
  return `evt_cs_${createHash("sha256").update(settlementKey).digest("hex").slice(0, 32)}`;
}

/**
 * Exact USD only for the configured USD stablecoin (USDC / a `usd_pegged`
 * asset). Any other asset, native ETH included, returns null: no USD price is
 * invented, so the sale still counts as settled commerce but adds nothing to
 * USD sums.
 */
export function exactStablecoinUsd(input: {
  symbol?: string | null;
  pricingStrategy?: string | null;
  amountUnits?: string | null;
  decimals?: number | null;
}): number | null {
  const isUsdStablecoin =
    input.symbol?.trim().toUpperCase() === "USDC" || input.pricingStrategy === "usd_pegged";
  if (!isUsdStablecoin || !input.amountUnits || input.decimals == null) return null;
  try {
    const usd = Number(formatUnits(BigInt(input.amountUnits), input.decimals));
    return Number.isFinite(usd) ? usd : null;
  } catch {
    return null;
  }
}

/** Pseudonymous buyer actor: the owning user when the wallet is known, else the hashed address. */
async function resolveBuyerActorId(address?: string | null) {
  const normalized = address?.trim().toLowerCase();
  if (!normalized) return undefined;
  const wallet = await prisma.wallet.findFirst({
    where: {
      OR: [
        { address: { equals: normalized, mode: "insensitive" } },
        { ownerAddress: { equals: normalized, mode: "insensitive" } },
      ],
    },
    select: { userId: true },
  });
  return pseudonymousAnalyticsActorId(wallet?.userId ?? normalized);
}

/** Builds the fact for a recorded StemPurchase, identified by its Sold log. */
export async function loadMarketplaceCommerceSettled(input: {
  transactionHash: string;
  logIndex: number;
}): Promise<CommerceSettledEvent | null> {
  const purchase = await prisma.stemPurchase.findUnique({
    where: { transactionHash_logIndex: { transactionHash: input.transactionHash, logIndex: input.logIndex } },
    include: {
      listing: {
        select: {
          listingId: true,
          stemId: true,
          tokenId: true,
          chainId: true,
          stem: { select: { id: true, trackId: true, track: { select: { releaseId: true, release: { select: { artistId: true } } } } } },
        },
      },
    },
  });
  if (!purchase || purchase.logIndex == null) return null;

  const listing = purchase.listing;
  let stem = listing.stem;
  if (!stem) {
    const mint = await prisma.stemNftMint.findFirst({
      where: { tokenId: listing.tokenId, chainId: listing.chainId },
      select: {
        stem: { select: { id: true, trackId: true, track: { select: { releaseId: true, release: { select: { artistId: true } } } } } },
      },
    });
    stem = mint?.stem ?? null;
  }

  const asset = resolvePaymentAssetForToken({ chainId: listing.chainId, tokenAddress: purchase.paymentToken });
  const settlementKey = marketplaceCommerceSettlementKey(listing.chainId, purchase.transactionHash, purchase.logIndex);
  return {
    eventName: "commerce.settled",
    eventVersion: 1,
    occurredAt: purchase.purchasedAt.toISOString(),
    settlementKey,
    paymentId: purchase.id,
    rail: "marketplace",
    paymentRail: "marketplace_contract",
    resourceKind: "stem",
    stemId: stem?.id,
    trackId: stem?.trackId,
    releaseId: stem?.track?.releaseId,
    artistId: stem?.track?.release?.artistId,
    licenseType: purchase.licenseType,
    listingId: listing.listingId.toString(),
    chainId: listing.chainId,
    transactionHash: purchase.transactionHash,
    logIndex: purchase.logIndex,
    buyerActorId: await resolveBuyerActorId(purchase.buyerAddress),
    amountUsd: exactStablecoinUsd({
      symbol: purchase.paymentAssetSymbol,
      pricingStrategy: asset.pricingStrategy,
      amountUnits: purchase.settlementAmountUnits ?? purchase.totalPaid,
      decimals: purchase.paymentAssetDecimals,
    }),
    paymentToken: purchase.paymentToken,
    paymentAssetId: purchase.paymentAssetId ?? undefined,
    paymentAssetSymbol: purchase.paymentAssetSymbol,
    paymentAssetDecimals: purchase.paymentAssetDecimals,
    settlementAmount: purchase.settlementAmount ?? undefined,
    settlementAmountUnits: purchase.settlementAmountUnits ?? purchase.totalPaid,
  };
}

/**
 * Builds the fact for an X402Settlement, or null when it is not a counted
 * x402 settlement (not final, or contract-backed and so counted by the
 * marketplace rail).
 */
export async function loadX402CommerceSettled(
  where: { id: string } | { receiptId: string },
): Promise<CommerceSettledEvent | null> {
  const settlement = await prisma.x402Settlement.findUnique({
    where,
    include: {
      stem: { select: { id: true, trackId: true, track: { select: { releaseId: true, release: { select: { artistId: true } } } } } },
      moment: { select: { id: true, drop: { select: { trackId: true, artistId: true } } } },
    },
  });
  if (!settlement) return null;
  if (!X402_FINAL_SETTLEMENT_STATUSES.has(settlement.status)) return null;
  if (settlement.contractSettlementStatus === "contract_backed") return null;

  const isMoment = settlement.resourceKind !== "stem" || Boolean(settlement.momentId);
  const receipt = settlement.receipt as { license?: { key?: unknown } } | null;
  const licenseKey = typeof receipt?.license?.key === "string" ? receipt.license.key : undefined;
  return {
    eventName: "commerce.settled",
    eventVersion: 1,
    occurredAt: settlement.purchasedAt.toISOString(),
    settlementKey: x402CommerceSettlementKey(settlement.id),
    paymentId: settlement.id,
    rail: "x402",
    paymentRail: settlement.paymentRail,
    resourceKind: isMoment ? "punchline_moment" : "stem",
    stemId: settlement.stem?.id,
    momentId: settlement.moment?.id,
    trackId: settlement.stem?.trackId ?? settlement.moment?.drop.trackId,
    releaseId: settlement.stem?.track?.releaseId,
    artistId: settlement.stem?.track?.release?.artistId ?? settlement.moment?.drop.artistId,
    licenseType: isMoment ? undefined : licenseKey,
    receiptId: settlement.receiptId,
    transactionHash: settlement.paymentTransactionHash ?? undefined,
    buyerActorId: await resolveBuyerActorId(settlement.payerAddress),
    amountUsd: exactStablecoinUsd({
      symbol: settlement.paymentAssetSymbol,
      amountUnits: settlement.settlementAmountUnits,
      decimals: settlement.paymentAssetDecimals,
    }),
    paymentToken: settlement.paymentToken,
    paymentAssetId: settlement.paymentAssetId ?? undefined,
    paymentAssetSymbol: settlement.paymentAssetSymbol,
    paymentAssetDecimals: settlement.paymentAssetDecimals,
    settlementAmount: settlement.settlementAmount,
    settlementAmountUnits: settlement.settlementAmountUnits,
  };
}

/**
 * Publishes a `commerce.settled` domain event. Never throws: an analytics
 * failure must not break the purchase or settlement path.
 */
export async function publishCommerceSettled(
  eventBus: EventBus | undefined,
  load: () => Promise<CommerceSettledEvent | null>,
  logger: { warn(message: string): void },
  context: string,
) {
  if (!eventBus) return;
  try {
    const event = await load();
    if (event) eventBus.publish(event);
  } catch (error) {
    logger.warn(
      `[Analytics] commerce.settled emission skipped (${context}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Maps the domain event onto the analytics envelope with a deterministic eventId. */
export function commerceSettledAnalyticsEvent(event: CommerceSettledEvent): AnalyticsEventInput {
  const payload: Record<string, unknown> = {
    paymentId: event.paymentId,
    settlementKey: event.settlementKey,
    rail: event.rail,
    paymentRail: event.paymentRail,
    resourceKind: event.resourceKind,
    stemId: event.stemId,
    momentId: event.momentId,
    trackId: event.trackId,
    releaseId: event.releaseId,
    artistId: event.artistId,
    licenseType: event.licenseType,
    listingId: event.listingId,
    receiptId: event.receiptId,
    chainId: event.chainId,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
    status: "settled",
    // Gross settled amount. `payoutUsd` sums canonicalAmountUsd; null for any
    // asset that is not the USD stablecoin (no invented ETH price).
    amountUsd: event.amountUsd,
    canonicalAmountUsd: event.amountUsd,
    paymentToken: event.paymentToken,
    paymentAssetId: event.paymentAssetId,
    paymentAssetSymbol: event.paymentAssetSymbol,
    paymentAssetDecimals: event.paymentAssetDecimals,
    settlementAmount: event.settlementAmount,
    settlementAmountUnits: event.settlementAmountUnits,
  };
  const sourceRefs: Record<string, string> = { settlementKey: event.settlementKey };
  if (event.paymentId) sourceRefs.paymentId = event.paymentId;
  if (event.transactionHash) sourceRefs.transactionHash = event.transactionHash;
  return {
    eventId: commerceSettledEventId(event.settlementKey),
    eventName: "commerce.settled",
    eventVersion: 1,
    occurredAt: event.occurredAt,
    producer: "payments-service",
    privacyTier: "pseudonymous",
    consentBasis: "performance_of_contract",
    subjectType: event.trackId ? "track" : undefined,
    subjectId: event.trackId,
    actorId: event.buyerActorId,
    payload: Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)),
    sourceRefs,
  };
}
