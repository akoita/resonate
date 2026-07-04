import { describe, expect, it } from "vitest";
import type { PaymentAsset } from "./payments";
import {
  calculateSellerNetUnits,
  formatBpsPercent,
  sellerNetProceedsLine,
} from "./marketplaceProceeds";

const usdc: PaymentAsset = {
  assetId: "base:usdc",
  chainId: 84532,
  symbol: "USDC",
  name: "USD Coin",
  kind: "stablecoin",
  tokenAddress: "0x0000000000000000000000000000000000000001",
  decimals: 6,
  enabled: true,
  settlement: ["marketplace"],
  pricingStrategy: "usd_pegged",
};

describe("marketplace proceeds helpers", () => {
  it("formats basis points as compact percentages", () => {
    expect(formatBpsPercent(1000)).toBe("10%");
    expect(formatBpsPercent(1250n)).toBe("12.5%");
  });

  it("subtracts platform fee and royalty from seller proceeds", () => {
    expect(calculateSellerNetUnits({
      grossUnits: 10_000_000n,
      protocolFeeBps: 1000n,
      royaltyBps: 500,
    })).toBe(8_500_000n);
  });

  it("builds a seller-facing proceeds line with listing asset formatting", () => {
    expect(sellerNetProceedsLine({
      priceUnits: 10_000_000n,
      asset: usdc,
      protocolFeeBps: 1000n,
      royaltyBps: 500,
    })).toBe("You receive ≈ 8.5 USDC after the 10% platform fee and 5% royalty.");
  });
});
