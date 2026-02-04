import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { prisma } from "../../db/prisma";
import { createPublicClient, http, parseAbiItem, type Log, type Address } from "viem";
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

// Chain configurations
const CHAIN_CONFIGS: Record<number, { chain: any; rpcUrl: string }> = {
  31337: {
    chain: foundry,
    rpcUrl: process.env.LOCAL_RPC_URL || "http://localhost:8545",
  },
  11155111: {
    chain: sepolia,
    rpcUrl: process.env.SEPOLIA_RPC_URL || `https://sepolia.infura.io/v3/${process.env.INFURA_KEY}`,
  },
  84532: {
    chain: baseSepolia,
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
  },
};

// Contract addresses by chain
const CONTRACT_ADDRESSES: Record<number, { stemNFT: Address; marketplace: Address }> = {
  31337: {
    stemNFT: (process.env.LOCAL_STEM_NFT_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
    marketplace: (process.env.LOCAL_MARKETPLACE_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
  },
  11155111: {
    stemNFT: (process.env.SEPOLIA_STEM_NFT_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
    marketplace: (process.env.SEPOLIA_MARKETPLACE_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
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

  constructor(private readonly eventBus: EventBus) {}

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
      const chainId = parseInt(process.env.CHAIN_ID || "31337");
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

      const client = createPublicClient({
        chain: config.chain,
        transport: http(config.rpcUrl),
      });

      // Get last indexed block
      let indexerState = await prisma.indexerState.findUnique({
        where: { chainId },
      });

      if (!indexerState) {
        indexerState = await prisma.indexerState.create({
          data: { chainId, lastBlockNumber: 0n },
        });
      }

      const fromBlock = indexerState.lastBlockNumber + 1n;
      const currentBlock = await client.getBlockNumber();

      if (fromBlock > currentBlock) {
        return; // Already up to date
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
      // Identify and decode event
      const eventSignature = topics[0];
      let eventName: string | null = null;
      let eventData: any = null;

      // Try to decode as StemMinted
      if (eventSignature === "0x" + Buffer.from("StemMinted(uint256,address,uint256[],string)").toString("hex").slice(0, 64)) {
        eventName = "StemMinted";
        // Decode event args - simplified, would use decodeEventLog in production
      }

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
          args: {
            topics: topics.map((t) => t.toString()),
            data: data,
          },
        },
      });

      // Publish typed event
      if (eventName) {
        await this.publishTypedEvent(eventName, log, chainId);
      }
    } catch (error) {
      this.logger.error(`Failed to process log: ${error}`);
    }
  }

  private async publishTypedEvent(eventName: string, log: Log, chainId: number) {
    const { transactionHash, blockNumber, address } = log;
    const occurredAt = new Date().toISOString();

    switch (eventName) {
      case "StemMinted":
        this.eventBus.publish({
          eventName: "contract.stem_minted",
          eventVersion: 1,
          occurredAt,
          tokenId: "0", // Would be decoded from log
          creatorAddress: "0x0000000000000000000000000000000000000000",
          parentIds: [],
          tokenUri: "",
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
          listingId: "0",
          sellerAddress: "0x0000000000000000000000000000000000000000",
          tokenId: "0",
          amount: "0",
          pricePerUnit: "0",
          paymentToken: "0x0000000000000000000000000000000000000000",
          expiresAt: "0",
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
          listingId: "0",
          buyerAddress: "0x0000000000000000000000000000000000000000",
          amount: "0",
          totalPaid: "0",
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
          tokenId: "0",
          recipientAddress: "0x0000000000000000000000000000000000000000",
          amount: "0",
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
          listingId: "0",
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
