/**
 * Shared constants and utilities for Content Protection stake UI.
 *
 * Used by StakeDepositCard (upload page), ContentProtectionBadge (public pages),
 * and MyStakesCard (wallet dashboard).
 */

// ============ Trust Tier Display ============

export const TIER_LABELS: Record<string, string> = {
  new: "New Creator",
  established: "Established",
  trusted: "Trusted",
  verified: "Verified ✓",
};

export const TIER_COLORS: Record<string, string> = {
  new: "#f59e0b",
  established: "#3b82f6",
  trusted: "#8b5cf6",
  verified: "#10b981",
};

// ============ Formatting Helpers ============

/**
 * Format a wei value (string or bigint) to a human-readable ETH string.
 * Returns "Waived" for zero values.
 */
export function formatEth(wei: string | bigint): string {
  const numeric = typeof wei === "bigint" ? Number(wei) : Number(wei);
  const eth = numeric / 1e18;
  if (eth === 0) return "Waived";
  return `${eth} ETH`;
}

/**
 * Parse an ISO date string from the backend into epoch seconds.
 * Returns 0n for missing or invalid timestamps so UI code can degrade safely.
 */
export function parseDateToEpochSeconds(value?: string | null): bigint {
  if (!value) return 0n;

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 0n;

  return BigInt(Math.floor(timestamp / 1000));
}

/**
 * Format an ISO date string for display, falling back to an em dash when absent.
 */
export function formatOptionalDate(value?: string | null): string {
  if (!value) return "\u2014";

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "\u2014";

  return new Date(timestamp).toLocaleDateString();
}

// ============ Status Derivation ============

export type StakeStatus = "active" | "releasable" | "refunded" | "slashed" | "not_staked";

/**
 * Derive a human-readable stake status from on-chain data.
 *
 * @param active   - `stakes[tokenId].active`  (on-chain)
 * @param amount   - `stakes[tokenId].amount`   (on-chain, 0n means never staked)
 * @param depositedAt - `stakes[tokenId].depositedAt` (seconds since epoch)
 * @param escrowDays  - escrow period in days (from backend trust tier, default 30)
 */
export function deriveStakeStatus(
  active: boolean,
  amount: bigint,
  depositedAt: bigint,
  escrowDays = 30,
): StakeStatus {
  if (amount === 0n) return "not_staked";
  if (!active) return "refunded"; // stake was withdrawn or slashed
  const escrowEnd = Number(depositedAt) + escrowDays * 86400;
  const now = Math.floor(Date.now() / 1000);
  return now >= escrowEnd ? "releasable" : "active";
}

export const STAKE_STATUS_LABELS: Record<StakeStatus, string> = {
  active: "Active ✓",
  releasable: "Releasable",
  refunded: "Refunded",
  slashed: "Slashed ⚠️",
  not_staked: "Not Staked",
};

export const STAKE_STATUS_COLORS: Record<StakeStatus, string> = {
  active: "#10b981",
  releasable: "#3b82f6",
  refunded: "#a1a1aa",
  slashed: "#ef4444",
  not_staked: "#6b7280",
};

// ============ Escrow Helpers ============

export type EscrowStatus = "locked" | "releasable" | "released" | "none";

/**
 * Derive escrow status and remaining days from on-chain data.
 */
export function deriveEscrowStatus(
  active: boolean,
  depositedAt: bigint,
  escrowDays = 30,
): { status: EscrowStatus; daysRemaining: number } {
  if (depositedAt === 0n) return { status: "none", daysRemaining: 0 };
  if (!active) return { status: "released", daysRemaining: 0 };

  const escrowEnd = Number(depositedAt) + escrowDays * 86400;
  const now = Math.floor(Date.now() / 1000);
  const remaining = Math.max(0, Math.ceil((escrowEnd - now) / 86400));

  return remaining > 0
    ? { status: "locked", daysRemaining: remaining }
    : { status: "releasable", daysRemaining: 0 };
}

export const ESCROW_STATUS_LABELS: Record<EscrowStatus, string> = {
  locked: "Locked",
  releasable: "Releasable",
  released: "Released",
  none: "—",
};
