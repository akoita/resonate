import { formatDollars } from "./money";

/**
 * The two ways the buy dialog can pay for a stem. Both pay from the buyer's
 * Resonate wallet; they differ in what the buyer gets and when (#2724). The
 * values stay technical for the code; people only ever see the labels below.
 */
export type BuyPaymentMethod = "onchain" | "x402";

export function defaultBuyPaymentMethod(x402Available: boolean): BuyPaymentMethod {
  return x402Available ? "x402" : "onchain";
}

/** What people see for each payment method: no protocol or token names. */
export function getCheckoutRailLabel(method: BuyPaymentMethod): string {
  return method === "x402" ? "Quick checkout" : "Standard checkout";
}

export function getCheckoutRailSubLabel(input: { method: BuyPaymentMethod }): string {
  return input.method === "x402"
    ? "Personal license · download right away"
    : "Every license · added to your library";
}

/** A price in dollars, the same format as every other checkout. */
export function formatUsdPrice(amountUsd: number | null | undefined): string {
  if (amountUsd == null) return "-";
  return formatDollars(amountUsd);
}

export function formatStableAssetAmount(
  amountUsd: number | null | undefined,
  symbol: string,
): string {
  if (amountUsd == null) return "-";
  const amount = amountUsd.toFixed(6).replace(/\.?0+$/, "");
  return `${amount} ${symbol}`;
}
