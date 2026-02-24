import { Controller, Get, Param, Query, NotFoundException, Logger } from "@nestjs/common";
import { ContractsService } from "./contracts.service";
import { prisma } from "../../db/prisma";
import { keccak256, toHex } from "viem";

/**
 * NFT Metadata Controller
 * Serves ERC-1155 compliant metadata for StemNFT tokens
 * 
 * IMPORTANT: Static routes must be defined BEFORE parameterized routes
 * to avoid route shadowing (e.g., "listings" matching ":chainId")
 */
@Controller("metadata")
export class MetadataController {
  private readonly logger = new Logger(MetadataController.name);

  constructor(private readonly contractsService: ContractsService) { }

  // ============ STATIC ROUTES (must come first) ============

  /**
   * Get NFT info for a stem
   * GET /api/metadata/stem/:stemId
   */
  @Get("stem/:stemId")
  async getStemNftInfo(@Param("stemId") stemId: string) {
    const mint = await prisma.stemNftMint.findUnique({
      where: { stemId },
    });

    if (!mint) {
      return null;
    }

    return {
      tokenId: mint.tokenId.toString(),
      chainId: mint.chainId,
      contractAddress: mint.contractAddress,
      creator: mint.creatorAddress,
      transactionHash: mint.transactionHash,
      mintedAt: mint.mintedAt.toISOString(),
    };
  }

  /**
   * Get all stems owned by a wallet (purchased)
   * GET /api/metadata/collection/:walletAddress
   */
  @Get("collection/:walletAddress")
  async getCollection(@Param("walletAddress") walletAddress: string) {
    const stems = await this.contractsService.getStemsByOwner(walletAddress);

    return {
      total: stems.length,
      stems: stems.map((stem: any) => {
        const release = stem.track?.release;

        // Artwork logic: Stem > Release URL > Release blob endpoint > Default
        let artworkUrl = this.toPublicUrl(stem.artworkUrl || release?.artworkUrl);
        if (!artworkUrl && release?.id && release?.artworkMimeType) {
          artworkUrl = `${process.env.BACKEND_URL || "http://localhost:3001"}/catalog/releases/${release.id}/artwork`;
        }
        if (!artworkUrl) {
          artworkUrl = `${process.env.BACKEND_URL || "http://localhost:3001"}/default-stem-cover.png`;
        }

        return {
          id: stem.id,
          title: stem.title || stem.type,
          type: stem.type,
          artist: release?.primaryArtist,
          trackTitle: stem.track?.title,
          releaseTitle: release?.title,
          genre: release?.genre,
          artworkUrl,
          previewUrl: this.toPublicUrl(stem.previewUrl, stem.id),
          uri: this.toPublicUrl(stem.uri, stem.id),
          tokenId: stem.tokenId?.toString(),
          chainId: stem.chainId,
          purchasedAt: stem.purchasedAt?.toISOString(),
          durationSeconds: stem.durationSeconds,
          activeListingId: stem.activeListingId,
        };
      }),
    };
  }


  /**
   * List marketplace listings
   */
  @Get("listings")
  async getListings(
    @Query("status") status?: string,
    @Query("seller") seller?: string,
    @Query("chainId") chainIdStr?: string,
    @Query("artistId") artistId?: string,
    @Query("releaseId") releaseId?: string,
    @Query("genre") genre?: string,
    @Query("search") search?: string,
    @Query("sortBy") sortBy?: string,
    @Query("minPrice") minPrice?: string,
    @Query("maxPrice") maxPrice?: string,
    @Query("excludeSeller") excludeSeller?: string,
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
      artistId,
      releaseId,
      genre,
      search: search?.trim() || undefined,
      sortBy,
      minPrice,
      maxPrice,
      excludeSellerAddress: excludeSeller?.toLowerCase(),
      limit,
      offset,
    });


    return {
      listings: listings.map((l) => {
        const stem = l.stem;
        const track = stem?.track;
        const release = track?.release;

        // Artwork logic: Stem > Release URL > Release blob endpoint > Default
        let artworkUrl = this.toPublicUrl(stem?.artworkUrl || release?.artworkUrl);

        // If no direct URL but release has artwork data, use the catalog endpoint
        if (!artworkUrl && release?.id && release?.artworkMimeType) {
          artworkUrl = `${process.env.BACKEND_URL || "http://localhost:3001"}/catalog/releases/${release.id}/artwork`;
        }

        if (!artworkUrl) {
          artworkUrl = `${process.env.BACKEND_URL || "http://localhost:3001"}/default-stem-cover.png`;
        }


        return {
          listingId: l.listingId.toString(),
          tokenId: l.tokenId.toString(),
          seller: l.sellerAddress,
          price: l.pricePerUnit,
          amount: l.amount.toString(),
          status: l.status,
          expiresAt: l.expiresAt.toISOString(),
          stem: stem
            ? {
              id: stem.id,
              title: stem.title || `${stem.type.charAt(0).toUpperCase() + stem.type.slice(1)} Stem`,
              type: stem.type,
              track: track?.title || "Unknown Track",
              artist: release?.primaryArtist || "Unknown Artist",
              trackId: track?.id,
              releaseId: release?.id,
              artistId: release?.artistId,
              artworkUrl,
              uri: this.toPublicUrl(stem.uri, stem.id),
              isAiGenerated: release?.type === 'ai_generated' || !!track?.generationMetadata,
              generationProvider: (track?.generationMetadata as any)?.provider,
            }
            : null,
        };
      }),
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

    const stem = listing.stem;
    const track = stem?.track;
    const release = track?.release;

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
      stem: stem
        ? {
          id: stem.id,
          title: stem.title,
          type: stem.type,
          uri: this.toPublicUrl(stem.uri, stem.id),
          track: track?.title,
          artist: release?.primaryArtist,
          artistId: release?.artistId,
          releaseId: release?.id,
          artworkUrl: this.toPublicUrl(stem.artworkUrl || release?.artworkUrl),
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

    // Format wei to ETH with decimal precision (avoid integer division truncation)
    const totalWei = BigInt(earnings.totalWei);
    const wholePart = totalWei / BigInt(1e18);
    const fracPart = totalWei % BigInt(1e18);
    const fracStr = fracPart.toString().padStart(18, "0").replace(/0+$/, "");
    const totalEth = fracStr.length > 0 ? `${wholePart}.${fracStr}` : wholePart.toString();

    return {
      address,
      totalWei: earnings.totalWei,
      totalEth,
      totalPayments: earnings.totalPayments,
      recentPayments: earnings.payments.map((p) => ({
        tokenId: p.tokenId.toString(),
        amount: p.amount,
        paidAt: p.paidAt.toISOString(),
        transactionHash: p.transactionHash,
      })),
    };
  }

  // ============ PARAMETERIZED ROUTES (must come after static routes) ============

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
    const genMeta = (track?.generationMetadata as any) || null;

    // Build OpenSea-compatible metadata
    const properties: Record<string, any> = {
      creator: nftData.creatorAddress,
      royalty_bps: nftData.royaltyBps,
      remixable: nftData.remixable,
      chain_id: chainId,
      contract_address: nftData.contractAddress,
    };

    // Add generation provenance for AI-created stems
    if (genMeta) {
      properties.generation = {
        provider: genMeta.provider || 'lyria-002',
        prompt_hash: genMeta.prompt
          ? keccak256(toHex(genMeta.prompt))
          : undefined,
        seed: genMeta.seed,
        synthid: genMeta.synthIdPresent ?? false,
        generated_at: genMeta.generatedAt,
        cost_usd: genMeta.cost != null
          ? String(genMeta.cost)
          : undefined,
      };
    }

    const metadata = {
      name: stem?.title || track?.title || (stem?.type ? `${stem.type.charAt(0).toUpperCase() + stem.type.slice(1)} Stem` : `Stem #${tokenId}`),
      description: this.buildDescription(stem, track, release),
      image: this.toPublicUrl(stem?.artworkUrl || release?.artworkUrl) || `${process.env.FRONTEND_URL || "https://resonate.audio"}/default-stem-cover.png`,
      animation_url: this.toPublicUrl(stem?.uri, stem?.id),
      external_url: `${process.env.FRONTEND_URL || "https://resonate.audio"}/stem/${tokenId}`,
      attributes: this.buildAttributes(nftData, stem, track, release),
      properties,
    };

    return metadata;
  }

  /**
   * Get metadata by stemId (Used before token is centrally indexed)
   * GET /api/metadata/:chainId/stem/:stemId
   */
  @Get(":chainId/stem/:stemId")
  async getMetadataByStemId(
    @Param("chainId") chainIdStr: string,
    @Param("stemId") stemId: string
  ) {
    const chainId = parseInt(chainIdStr);
    const stem = await this.contractsService.getStemData(stemId);

    if (!stem) {
      throw new NotFoundException(`Stem ${stemId} not found`);
    }

    const track = stem.track;
    const release = track?.release;
    const nftMint = stem.nftMint;

    return {
      name: stem.title || track?.title || `${stem.type.charAt(0).toUpperCase() + stem.type.slice(1)} Stem`,
      description: this.buildDescription(stem, track, release),
      image: this.toPublicUrl(stem.artworkUrl || release?.artworkUrl) || `${process.env.FRONTEND_URL || "https://resonate.audio"}/default-stem-cover.png`,
      animation_url: this.toPublicUrl(stem.uri, stem.id),
      external_url: `${process.env.FRONTEND_URL || "https://resonate.audio"}/stem/${stem.id}`,
      attributes: this.buildAttributes(nftMint, stem, track, release),
      properties: {
        creator: nftMint?.creatorAddress,
        type: stem.type,
        trackId: track?.id,
        releaseId: release?.id,
      }
    };
  }

  // ============ Helper Methods ============

  private toPublicUrl(uri?: string | null, stemId?: string): string | undefined {
    if (!uri) return undefined;

    // IF stemId is provided, we ALWAYS proxy through the backend for audio playback
    // This allows for decryption and ensures the browser receives standard mp3 headers
    if (stemId) {
      return `${process.env.BACKEND_URL || "http://localhost:3001"}/catalog/stems/${stemId}/preview`;
    }

    // Handle ipfs:// protocol for artwork/other
    if (uri.startsWith("ipfs://")) {
      return `https://ipfs.io/ipfs/${uri.replace("ipfs://", "")}`;
    }

    // Normalize Lighthouse gateway links to ipfs.io for artwork/other
    if (uri.includes("gateway.lighthouse.storage/ipfs/")) {
      return uri.replace("https://gateway.lighthouse.storage/ipfs/", "https://ipfs.io/ipfs/");
    }

    if (uri.startsWith("http")) {
      return uri;
    }

    return uri;
  }

  private buildDescription(stem: any, track: any, release: any): string {
    const isAi = release?.type === 'ai_generated' || !!track?.generationMetadata;
    const parts: string[] = [];

    if (isAi) {
      parts.push('AI-Generated');
    }

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

  private buildAttributes(nftData: any, stem: any, track: any, release: any): Array<{ trait_type: string; value: any }> {
    const attributes: Array<{ trait_type: string; value: any }> = [];

    if (stem?.type) {
      attributes.push({ trait_type: "Type", value: stem.type });
    }

    if (release?.primaryArtist) {
      attributes.push({ trait_type: "Artist", value: release.primaryArtist });
    }

    if (release?.title) {
      attributes.push({ trait_type: "Release", value: release.title });
    }

    if (track?.title) {
      attributes.push({ trait_type: "Track", value: track.title });
    }

    if (release?.genre) {
      attributes.push({ trait_type: "Genre", value: release.genre });
    }

    if (stem?.durationSeconds) {
      attributes.push({
        trait_type: "Duration",
        value: Math.round(stem.durationSeconds),
      });
    }

    if (nftData) {
      attributes.push({
        trait_type: "Remixable",
        value: nftData.remixable ? "Yes" : "No",
      });

      attributes.push({
        trait_type: "Royalty",
        value: `${nftData.royaltyBps / 100}%`,
      });
    }

    if (stem?.storageProvider) {
      attributes.push({
        trait_type: "Storage",
        value: stem.storageProvider.toUpperCase(),
      });
    }

    // AI generation provenance attributes
    const genMeta = track?.generationMetadata as any;
    const isAi = release?.type === 'ai_generated' || !!genMeta;
    attributes.push({
      trait_type: "AI Generated",
      value: isAi ? "Yes" : "No",
    });

    if (isAi && genMeta?.provider) {
      attributes.push({
        trait_type: "AI Provider",
        value: genMeta.provider,
      });
    }

    if (isAi && genMeta?.synthIdPresent) {
      attributes.push({
        trait_type: "SynthID Verified",
        value: "Yes",
      });
    }

    return attributes;
  }
}
