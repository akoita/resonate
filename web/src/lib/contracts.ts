/**
 * Contract utilities for interacting with Resonate Protocol smart contracts
 */
import { 
  type PublicClient, 
  getContract,
  type Address,
  formatEther,
  parseEther,
} from 'viem';
import { 
  StemNFTABI, 
  StemMarketplaceABI, 
  TransferValidatorABI,
  getAddresses,
  type ContractAddresses,
} from '../../../contracts/abi/index';

// Re-export ABIs for convenience
export { StemNFTABI, StemMarketplaceABI, TransferValidatorABI };

// ============ Types ============

export interface StemData {
  creator: Address;
  royaltyReceiver: Address;
  royaltyBps: bigint;
  remixable: boolean;
  exists: boolean;
}

export interface Listing {
  seller: Address;
  tokenId: bigint;
  amount: bigint;
  pricePerUnit: bigint;
  paymentToken: Address;
  expiry: number;
}

export interface BuyQuote {
  totalPrice: bigint;
  royaltyAmount: bigint;
  protocolFee: bigint;
  sellerAmount: bigint;
}

export interface MintParams {
  to: Address;
  amount: bigint;
  tokenURI: string;
  royaltyReceiver: Address;
  royaltyBps: number;
  remixable: boolean;
  parentIds: bigint[];
}

export interface ListParams {
  tokenId: bigint;
  amount: bigint;
  pricePerUnit: bigint;
  paymentToken: Address;
  durationSeconds: bigint;
}

// ============ Contract Addresses ============

export function getContractAddresses(chainId: number): ContractAddresses {
  return getAddresses(chainId);
}

// ============ Contract Instances ============

export function getStemNFTContract(
  publicClient: PublicClient,
  chainId: number
) {
  const addresses = getContractAddresses(chainId);
  return getContract({
    address: addresses.stemNFT,
    abi: StemNFTABI,
    client: publicClient,
  });
}

export function getMarketplaceContract(
  publicClient: PublicClient,
  chainId: number
) {
  const addresses = getContractAddresses(chainId);
  return getContract({
    address: addresses.marketplace,
    abi: StemMarketplaceABI,
    client: publicClient,
  });
}

// ============ Read Functions ============

export async function getStemData(
  publicClient: PublicClient,
  chainId: number,
  tokenId: bigint
): Promise<StemData> {
  const addresses = getContractAddresses(chainId);
  const result = await publicClient.readContract({
    address: addresses.stemNFT,
    abi: StemNFTABI,
    functionName: 'stems',
    args: [tokenId],
  });
  
  return {
    creator: result[0],
    royaltyReceiver: result[1],
    royaltyBps: result[2],
    remixable: result[3],
    exists: result[4],
  };
}

export async function getTokenURI(
  publicClient: PublicClient,
  chainId: number,
  tokenId: bigint
): Promise<string> {
  const addresses = getContractAddresses(chainId);
  return await publicClient.readContract({
    address: addresses.stemNFT,
    abi: StemNFTABI,
    functionName: 'uri',
    args: [tokenId],
  });
}

export async function getBalance(
  publicClient: PublicClient,
  chainId: number,
  account: Address,
  tokenId: bigint
): Promise<bigint> {
  const addresses = getContractAddresses(chainId);
  return await publicClient.readContract({
    address: addresses.stemNFT,
    abi: StemNFTABI,
    functionName: 'balanceOf',
    args: [account, tokenId],
  });
}

export async function getRoyaltyInfo(
  publicClient: PublicClient,
  chainId: number,
  tokenId: bigint,
  salePrice: bigint
): Promise<{ receiver: Address; amount: bigint }> {
  const addresses = getContractAddresses(chainId);
  const result = await publicClient.readContract({
    address: addresses.stemNFT,
    abi: StemNFTABI,
    functionName: 'royaltyInfo',
    args: [tokenId, salePrice],
  });
  
  return {
    receiver: result[0],
    amount: result[1],
  };
}

export async function getParentIds(
  publicClient: PublicClient,
  chainId: number,
  tokenId: bigint
): Promise<readonly bigint[]> {
  const addresses = getContractAddresses(chainId);
  return await publicClient.readContract({
    address: addresses.stemNFT,
    abi: StemNFTABI,
    functionName: 'getParentIds',
    args: [tokenId],
  });
}

export async function isRemix(
  publicClient: PublicClient,
  chainId: number,
  tokenId: bigint
): Promise<boolean> {
  const addresses = getContractAddresses(chainId);
  return await publicClient.readContract({
    address: addresses.stemNFT,
    abi: StemNFTABI,
    functionName: 'isRemix',
    args: [tokenId],
  });
}

export async function getTotalStems(
  publicClient: PublicClient,
  chainId: number
): Promise<bigint> {
  const addresses = getContractAddresses(chainId);
  return await publicClient.readContract({
    address: addresses.stemNFT,
    abi: StemNFTABI,
    functionName: 'totalStems',
  });
}

// ============ Marketplace Read Functions ============

export async function getListing(
  publicClient: PublicClient,
  chainId: number,
  listingId: bigint
): Promise<Listing> {
  const addresses = getContractAddresses(chainId);
  const result = await publicClient.readContract({
    address: addresses.marketplace,
    abi: StemMarketplaceABI,
    functionName: 'getListing',
    args: [listingId],
  });
  
  return {
    seller: result.seller,
    tokenId: result.tokenId,
    amount: result.amount,
    pricePerUnit: result.pricePerUnit,
    paymentToken: result.paymentToken,
    expiry: Number(result.expiry),
  };
}

export async function quoteBuy(
  publicClient: PublicClient,
  chainId: number,
  listingId: bigint,
  amount: bigint
): Promise<BuyQuote> {
  const addresses = getContractAddresses(chainId);
  const result = await publicClient.readContract({
    address: addresses.marketplace,
    abi: StemMarketplaceABI,
    functionName: 'quoteBuy',
    args: [listingId, amount],
  });
  
  return {
    totalPrice: result[0],
    royaltyAmount: result[1],
    protocolFee: result[2],
    sellerAmount: result[3],
  };
}

export async function getProtocolFeeBps(
  publicClient: PublicClient,
  chainId: number
): Promise<bigint> {
  const addresses = getContractAddresses(chainId);
  return await publicClient.readContract({
    address: addresses.marketplace,
    abi: StemMarketplaceABI,
    functionName: 'protocolFeeBps',
  });
}

// ============ Utility Functions ============

export function formatPrice(wei: bigint): string {
  return formatEther(wei);
}

export function parsePrice(eth: string): bigint {
  return parseEther(eth);
}

export function formatRoyaltyBps(bps: bigint): string {
  return `${Number(bps) / 100}%`;
}

export function isZeroAddress(address: Address): boolean {
  return address === '0x0000000000000000000000000000000000000000';
}
