import { describe, expect, it } from "vitest";
import {
  defaultBuyPaymentMethod,
  formatStableAssetAmount,
  formatUsdPrice,
  getCheckoutRailLabel,
  getCheckoutRailSubLabel,
} from "./buyPricing";

describe("buy pricing helpers", () => {
  it("defaults the purchase flow to quick checkout when it is available", () => {
    expect(defaultBuyPaymentMethod(true)).toBe("x402");
    expect(defaultBuyPaymentMethod(false)).toBe("onchain");
  });

  it("formats the user-facing price in dollars and the settlement amount in token units", () => {
    expect(formatUsdPrice(0.05)).toBe("$0.05");
    expect(formatUsdPrice(1234.5)).toBe("$1,234.50");
    expect(formatUsdPrice(null)).toBe("-");
    expect(formatStableAssetAmount(0.05, "USDC")).toBe("0.05 USDC");
  });

  it("names checkout choices for what the buyer gets, never the protocol or token (#2724)", () => {
    expect(getCheckoutRailLabel("x402")).toBe("Quick checkout");
    expect(getCheckoutRailLabel("onchain")).toBe("Standard checkout");
    expect(getCheckoutRailSubLabel({ method: "x402" })).toBe("Personal license · download right away");
    expect(getCheckoutRailSubLabel({ method: "onchain" })).toBe("Every license · added to your library");
    for (const method of ["x402", "onchain"] as const) {
      const text = `${getCheckoutRailLabel(method)} ${getCheckoutRailSubLabel({ method })}`;
      expect(text).not.toMatch(/x402|rail|on-chain|USDC|wallet transaction/i);
    }
  });
});
