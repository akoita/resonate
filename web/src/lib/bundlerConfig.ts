const LOCAL_BUNDLER_PROXY_PATH = "/api/bundler";
const LOCAL_BUNDLER_FALLBACK = "http://localhost:4337";

function isLocalUrl(url: string) {
  return url.includes("localhost") || url.includes("127.0.0.1");
}

export function isLocalDevEnvironment(chainId?: number, rpcOverride = process.env.NEXT_PUBLIC_RPC_URL || ""): boolean {
  if (chainId === 31337) return true;
  return isLocalUrl(rpcOverride);
}

export function getPimlicoBundlerUrl(chainId: number, apiKey?: string | null): string | null {
  const trimmedApiKey = apiKey?.trim();
  if (!trimmedApiKey) return null;
  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${trimmedApiKey}`;
}

export function getBundlerUrl(chainId: number): string {
  const publicOverride = process.env.NEXT_PUBLIC_AA_BUNDLER?.trim();
  if (publicOverride) return publicOverride;

  if (isLocalDevEnvironment(chainId)) {
    return LOCAL_BUNDLER_PROXY_PATH;
  }

  return getPimlicoBundlerUrl(chainId, process.env.NEXT_PUBLIC_PIMLICO_API_KEY) || LOCAL_BUNDLER_PROXY_PATH;
}

export function getServerBundlerChainId(): number {
  return Number(
    process.env.AA_CHAIN_ID ||
      process.env.CHAIN_ID ||
      process.env.NEXT_PUBLIC_CHAIN_ID ||
      "11155111",
  );
}

export function getServerBundlerTarget(chainId: number): string | null {
  const serverOverride =
    process.env.ALTO_BUNDLER_URL?.trim() ||
    process.env.AA_BUNDLER?.trim() ||
    process.env.NEXT_PUBLIC_AA_BUNDLER?.trim();

  if (serverOverride) return serverOverride;

  if (isLocalDevEnvironment(chainId)) {
    return LOCAL_BUNDLER_FALLBACK;
  }

  const pimlicoBundlerUrl =
    getPimlicoBundlerUrl(chainId, process.env.PIMLICO_API_KEY) ||
    getPimlicoBundlerUrl(chainId, process.env.NEXT_PUBLIC_PIMLICO_API_KEY);

  if (pimlicoBundlerUrl) return pimlicoBundlerUrl;

  return null;
}
