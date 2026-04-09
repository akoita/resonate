const LOCAL_RPC_FALLBACK = "http://localhost:8545";

export function getRpcUrl() {
  return process.env.NEXT_PUBLIC_RPC_URL || LOCAL_RPC_FALLBACK;
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
