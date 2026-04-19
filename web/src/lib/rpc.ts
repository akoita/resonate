const LOCAL_RPC_FALLBACK = "http://localhost:8545";
const DEFAULT_SEPOLIA_RPC_URL = "https://sepolia.drpc.org";
const DEFAULT_BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org";

function getDefaultRpcUrl() {
  const chainId = process.env.NEXT_PUBLIC_CHAIN_ID;

  switch (chainId) {
    case "31337":
      return LOCAL_RPC_FALLBACK;
    case "84532":
      return DEFAULT_BASE_SEPOLIA_RPC_URL;
    case "11155111":
    case undefined:
      return DEFAULT_SEPOLIA_RPC_URL;
    default:
      return DEFAULT_SEPOLIA_RPC_URL;
  }
}

export function getRpcUrl() {
  return process.env.NEXT_PUBLIC_RPC_URL || getDefaultRpcUrl();
}

export function isLocalRpcUrl(rpcUrl = getRpcUrl()) {
  return rpcUrl.includes("localhost") || rpcUrl.includes("127.0.0.1");
}

export function getBrowserSafeRpcUrl() {
  const rpcUrl = getRpcUrl();
  if (typeof window !== "undefined" && isLocalRpcUrl(rpcUrl)) {
    return `${window.location.origin}/api/rpc`;
  }
  return rpcUrl;
}
