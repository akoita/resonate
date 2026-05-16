export type BuyPaymentMethod = "onchain" | "x402";

export function defaultBuyPaymentMethod(x402Available: boolean): BuyPaymentMethod {
  return x402Available ? "x402" : "onchain";
}

export function formatUsdPrice(amountUsd: number | null | undefined): string {
  if (amountUsd == null) return "-";
  const amount = amountUsd.toFixed(6).replace(/\.?0+$/, "");
  return `$${amount} USD`;
}

export function formatStableAssetAmount(
  amountUsd: number | null | undefined,
  symbol: string,
): string {
  if (amountUsd == null) return "-";
  const amount = amountUsd.toFixed(6).replace(/\.?0+$/, "");
  return `${amount} ${symbol}`;
}
