import { arbitrumSepolia, base, baseSepolia, mainnet, sepolia } from "viem/chains";

const CHAIN_EXPLORERS = new Map<number, string>(
  [mainnet, sepolia, base, baseSepolia, arbitrumSepolia].map((chain) => [
    chain.id,
    chain.blockExplorers.default.url,
  ]),
);
const LOCAL_CHAIN_IDS = new Set([31337, 1337]);

function configuredChainId(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;

  const chainId = Number(normalized);
  return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : undefined;
}

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
  if (!address) return undefined;
  const addressBase = normalizeExplorerAddressBase(process.env.NEXT_PUBLIC_EXPLORER_URL);
  return addressBase ? `${addressBase}/${address}` : undefined;
}

export function getChainExplorerAddressUrl(
  chainId: number | null | undefined,
  address: string | null | undefined,
  fallbackBaseUrl?: string | null,
) {
  if (!address || (chainId != null && LOCAL_CHAIN_IDS.has(chainId))) return undefined;

  const configuredExplorer =
    chainId != null && chainId === configuredChainId(process.env.NEXT_PUBLIC_CHAIN_ID)
      ? normalizeExplorerAddressBase(process.env.NEXT_PUBLIC_EXPLORER_URL)
      : undefined;
  const addressBase = normalizeExplorerAddressBase(
    configuredExplorer ??
      (chainId == null ? fallbackBaseUrl : CHAIN_EXPLORERS.get(chainId) ?? fallbackBaseUrl),
  );
  return addressBase ? `${addressBase}/${address}` : undefined;
}

export function getChainExplorerContractUrl(
  chainId: number | null | undefined,
  address: string | null | undefined,
  fallbackBaseUrl?: string | null,
) {
  const addressUrl = getChainExplorerAddressUrl(chainId, address, fallbackBaseUrl);
  if (!addressUrl) return undefined;

  const url = new URL(addressUrl);
  const hostname = url.hostname.toLowerCase();
  if (hostname === "blockscout.com" || hostname.endsWith(".blockscout.com")) {
    url.searchParams.set("tab", "contract");
  }
  return url.toString();
}

export function getExplorerTxUrl(txHash: string | null | undefined) {
  if (!txHash) return undefined;

  const addressBase = normalizeExplorerAddressBase(process.env.NEXT_PUBLIC_EXPLORER_URL);
  if (!addressBase) return undefined;
  return `${addressBase.replace(/\/address$/, "")}/tx/${txHash}`;
}
