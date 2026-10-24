import { describe, it, expect } from "vitest";
import {
  formatEth,
  formatStakeAmount,
  formatStakeTotals,
  formatReleaseStake,
  formatUsdValue,
  parseDateToEpochSeconds,
  formatOptionalDate,
  deriveStakeStatus,
  deriveEscrowStatus,
  STAKE_STATUS_LABELS,
  ESCROW_STATUS_LABELS,
  TIER_LABELS,
  stakeActionLabel,
} from "../stakeConstants";

// ============ formatEth ============

describe("formatEth", () => {
  it("returns 'Waived' for zero", () => {
    expect(formatEth(0n)).toBe("Waived");
    expect(formatEth("0")).toBe("Waived");
  });

  it("formats 1 ETH", () => {
    expect(formatEth(1000000000000000000n)).toBe("1 ETH");
  });

  it("formats 0.01 ETH", () => {
    expect(formatEth(10000000000000000n)).toBe("0.01 ETH");
  });

  it("accepts string input", () => {
    expect(formatEth("10000000000000000")).toBe("0.01 ETH");
  });
});

// ============ formatStakeAmount ============

describe("formatStakeAmount", () => {
  it("formats a stablecoin stake in its own 6-decimal units", () => {
    expect(formatStakeAmount(5_000_000n, { symbol: "USDC", decimals: 6 })).toBe("5 USDC");
    expect(formatStakeAmount("5000000", { symbol: "USDC", decimals: 6 })).toBe("5 USDC");
    expect(formatStakeAmount("5500000", { symbol: "USDC", decimals: 6 })).toBe("5.5 USDC");
  });

  it("limits stablecoins to two decimals", () => {
    expect(formatStakeAmount("5125000", { symbol: "USDC", decimals: 6 })).toBe("5.12 USDC");
  });

  it("formats native ETH with up to six decimals", () => {
    expect(formatStakeAmount(5_000_000_000_000_000n, { symbol: "ETH", decimals: 18 })).toBe("0.005 ETH");
    expect(formatStakeAmount("1234567890000000000", { symbol: "ETH", decimals: 18 })).toBe("1.234567 ETH");
  });

  it("defaults to native ETH when the asset is unknown", () => {
    expect(formatStakeAmount("10000000000000000")).toBe("0.01 ETH");
    expect(formatStakeAmount("10000000000000000", { symbol: null, decimals: null })).toBe("0.01 ETH");
  });

  it("returns Waived for zero", () => {
    expect(formatStakeAmount(0n, { symbol: "USDC", decimals: 6 })).toBe("Waived");
    expect(formatStakeAmount("0")).toBe("Waived");
  });

  it("never uses exponent notation", () => {
    // The regression: 5 USDC (5_000_000 base units) read as 18-decimal ETH printed "5e-12 ETH".
    const label = formatStakeAmount(5_000_000n, { symbol: "ETH", decimals: 18 });
    expect(label).toBe("< 0.000001 ETH");
    expect(label).not.toMatch(/e[-+]?\d/i);
    expect(formatStakeAmount("1", { symbol: "ETH", decimals: 18 })).not.toMatch(/e[-+]?\d/i);
    expect(formatStakeAmount("1", { symbol: "USDC", decimals: 6 })).toBe("< 0.01 USDC");
  });

  it("formats large values exactly with thousands separators", () => {
    expect(formatStakeAmount("1234567000000", { symbol: "USDC", decimals: 6 })).toBe("1,234,567 USDC");
    expect(formatStakeAmount("123456789012345678901234567890", { symbol: "ETH", decimals: 18 })).toBe(
      "123,456,789,012.345678 ETH",
    );
  });

  it("appends the USD value for non-USD assets only", () => {
    expect(formatStakeAmount("2000000000000000", { symbol: "ETH", decimals: 18, usd: "5" })).toBe(
      "0.002 ETH (\u2248 $5)",
    );
    expect(formatStakeAmount("5000000", { symbol: "USDC", decimals: 6, usd: "5" })).toBe("5 USDC");
    expect(formatStakeAmount("2000000000000000", { symbol: "ETH", decimals: 18, usd: null })).toBe("0.002 ETH");
  });

  it("returns an em dash for missing or invalid input", () => {
    expect(formatStakeAmount(undefined)).toBe("\u2014");
    expect(formatStakeAmount(null)).toBe("\u2014");
    expect(formatStakeAmount("")).toBe("\u2014");
    expect(formatStakeAmount("not-a-number")).toBe("\u2014");
    expect(formatStakeAmount("-5")).toBe("\u2014");
  });
});

describe("formatEth (native ETH wrapper)", () => {
  it("does not print exponent notation for tiny values", () => {
    expect(formatEth(5_000_000n)).not.toMatch(/e[-+]?\d/i);
  });
});

describe("formatUsdValue", () => {
  it("formats whole and fractional dollars", () => {
    expect(formatUsdValue("5")).toBe("$5");
    expect(formatUsdValue("5.50")).toBe("$5.5");
    expect(formatUsdValue(1234.567)).toBe("$1,234.57");
  });

  it("returns null when unknown or not positive", () => {
    expect(formatUsdValue(null)).toBeNull();
    expect(formatUsdValue("")).toBeNull();
    expect(formatUsdValue("0")).toBeNull();
    expect(formatUsdValue("abc")).toBeNull();
  });
});

describe("formatStakeTotals", () => {
  it("lists each asset separately instead of adding base units", () => {
    expect(
      formatStakeTotals([
        { assetSymbol: "USDC", assetDecimals: 6, amount: "10000000" },
        { assetSymbol: "ETH", assetDecimals: 18, amount: "2000000000000000", amountUsd: "5" },
      ]),
    ).toBe("10 USDC + 0.002 ETH (\u2248 $5)");
  });

  it("shows 0 when nothing is staked", () => {
    expect(formatStakeTotals([])).toBe("0");
    expect(formatStakeTotals([{ assetSymbol: "USDC", assetDecimals: 6, amount: "0" }])).toBe("0");
    expect(formatStakeTotals(undefined, "0")).toBe("0");
  });

  it("treats the legacy total as native wei", () => {
    expect(formatStakeTotals(undefined, "10000000000000000")).toBe("0.01 ETH");
  });
});

describe("formatReleaseStake", () => {
  it("shows a recorded USDC stake as 5 USDC, not 5e-12 ETH", () => {
    expect(
      formatReleaseStake({
        staked: true,
        stakeAmount: "5000000",
        stakeAssetSymbol: "USDC",
        stakeAssetDecimals: 6,
        stakeAmountUsd: "5",
      }),
    ).toBe("5 USDC");
  });

  it("shows a recorded ETH stake with its USD value", () => {
    expect(
      formatReleaseStake({
        staked: true,
        stakeAmount: "2000000000000000",
        stakeAssetSymbol: "ETH",
        stakeAssetDecimals: 18,
        stakeAmountUsd: "5",
      }),
    ).toBe("0.002 ETH (\u2248 $5)");
  });

  it("shows the USD requirement before anything is staked", () => {
    expect(
      formatReleaseStake({
        staked: false,
        stakeAmount: "2000000000000000",
        stakeAssetSymbol: "ETH",
        stakeAssetDecimals: 18,
        stakeAmountUsd: "5",
      }),
    ).toBe("$5 required");
  });

  it("falls back to the native amount when no USD value is known, and reports waived stakes", () => {
    expect(formatReleaseStake({ staked: false, stakeAmount: "10000000000000000" })).toBe("0.01 ETH");
    expect(formatReleaseStake({ staked: false, stakeAmount: "0", stakeAmountUsd: "0" })).toBe("Waived");
    expect(formatReleaseStake({ staked: false, stakeAmount: "" })).toBe("\u2014");
  });
});

// ============ date helpers ============

describe("parseDateToEpochSeconds", () => {
  it("returns epoch seconds for a valid ISO date", () => {
    expect(parseDateToEpochSeconds("2024-01-02T03:04:05.000Z")).toBe(1704164645n);
  });

  it("returns 0 for missing or invalid dates", () => {
    expect(parseDateToEpochSeconds("")).toBe(0n);
    expect(parseDateToEpochSeconds("not-a-date")).toBe(0n);
    expect(parseDateToEpochSeconds(null)).toBe(0n);
  });
});

describe("formatOptionalDate", () => {
  it("returns a fallback for missing or invalid dates", () => {
    expect(formatOptionalDate("")).toBe("—");
    expect(formatOptionalDate("not-a-date")).toBe("—");
    expect(formatOptionalDate(undefined)).toBe("—");
  });
});

// ============ deriveStakeStatus ============

describe("deriveStakeStatus", () => {
  it("returns 'not_staked' when amount is 0", () => {
    expect(deriveStakeStatus(false, 0n, 0n, 30)).toBe("not_staked");
  });

  it("returns 'refunded' when not active", () => {
    expect(deriveStakeStatus(false, 10000000000000000n, 1000000n, 30)).toBe("refunded");
  });

  it("returns 'active' when within escrow period", () => {
    // depositedAt = now (so escrow hasn't elapsed yet)
    const now = BigInt(Math.floor(Date.now() / 1000));
    expect(deriveStakeStatus(true, 10000000000000000n, now, 30)).toBe("active");
  });

  it("returns 'releasable' when escrow has elapsed", () => {
    // depositedAt = 60 days ago, escrow = 30
    const sixtyDaysAgo = BigInt(Math.floor(Date.now() / 1000) - 60 * 86400);
    expect(deriveStakeStatus(true, 10000000000000000n, sixtyDaysAgo, 30)).toBe("releasable");
  });
});

// ============ deriveEscrowStatus ============

describe("deriveEscrowStatus", () => {
  it("returns 'none' when depositedAt is 0", () => {
    const result = deriveEscrowStatus(true, 0n, 30);
    expect(result.status).toBe("none");
    expect(result.daysRemaining).toBe(0);
  });

  it("returns 'released' when not active", () => {
    const result = deriveEscrowStatus(false, 1000000n, 30);
    expect(result.status).toBe("released");
    expect(result.daysRemaining).toBe(0);
  });

  it("returns 'locked' with days remaining when within period", () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const result = deriveEscrowStatus(true, now, 30);
    expect(result.status).toBe("locked");
    expect(result.daysRemaining).toBeGreaterThanOrEqual(29);
    expect(result.daysRemaining).toBeLessThanOrEqual(30);
  });

  it("returns 'releasable' when escrow has elapsed", () => {
    const sixtyDaysAgo = BigInt(Math.floor(Date.now() / 1000) - 60 * 86400);
    const result = deriveEscrowStatus(true, sixtyDaysAgo, 30);
    expect(result.status).toBe("releasable");
    expect(result.daysRemaining).toBe(0);
  });
});

// ============ Label maps completeness ============

describe("label maps", () => {
  it("STAKE_STATUS_LABELS covers all statuses", () => {
    expect(STAKE_STATUS_LABELS.active).toBeDefined();
    expect(STAKE_STATUS_LABELS.releasable).toBeDefined();
    expect(STAKE_STATUS_LABELS.refunded).toBeDefined();
    expect(STAKE_STATUS_LABELS.slashed).toBeDefined();
    expect(STAKE_STATUS_LABELS.not_staked).toBeDefined();
  });

  it("ESCROW_STATUS_LABELS covers all statuses", () => {
    expect(ESCROW_STATUS_LABELS.locked).toBeDefined();
    expect(ESCROW_STATUS_LABELS.releasable).toBeDefined();
    expect(ESCROW_STATUS_LABELS.released).toBeDefined();
    expect(ESCROW_STATUS_LABELS.none).toBeDefined();
  });

  it("TIER_LABELS covers all tiers", () => {
    expect(TIER_LABELS.new).toBeDefined();
    expect(TIER_LABELS.established).toBeDefined();
    expect(TIER_LABELS.trusted).toBeDefined();
    expect(TIER_LABELS.verified).toBe("Verified Economic Tier");
  });
});

// ============ stakeActionLabel (#1758) ============

describe("stakeActionLabel", () => {
  it("never promises the viewer an action they cannot perform", () => {
    // refundStake is owner-only on-chain, so no state may read as an
    // invitation to withdraw until #1759 ships a creator-callable claim.
    const labels = [
      stakeActionLabel("active"),
      stakeActionLabel("releasable"),
      stakeActionLabel("refunded"),
      stakeActionLabel("slashed"),
      stakeActionLabel("not_staked"),
    ];
    for (const label of labels) {
      expect(label.toLowerCase()).not.toContain("withdraw");
      expect(label.toLowerCase()).not.toContain("claim");
      expect(label.toLowerCase()).not.toContain("release your");
    }
  });

  it("says who issues the refund once the escrow has elapsed", () => {
    expect(stakeActionLabel("releasable")).toBe("Refund issued by Resonate");
  });

  it("keeps an in-escrow stake marked as locked", () => {
    expect(stakeActionLabel("active")).toBe("Locked");
  });

  it("has nothing to say about settled stakes", () => {
    expect(stakeActionLabel("refunded")).toBe("\u2014");
    expect(stakeActionLabel("slashed")).toBe("\u2014");
  });
});

// ============ status labels describe time, not permission (#1758) ============

describe("stake status labels", () => {
  it("does not label an elapsed escrow as something the viewer can release", () => {
    expect(STAKE_STATUS_LABELS.releasable).toBe("Escrow ended");
    expect(ESCROW_STATUS_LABELS.releasable).toBe("Elapsed");
  });
});
