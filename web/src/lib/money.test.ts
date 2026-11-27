import { describe, expect, it } from "vitest";
import {
  formatDollars,
  formatTokenAmountForPeople,
  formatUnitsForPeople,
  isUsdPeggedAsset,
  isUsdStablecoinSymbol,
  paidAsText,
} from "./money";

describe("money display (#2724)", () => {
  it("formats dollars and cents from numbers and decimal strings", () => {
    expect(formatDollars(7)).toBe("$7.00");
    expect(formatDollars("19.995")).toBe("$20.00");
    expect(formatDollars("1234567.1")).toBe("$1,234,567.10");
    expect(formatDollars(0)).toBe("$0.00");
    expect(formatDollars("0.004")).toBe("under $0.01");
  });

  it("refuses to guess an unreadable amount", () => {
    expect(formatDollars(null)).toBe("price unknown");
    expect(formatDollars("abc")).toBe("price unknown");
    expect(formatDollars(-1)).toBe("price unknown");
    expect(formatDollars(Number.NaN)).toBe("price unknown");
  });

  it("reads dollar stablecoins as dollars and leaves other tokens as tokens", () => {
    expect(isUsdStablecoinSymbol("USDC")).toBe(true);
    expect(isUsdStablecoinSymbol("ETH")).toBe(false);
    expect(formatTokenAmountForPeople("1.025", "USDC")).toBe("$1.03");
    expect(formatTokenAmountForPeople("0.01", "ETH")).toBe("0.01 ETH");
  });

  it("formats raw token units for people", () => {
    expect(formatUnitsForPeople(2_000_000n, { decimals: 6, symbol: "USDC", usdPegged: true })).toBe("$2.00");
    expect(formatUnitsForPeople(10n ** 16n, { decimals: 18, symbol: "ETH", usdPegged: false })).toBe("0.01 ETH");
  });

  it("knows which payment assets are dollar-pegged", () => {
    expect(isUsdPeggedAsset({ kind: "stablecoin", pricingStrategy: "usd_pegged", symbol: "USDC" })).toBe(true);
    expect(isUsdPeggedAsset({ kind: "stablecoin", pricingStrategy: "fixed_test_price", symbol: "USDC" })).toBe(true);
    expect(isUsdPeggedAsset({ kind: "native", pricingStrategy: "chainlink_feed", symbol: "ETH" })).toBe(false);
    expect(isUsdPeggedAsset(null)).toBe(false);
  });

  it("writes the settlement line for Payment details", () => {
    expect(paidAsText({ amount: "2", symbol: "USDC", network: "Base" })).toBe("Paid as 2 USDC on Base");
    expect(paidAsText({ amount: "2", symbol: "USDC" })).toBe("Paid as 2 USDC");
  });
});
