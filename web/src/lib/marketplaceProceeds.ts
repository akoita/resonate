import type { MarketplaceListingAsset } from "./listingPricing";
import { formatListingPrice } from "./listingPricing";

export function formatBpsPercent(bps: bigint | number | null | undefined) {
  if (bps === null || bps === undefined) return null;
  const value = typeof bps === "bigint" ? Number(bps) : bps;
  if (!Number.isFinite(value) || value < 0) return null;
  const percent = value / 100;
  return Number.isInteger(percent)
    ? `${percent}%`
    : `${percent.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export function calculateSellerNetUnits(input: {
  grossUnits: bigint;
  protocolFeeBps: bigint | number | null | undefined;
  royaltyBps: bigint | number | null | undefined;
}) {
  const feeBps = toSafeBps(input.protocolFeeBps);
  const royaltyBps = toSafeBps(input.royaltyBps);
  const deductions = input.grossUnits * BigInt(feeBps + royaltyBps) / 10_000n;
  return input.grossUnits > deductions ? input.grossUnits - deductions : 0n;
}

export function sellerNetProceedsLine(input: {
  priceUnits: bigint;
  quantity?: bigint;
  asset: MarketplaceListingAsset;
  protocolFeeBps: bigint | number | null | undefined;
  royaltyBps: bigint | number | null | undefined;
}) {
  const feePercent = formatBpsPercent(input.protocolFeeBps);
  const royaltyPercent = formatBpsPercent(input.royaltyBps);
  if (!feePercent || !royaltyPercent) return null;

  const grossUnits = input.priceUnits * (input.quantity ?? 1n);
  const netUnits = calculateSellerNetUnits({
    grossUnits,
    protocolFeeBps: input.protocolFeeBps,
    royaltyBps: input.royaltyBps,
  });

  return `You receive ≈ ${formatListingPrice({
    priceUnits: netUnits,
    asset: input.asset,
  })} after the ${feePercent} platform fee and ${royaltyPercent} royalty.`;
}

function toSafeBps(value: bigint | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === "bigint" ? Number(value) : value;
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}
