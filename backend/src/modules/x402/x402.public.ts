import type { PaymentAsset } from '../payments/payments.service';

export type X402AssetInfo = {
  assetId: string;
  address: string;
  symbol: string;
  name: string;
  version: string;
  decimals: number;
};

const DEFAULT_USDC_ASSETS: Record<string, X402AssetInfo> = {
  'eip155:8453': {
    assetId: 'base:usdc',
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    symbol: 'USDC',
    name: 'USD Coin',
    version: '2',
    decimals: 6,
  },
  'eip155:84532': {
    assetId: 'base-sepolia:usdc',
    address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    symbol: 'USDC',
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

export function resolveX402AssetInfo(
  network: string,
  paymentAssets: PaymentAsset[] = [],
): X402AssetInfo {
  const chainId = getX402ChainId(network);
  const sharedAsset = paymentAssets.find((asset) => {
    return asset.enabled &&
      asset.chainId === chainId &&
      asset.kind === 'stablecoin' &&
      asset.symbol.toUpperCase() === 'USDC' &&
      asset.settlement.includes('x402') &&
      asset.tokenAddress !== '0x0000000000000000000000000000000000000000';
  });
  if (!sharedAsset) {
    return getDefaultX402Asset(network);
  }
  const defaultAsset = DEFAULT_USDC_ASSETS[network];
  return {
    assetId: sharedAsset.assetId,
    address: sharedAsset.tokenAddress,
    symbol: sharedAsset.symbol,
    name: resolveEip712DomainName(sharedAsset, defaultAsset),
    version: defaultAsset?.version ?? '2',
    decimals: sharedAsset.decimals,
  };
}

// The x402 challenge's extra.name/version feed the EIP-712 domain that payers
// sign EIP-3009 TransferWithAuthorization against — verification requires it
// to equal the token contract's on-chain domain name, NOT a display label
// (#1309). Shared payment metadata carries display names ("Circle USDC"), so
// prefer an explicit eip712Name, then the known on-chain name when the token
// address is one of the canonical USDC deployments.
function resolveEip712DomainName(
  sharedAsset: PaymentAsset,
  defaultAsset: X402AssetInfo | undefined,
): string {
  if (sharedAsset.eip712Name) {
    return sharedAsset.eip712Name;
  }
  const isCanonicalToken = defaultAsset &&
    sharedAsset.tokenAddress.toLowerCase() === defaultAsset.address.toLowerCase();
  return isCanonicalToken ? defaultAsset.name : sharedAsset.name;
}

export function getX402ChainId(network: string): number {
  const [, chainId] = network.split(':');
  const parsed = Number(chainId);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Unable to derive chainId from x402 network ${network}`);
  }
  return parsed;
}
