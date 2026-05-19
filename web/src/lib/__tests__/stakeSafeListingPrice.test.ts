import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARKETPLACE_LISTING_PRICE_WEI,
  isStakeCappedListingPrice,
  isStakeCappedListingPriceUnits,
  resolveStakeSafeListingPriceWei,
  resolveStakeSafeListingPriceUnits,
} from "../stakeSafeListingPrice";
import { ZERO_PAYMENT_TOKEN, type PaymentAsset } from "../payments";

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

describe("stakeSafeListingPrice", () => {
  it("keeps the default listing price when no trust tier is available", () => {
    expect(resolveStakeSafeListingPriceWei(null)).toBe(
      DEFAULT_MARKETPLACE_LISTING_PRICE_WEI,
    );
  });

  it("keeps the default listing price when listings are uncapped", () => {
    expect(
      resolveStakeSafeListingPriceWei({
        trustTier: {
          maxListingPriceUncapped: true,
          maxListingPriceWei: null,
          maxPriceMultiplier: 10,
        },
      }),
    ).toBe(DEFAULT_MARKETPLACE_LISTING_PRICE_WEI);
  });

  it("caps the listing price when the trust tier max is lower than default", () => {
    expect(
      resolveStakeSafeListingPriceWei({
        trustTier: {
          maxListingPriceUncapped: false,
          maxListingPriceWei: "5000000000000000",
          maxPriceMultiplier: 10,
        },
      }),
    ).toBe(BigInt("5000000000000000"));
  });

  it("does not mark the price as capped when the max is higher than default", () => {
    expect(
      isStakeCappedListingPrice({
        trustTier: {
          maxListingPriceUncapped: false,
          maxListingPriceWei: "50000000000000000",
          maxPriceMultiplier: 10,
        },
      }),
    ).toBe(false);
  });

  it("marks the price as capped when the max is lower than default", () => {
    expect(
      isStakeCappedListingPrice({
        trustTier: {
          maxListingPriceUncapped: false,
          maxListingPriceWei: "5000000000000000",
          maxPriceMultiplier: 10,
        },
      }),
    ).toBe(true);
  });

  it("uses the active release stake amount when available", () => {
    expect(
      resolveStakeSafeListingPriceWei({
        trustTier: {
          maxListingPriceUncapped: false,
          maxListingPriceWei: "50000000000000000",
          maxPriceMultiplier: 10,
        },
        releaseProtection: {
          staked: true,
          active: true,
          stakeAmount: "500000000000000",
        },
      }),
    ).toBe(BigInt("5000000000000000"));
  });

  it("falls back to the default multiplier when release stake exists before trust tier loads", () => {
    expect(
      resolveStakeSafeListingPriceWei({
        releaseProtection: {
          staked: true,
          active: true,
          stakeAmount: "500000000000000",
        },
      }),
    ).toBe(BigInt("5000000000000000"));
  });

  it("resolves uncapped stablecoin listing prices in the asset decimals", () => {
    expect(
      resolveStakeSafeListingPriceUnits({
        asset: usdc,
      }),
    ).toBe(10_000n);
  });

  it("keeps USDC stake caps in USDC units instead of treating them as wei", () => {
    expect(
      resolveStakeSafeListingPriceUnits({
        asset: usdc,
        trustTier: {
          maxListingPriceUncapped: false,
          maxListingPriceWei: "50000000000000000",
          maxPriceMultiplier: 10,
        },
        releaseProtection: {
          staked: true,
          active: true,
          stakeAmount: "5000000",
        },
      }),
    ).toBe(10_000n);
  });

  it("caps stablecoin listings when the stake cap is below the requested price", () => {
    expect(
      resolveStakeSafeListingPriceUnits(
        {
          asset: usdc,
          trustTier: {
            maxListingPriceUncapped: false,
            maxListingPriceWei: "50000000000000000",
            maxPriceMultiplier: 10,
          },
          releaseProtection: {
            staked: true,
            active: true,
            stakeAmount: "999",
          },
        },
        10_000_000_000_000_000n,
      ),
    ).toBe(9_990n);
  });

  it("reports asset-unit caps using the selected marketplace asset", () => {
    expect(
      isStakeCappedListingPriceUnits(
        {
          asset: usdc,
          releaseProtection: {
            staked: true,
            active: true,
            stakeAmount: "1000",
          },
        },
        10_000_000_000_000_000n,
      ),
    ).toBe(false);
    expect(
      isStakeCappedListingPriceUnits(
        {
          asset: native,
          releaseProtection: {
            staked: true,
            active: true,
            stakeAmount: "1000",
          },
        },
        10_000_000_000_000_000n,
      ),
    ).toBe(true);
  });
});
