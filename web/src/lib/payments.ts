import { formatUnits, type Address } from "viem";
import { API_BASE } from "./api";

export const ZERO_PAYMENT_TOKEN = "0x0000000000000000000000000000000000000000";

export type PaymentAssetKind = "native" | "wrapped_native" | "stablecoin";
export type PaymentPricingStrategy = "usd_pegged" | "chainlink_feed" | "fixed_test_price";
export type PaymentSurface =
  | "marketplace"
  | "upload_stake"
  | "dispute_counter_stake"
  | "appeal_stake"
  | "revenue_escrow"
  | "x402";

export type PaymentAsset = {
  assetId: string;
  chainId: number;
  symbol: string;
  name: string;
  kind: PaymentAssetKind;
  tokenAddress: Address;
  decimals: number;
  enabled: boolean;
  settlement: string[];
  pricingStrategy: PaymentPricingStrategy;
};

export type PaymentAssetQuote = {
  assetId: string;
  chainId: number;
  symbol: string;
  name: string;
  kind: PaymentAssetKind;
  tokenAddress: Address;
  decimals: number;
  pricingStrategy: PaymentPricingStrategy;
  priceUsd: string;
  amount: string;
  amountUnits: string;
  expiresAt: string;
};

export type FundingOption = {
  id: string;
  assetId: string;
  chainId?: number;
  kind: "local_faucet" | "testnet_faucet" | "transfer" | "onramp" | "offramp";
  label: string;
  endpoint?: string;
  url?: string;
  localOnly?: boolean;
  surfaces?: PaymentSurface[];
};

export type PaymentAssetsResponse = {
  chainId: number;
  assets: PaymentAsset[];
  defaultAsset: string | null;
  source: "env" | "artifact" | "empty" | string;
};

export type PaymentQuoteResponse = {
  chainId: number;
  surface: PaymentSurface | null;
  amountUsd: string;
  quotes: PaymentAssetQuote[];
  defaultAsset: string | null;
  source: "env" | "artifact" | "empty" | string;
};

export type PaymentPolicyResponse = {
  chainId: number;
  policies: Array<{
    surface: PaymentSurface;
    acceptedAssetIds: string[];
    defaultAsset: string | null;
    requiresGas: boolean;
    quoteRequired: boolean;
  }>;
};

export type FundingOptionsResponse = {
  chainId: number;
  wallet: string | null;
  options: FundingOption[];
};

function appendQuery(path: string, params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  const suffix = qs.toString();
  return suffix ? `${path}?${suffix}` : path;
}

async function paymentsGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`payments request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function getPaymentAssets(chainId?: number) {
  return paymentsGet<PaymentAssetsResponse>(
    appendQuery("/api/payments/assets", { chainId }),
  );
}

export function getPaymentQuote(input: {
  amountUsd: string | number;
  chainId?: number;
  assetId?: string;
  surface?: PaymentSurface;
}) {
  return paymentsGet<PaymentQuoteResponse>(
    appendQuery("/api/payments/quote", input),
  );
}

export function getPaymentPolicy(input: { chainId?: number; surface?: PaymentSurface } = {}) {
  return paymentsGet<PaymentPolicyResponse>(
    appendQuery("/api/payments/policy", input),
  );
}

export function getFundingOptions(input: {
  chainId?: number;
  wallet?: string | null;
  assetId?: string;
  surface?: PaymentSurface;
} = {}) {
  return paymentsGet<FundingOptionsResponse>(
    appendQuery("/api/payments/funding-options", {
      chainId: input.chainId,
      wallet: input.wallet ?? undefined,
      assetId: input.assetId,
      surface: input.surface,
    }),
  );
}

export async function fundLocalDevWallet(input: {
  wallet: string;
  assetId: string;
  amount?: string;
  token?: string | null;
  endpoint?: string;
}) {
  const endpoint = input.endpoint ?? "/api/payments/dev/fund";
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
    },
    body: JSON.stringify({
      wallet: input.wallet,
      assetId: input.assetId,
      amount: input.amount,
    }),
  });
  if (!res.ok) {
    throw new Error(`funding request failed (${res.status})`);
  }
  return res.json() as Promise<{
    status: string;
    assetId: string;
    wallet?: string;
    amount?: string;
    txHash?: string | null;
  }>;
}

export function isNativePaymentToken(token?: string | null) {
  return !token || token.toLowerCase() === ZERO_PAYMENT_TOKEN;
}

export function findPaymentAssetForToken(
  assets: PaymentAsset[],
  chainId: number | undefined,
  token?: string | null,
) {
  const normalizedToken = (token ?? ZERO_PAYMENT_TOKEN).toLowerCase();
  return assets.find((asset) => {
    if (chainId && asset.chainId !== chainId) return false;
    return asset.tokenAddress.toLowerCase() === normalizedToken;
  }) ?? null;
}

export function fallbackAssetSymbol(token?: string | null) {
  return isNativePaymentToken(token) ? "ETH" : "ERC-20";
}

export function paymentAssetSymbol(asset: PaymentAsset | null | undefined, token?: string | null) {
  return asset?.symbol ?? fallbackAssetSymbol(token);
}

export function formatPaymentAmount(amountUnits: bigint | string, decimals: number) {
  const raw = typeof amountUnits === "bigint" ? amountUnits : BigInt(amountUnits);
  const formatted = formatUnits(raw, decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmed = fraction.replace(/0+$/, "").slice(0, 6);
  return trimmed ? `${whole}.${trimmed}` : whole;
}
