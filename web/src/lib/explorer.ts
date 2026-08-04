import { arbitrumSepolia, base, baseSepolia, mainnet, sepolia } from "viem/chains";

const EXPLORER_BASE_URL = process.env.NEXT_PUBLIC_EXPLORER_URL?.replace(/\/$/, "") ?? null;

const CHAIN_EXPLORERS = new Map<number, string>(
  [mainnet, sepolia, base, baseSepolia, arbitrumSepolia].map((chain) => [
    chain.id,
    chain.blockExplorers.default.url,
  ]),
);
const LOCAL_CHAIN_IDS = new Set([31337, 1337]);

function normalizeExplorerAddressBase(baseUrl: string | null | undefined) {
  const value = baseUrl?.trim();
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    url.search = "";
    url.hash = "";
    const pathname = url.pathname.replace(/\/+$/, "");
    if (!pathname.endsWith("/address")) {
      url.pathname = `${pathname}/address`;
    } else {
      url.pathname = pathname;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function getNetworkLabel(chainId: number | null | undefined) {
  if (chainId === 84532) return "Base Sepolia";
  if (chainId === 11155111) return "Sepolia";
  if (chainId === 31337) return "Local Anvil";
  if (chainId === 8453) return "Base";
  return chainId ? `Chain ${chainId}` : "Unknown Network";
}

export function getExplorerAddressUrl(address: string | null | undefined) {
  if (!EXPLORER_BASE_URL || !address) return undefined;
  return `${EXPLORER_BASE_URL}/address/${address}`;
}

export function getChainExplorerAddressUrl(
  chainId: number | null | undefined,
  address: string | null | undefined,
  fallbackBaseUrl?: string | null,
) {
  if (!address || (chainId != null && LOCAL_CHAIN_IDS.has(chainId))) return undefined;

  const addressBase = normalizeExplorerAddressBase(
    chainId == null ? fallbackBaseUrl : CHAIN_EXPLORERS.get(chainId) ?? fallbackBaseUrl,
  );
  return addressBase ? `${addressBase}/${address}` : undefined;
}

export function getExplorerTxUrl(txHash: string | null | undefined) {
  if (!EXPLORER_BASE_URL || !txHash) return undefined;
  return `${EXPLORER_BASE_URL}/tx/${txHash}`;
}
