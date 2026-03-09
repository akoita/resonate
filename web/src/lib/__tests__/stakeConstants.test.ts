import { describe, it, expect } from "vitest";
import {
  formatEth,
  deriveStakeStatus,
  deriveEscrowStatus,
  STAKE_STATUS_LABELS,
  ESCROW_STATUS_LABELS,
  TIER_LABELS,
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
    expect(TIER_LABELS.verified).toBeDefined();
  });
});
