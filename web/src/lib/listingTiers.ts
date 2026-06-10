import type { LicenseType } from "../components/marketplace/LicenseTypeSelector";

/**
 * Seller-side license tier helpers (#1141). License tier is an off-chain
 * listing attribute: the chain's list() carries no license type, and the
 * indexer stamps StemListing.licenseType from the listing intent recorded by
 * POST /metadata/notify-listing. These helpers keep that payload and the
 * per-tier price prefill pure and testable.
 */

export type StemTierPricing = {
  remixLicenseUsd?: number | null;
  commercialLicenseUsd?: number | null;
};

/**
 * Default USD prefill when the seller picks a tier. Personal returns null:
 * the edition price is the seller's call and has no catalog default. Remix
 * and commercial fall back to the platform defaults used by StemPricing.
 */
export function tierDefaultPriceUsd(
  pricing: StemTierPricing | null,
  tier: LicenseType,
): number | null {
  if (tier === "remix") {
    return pricing?.remixLicenseUsd ?? 5;
  }
  if (tier === "commercial") {
    return pricing?.commercialLicenseUsd ?? 25;
  }
  return null;
}

export type NotifyListingInput = {
  tokenId: bigint;
  chainId: number;
  seller: string;
  priceUnits: bigint;
  amount: bigint;
  paymentToken: string;
  durationSeconds: bigint;
  transactionHash: string;
  licenseType: LicenseType;
  stemId?: string | null;
};

/**
 * Payload for POST /api/contracts/notify-listing. The backend upserts a
 * StemListingIntent keyed by (transactionHash, tokenId); the indexer then
 * stamps the listing's licenseType from it.
 */
export function buildNotifyListingPayload(
  input: NotifyListingInput,
): Record<string, string | number> {
  return {
    tokenId: input.tokenId.toString(),
    chainId: input.chainId,
    seller: input.seller,
    price: input.priceUnits.toString(),
    amount: input.amount.toString(),
    paymentToken: input.paymentToken,
    licenseType: input.licenseType,
    durationSeconds: input.durationSeconds.toString(),
    transactionHash: input.transactionHash,
    ...(input.stemId ? { stemId: input.stemId } : {}),
  };
}

/**
 * One active listing consumes the listed editions, so offering several
 * license tiers at once needs several editions of the token.
 */
export function multiTierEditionHint(input: {
  balance: bigint;
  tier: LicenseType;
}): string | null {
  if (input.tier === "personal" || input.balance > 1n) {
    return null;
  }
  return "You own a single edition: listing it under this license uses your only unit, so you cannot offer other license tiers at the same time. Mint more editions to sell several tiers.";
}
