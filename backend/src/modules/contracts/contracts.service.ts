import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { prisma } from "../../db/prisma";
import { createPublicClient, http, type Address } from "viem";
import { foundry, sepolia, baseSepolia } from "viem/chains";
import type {
  ContractStemMintedEvent,
  ContractStemListedEvent,
  ContractStemSoldEvent,
  ContractRoyaltyPaidEvent,
  ContractListingCancelledEvent,
} from "../../events/event_types";

// ABI for the marketplace getListing view function
const MARKETPLACE_ABI = [
  {
    name: "getListing",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "seller", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "pricePerUnit", type: "uint256" },
        { name: "paymentToken", type: "address" },
        { name: "expiry", type: "uint40" },
      ],
    }],
  },
] as const;

// Chain configurations (shared with indexer)
const CHAIN_CONFIGS: Record<number, { chain: any; rpcUrl: string }> = {
  31337: { chain: foundry, rpcUrl: process.env.LOCAL_RPC_URL || "http://localhost:8545" },
  11155111: { chain: sepolia, rpcUrl: process.env.SEPOLIA_RPC_URL || `https://sepolia.infura.io/v3/${process.env.INFURA_KEY}` },
  84532: { chain: baseSepolia, rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org" },
};

const MARKETPLACE_ADDRESSES: Record<number, Address> = {
  31337: (process.env.MARKETPLACE_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
  11155111: (process.env.SEPOLIA_MARKETPLACE_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
  84532: (process.env.BASE_SEPOLIA_MARKETPLACE_ADDRESS || "0x0000000000000000000000000000000000000000") as Address,
};

@Injectable()
export class ContractsService implements OnModuleInit {
  private readonly logger = new Logger(ContractsService.name);

  constructor(private readonly eventBus: EventBus) { }

  async onModuleInit() {
    this.subscribeToContractEvents();

    // Reconcile stale listings on startup (non-blocking)
    this.reconcileListings().catch(err =>
      this.logger.error(`Listing reconciliation failed: ${err}`)
    );
  }

  /**
   * Reconcile DB listings with on-chain state.
   * Any "active" listing whose on-chain record shows seller=0x0 (deleted)
   * or amount=0 is marked as "sold" in the DB.
   */
  private async reconcileListings() {
    const chainId = parseInt(process.env.INDEXER_CHAIN_ID || process.env.CHAIN_ID || "31337");
    const config = CHAIN_CONFIGS[chainId];
    const marketplaceAddr = MARKETPLACE_ADDRESSES[chainId];

    if (!config || !marketplaceAddr || marketplaceAddr === "0x0000000000000000000000000000000000000000") {
      this.logger.debug("Skipping listing reconciliation: no chain/contract config");
      return;
    }

    const client = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl) });

    // Get all "active" listings from DB for this chain
    const activeListings = await prisma.stemListing.findMany({
      where: { status: "active", chainId },
      select: { id: true, listingId: true },
    });

    if (activeListings.length === 0) return;

    this.logger.log(`Reconciling ${activeListings.length} active listings against on-chain state...`);
    let staleCount = 0;

    for (const dbListing of activeListings) {
      try {
        const onChain = await client.readContract({
          address: marketplaceAddr,
          abi: MARKETPLACE_ABI,
          functionName: "getListing",
          args: [dbListing.listingId],
        });

        const seller = onChain.seller as string;
        const amount = onChain.amount as bigint;

        // seller == 0x0 means listing was deleted on-chain (sold out or cancelled)
        if (seller === "0x0000000000000000000000000000000000000000" || amount === 0n) {
          await prisma.stemListing.update({
            where: { id: dbListing.id },
            data: { status: "sold", amount: 0n, soldAt: new Date() },
          });
          staleCount++;
          this.logger.log(`Reconciled stale listing ${dbListing.listingId} -> sold`);
        }
      } catch (error) {
        this.logger.warn(`Failed to reconcile listing ${dbListing.listingId}: ${error}`);
      }
    }

    if (staleCount > 0) {
      this.logger.log(`Reconciliation complete: marked ${staleCount} stale listings as sold`);
    } else {
      this.logger.log("Reconciliation complete: all active listings are valid on-chain");
    }
  }

  private subscribeToContractEvents() {
    // Handle StemMinted events
    this.eventBus.subscribe("contract.stem_minted", async (event: ContractStemMintedEvent) => {
      this.logger.log(`Processing StemMinted: tokenId=${event.tokenId}, tx=${event.transactionHash}`);

      try {
        // Find the stem by tokenURI
        // 1. Try to extract stemId from metadata URL (e.g., .../metadata/:chainId/:stemId)
        let stemIdFromUrl: string | undefined;
        try {
          const urlParts = event.tokenUri.split("/");
          const lastPart = urlParts[urlParts.length - 1];
          // Simple check: is the last part a uuid-like string or one of our IDs?
          if (lastPart && (lastPart.startsWith("stem_") || lastPart.length > 20)) {
            stemIdFromUrl = lastPart;
          }
        } catch (e) {
          // ignore
        }

        const stem = stemIdFromUrl
          ? await prisma.stem.findUnique({ where: { id: stemIdFromUrl } })
          : await prisma.stem.findFirst({
            where: { uri: { contains: event.tokenUri } },
          });

        // Determine royaltyBps: try to read from metadata URI query params or use default
        let royaltyBps = 500; // 5% default
        try {
          const url = new URL(event.tokenUri);
          const bpsParam = url.searchParams.get("royaltyBps");
          if (bpsParam) royaltyBps = parseInt(bpsParam, 10);
        } catch {
          // tokenUri may not be a full URL, use default
        }

        const createData: any = {
          tokenId: BigInt(event.tokenId),
          chainId: event.chainId,
          contractAddress: event.contractAddress,
          creatorAddress: event.creatorAddress,
          royaltyBps,
          remixable: event.parentIds.length === 0,
          metadataUri: event.tokenUri,
          transactionHash: event.transactionHash,
          blockNumber: BigInt(event.blockNumber),
          mintedAt: new Date(event.occurredAt),
        };

        if (stem?.id) {
          createData.stem = { connect: { id: stem.id } };
        }

        await prisma.stemNftMint.upsert({
          where: { transactionHash: event.transactionHash },
          create: createData,
          update: {},
        });

        // Update stem with NFT token ID
        if (stem) {
          await prisma.stem.update({
            where: { id: stem.id },
            data: { ipnftId: event.tokenId },
          });
        }

        this.logger.log(`Stored StemMinted: tokenId=${event.tokenId}`);
      } catch (error) {
        this.logger.error(`Failed to process StemMinted: ${error}`);
      }
    });

    // Handle Listed events
    this.eventBus.subscribe("contract.stem_listed", async (event: ContractStemListedEvent) => {
      this.logger.log(`Processing StemListed: listingId=${event.listingId}, tx=${event.transactionHash}`);

      try {
        // Find stem by tokenId
        const nftMint = await prisma.stemNftMint.findFirst({
          where: {
            tokenId: BigInt(event.tokenId),
            chainId: event.chainId,
          },
        });

        let expiresAt = new Date(parseInt(event.expiresAt) * 1000);
        // If expiresAt is 0, default to 7 days from now
        if (parseInt(event.expiresAt) === 0) {
          expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        }

        const listingData: any = {
          listingId: BigInt(event.listingId),
          tokenId: BigInt(event.tokenId),
          chainId: event.chainId,
          contractAddress: event.contractAddress,
          sellerAddress: event.sellerAddress.toLowerCase(),
          pricePerUnit: event.pricePerUnit,
          amount: BigInt(event.amount),
          paymentToken: event.paymentToken,
          expiresAt,
          transactionHash: event.transactionHash,
          blockNumber: BigInt(event.blockNumber),
          status: "active",
          listedAt: new Date(event.occurredAt),
        };

        if (nftMint?.stemId) {
          listingData.stem = { connect: { id: nftMint.stemId } };
        }

        // Mark any previous active listings for same tokenId/seller as cancelled
        await prisma.stemListing.updateMany({
          where: {
            tokenId: BigInt(event.tokenId),
            chainId: event.chainId,
            sellerAddress: event.sellerAddress,
            status: "active",
            NOT: { transactionHash: event.transactionHash } // Don't cancel the one we just (might) have upserted
          },
          data: {
            status: "cancelled",
            cancelledAt: new Date(event.occurredAt),
          },
        });

        await prisma.stemListing.upsert({
          where: { transactionHash: event.transactionHash },
          create: listingData,
          update: {},
        });

        this.logger.log(`Stored StemListing: listingId=${event.listingId}`);
      } catch (error) {
        this.logger.error(`Failed to process StemListed: ${error}`);
      }
    });

    // Handle Sold events
    this.eventBus.subscribe("contract.stem_sold", async (event: ContractStemSoldEvent) => {
      this.logger.log(`Processing StemSold: listingId=${event.listingId}, tx=${event.transactionHash}`);

      try {
        // Find the listing
        const listing = await prisma.stemListing.findFirst({
          where: {
            listingId: BigInt(event.listingId),
            chainId: event.chainId,
          },
        });

        if (!listing) {
          this.logger.warn(`Listing not found for StemSold: ${event.listingId}`);
          return;
        }

        // Create purchase record
        await prisma.stemPurchase.upsert({
          where: { transactionHash: event.transactionHash },
          create: {
            listingId: listing.id,
            buyerAddress: event.buyerAddress.toLowerCase(),
            amount: BigInt(event.amount),
            totalPaid: event.totalPaid,
            royaltyPaid: "0", // Will be updated from RoyaltyPaid event
            protocolFeePaid: "0",
            sellerReceived: "0",
            transactionHash: event.transactionHash,
            blockNumber: BigInt(event.blockNumber),
            purchasedAt: new Date(event.occurredAt),
          },
          update: {},
        });

        // Update listing status
        const remainingAmount = listing.amount - BigInt(event.amount);
        await prisma.stemListing.update({
          where: { id: listing.id },
          data: {
            amount: remainingAmount,
            status: remainingAmount <= 0n ? "sold" : "active",
            soldAt: remainingAmount <= 0n ? new Date(event.occurredAt) : null,
          },
        });

        this.logger.log(`Stored StemPurchase: listingId=${event.listingId}`);
      } catch (error) {
        this.logger.error(`Failed to process StemSold: ${error}`);
      }
    });

    // Handle RoyaltyPaid events
    this.eventBus.subscribe("contract.royalty_paid", async (event: ContractRoyaltyPaidEvent) => {
      this.logger.log(`Processing RoyaltyPaid: tokenId=${event.tokenId}, tx=${event.transactionHash}`);

      try {
        // Use upsert to prevent duplicates on reindex (keyed on tx + tokenId)
        await prisma.royaltyPayment.upsert({
          where: {
            transactionHash_tokenId: {
              transactionHash: event.transactionHash,
              tokenId: BigInt(event.tokenId),
            },
          },
          create: {
            tokenId: BigInt(event.tokenId),
            chainId: event.chainId,
            recipientAddress: event.recipientAddress,
            amount: event.amount,
            transactionHash: event.transactionHash,
            blockNumber: BigInt(event.blockNumber),
            paidAt: new Date(event.occurredAt),
          },
          update: {},
        });

        this.logger.log(`Stored RoyaltyPayment: tokenId=${event.tokenId}, amount=${event.amount}`);
      } catch (error) {
        this.logger.error(`Failed to process RoyaltyPaid: ${error}`);
      }
    });

    // Handle Cancelled events
    this.eventBus.subscribe("contract.listing_cancelled", async (event: ContractListingCancelledEvent) => {
      this.logger.log(`Processing ListingCancelled: listingId=${event.listingId}, tx=${event.transactionHash}`);

      try {
        await prisma.stemListing.updateMany({
          where: {
            listingId: BigInt(event.listingId),
            chainId: event.chainId,
          },
          data: {
            status: "cancelled",
            cancelledAt: new Date(event.occurredAt),
          },
        });

        this.logger.log(`Cancelled listing: listingId=${event.listingId}`);
      } catch (error) {
        this.logger.error(`Failed to process ListingCancelled: ${error}`);
      }
    });

    this.logger.log("Subscribed to contract events");
  }

  // ============ Query Methods ============

  async getListings(options: {
    status?: string;
    sellerAddress?: string;
    chainId?: number;
    artistId?: string;
    releaseId?: string;
    genre?: string;
    search?: string;
    sortBy?: string;
    minPrice?: string;
    maxPrice?: string;
    excludeSellerAddress?: string;
    limit?: number;
    offset?: number;
  }) {
    const { status, sellerAddress, chainId, artistId, releaseId, genre, search, sortBy, minPrice, maxPrice, excludeSellerAddress, limit = 20, offset = 0 } = options;

    // Build stem relation filter for artist/release/genre/search
    const stemFilter: any = {};
    const trackFilter: any = {};
    const releaseFilter: any = {};

    if (artistId) releaseFilter.artistId = artistId;
    if (releaseId) releaseFilter.id = releaseId;
    if (genre) releaseFilter.genre = { contains: genre, mode: "insensitive" as const };

    if (Object.keys(releaseFilter).length > 0) {
      trackFilter.release = releaseFilter;
    }
    if (Object.keys(trackFilter).length > 0) {
      stemFilter.track = trackFilter;
    }

    // Build search filter (OR across stem title, track title, artist name)
    const searchConditions: any[] = [];
    if (search) {
      searchConditions.push(
        { stem: { title: { contains: search, mode: "insensitive" as const } } },
        { stem: { track: { title: { contains: search, mode: "insensitive" as const } } } },
        { stem: { track: { release: { primaryArtist: { contains: search, mode: "insensitive" as const } } } } },
      );
    }

    const listings = await prisma.stemListing.findMany({
      where: {
        // Safety: always exclude sold-out and expired listings regardless of status field
        amount: { gt: 0 },
        expiresAt: { gt: new Date() },
        ...(status && { status }),
        ...(sellerAddress && { sellerAddress }),
        ...(excludeSellerAddress && { NOT: { sellerAddress: excludeSellerAddress } }),
        ...(chainId && { chainId }),
        ...(minPrice && { pricePerUnit: { gte: minPrice } }),
        ...(maxPrice && { pricePerUnit: { lte: maxPrice } }),
        ...(Object.keys(stemFilter).length > 0 ? { stem: stemFilter } : {}),
        ...(searchConditions.length > 0 ? { OR: searchConditions } : {}),
      },
      select: {
        id: true,
        listingId: true,
        tokenId: true,
        chainId: true,
        contractAddress: true,
        sellerAddress: true,
        pricePerUnit: true,
        amount: true,
        paymentToken: true,
        status: true,
        expiresAt: true,
        listedAt: true,
        transactionHash: true,
        blockNumber: true,
        stem: {
          select: {
            id: true,
            type: true,
            title: true,
            uri: true,
            artworkUrl: true,
            durationSeconds: true,
            track: {
              include: {
                release: true
              }
            }
          }
        },
        purchases: true,
      },
      orderBy: { listedAt: "desc" },
      // We don't take/skip yet because we need to deduplicate in-memory
    });

    // Deduplicate: Keep only the latest listing for each (tokenId, sellerAddress, chainId)
    // Since we ordered by listedAt desc, the first one we encounter is the most recent
    const dedupedMap = new Map<string, typeof listings[number]>();
    for (const l of listings) {
      const key = `${l.chainId}-${l.tokenId}-${l.sellerAddress.toLowerCase()}`;
      if (!dedupedMap.has(key)) {
        dedupedMap.set(key, l);
      }
    }

    const allDeduped = Array.from(dedupedMap.values());

    // Filter out orphan listings (no linked stem) — these have no useful metadata
    const withStems = allDeduped.filter(l => l.stem !== null);

    // Apply sorting after deduplication
    const sorted = this.sortListings(withStems, sortBy);

    // Apply pagination manually after deduplication + sorting
    return sorted.slice(offset, offset + limit);
  }

  /**
   * Sort listings by the given strategy.
   * Price comparison treats the string value as wei (numeric sort).
   */
  private sortListings<T extends { pricePerUnit: string; expiresAt: Date; listedAt: Date }>(listings: T[], sortBy?: string): T[] {
    switch (sortBy) {
      case 'price_asc':
        return [...listings].sort((a, b) => {
          try { return Number(BigInt(a.pricePerUnit) - BigInt(b.pricePerUnit)); } catch { return 0; }
        });
      case 'price_desc':
        return [...listings].sort((a, b) => {
          try { return Number(BigInt(b.pricePerUnit) - BigInt(a.pricePerUnit)); } catch { return 0; }
        });
      case 'ending_soon':
        return [...listings].sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
      case 'newest':
      default:
        // Already ordered by listedAt desc from the DB query
        return listings;
    }
  }

  async getListingById(listingId: bigint, chainId: number) {
    return prisma.stemListing.findFirst({
      where: { listingId, chainId },
      include: {
        stem: {
          include: {
            track: {
              include: { release: true }
            }
          },
        },
        purchases: true,
      },
    });
  }

  async getStemNftData(tokenId: bigint, chainId: number) {
    return prisma.stemNftMint.findFirst({
      where: { tokenId, chainId },
      include: {
        stem: {
          include: { track: { include: { release: true } } },
        },
      },
    });
  }

  async getRoyaltyPayments(options: {
    recipientAddress?: string;
    tokenId?: bigint;
    chainId?: number;
    limit?: number;
    offset?: number;
  }) {
    const { recipientAddress, tokenId, chainId, limit = 20, offset = 0 } = options;

    return prisma.royaltyPayment.findMany({
      where: {
        ...(recipientAddress && { recipientAddress }),
        ...(tokenId && chainId && { tokenId, chainId }),
      },
      orderBy: { paidAt: "desc" },
      take: limit,
      skip: offset,
    });
  }

  async getArtistEarnings(artistAddress: string) {
    // Sum all royalty payments for this artist
    const payments = await prisma.royaltyPayment.findMany({
      where: { recipientAddress: artistAddress.toLowerCase() },
    });

    const totalWei = payments.reduce((sum, p) => sum + BigInt(p.amount), 0n);
    const count = payments.length;

    return {
      totalWei: totalWei.toString(),
      totalPayments: count,
      payments: payments.slice(0, 10), // Last 10
    };
  }

  async getStemData(stemId: string) {
    return prisma.stem.findUnique({
      where: { id: stemId },
      include: {
        track: {
          include: { release: true },
        },
        nftMint: true,
      },
    });
  }

  /**
   * Get all stems owned by a wallet address (via purchases)
   */
  async getStemsByOwner(walletAddress: string) {
    this.logger.log(`Fetching collection for wallet: ${walletAddress}`);
    const purchases = await prisma.stemPurchase.findMany({
      where: { buyerAddress: walletAddress.toLowerCase() },
      include: {
        listing: {
          include: {
            stem: {
              select: {
                id: true,
                trackId: true,
                type: true,
                uri: true,
                ipnftId: true,
                checksum: true,
                artist: true,
                artworkUrl: true,
                title: true,
                mimeType: true,
                durationSeconds: true,
                encryptionMetadata: true,
                isEncrypted: true,
                storageProvider: true,
                track: {
                  include: { release: true },
                },
                nftMint: true,
              },
            },
          },
        },
      },
      orderBy: { purchasedAt: "desc" },
    });

    // 2. Fetch all active listings where this user is the seller
    const activeListings = await prisma.stemListing.findMany({
      where: {
        sellerAddress: {
          equals: walletAddress.toLowerCase(),
          mode: "insensitive", // Handle legacy mixed-case records
        },
        status: "active",
      },
      include: {
        stem: {
          include: {
            track: { include: { release: true } },
            nftMint: true,
          },
        },
      },
    });

    // Deduplicate stems
    const stemMap = new Map<string, any>();

    // Add purchased stems (they might or might not be listed now)
    for (const purchase of purchases) {
      const stem = purchase.listing?.stem;
      if (stem && !stemMap.has(stem.id)) {
        stemMap.set(stem.id, {
          ...stem,
          purchasedAt: purchase.purchasedAt,
          tokenId: purchase.listing.tokenId,
          chainId: purchase.listing.chainId,
          // We'll fill activeListingId later
        });
      }
    }

    // Add/Update with active listings
    // If a stem is in activeListings, it means the user currently owns it (and has it for sale)
    for (const listing of activeListings) {
      const stem = listing.stem;
      if (stem) {
        if (!stemMap.has(stem.id)) {
          // This might be a stem they minted but didn't "buy"
          stemMap.set(stem.id, {
            ...stem,
            tokenId: listing.tokenId,
            chainId: listing.chainId,
            activeListingId: listing.listingId.toString(),
          });
        } else {
          // Update existing entry from purchase with the active listing info
          const entry = stemMap.get(stem.id);
          entry.activeListingId = listing.listingId.toString();
        }
      }
    }

    return Array.from(stemMap.values());
  }
}
