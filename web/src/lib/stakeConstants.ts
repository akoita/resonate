/**
 * Shared constants and utilities for Content Protection stake UI.
 *
 * Used by StakeDepositCard (upload page), ContentProtectionBadge (public pages),
 * and MyStakesCard (wallet dashboard).
 */

import { formatUnits } from "viem";

// ============ Economic Trust Tier Display ============

export const TIER_LABELS: Record<string, string> = {
  new: "New Creator",
  established: "Established",
  trusted: "Trusted",
  verified: "Verified Economic Tier",
};

export const TIER_COLORS: Record<string, string> = {
  new: "#f59e0b",
  established: "#3b82f6",
  trusted: "#8b5cf6",
  verified: "#10b981",
};

// ============ Formatting Helpers ============

export interface StakeAssetInfo {
  /** Asset ticker as recorded with the stake (e.g. "USDC", "ETH"). Defaults to "ETH". */
  symbol?: string | null;
  /** Token decimals as recorded with the stake. Defaults to 18 (native ETH). */
  decimals?: number | null;
  /** Canonical USD value of the stake, when known. Appended for non-USD assets. */
  usd?: string | number | null;
}

const USD_PEGGED_SYMBOL = /^(USD|DAI$|PYUSD$|USDS$)/i;

function toBigInt(value: string | bigint | number): bigint | null {
  try {
    if (typeof value === "number" && !Number.isInteger(value)) return null;
    return BigInt(value);
  } catch {
    return null;
  }
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a canonical USD value such as "5" or "4.999" as "$5" or "$1,234.5". Returns
 * null when the value is missing or not a positive number.
 */
export function formatUsdValue(usd: string | number | null | undefined): string | null {
  if (usd === null || usd === undefined || usd === "") return null;
  const numeric = Number(usd);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const fixed = numeric.toFixed(2).replace(/\.?0+$/, "");
  const [whole, fraction] = fixed.split(".");
  return `$${groupThousands(whole)}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Format a stake amount stored in base units of its own payment asset.
 *
 * Uses exact integer arithmetic (never exponent notation). Stablecoin-sized
 * assets (6 decimals or fewer) show up to 2 decimals ("5 USDC"); 18-decimal
 * assets show up to 6 ("0.005 ETH"). Non-zero amounts below the display
 * precision render as "< 0.000001 ETH" instead of rounding to zero.
 * Returns "Waived" for zero and an em dash for unparseable input.
 */
export function formatStakeAmount(
  amount: string | bigint | number | null | undefined,
  asset: StakeAssetInfo = {},
): string {
  if (amount === null || amount === undefined || amount === "") return "\u2014";
  const units = toBigInt(amount);
  if (units === null || units < 0n) return "\u2014";
  if (units === 0n) return "Waived";

  const symbol = asset.symbol?.trim() || "ETH";
  const decimals =
    typeof asset.decimals === "number" && Number.isInteger(asset.decimals) && asset.decimals >= 0
      ? asset.decimals
      : 18;
  const maxFraction = Math.min(decimals, decimals <= 6 ? 2 : 6);

  const [whole, fraction = ""] = formatUnits(units, decimals).split(".");
  const kept = fraction.slice(0, maxFraction).replace(/0+$/, "");
  const isBelowPrecision = whole === "0" && kept === "";

  const body = isBelowPrecision
    ? `< ${maxFraction > 0 ? `0.${"0".repeat(maxFraction - 1)}1` : "1"}`
    : `${groupThousands(whole)}${kept ? `.${kept}` : ""}`;
  const label = `${body} ${symbol}`;

  const usd = USD_PEGGED_SYMBOL.test(symbol) ? null : formatUsdValue(asset.usd);
  return usd ? `${label} (\u2248 ${usd})` : label;
}

/**
 * Format a genuine 18-decimal native ETH value (string or bigint wei).
 * Stake records can be paid in other assets: use `formatStakeAmount` with the
 * record's own symbol and decimals for those.
 */
export function formatEth(wei: string | bigint): string {
  return formatStakeAmount(wei, { symbol: "ETH", decimals: 18 });
}

export interface AssetAmountTotal {
  assetSymbol: string;
  assetDecimals: number;
  /** Base units of this single asset. */
  amount: string;
  amountUsd?: string | null;
}

/**
 * One entry per asset ("5 USDC + 0.005 ETH"). Stakes are paid in different
 * assets, so base units are never added together across assets. Without a
 * per-asset breakdown, the legacy total is treated as native ETH wei.
 */
export function formatStakeTotals(
  totals: AssetAmountTotal[] | undefined,
  legacyNativeWei: string = "0",
): string {
  if (!totals) return legacyNativeWei === "0" ? "0" : formatEth(legacyNativeWei);
  const nonZero = totals.filter((t) => t.amount !== "0");
  if (nonZero.length === 0) return "0";
  return nonZero
    .map((t) =>
      formatStakeAmount(t.amount, { symbol: t.assetSymbol, decimals: t.assetDecimals, usd: t.amountUsd }),
    )
    .join(" + ");
}

export interface ReleaseStakeFields {
  staked: boolean;
  stakeAmount?: string | null;
  stakeAssetSymbol?: string | null;
  stakeAssetDecimals?: number | null;
  stakeAmountUsd?: string | null;
}

/**
 * Label for the release page "Stake" cell. A recorded stake is shown in its own
 * asset. Before anything is staked, `stakeAmount` is the native-ETH policy
 * requirement, so the USD requirement is preferred when known.
 */
export function formatReleaseStake(data: ReleaseStakeFields): string {
  if (!data.stakeAmount) return "\u2014";
  if (!data.staked && data.stakeAmount !== "0") {
    const usd = formatUsdValue(data.stakeAmountUsd);
    if (usd) return `${usd} required`;
  }
  return formatStakeAmount(data.stakeAmount, {
    symbol: data.stakeAssetSymbol,
    decimals: data.stakeAssetDecimals,
    usd: data.stakeAmountUsd,
  });
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

// "Escrow ended" rather than "Releasable": the status is derived from elapsed
// time. Whether the creator can actually withdraw comes from the contract's
// claim state (see `deriveStakeClaimAction`, #1759), not from this label.
export const STAKE_STATUS_LABELS: Record<StakeStatus, string> = {
  active: "Active ✓",
  releasable: "Escrow ended",
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
  releasable: "Elapsed",
  released: "Released",
  none: "—",
};

// ============ Self-claim (#1759) ============

/** Claim state of a stake as returned by `GET /metadata/stakes/:owner`. */
export interface StakeClaimInfo {
  active: boolean;
  /** ISO time the escrow ends; null when unknown or not yet recorded. */
  claimableAt?: string | null;
  /** ISO time a dispute hold stops blocking the claim; null when unknown. */
  failSafeAt?: string | null;
  /** Whether a dispute holds the stake; null when unknown. */
  locked?: boolean | null;
  /** Whether `claimStakeRefund` would succeed right now (read from the contract). */
  claimable?: boolean;
}

export type StakeClaimActionKind = "claim" | "scheduled" | "on_hold" | "pending" | "none";

export interface StakeClaimAction {
  kind: StakeClaimActionKind;
  /** Short label for the Actions column. */
  label: string;
  /** Optional longer explanation (tooltip / secondary line). */
  detail?: string;
}

/**
 * What the creator can do about their stake right now.
 *
 * The Claim control is offered only when the contract says the claim would
 * succeed (`claimable`), so the wallet never renders a button that reverts
 * (#1758). Otherwise it explains why not: the escrow date, a dispute hold
 * (with the latest date the hold can last), or a date not yet recorded.
 */
export function deriveStakeClaimAction(stake: StakeClaimInfo, nowMs: number = Date.now()): StakeClaimAction {
  if (!stake.active) return { kind: "none", label: "\u2014" };
  if (stake.claimable) return { kind: "claim", label: "Claim" };

  const claimableAtMs = stake.claimableAt ? Date.parse(stake.claimableAt) : NaN;
  if (stake.locked) {
    const failSafeMs = stake.failSafeAt ? Date.parse(stake.failSafeAt) : NaN;
    return {
      kind: "on_hold",
      label: "On hold: under dispute",
      detail: Number.isNaN(failSafeMs)
        ? "Claimable once the dispute is resolved in your favour."
        : `Claimable once the dispute is resolved in your favour, and on ${new Date(failSafeMs).toLocaleDateString()} at the latest.`,
    };
  }
  if (!Number.isNaN(claimableAtMs) && nowMs < claimableAtMs) {
    return { kind: "scheduled", label: `Claimable on ${new Date(claimableAtMs).toLocaleDateString()}` };
  }
  return {
    kind: "pending",
    label: "Claim date pending",
    detail: "Resonate has not recorded this stake's claim date yet, or claims are briefly paused. Your deposit is safe.",
  };
}

/** Escrow length in whole days from the contract deadline, if known. */
export function escrowDaysFromClaimableAt(depositedAt?: string | null, claimableAt?: string | null): number | null {
  if (!depositedAt || !claimableAt) return null;
  const start = Date.parse(depositedAt);
  const end = Date.parse(claimableAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000);
}
