import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { prisma } from "../../db/prisma";
import { createPublicClient, http, parseAbiItem, decodeEventLog, type Log, type Address } from "viem";
import { foundry, sepolia, baseSepolia } from "viem/chains";

// Contract ABIs for event parsing
const STEM_MINTED_EVENT = parseAbiItem(
  "event StemMinted(uint256 indexed tokenId, address indexed creator, uint256[] parentIds, string tokenURI)"
);
const LISTED_EVENT = parseAbiItem(
  "event Listed(uint256 indexed listingId, address indexed seller, uint256 tokenId, uint256 amount, uint256 price)"
);
const SOLD_EVENT = parseAbiItem(
  "event Sold(uint256 indexed listingId, address indexed buyer, uint256 amount, uint256 totalPaid)"
);
const ROYALTY_PAID_EVENT = parseAbiItem(
  "event RoyaltyPaid(uint256 indexed tokenId, address indexed recipient, uint256 amount)"
);
const CANCELLED_EVENT = parseAbiItem("event Cancelled(uint256 indexed listingId)");

// Standard ERC-1155 events
const TRANSFER_SINGLE_EVENT = parseAbiItem(
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)"
);
const TRANSFER_BATCH_EVENT = parseAbiItem(
  "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)"
);

// Chain configurations
// Global override: when set, routes ALL chains through this RPC (e.g., local Anvil fork)
const RPC_OVERRIDE = process.env.RPC_URL || "";

const CHAIN_CONFIGS: Record<number, { chain: any; rpcUrl: string }> = {
  31337: {
    chain: foundry,
    rpcUrl: RPC_OVERRIDE || process.env.LOCAL_RPC_URL || "http://localhost:8545",
  },
  11155111: {
    chain: sepolia,
    rpcUrl: RPC_OVERRIDE || process.env.SEPOLIA_RPC_URL || `https://sepolia.infura.io/v3/${process.env.INFURA_KEY}`,
  },
  84532: {
    chain: baseSepolia,
    rpcUrl: RPC_OVERRIDE || process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
  },
};

// Contract addresses by chain
// For forked Sepolia, SEPOLIA_* vars may not be set — fall back to generic STEM_NFT_ADDRESS/MARKETPLACE_ADDRESS
const CONTRACT_ADDRESSES: Record<number, { stemNFT: Address; marketplace: Address }> = {
  31337: {
    stemNFT: (process.env.STEM_NFT_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
    marketplace: (process.env.MARKETPLACE_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
  },
  11155111: {
    stemNFT: (process.env.SEPOLIA_STEM_NFT_ADDRESS || process.env.STEM_NFT_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
    marketplace: (process.env.SEPOLIA_MARKETPLACE_ADDRESS || process.env.MARKETPLACE_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
  },
  84532: {
    stemNFT: (process.env.BASE_SEPOLIA_STEM_NFT_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
    marketplace: (process.env.BASE_SEPOLIA_MARKETPLACE_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
  },
};

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerService.name);
  private indexingInterval: NodeJS.Timeout | null = null;
  private isIndexing = false;
  private readonly POLL_INTERVAL_MS = 5000; // 5 seconds
  private readonly BLOCKS_PER_BATCH = 1000;
  private clientCache = new Map<number, any>();

  constructor(private readonly eventBus: EventBus) { }

  private getClient(chainId: number) {
    let client = this.clientCache.get(chainId);
    if (!client) {
      const config = CHAIN_CONFIGS[chainId];
      if (!config) return null;
      client = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) });
      this.clientCache.set(chainId, client);
    }
    return client;
  }

  async onModuleInit() {
    const enableIndexer = process.env.ENABLE_CONTRACT_INDEXER === "true";

    if (!enableIndexer) {
      this.logger.log("Contract indexer disabled (set ENABLE_CONTRACT_INDEXER=true to enable)");
      return;
    }

    this.logger.log("Starting contract indexer...");
    await this.startIndexing();
  }

  onModuleDestroy() {
    this.stopIndexing();
  }

  private async startIndexing() {
    // Initial index
    await this.runIndexCycle();

    // Set up polling interval
    this.indexingInterval = setInterval(async () => {
      if (!this.isIndexing) {
        await this.runIndexCycle();
      }
    }, this.POLL_INTERVAL_MS);
  }

  private stopIndexing() {
    if (this.indexingInterval) {
      clearInterval(this.indexingInterval);
      this.indexingInterval = null;
    }
  }

  private async runIndexCycle() {
    this.isIndexing = true;

    try {
      const chainId = parseInt(process.env.INDEXER_CHAIN_ID || process.env.CHAIN_ID || process.env.AA_CHAIN_ID || "31337");
      const config = CHAIN_CONFIGS[chainId];
      const addresses = CONTRACT_ADDRESSES[chainId];

      if (!config || !addresses) {
        this.logger.warn(`No configuration for chain ${chainId}`);
        return;
      }

      // Skip if addresses not configured
      if (addresses.stemNFT === "0x0000000000000000000000000000000000000000") {
        this.logger.debug("Contract addresses not configured, skipping indexing");
        return;
      }

      const client = this.getClient(chainId);
      if (!client) {
        this.logger.warn(`Failed to create client for chain ${chainId}`);
        return;
      }

      // Get last indexed block
      let indexerState = await prisma.indexerState.findUnique({
        where: { chainId },
      });

      const currentBlock = await client.getBlockNumber();

      if (!indexerState) {
        // Start from near-current block rather than 0 to avoid scanning millions
        // of blocks on forked chains (e.g., Sepolia fork starts at block ~10M)
        const startBlock = currentBlock > 100n ? currentBlock - 100n : 0n;
        this.logger.log(`First run: starting indexer at block ${startBlock} (current: ${currentBlock})`);
        indexerState = await prisma.indexerState.create({
          data: { chainId, lastBlockNumber: startBlock },
        });
      }

      if (indexerState.lastBlockNumber > currentBlock) {
        // Detect chain reset (Anvil restart)
        this.logger.log(`Chain reset detected (current block ${currentBlock} < last indexed ${indexerState.lastBlockNumber}). Resetting indexer...`);
        await prisma.indexerState.update({
          where: { chainId },
          data: { lastBlockNumber: 0n },
        });
        return;
      }

      const fromBlock = indexerState.lastBlockNumber + 1n;

      if (fromBlock > currentBlock) {
        // Already caught up
        return;
      }

      const toBlock = fromBlock + BigInt(this.BLOCKS_PER_BATCH) - 1n;
      const effectiveToBlock = toBlock > currentBlock ? currentBlock : toBlock;

      this.logger.debug(`Indexing blocks ${fromBlock} to ${effectiveToBlock} on chain ${chainId}`);

      // Fetch logs for StemNFT contract
      const stemNftLogs = await client.getLogs({
        address: addresses.stemNFT,
        fromBlock,
        toBlock: effectiveToBlock,
      });

      // Fetch logs for Marketplace contract
      const marketplaceLogs = await client.getLogs({
        address: addresses.marketplace,
        fromBlock,
        toBlock: effectiveToBlock,
      });

      // Process all logs
      for (const log of [...stemNftLogs, ...marketplaceLogs]) {
        await this.processLog(log, chainId);
      }

      // Update last indexed block
      await prisma.indexerState.update({
        where: { chainId },
        data: { lastBlockNumber: effectiveToBlock },
      });

      if (stemNftLogs.length + marketplaceLogs.length > 0) {
        this.logger.log(
          `Indexed ${stemNftLogs.length + marketplaceLogs.length} events from blocks ${fromBlock}-${effectiveToBlock}`
        );
      }
    } catch (error) {
      this.logger.error(`Indexing error: ${error}`);
    } finally {
      this.isIndexing = false;
    }
  }

  private async processLog(log: Log, chainId: number) {
    const { transactionHash, logIndex, blockNumber, blockHash, address, topics, data } = log;

    // Check if already processed
    const existing = await prisma.contractEvent.findUnique({
      where: {
        transactionHash_logIndex: {
          transactionHash: transactionHash!,
          logIndex: logIndex!,
        },
      },
    });

    if (existing) {
      return; // Already processed
    }

    try {
      // Decode event using viem
      const { eventName, decodedArgs } = this.decodeEvent(log);

      // Store raw event
      await prisma.contractEvent.create({
        data: {
          eventName: eventName || "Unknown",
          chainId,
          contractAddress: address,
          transactionHash: transactionHash!,
          logIndex: logIndex!,
          blockNumber: blockNumber!,
          blockHash: blockHash!,
          args: decodedArgs || {
            topics: topics.map((t) => t.toString()),
            data: data,
          },
        },
      });

      // Publish typed event
      if (eventName && decodedArgs) {
        await this.publishTypedEvent(eventName, decodedArgs, log, chainId);
      }
    } catch (error) {
      this.logger.error(`Failed to process log: ${error}`);
    }
  }

  private decodeEvent(log: Log): { eventName: string | null; decodedArgs: any } {

    const ABIs = [
      STEM_MINTED_EVENT,
      LISTED_EVENT,
      SOLD_EVENT,
      ROYALTY_PAID_EVENT,
      CANCELLED_EVENT,
      TRANSFER_SINGLE_EVENT,
      TRANSFER_BATCH_EVENT
    ];

    for (const abiItem of ABIs) {
      try {
        const decoded = decodeEventLog({
          abi: [abiItem],
          data: log.data,
          topics: log.topics,
        });

        const eventName = (abiItem as any).name;
        // Cast to any — viem's decodeEventLog returns a union type across all ABIs
        // that TS can't narrow via string comparison; the eventName check guarantees shape
        const args = decoded.args as any;

        // Custom formatting for our events
        if (eventName === "StemMinted") {
          return {
            eventName,
            decodedArgs: {
              tokenId: args.tokenId.toString(),
              creator: args.creator,
              parentIds: args.parentIds.map((id: bigint) => id.toString()),
              tokenURI: args.tokenURI,
            },
          };
        }

        if (eventName === "Listed") {
          return {
            eventName,
            decodedArgs: {
              listingId: args.listingId.toString(),
              seller: args.seller,
              tokenId: args.tokenId.toString(),
              amount: args.amount.toString(),
              price: args.price.toString(),
            },
          };
        }

        if (eventName === "Sold") {
          return {
            eventName,
            decodedArgs: {
              listingId: args.listingId.toString(),
              buyer: args.buyer,
              amount: args.amount.toString(),
              totalPaid: args.totalPaid.toString(),
            },
          };
        }

        if (eventName === "RoyaltyPaid") {
          return {
            eventName,
            decodedArgs: {
              tokenId: args.tokenId.toString(),
              recipient: args.recipient,
              amount: args.amount.toString(),
            },
          };
        }

        if (eventName === "Cancelled") {
          return {
            eventName,
            decodedArgs: {
              listingId: args.listingId.toString(),
            },
          };
        }

        // Generic decoding for other events
        return {
          eventName,
          decodedArgs: decoded.args
        };
      } catch {
        continue;
      }
    }

    return { eventName: null, decodedArgs: null };
  }

  private async publishTypedEvent(eventName: string, decodedArgs: any, log: Log, chainId: number) {
    const { transactionHash, blockNumber, address } = log;
    const occurredAt = new Date().toISOString();

    switch (eventName) {
      case "StemMinted":
        this.eventBus.publish({
          eventName: "contract.stem_minted",
          eventVersion: 1,
          occurredAt,
          tokenId: decodedArgs.tokenId,
          creatorAddress: decodedArgs.creator,
          parentIds: decodedArgs.parentIds,
          tokenUri: decodedArgs.tokenURI,
          chainId,
          contractAddress: address,
          transactionHash: transactionHash!,
          blockNumber: blockNumber!.toString(),
        });
        break;

      case "Listed":
        this.eventBus.publish({
          eventName: "contract.stem_listed",
          eventVersion: 1,
          occurredAt,
          listingId: decodedArgs.listingId,
          sellerAddress: decodedArgs.seller,
          tokenId: decodedArgs.tokenId,
          amount: decodedArgs.amount,
          pricePerUnit: decodedArgs.price,
          paymentToken: "0x0000000000000000000000000000000000000000", // ETH - event doesn't include this
          expiresAt: "0", // Not in the event, would need to query contract
          chainId,
          contractAddress: address,
          transactionHash: transactionHash!,
          blockNumber: blockNumber!.toString(),
        });
        break;

      case "Sold":
        this.eventBus.publish({
          eventName: "contract.stem_sold",
          eventVersion: 1,
          occurredAt,
          listingId: decodedArgs.listingId,
          buyerAddress: decodedArgs.buyer,
          amount: decodedArgs.amount,
          totalPaid: decodedArgs.totalPaid,
          chainId,
          contractAddress: address,
          transactionHash: transactionHash!,
          blockNumber: blockNumber!.toString(),
        });
        break;

      case "RoyaltyPaid":
        this.eventBus.publish({
          eventName: "contract.royalty_paid",
          eventVersion: 1,
          occurredAt,
          tokenId: decodedArgs.tokenId,
          recipientAddress: decodedArgs.recipient,
          amount: decodedArgs.amount,
          chainId,
          contractAddress: address,
          transactionHash: transactionHash!,
          blockNumber: blockNumber!.toString(),
        });
        break;

      case "Cancelled":
        this.eventBus.publish({
          eventName: "contract.listing_cancelled",
          eventVersion: 1,
          occurredAt,
          listingId: decodedArgs.listingId,
          chainId,
          contractAddress: address,
          transactionHash: transactionHash!,
          blockNumber: blockNumber!.toString(),
        });
        break;
    }
  }

  // ============ Manual Indexing Methods ============

  /**
   * Manually index a specific transaction (for testing/debugging)
   */
  async indexTransaction(txHash: string, chainId: number) {
    const config = CHAIN_CONFIGS[chainId];
    if (!config) {
      throw new Error(`No configuration for chain ${chainId}`);
    }

    const client = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    });

    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });

    for (const log of receipt.logs) {
      await this.processLog(log, chainId);
    }

    return { processed: receipt.logs.length };
  }

  /**
   * Reset indexer to reprocess from a specific block
   */
  async resetIndexer(chainId: number, fromBlock: bigint) {
    await prisma.indexerState.update({
      where: { chainId },
      data: { lastBlockNumber: fromBlock - 1n },
    });

    this.logger.log(`Reset indexer for chain ${chainId} to block ${fromBlock}`);
  }

  /**
   * Get indexer status
   */
  async getStatus() {
    const states = await prisma.indexerState.findMany();
    return {
      enabled: process.env.ENABLE_CONTRACT_INDEXER === "true",
      chains: states.map((s) => ({
        chainId: s.chainId,
        lastBlockNumber: s.lastBlockNumber.toString(),
        updatedAt: s.updatedAt,
      })),
    };
  }
}
