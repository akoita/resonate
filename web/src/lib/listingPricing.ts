import { formatUnits, parseUnits, type Address } from "viem";
import {
  paymentAssetSupportsSurface,
  ZERO_PAYMENT_TOKEN,
  type PaymentAsset,
} from "./payments";

export type MarketplaceListingAsset = PaymentAsset | null;

export function selectDefaultMarketplaceListingAsset(input: {
  assets: PaymentAsset[];
  chainId?: number;
  defaultAssetId?: string | null;
}): MarketplaceListingAsset {
  const candidates = input.assets.filter((asset) => {
    if (input.chainId && asset.chainId !== input.chainId) return false;
    return paymentAssetSupportsSurface(asset, "marketplace");
  });

  const defaultAsset = input.defaultAssetId
    ? candidates.find((asset) => asset.assetId === input.defaultAssetId)
    : null;
  if (defaultAsset?.kind === "stablecoin") return defaultAsset;

  const stablecoin = candidates.find((asset) => asset.kind === "stablecoin");
  if (stablecoin) return stablecoin;

  return defaultAsset ?? candidates.find((asset) => asset.kind === "native") ?? null;
}

export function listingPaymentToken(asset: MarketplaceListingAsset): Address {
  return (asset?.tokenAddress ?? ZERO_PAYMENT_TOKEN) as Address;
}

export function listingAssetSymbol(asset: MarketplaceListingAsset): string {
  return asset?.symbol ?? "ETH";
}

export function listingAssetDecimals(asset: MarketplaceListingAsset): number {
  return asset?.decimals ?? 18;
}

export function hasStablecoinMarketplaceAsset(input: {
  assets: PaymentAsset[];
  chainId?: number;
}): boolean {
  return input.assets.some((asset) => {
    if (input.chainId && asset.chainId !== input.chainId) return false;
    return asset.kind === "stablecoin" && paymentAssetSupportsSurface(asset, "marketplace");
  });
}

export function parseListingPriceUnits(input: {
  price: string;
  asset: MarketplaceListingAsset;
}): bigint {
  return parseUnits(input.price || "0", listingAssetDecimals(input.asset));
}

export function convertCanonicalListingPriceToAssetUnits(input: {
  canonicalPriceWei: bigint;
  asset: MarketplaceListingAsset;
}): bigint {
  const canonicalAmount = formatUnits(input.canonicalPriceWei, 18);
  return parseUnits(canonicalAmount, listingAssetDecimals(input.asset));
}

export function formatListingPrice(input: {
  priceUnits: bigint;
  asset: MarketplaceListingAsset;
}): string {
  const formatted = formatUnits(input.priceUnits, listingAssetDecimals(input.asset));
  const [whole, fraction = ""] = formatted.split(".");
  const trimmed = fraction.replace(/0+$/, "").slice(0, 6);
  return `${trimmed ? `${whole}.${trimmed}` : whole} ${listingAssetSymbol(input.asset)}`;
}
