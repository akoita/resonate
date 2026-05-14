const EXPLORER_BASE_URL = process.env.NEXT_PUBLIC_EXPLORER_URL?.replace(/\/$/, "") ?? null;

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

export function getExplorerTxUrl(txHash: string | null | undefined) {
  if (!EXPLORER_BASE_URL || !txHash) return undefined;
  return `${EXPLORER_BASE_URL}/tx/${txHash}`;
}
