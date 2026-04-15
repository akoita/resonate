export type X402AssetInfo = {
  address: string;
  name: string;
  version: string;
  decimals: number;
};

const DEFAULT_USDC_ASSETS: Record<string, X402AssetInfo> = {
  'eip155:8453': {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    name: 'USD Coin',
    version: '2',
    decimals: 6,
  },
  'eip155:84532': {
    address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    name: 'USDC',
    version: '2',
    decimals: 6,
  },
};

export const X402_RETRY_HEADERS = ['PAYMENT-SIGNATURE', 'X-PAYMENT'] as const;

export function getDefaultX402Asset(network: string): X402AssetInfo {
  const asset = DEFAULT_USDC_ASSETS[network];
  if (!asset) {
    throw new Error(`No default USDC asset configured for network ${network}`);
  }
  return asset;
}

export function getX402ChainId(network: string): number {
  const [, chainId] = network.split(':');
  const parsed = Number(chainId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Unable to derive chainId from x402 network ${network}`);
  }
  return parsed;
}
