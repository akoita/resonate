import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import { resolveMarketplaceReadConfig } from "../contracts/indexer.service";

/**
 * The crate quote's view of the on-chain marketplace (#1964,
 * docs/rfc/taste-engine.md §5.4).
 *
 * The quote is built from ON-CHAIN facts only: the database listing can be
 * stale (the indexer stores a native payment token when it saw no listing
 * intent), so price, payment token, seller and expiry are read from
 * `StemMarketplaceV2` itself, and a settlement is verified from the
 * transaction receipt. The service depends on this interface, not on viem, so
 * integration specs can substitute a fake chain (an external boundary; Prisma
 * stays real).
 */

/** Nest injection token for the {@link CrateMarketplaceReader}. */
export const CRATE_MARKETPLACE_READER = "CRATE_MARKETPLACE_READER";

/** `StemMarketplaceV2.getListing`; every address is lower-case. */
export type MarketplaceListing = {
  seller: string;
  tokenId: bigint;
  amount: bigint;
  pricePerUnit: bigint;
  /** Zero address means native ETH. */
  paymentToken: string;
  /** Unix seconds; the contract accepts a buy while `now <= expiry`. */
  expiry: number;
};

/** `StemMarketplaceV2.quoteBuy` for one listing and amount. */
export type MarketplaceQuote = {
  totalPrice: bigint;
  royaltyAmount: bigint;
  protocolFee: bigint;
  sellerAmount: bigint;
};

/** One decoded `Sold` log of the marketplace. */
export type MarketplaceSoldLog = {
  listingId: bigint;
  /** Lower-case recipient of the units. */
  buyer: string;
  amount: bigint;
  totalPaid: bigint;
  logIndex: number;
};

export type MarketplaceSoldLogs = {
  /** `pending` when the transaction has no receipt yet. */
  status: "success" | "reverted" | "pending";
  logs: MarketplaceSoldLog[];
  /** Block the transaction was mined in; null while pending. */
  blockNumber: bigint | null;
};

export interface CrateMarketplaceReader {
  /** False when the marketplace address or RPC is not configured. */
  isConfigured(): boolean;
  readonly chainId: number;
  /** Lower-case marketplace address; empty when unconfigured. */
  readonly marketplaceAddress: string;
  /** The current chain head; throws when the chain cannot be read. */
  getBlockNumber(): Promise<bigint>;
  /** Throws when the chain cannot be read. */
  getListing(listingId: bigint): Promise<MarketplaceListing>;
  /** Throws when the chain cannot be read. */
  quoteBuy(listingId: bigint, amount: bigint): Promise<MarketplaceQuote>;
  /**
   * The marketplace `Sold` logs of a transaction, in log order. Only logs
   * emitted by the marketplace address are decoded.
   */
  getSoldLogs(transactionHash: string): Promise<MarketplaceSoldLogs>;
}

const MARKETPLACE_ABI = parseAbi([
  "struct Listing { address seller; uint256 tokenId; uint256 amount; uint256 pricePerUnit; address paymentToken; uint40 expiry; }",
  "function getListing(uint256 listingId) view returns (Listing)",
  "function quoteBuy(uint256 listingId, uint256 amount) view returns (uint256 totalPrice, uint256 royaltyAmount, uint256 protocolFee, uint256 sellerAmount)",
  "event Sold(uint256 indexed listingId, address indexed buyer, uint256 amount, uint256 totalPaid)",
]);

type ReaderClient = Pick<PublicClient, "readContract" | "getTransactionReceipt" | "getBlockNumber">;

export type ViemMarketplaceReaderOptions = {
  /** Test seam: a client to use instead of one built from the configuration. */
  client?: ReaderClient;
  /** Test seam: the chain and marketplace to read instead of the environment. */
  config?: { chainId: number; marketplaceAddress: string | null; rpcUrl?: string | null };
};

function isReceiptNotFound(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TransactionReceiptNotFoundError";
}

/**
 * The viem implementation, configured from the indexer's environment (RPC_URL,
 * MARKETPLACE_ADDRESS, INDEXER_CHAIN_ID / CHAIN_ID / AA_CHAIN_ID), so a quote
 * reads the same chain and marketplace the indexer stamps onto listing rows.
 */
export function createViemMarketplaceReader(
  options: ViemMarketplaceReaderOptions = {},
): CrateMarketplaceReader {
  const resolved = options.config
    ? {
        chainId: options.config.chainId,
        chain: null as any,
        rpcUrl: options.config.rpcUrl ?? null,
        marketplace: options.config.marketplaceAddress,
      }
    : resolveMarketplaceReadConfig();
  const marketplace = resolved.marketplace ? (resolved.marketplace.toLowerCase() as Address) : null;

  let cached: ReaderClient | undefined = options.client;
  const client = (): ReaderClient => {
    if (!cached) {
      cached = createPublicClient({
        chain: resolved.chain ?? undefined,
        transport: http(resolved.rpcUrl ?? undefined),
      }) as ReaderClient;
    }
    return cached;
  };

  const requireMarketplace = (): Address => {
    if (!marketplace) throw new Error("Marketplace is not configured");
    return marketplace;
  };

  return {
    chainId: resolved.chainId,
    marketplaceAddress: marketplace ?? "",

    isConfigured(): boolean {
      return marketplace !== null && (options.client !== undefined || Boolean(resolved.rpcUrl));
    },

    async getBlockNumber(): Promise<bigint> {
      return client().getBlockNumber();
    },

    async getListing(listingId: bigint): Promise<MarketplaceListing> {
      const listing = await client().readContract({
        address: requireMarketplace(),
        abi: MARKETPLACE_ABI,
        functionName: "getListing",
        args: [listingId],
      });
      return {
        seller: listing.seller.toLowerCase(),
        tokenId: listing.tokenId,
        amount: listing.amount,
        pricePerUnit: listing.pricePerUnit,
        paymentToken: listing.paymentToken.toLowerCase(),
        expiry: Number(listing.expiry),
      };
    },

    async quoteBuy(listingId: bigint, amount: bigint): Promise<MarketplaceQuote> {
      const [totalPrice, royaltyAmount, protocolFee, sellerAmount] = await client().readContract({
        address: requireMarketplace(),
        abi: MARKETPLACE_ABI,
        functionName: "quoteBuy",
        args: [listingId, amount],
      });
      return { totalPrice, royaltyAmount, protocolFee, sellerAmount };
    },

    async getSoldLogs(transactionHash: string): Promise<MarketplaceSoldLogs> {
      const address = requireMarketplace();
      let receipt;
      try {
        receipt = await client().getTransactionReceipt({ hash: transactionHash as `0x${string}` });
      } catch (error) {
        if (isReceiptNotFound(error)) return { status: "pending", logs: [], blockNumber: null };
        throw error;
      }
      if (receipt.status !== "success") {
        return { status: "reverted", logs: [], blockNumber: receipt.blockNumber };
      }

      const logs: MarketplaceSoldLog[] = [];
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== address) continue;
        try {
          const decoded = decodeEventLog({
            abi: MARKETPLACE_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName !== "Sold") continue;
          logs.push({
            listingId: decoded.args.listingId,
            buyer: decoded.args.buyer.toLowerCase(),
            amount: decoded.args.amount,
            totalPaid: decoded.args.totalPaid,
            logIndex: Number(log.logIndex),
          });
        } catch {
          // Not an event this ABI knows (RoyaltyPaid, Transfer, ...): skip it.
        }
      }
      logs.sort((a, b) => a.logIndex - b.logIndex);
      return { status: "success", logs, blockNumber: receipt.blockNumber };
    },
  };
}
