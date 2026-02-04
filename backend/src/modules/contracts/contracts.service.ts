import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { prisma } from "../../db/prisma";
import type {
  ContractStemMintedEvent,
  ContractStemListedEvent,
  ContractStemSoldEvent,
  ContractRoyaltyPaidEvent,
  ContractListingCancelledEvent,
} from "../../events/event_types";

@Injectable()
export class ContractsService implements OnModuleInit {
  private readonly logger = new Logger(ContractsService.name);

  constructor(private readonly eventBus: EventBus) {}

  onModuleInit() {
    this.subscribeToContractEvents();
  }

  private subscribeToContractEvents() {
    // Handle StemMinted events
    this.eventBus.subscribe("contract.stem_minted", async (event: ContractStemMintedEvent) => {
      this.logger.log(`Processing StemMinted: tokenId=${event.tokenId}, tx=${event.transactionHash}`);
      
      try {
        // Find the stem by tokenURI (IPFS CID matches our stem URI)
        const stem = await prisma.stem.findFirst({
          where: { uri: { contains: event.tokenUri } },
        });

        const createData: any = {
          tokenId: BigInt(event.tokenId),
          chainId: event.chainId,
          contractAddress: event.contractAddress,
          creatorAddress: event.creatorAddress,
          royaltyBps: 500, // Default, will be updated from contract
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

        const listingData: any = {
          listingId: BigInt(event.listingId),
          tokenId: BigInt(event.tokenId),
          chainId: event.chainId,
          contractAddress: event.contractAddress,
          sellerAddress: event.sellerAddress,
          pricePerUnit: event.pricePerUnit,
          amount: BigInt(event.amount),
          paymentToken: event.paymentToken,
          expiresAt: new Date(parseInt(event.expiresAt) * 1000),
          transactionHash: event.transactionHash,
          blockNumber: BigInt(event.blockNumber),
          status: "active",
          listedAt: new Date(event.occurredAt),
        };
        
        if (nftMint?.stemId) {
          listingData.stem = { connect: { id: nftMint.stemId } };
        }

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
            buyerAddress: event.buyerAddress,
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
        await prisma.royaltyPayment.create({
          data: {
            tokenId: BigInt(event.tokenId),
            chainId: event.chainId,
            recipientAddress: event.recipientAddress,
            amount: event.amount,
            transactionHash: event.transactionHash,
            blockNumber: BigInt(event.blockNumber),
            paidAt: new Date(event.occurredAt),
          },
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
    limit?: number;
    offset?: number;
  }) {
    const { status, sellerAddress, chainId, limit = 20, offset = 0 } = options;

    return prisma.stemListing.findMany({
      where: {
        ...(status && { status }),
        ...(sellerAddress && { sellerAddress }),
        ...(chainId && { chainId }),
      },
      include: {
        stem: {
          include: { track: true },
        },
        purchases: true,
      },
      orderBy: { listedAt: "desc" },
      take: limit,
      skip: offset,
    });
  }

  async getListingById(listingId: bigint, chainId: number) {
    return prisma.stemListing.findFirst({
      where: { listingId, chainId },
      include: {
        stem: {
          include: { track: true },
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
}
