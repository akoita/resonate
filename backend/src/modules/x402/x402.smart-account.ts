import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  type Address,
  type TransactionReceipt,
} from 'viem';
import { base, baseSepolia, foundry } from 'viem/chains';

/**
 * Shared primitives for verifying human "smart-account" x402 payments — a
 * Resonate passkey wallet transfers USDC directly to the payout address, and
 * the backend confirms the resulting on-chain Transfer before granting the
 * resource. The stem controller (#705) keeps its own private copies for spec
 * stability; these exports let the Punchline moment rail (#1462) verify the
 * exact same way without duplicating the viem plumbing per module.
 */

export const X402_TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

const ERC20_TRANSFER_EVENT = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { indexed: true, name: 'from', type: 'address' },
    { indexed: true, name: 'to', type: 'address' },
    { indexed: false, name: 'value', type: 'uint256' },
  ],
} as const;

/** Build a viem chain object bound to the configured x402 RPC endpoint. */
export function getX402ViemChain(chainId: number, rpcUrl: string) {
  if (chainId === baseSepolia.id) {
    return {
      ...baseSepolia,
      rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
    };
  }
  if (chainId === base.id) {
    return {
      ...base,
      rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
    };
  }
  if (chainId === foundry.id) {
    return {
      ...foundry,
      rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
    };
  }
  return {
    id: chainId,
    name: `x402 chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
  };
}

/** A public client for reading x402 payment receipts on the configured chain. */
export function createX402PublicClient(chainId: number, rpcUrl: string) {
  return createPublicClient({
    chain: getX402ViemChain(chainId, rpcUrl),
    transport: http(rpcUrl),
  });
}

/**
 * Find a USDC Transfer in the receipt from `payer` to `payTo` for at least
 * `minAmountUnits`. Returns the matching log index, or null when no qualifying
 * transfer exists (verification must then fail closed).
 */
export function findVerifiedUsdcTransfer(
  receipt: TransactionReceipt,
  input: {
    assetAddress: Address;
    payer: Address;
    payTo: Address;
    minAmountUnits: bigint;
  },
): { logIndex: number } | null {
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== input.assetAddress) continue;
    try {
      const decoded = decodeEventLog({
        abi: [ERC20_TRANSFER_EVENT],
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== 'Transfer') continue;
      const args = decoded.args as { from: Address; to: Address; value: bigint };
      if (
        getAddress(args.from) === input.payer &&
        getAddress(args.to) === input.payTo &&
        args.value >= input.minAmountUnits
      ) {
        return { logIndex: log.logIndex };
      }
    } catch {
      // Ignore unrelated logs emitted by the token contract.
    }
  }
  return null;
}
