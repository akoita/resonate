const EXPLORER_BASE_URL = process.env.NEXT_PUBLIC_EXPLORER_URL?.replace(/\/$/, "") ?? null;

export function getExplorerAddressUrl(address: string | null | undefined) {
  if (!EXPLORER_BASE_URL || !address) return undefined;
  return `${EXPLORER_BASE_URL}/address/${address}`;
}

export function getExplorerTxUrl(txHash: string | null | undefined) {
  if (!EXPLORER_BASE_URL || !txHash) return undefined;
  return `${EXPLORER_BASE_URL}/tx/${txHash}`;
}
