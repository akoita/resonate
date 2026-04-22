import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARKETPLACE_LISTING_PRICE_WEI,
  isStakeCappedListingPrice,
  resolveStakeSafeListingPriceWei,
} from "../stakeSafeListingPrice";

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
});
