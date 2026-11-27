/**
 * One way to show money on every checkout (#2724).
 *
 * People see a price in dollars. The token and the network that settle it
 * (for example "2 USDC on Base") are payment details: shown on request, never
 * as the headline, and never as a choice of protocol. Pure: no network, no
 * wallet, no React.
 *
 * ADR-BM-6: vision-neutral quality. Nothing here computes or changes a price,
 * fee or split; it only formats amounts it is given.
 */

import { formatUnits } from "viem";

/** Stablecoins worth one US dollar each, by symbol (case-insensitive). */
const USD_STABLECOIN_SYMBOLS = new Set(["usdc", "usdbc", "usdt", "dai", "usd"]);

export function isUsdStablecoinSymbol(symbol: string | null | undefined): boolean {
  return typeof symbol === "string" && USD_STABLECOIN_SYMBOLS.has(symbol.trim().toLowerCase());
}

/** Whether a payment asset's amounts can be read as dollars one for one. */
export function isUsdPeggedAsset(
  asset: { kind?: string; pricingStrategy?: string; symbol?: string } | null | undefined,
): boolean {
  if (!asset) return false;
  if (asset.kind === "stablecoin" && asset.pricingStrategy === "usd_pegged") return true;
  return asset.kind === "stablecoin" && isUsdStablecoinSymbol(asset.symbol);
}

function toDecimalString(value: number | string): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return value.toFixed(6);
  }
  const trimmed = value.trim();
  return /^\d+(\.\d+)?$/.test(trimmed) ? trimmed : null;
}

/**
 * Dollars and cents, rounded half up, with integer math only. Anything above
 * zero but below a cent reads "under $0.01"; an unreadable amount reads
 * "price unknown".
 */
export function formatDollars(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "price unknown";
  const decimal = toDecimalString(value);
  if (decimal === null) return "price unknown";
  const [whole, fraction = ""] = decimal.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
  if (micros === 0n) return "$0.00";
  if (micros < 10_000n) return "under $0.01";
  const cents = (micros + 5_000n) / 10_000n;
  const dollars = cents / 100n;
  const remainder = (cents % 100n).toString().padStart(2, "0");
  return `$${dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${remainder}`;
}

/** A token amount as people read it: dollars for a dollar stablecoin, else the token itself. */
export function formatTokenAmountForPeople(amount: string, symbol: string): string {
  return isUsdStablecoinSymbol(symbol) ? formatDollars(amount) : `${amount} ${symbol}`;
}

/** Raw token units as people read them: dollars for a dollar stablecoin, else the token itself. */
export function formatUnitsForPeople(
  units: bigint,
  asset: { decimals: number; symbol: string; usdPegged: boolean },
): string {
  const amount = trimDecimal(formatUnits(units, asset.decimals));
  return asset.usdPegged ? formatDollars(amount) : `${amount} ${asset.symbol}`;
}

function trimDecimal(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "").slice(0, 6);
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/** "Paid as 2 USDC on Base": the settlement line inside Payment details. */
export function paidAsText(input: { amount: string; symbol: string; network?: string | null }): string {
  const network = input.network?.trim();
  return `Paid as ${input.amount} ${input.symbol}${network ? ` on ${network}` : ""}`;
}
