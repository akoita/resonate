import { existsSync, readFileSync } from "fs";
import { formatUnits } from "viem";

export const ZERO_PAYMENT_TOKEN = "0x0000000000000000000000000000000000000000";

export type IndexedPaymentAsset = {
  assetId: string;
  chainId: number;
  symbol: string;
  name?: string;
  kind?: string;
  tokenAddress: string;
  decimals: number;
  enabled?: boolean;
  pricingStrategy?: string;
};

export type PaymentAmountMetadata = {
  paymentToken: string;
  paymentAssetId: string;
  paymentAssetSymbol: string;
  paymentAssetDecimals: number;
  settlementAmount: string;
  settlementAmountUnits: string;
  canonicalAmountUsd: string | null;
};

const DEFAULT_LOCAL_PAYMENT_ARTIFACT = "contracts/deployments/local-payments.json";
const DEFAULT_FIXED_TEST_PRICES_USD: Record<string, string> = {
  ETH: "3000",
  WETH: "3000",
  USDC: "1",
};

export function normalizePaymentToken(token?: string | null) {
  if (!token || token.toLowerCase() === ZERO_PAYMENT_TOKEN) {
    return ZERO_PAYMENT_TOKEN;
  }
  return token.toLowerCase();
}

export function loadPaymentAssetsForIndexing(env: NodeJS.ProcessEnv = process.env): IndexedPaymentAsset[] {
  const configured = parsePaymentAssetsJson(env.PAYMENT_ASSETS_JSON);
  if (configured.length > 0) {
    return configured;
  }

  const artifactPath = env.PAYMENT_LOCAL_ARTIFACT_PATH || DEFAULT_LOCAL_PAYMENT_ARTIFACT;
  if (!existsSync(artifactPath)) {
    return [];
  }

  try {
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as { assets?: IndexedPaymentAsset[] };
    return Array.isArray(artifact.assets) ? artifact.assets : [];
  } catch {
    return [];
  }
}

export function resolvePaymentAssetForToken(input: {
  chainId: number;
  tokenAddress?: string | null;
  assets?: IndexedPaymentAsset[];
}) {
  const token = normalizePaymentToken(input.tokenAddress);
  const assets = input.assets ?? loadPaymentAssetsForIndexing();
  const configured = assets.find((asset) => {
    return asset.chainId === input.chainId &&
      normalizePaymentToken(asset.tokenAddress) === token &&
      asset.enabled !== false;
  });

  if (configured) {
    return configured;
  }

  if (token === ZERO_PAYMENT_TOKEN) {
    return {
      assetId: `${chainSlug(input.chainId)}:eth`,
      chainId: input.chainId,
      symbol: "ETH",
      name: "Native Ether",
      kind: "native",
      tokenAddress: ZERO_PAYMENT_TOKEN,
      decimals: 18,
      enabled: true,
      pricingStrategy: "fixed_test_price",
    };
  }

  return {
    assetId: `${chainSlug(input.chainId)}:${token.slice(2, 8)}`,
    chainId: input.chainId,
    symbol: "TOKEN",
    name: "Unknown ERC-20",
    kind: "stablecoin",
    tokenAddress: token,
    decimals: 18,
    enabled: true,
    pricingStrategy: "chainlink_feed",
  };
}

export function decoratePaymentAmount(input: {
  chainId: number;
  paymentToken?: string | null;
  amountUnits: string;
  assets?: IndexedPaymentAsset[];
  canonicalAmountUsd?: string | number | null;
  env?: NodeJS.ProcessEnv;
}): PaymentAmountMetadata {
  const asset = resolvePaymentAssetForToken({
    chainId: input.chainId,
    tokenAddress: input.paymentToken,
    assets: input.assets,
  });
  const amountUnits = input.amountUnits || "0";
  const settlementAmount = formatUnits(BigInt(amountUnits), asset.decimals);
  const canonicalAmountUsd = input.canonicalAmountUsd == null
    ? deriveCanonicalUsdAmount(asset, settlementAmount, input.env ?? process.env)
    : normalizeDecimalString(input.canonicalAmountUsd);

  return {
    paymentToken: normalizePaymentToken(asset.tokenAddress),
    paymentAssetId: asset.assetId,
    paymentAssetSymbol: asset.symbol,
    paymentAssetDecimals: asset.decimals,
    settlementAmount,
    settlementAmountUnits: amountUnits,
    canonicalAmountUsd,
  };
}

function parsePaymentAssetsJson(raw?: string): IndexedPaymentAsset[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function deriveCanonicalUsdAmount(
  asset: IndexedPaymentAsset,
  settlementAmount: string,
  env: NodeJS.ProcessEnv,
) {
  const priceUsd = resolvePriceUsd(asset, env);
  if (priceUsd == null) {
    return null;
  }
  const amount = Number(settlementAmount);
  const price = Number(priceUsd);
  if (!Number.isFinite(amount) || !Number.isFinite(price)) {
    return null;
  }
  return normalizeDecimalString(amount * price);
}

function resolvePriceUsd(asset: IndexedPaymentAsset, env: NodeJS.ProcessEnv) {
  if (asset.pricingStrategy === "usd_pegged") {
    return "1";
  }

  const configured = parsePriceConfig(env.PAYMENT_ASSET_PRICES_JSON);
  const rawPrice = configured[asset.assetId] ??
    configured[asset.symbol] ??
    configured[asset.symbol.toUpperCase()] ??
    configured[`${asset.symbol}/USD`];

  if (typeof rawPrice === "object" && rawPrice !== null && "priceUsd" in rawPrice) {
    return String((rawPrice as { priceUsd: string | number }).priceUsd);
  }
  if (typeof rawPrice === "string" || typeof rawPrice === "number") {
    return String(rawPrice);
  }

  return DEFAULT_FIXED_TEST_PRICES_USD[asset.symbol.toUpperCase()] ?? null;
}

function parsePriceConfig(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeDecimalString(value: string | number) {
  if (typeof value === "string") {
    return value;
  }
  if (!Number.isFinite(value)) {
    return String(value);
  }
  return value.toFixed(12).replace(/\.?0+$/, "");
}

function chainSlug(chainId: number) {
  if (chainId === 31337) return "local";
  if (chainId === 84532) return "base-sepolia";
  if (chainId === 8453) return "base";
  if (chainId === 11155111) return "sepolia";
  return `chain-${chainId}`;
}
