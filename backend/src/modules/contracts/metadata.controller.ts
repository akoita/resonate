import { Controller, Get, Param, Query, NotFoundException, Logger } from "@nestjs/common";
import { ContractsService } from "./contracts.service";
import { prisma } from "../../db/prisma";

/**
 * NFT Metadata Controller
 * Serves ERC-1155 compliant metadata for StemNFT tokens
 */
@Controller("api/metadata")
export class MetadataController {
  private readonly logger = new Logger(MetadataController.name);

  constructor(private readonly contractsService: ContractsService) {}

  /**
   * ERC-1155 Token URI endpoint
   * Returns OpenSea-compatible metadata JSON
   * 
   * GET /api/metadata/:chainId/:tokenId
   */
  @Get(":chainId/:tokenId")
  async getTokenMetadata(
    @Param("chainId") chainIdStr: string,
    @Param("tokenId") tokenIdStr: string
  ) {
    const chainId = parseInt(chainIdStr);
    const tokenId = BigInt(tokenIdStr);

    // Get NFT mint data with related stem info
    const nftData = await this.contractsService.getStemNftData(tokenId, chainId);

    if (!nftData) {
      throw new NotFoundException(`Token ${tokenId} not found on chain ${chainId}`);
    }

    const stem = nftData.stem;
    const track = stem?.track;
    const release = track?.release;

    // Build OpenSea-compatible metadata
    const metadata = {
      name: stem?.title || track?.title || `Stem #${tokenId}`,
      description: this.buildDescription(stem, track, release),
      image: this.getImageUrl(stem, release),
      animation_url: this.getAnimationUrl(stem),
      external_url: `${process.env.FRONTEND_URL || "https://resonate.audio"}/stem/${tokenId}`,
      attributes: this.buildAttributes(nftData, stem, track),
      properties: {
        creator: nftData.creatorAddress,
        royalty_bps: nftData.royaltyBps,
        remixable: nftData.remixable,
        chain_id: chainId,
        contract_address: nftData.contractAddress,
      },
    };

    return metadata;
  }

  /**
   * Get contract metadata (collection info)
   * GET /api/metadata/:chainId/contract
   */
  @Get(":chainId/contract")
  async getContractMetadata(@Param("chainId") chainIdStr: string) {
    const chainId = parseInt(chainIdStr);

    return {
      name: "Resonate Stems",
      description: "Audio stem NFTs from Resonate Protocol. Each stem represents a unique layer of music that can be licensed, remixed, and traded.",
      image: `${process.env.FRONTEND_URL || "https://resonate.audio"}/collection-image.png`,
      external_link: process.env.FRONTEND_URL || "https://resonate.audio",
      seller_fee_basis_points: 500, // 5% default royalty
      fee_recipient: process.env.PROTOCOL_FEE_RECIPIENT || "0x0000000000000000000000000000000000000000",
    };
  }

  /**
   * List marketplace listings
   * GET /api/metadata/listings
   */
  @Get("listings")
  async getListings(
    @Query("status") status?: string,
    @Query("seller") seller?: string,
    @Query("chainId") chainIdStr?: string,
    @Query("limit") limitStr?: string,
    @Query("offset") offsetStr?: string
  ) {
    const chainId = chainIdStr ? parseInt(chainIdStr) : undefined;
    const limit = limitStr ? parseInt(limitStr) : 20;
    const offset = offsetStr ? parseInt(offsetStr) : 0;

    const listings = await this.contractsService.getListings({
      status,
      sellerAddress: seller,
      chainId,
      limit,
      offset,
    });

    return {
      listings: listings.map((l) => ({
        listingId: l.listingId.toString(),
        tokenId: l.tokenId.toString(),
        seller: l.sellerAddress,
        price: l.pricePerUnit,
        amount: l.amount.toString(),
        status: l.status,
        expiresAt: l.expiresAt.toISOString(),
        stem: l.stem
          ? {
              id: l.stem.id,
              title: l.stem.title,
              type: l.stem.type,
              track: l.stem.track?.title,
            }
          : null,
      })),
      total: listings.length,
      limit,
      offset,
    };
  }

  /**
   * Get listing by ID
   * GET /api/metadata/listings/:chainId/:listingId
   */
  @Get("listings/:chainId/:listingId")
  async getListingById(
    @Param("chainId") chainIdStr: string,
    @Param("listingId") listingIdStr: string
  ) {
    const chainId = parseInt(chainIdStr);
    const listingId = BigInt(listingIdStr);

    const listing = await this.contractsService.getListingById(listingId, chainId);

    if (!listing) {
      throw new NotFoundException(`Listing ${listingId} not found on chain ${chainId}`);
    }

    return {
      listingId: listing.listingId.toString(),
      tokenId: listing.tokenId.toString(),
      chainId: listing.chainId,
      seller: listing.sellerAddress,
      price: listing.pricePerUnit,
      amount: listing.amount.toString(),
      paymentToken: listing.paymentToken,
      status: listing.status,
      expiresAt: listing.expiresAt.toISOString(),
      listedAt: listing.listedAt.toISOString(),
      soldAt: listing.soldAt?.toISOString(),
      stem: listing.stem
        ? {
            id: listing.stem.id,
            title: listing.stem.title,
            type: listing.stem.type,
            uri: listing.stem.uri,
            track: listing.stem.track?.title,
          }
        : null,
      purchases: listing.purchases.map((p) => ({
        buyer: p.buyerAddress,
        amount: p.amount.toString(),
        totalPaid: p.totalPaid,
        purchasedAt: p.purchasedAt.toISOString(),
      })),
    };
  }

  /**
   * Get royalty earnings for an artist
   * GET /api/metadata/earnings/:address
   */
  @Get("earnings/:address")
  async getEarnings(@Param("address") address: string) {
    const earnings = await this.contractsService.getArtistEarnings(address);

    return {
      address,
      totalWei: earnings.totalWei,
      totalEth: (BigInt(earnings.totalWei) / BigInt(1e18)).toString(),
      totalPayments: earnings.totalPayments,
      recentPayments: earnings.payments.map((p) => ({
        tokenId: p.tokenId.toString(),
        amount: p.amount,
        paidAt: p.paidAt.toISOString(),
        transactionHash: p.transactionHash,
      })),
    };
  }

  // ============ Helper Methods ============

  private buildDescription(stem: any, track: any, release: any): string {
    const parts: string[] = [];

    if (stem?.type) {
      parts.push(`${stem.type.charAt(0).toUpperCase() + stem.type.slice(1)} stem`);
    }

    if (track?.title) {
      parts.push(`from "${track.title}"`);
    }

    if (release?.primaryArtist) {
      parts.push(`by ${release.primaryArtist}`);
    }

    if (parts.length === 0) {
      return "Audio stem NFT from Resonate Protocol";
    }

    return parts.join(" ") + ". Licensed through Resonate Protocol.";
  }

  private getImageUrl(stem: any, release: any): string {
    // Priority: stem artwork > release artwork > default
    if (stem?.artworkUrl) {
      return stem.artworkUrl;
    }
    if (release?.artworkUrl) {
      return release.artworkUrl;
    }
    return `${process.env.FRONTEND_URL || "https://resonate.audio"}/default-stem-cover.png`;
  }

  private getAnimationUrl(stem: any): string | undefined {
    // Return audio file URL for playable NFTs
    if (stem?.uri) {
      // Convert internal URI to public URL
      if (stem.uri.startsWith("ipfs://")) {
        return `https://ipfs.io/ipfs/${stem.uri.replace("ipfs://", "")}`;
      }
      if (stem.uri.startsWith("http")) {
        return stem.uri;
      }
      // Local storage
      return `${process.env.BACKEND_URL || "http://localhost:3001"}/api/stems/${stem.id}/audio`;
    }
    return undefined;
  }

  private buildAttributes(nftData: any, stem: any, track: any): Array<{ trait_type: string; value: any }> {
    const attributes: Array<{ trait_type: string; value: any }> = [];

    if (stem?.type) {
      attributes.push({ trait_type: "Type", value: stem.type });
    }

    if (track?.release?.genre) {
      attributes.push({ trait_type: "Genre", value: track.release.genre });
    }

    if (stem?.durationSeconds) {
      attributes.push({
        trait_type: "Duration",
        value: Math.round(stem.durationSeconds),
      });
    }

    attributes.push({
      trait_type: "Remixable",
      value: nftData.remixable ? "Yes" : "No",
    });

    attributes.push({
      trait_type: "Royalty",
      value: `${nftData.royaltyBps / 100}%`,
    });

    if (stem?.storageProvider) {
      attributes.push({
        trait_type: "Storage",
        value: stem.storageProvider.toUpperCase(),
      });
    }

    return attributes;
  }
}
