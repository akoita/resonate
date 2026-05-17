import { describe, expect, it } from "vitest";
import {
  convertCanonicalListingPriceToAssetUnits,
  formatListingPrice,
  listingPaymentToken,
  parseListingPriceUnits,
  selectDefaultMarketplaceListingAsset,
} from "./listingPricing";
import { ZERO_PAYMENT_TOKEN, type PaymentAsset } from "./payments";

const native: PaymentAsset = {
  assetId: "base-sepolia:eth",
  chainId: 84532,
  symbol: "ETH",
  name: "Ether",
  kind: "native",
  tokenAddress: ZERO_PAYMENT_TOKEN,
  decimals: 18,
  enabled: true,
  settlement: ["marketplace"],
  pricingStrategy: "fixed_test_price",
};

const usdc: PaymentAsset = {
  assetId: "base-sepolia:usdc",
  chainId: 84532,
  symbol: "USDC",
  name: "USD Coin",
  kind: "stablecoin",
  tokenAddress: "0x00000000000000000000000000000000000000a0",
  decimals: 6,
  enabled: true,
  settlement: ["marketplace", "x402"],
  pricingStrategy: "usd_pegged",
};

describe("marketplace listing pricing", () => {
  it("prefers a configured stablecoin marketplace asset over native", () => {
    const asset = selectDefaultMarketplaceListingAsset({
      assets: [native, usdc],
      chainId: 84532,
      defaultAssetId: native.assetId,
    });

    expect(asset?.assetId).toBe(usdc.assetId);
    expect(listingPaymentToken(asset)).toBe(usdc.tokenAddress);
  });

  it("falls back to native listings when no stablecoin marketplace asset exists", () => {
    const asset = selectDefaultMarketplaceListingAsset({
      assets: [native],
      chainId: 84532,
      defaultAssetId: native.assetId,
    });

    expect(asset?.assetId).toBe(native.assetId);
    expect(listingPaymentToken(asset)).toBe(ZERO_PAYMENT_TOKEN);
  });

  it("parses and formats stablecoin prices with token decimals", () => {
    const units = parseListingPriceUnits({ price: "0.05", asset: usdc });
    expect(units).toBe(50_000n);
    expect(formatListingPrice({ priceUnits: units, asset: usdc })).toBe("0.05 USDC");
  });

  it("converts the existing 18-decimal canonical listing price to USDC units", () => {
    const units = convertCanonicalListingPriceToAssetUnits({
      canonicalPriceWei: 10_000_000_000_000_000n,
      asset: usdc,
    });

    expect(units).toBe(10_000n);
  });
});
