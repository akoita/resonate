import { describe, expect, it } from "vitest";
import {
  defaultBuyPaymentMethod,
  formatStableAssetAmount,
  formatUsdPrice,
  getCheckoutRailLabel,
  getCheckoutRailSubLabel,
} from "./buyPricing";

describe("buy pricing helpers", () => {
  it("defaults the purchase flow to stablecoin checkout when x402 is available", () => {
    expect(defaultBuyPaymentMethod(true)).toBe("x402");
    expect(defaultBuyPaymentMethod(false)).toBe("onchain");
  });

  it("formats the user-facing price in USD and settlement amount in stablecoin units", () => {
    expect(formatUsdPrice(0.05)).toBe("$0.05 USD");
    expect(formatStableAssetAmount(0.05, "USDC")).toBe("0.05 USDC");
  });

  it("labels checkout choices as rails rather than currencies", () => {
    expect(getCheckoutRailLabel("x402")).toBe("x402 rail");
    expect(getCheckoutRailLabel("onchain")).toBe("On-chain rail");
    expect(getCheckoutRailSubLabel({ method: "x402", symbol: "USDC" })).toBe(
      "HTTP payment · USDC",
    );
    expect(getCheckoutRailSubLabel({
      method: "onchain",
      symbol: "USDC",
      isStablecoin: true,
    })).toBe("Wallet transaction · stablecoin USDC");
  });
});
