import type { ReleaseContentProtectionData, TrustTier } from "./api";
import {
  convertCanonicalListingPriceToAssetUnits,
  type MarketplaceListingAsset,
} from "./listingPricing";

export const DEFAULT_MARKETPLACE_LISTING_PRICE_WEI = BigInt("10000000000000000");
export const DEFAULT_MAX_PRICE_MULTIPLIER = 10n;

type TrustTierListingPolicy = Pick<
  TrustTier,
  "maxListingPriceWei" | "maxListingPriceUncapped" | "maxPriceMultiplier"
>;

type StakeSafeListingPriceInput = {
  trustTier?: TrustTierListingPolicy | null;
  releaseProtection?: Pick<
    ReleaseContentProtectionData,
    "active" | "stakeAmount" | "staked"
  > | null;
};

type StakeSafeListingPriceUnitsInput = StakeSafeListingPriceInput & {
  asset: MarketplaceListingAsset;
};

function resolveReleaseStakeCapWei(
  input: StakeSafeListingPriceInput | null | undefined,
): bigint | null {
  if (!input) {
    return null;
  }
  const multiplier = BigInt(
    input.trustTier?.maxPriceMultiplier ?? Number(DEFAULT_MAX_PRICE_MULTIPLIER),
  );
  const stakeAmount = input.releaseProtection?.stakeAmount;

  if (
    !input.releaseProtection?.staked ||
    !input.releaseProtection?.active ||
    !stakeAmount
  ) {
    return null;
  }

  try {
    return BigInt(stakeAmount) * multiplier;
  } catch {
    return null;
  }
}

function resolveReleaseStakeCapUnits(
  input: StakeSafeListingPriceInput | null | undefined,
): bigint | null {
  if (!input) {
    return null;
  }
  const multiplier = BigInt(
    input.trustTier?.maxPriceMultiplier ?? Number(DEFAULT_MAX_PRICE_MULTIPLIER),
  );
  const stakeAmount = input.releaseProtection?.stakeAmount;

  if (
    !input.releaseProtection?.staked ||
    !input.releaseProtection?.active ||
    !stakeAmount
  ) {
    return null;
  }

  try {
    return BigInt(stakeAmount) * multiplier;
  } catch {
    return null;
  }
}

export function resolveStakeSafeListingPriceWei(
  input: StakeSafeListingPriceInput | null | undefined,
  requestedPriceWei: bigint = DEFAULT_MARKETPLACE_LISTING_PRICE_WEI,
): bigint {
  const releaseStakeCapWei = resolveReleaseStakeCapWei(input);
  if (releaseStakeCapWei != null) {
    return releaseStakeCapWei < requestedPriceWei
      ? releaseStakeCapWei
      : requestedPriceWei;
  }

  const trustTier = input?.trustTier;
  if (
    !trustTier ||
    trustTier.maxListingPriceUncapped ||
    !trustTier.maxListingPriceWei
  ) {
    return requestedPriceWei;
  }

  let maxListingPriceWei: bigint;
  try {
    maxListingPriceWei = BigInt(trustTier.maxListingPriceWei);
  } catch {
    return requestedPriceWei;
  }

  return maxListingPriceWei < requestedPriceWei
    ? maxListingPriceWei
    : requestedPriceWei;
}

export function isStakeCappedListingPrice(
  input: StakeSafeListingPriceInput | null | undefined,
  requestedPriceWei: bigint = DEFAULT_MARKETPLACE_LISTING_PRICE_WEI,
): boolean {
  return (
    resolveStakeSafeListingPriceWei(input, requestedPriceWei) <
    requestedPriceWei
  );
}

export function resolveStakeSafeListingPriceUnits(
  input: StakeSafeListingPriceUnitsInput | null | undefined,
  requestedPriceWei: bigint = DEFAULT_MARKETPLACE_LISTING_PRICE_WEI,
): bigint {
  const asset = input?.asset ?? null;
  const requestedPriceUnits = convertCanonicalListingPriceToAssetUnits({
    canonicalPriceWei: requestedPriceWei,
    asset,
  });
  const releaseStakeCapUnits = resolveReleaseStakeCapUnits(input);
  if (releaseStakeCapUnits != null) {
    return releaseStakeCapUnits < requestedPriceUnits
      ? releaseStakeCapUnits
      : requestedPriceUnits;
  }

  const trustTier = input?.trustTier;
  if (
    !trustTier ||
    trustTier.maxListingPriceUncapped ||
    !trustTier.maxListingPriceWei
  ) {
    return requestedPriceUnits;
  }

  let maxListingPriceWei: bigint;
  try {
    maxListingPriceWei = BigInt(trustTier.maxListingPriceWei);
  } catch {
    return requestedPriceUnits;
  }

  const maxListingPriceUnits = convertCanonicalListingPriceToAssetUnits({
    canonicalPriceWei: maxListingPriceWei,
    asset,
  });

  return maxListingPriceUnits < requestedPriceUnits
    ? maxListingPriceUnits
    : requestedPriceUnits;
}

export function isStakeCappedListingPriceUnits(
  input: StakeSafeListingPriceUnitsInput | null | undefined,
  requestedPriceWei: bigint = DEFAULT_MARKETPLACE_LISTING_PRICE_WEI,
): boolean {
  const requestedPriceUnits = convertCanonicalListingPriceToAssetUnits({
    canonicalPriceWei: requestedPriceWei,
    asset: input?.asset ?? null,
  });

  return (
    resolveStakeSafeListingPriceUnits(input, requestedPriceWei) <
    requestedPriceUnits
  );
}
