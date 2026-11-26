import { describe, expect, it } from "vitest";
import {
  dollarBalance,
  feesLine,
  formatDollars,
  formatWelcomeDollars,
  isTestMoneyChain,
  welcomeMoneyMessage,
} from "./walletPlainWords";

const asset = (kind: "stablecoin" | "native", decimals: number) => ({
  assetId: kind,
  chainId: 84532,
  symbol: kind === "stablecoin" ? "USDC" : "ETH",
  name: kind,
  kind,
  tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const,
  decimals,
  enabled: true,
  settlement: [],
  pricingStrategy: "usd_pegged" as const,
});

describe("wallet plain words", () => {
  it("adds up dollar-pegged balances only", () => {
    expect(dollarBalance([
      { asset: asset("stablecoin", 6), balanceUnits: BigInt(20_500_000) },
      { asset: asset("native", 18), balanceUnits: BigInt(10) ** BigInt(18) },
    ])).toBe(20.5);
  });

  it("formats dollars for people", () => {
    expect(formatDollars(20.5)).toBe("$20.50");
    expect(formatDollars(1234)).toBe("$1,234.00");
    expect(formatWelcomeDollars("20")).toBe("$20");
    expect(formatWelcomeDollars("2.5")).toBe("$2.50");
  });

  it("only calls test networks test money", () => {
    expect(isTestMoneyChain(84532)).toBe(true);
    expect(isTestMoneyChain(8453)).toBe(false);
    expect(isTestMoneyChain(null)).toBe(false);
  });

  it("never uses jargon in the welcome message", () => {
    const withDollars = welcomeMoneyMessage({ amountUsdc: "20", amountEth: "0.002" });
    const feesOnly = welcomeMoneyMessage({ amountEth: "0.002" });
    expect(withDollars).toContain("$20 of test money");
    for (const message of [withDollars, feesOnly]) {
      expect(message).not.toMatch(/ETH|smart account|gas|USDC|Sepolia/i);
    }
  });

  it("explains fees in plain words", () => {
    expect(feesLine({ sponsored: true, ethBalance: 0 })).toBe("Fees are on us.");
    expect(feesLine({ sponsored: false, ethBalance: 0 })).toMatch(/No fee money yet/);
    expect(feesLine({ sponsored: false, ethBalance: 0.004 })).toMatch(/ready/);
    expect(feesLine({ sponsored: false, ethBalance: null })).toBeNull();
  });
});
