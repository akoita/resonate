export type BuyPaymentMethod = "onchain" | "x402";

export function defaultBuyPaymentMethod(x402Available: boolean): BuyPaymentMethod {
  return x402Available ? "x402" : "onchain";
}

export function getCheckoutRailLabel(method: BuyPaymentMethod): string {
  return method === "x402" ? "x402 rail" : "On-chain rail";
}

export function getCheckoutRailSubLabel(input: {
  method: BuyPaymentMethod;
  symbol: string;
  isStablecoin?: boolean;
}): string {
  if (input.method === "x402") {
    return `HTTP payment · ${input.symbol}`;
  }
  return input.isStablecoin
    ? `Wallet transaction · stablecoin ${input.symbol}`
    : `Wallet transaction · ${input.symbol}`;
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
