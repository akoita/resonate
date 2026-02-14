import { Injectable, Logger } from "@nestjs/common";
import { createPublicClient, http, type Address } from "viem";
import { sepolia, foundry } from "viem/chains";
import { prisma } from "../../db/prisma";
import { ToolRegistry } from "./tools/tool_registry";

/** ABI fragment for StemMarketplaceV2.listings(uint256) view */
const LISTINGS_ABI = [
  {
    name: "listings",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "listingId", type: "uint256" }],
    outputs: [
      { name: "seller", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "pricePerUnit", type: "uint256" },
      { name: "paymentToken", type: "address" },
      { name: "expiry", type: "uint40" },
    ],
  },
] as const;

export interface AgentNegotiatorInput {
  trackId: string;
  licenseType?: "personal" | "remix" | "commercial";
  budgetRemainingUsd: number;
  /** Which stem types to buy. Empty array = buy all listed stems. */
  stemTypes?: string[];
}

export interface ListingInfo {
  listingId: bigint;
  tokenId: bigint;
  pricePerUnit: string;
  chainId: number;
  stemType: string;
}

export interface NegotiationResult {
  licenseType: "personal" | "remix" | "commercial";
  priceUsd: number;
  allowed: boolean;
  reason: string;
  /** First listing (backward compat) */
  listing?: ListingInfo;
  /** All active on-chain listings for this track */
  listings: ListingInfo[];
}

@Injectable()
export class AgentNegotiatorService {
  private readonly logger = new Logger(AgentNegotiatorService.name);
  private readonly rpcUrl: string;
  private readonly marketplaceAddress: Address;

  constructor(private readonly tools: ToolRegistry) {
    this.rpcUrl = process.env.RPC_URL ?? "http://localhost:8545";
    this.marketplaceAddress = (process.env.MARKETPLACE_ADDRESS ??
      "0x0000000000000000000000000000000000000000") as Address;
  }

  async negotiate(input: AgentNegotiatorInput): Promise<NegotiationResult> {
    const tool = this.tools.get("pricing.quote");
    const quote = await tool.run({
      licenseType: input.licenseType ?? "personal",
      volume: false,
    });
    const priceUsd = Number(quote.priceUsd ?? 0);
    const allowed = priceUsd <= input.budgetRemainingUsd;

    const result: NegotiationResult = {
      licenseType: input.licenseType ?? "personal",
      priceUsd,
      allowed,
      reason: allowed ? "within_budget" : "over_budget",
      listings: [],
    };

    if (!allowed) return result;

    // Look up all active on-chain listings for this track
    try {
      const allListings = await this.findActiveListings(input.trackId);

      // Filter by preferred stem types if specified
      const stemFilter = input.stemTypes ?? [];
      const filtered = stemFilter.length > 0
        ? allListings.filter((l) => stemFilter.includes(l.stemType))
        : allListings;

      result.listings = filtered;
      result.listing = filtered[0]; // backward compat

      if (filtered.length > 0) {
        this.logger.debug(
          `Found ${filtered.length} active listing(s) for track ${input.trackId}: ${filtered.map((l) => `${l.stemType}#${l.listingId}`).join(", ")}`
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to look up listings for track ${input.trackId}: ${err}`
      );
    }

    return result;
  }

  /**
   * Walk track → stems → StemListing to find ALL active on-chain listings.
   * Validates each candidate against the on-chain contract.
   * Auto-heals stale DB records if the listing doesn't exist on-chain.
   */
  private async findActiveListings(trackId: string): Promise<ListingInfo[]> {
    const stems = await prisma.stem.findMany({
      where: { trackId },
      include: {
        nftMint: true,
        listings: {
          where: { status: "active" },
          orderBy: { listedAt: "desc" },
        },
      },
    });

    const validListings: ListingInfo[] = [];

    for (const stem of stems) {
      for (const listing of stem.listings) {
        const onChainValid = await this.verifyListingOnChain(listing.listingId);
        if (!onChainValid) {
          this.logger.warn(
            `Listing ${listing.listingId} is active in DB but not on-chain — marking as stale`,
          );
          await prisma.stemListing.update({
            where: { id: listing.id },
            data: { status: "stale" },
          });
          continue;
        }

        validListings.push({
          listingId: listing.listingId,
          tokenId: listing.tokenId,
          pricePerUnit: listing.pricePerUnit,
          chainId: listing.chainId,
          stemType: stem.type,
        });
      }
    }

    return validListings;
  }

  /**
   * Call the marketplace contract's `listings(uint256)` view function
   * to verify a listing is actually active on-chain.
   */
  private async verifyListingOnChain(listingId: bigint): Promise<boolean> {
    try {
      const chainId = Number(process.env.AA_CHAIN_ID ?? "11155111");
      const chain = chainId === 31337 ? foundry : sepolia;

      const publicClient = createPublicClient({
        chain,
        transport: http(this.rpcUrl),
      });

      const result = await publicClient.readContract({
        address: this.marketplaceAddress,
        abi: LISTINGS_ABI,
        functionName: "listings",
        args: [listingId],
      });

      // result matches the ABI outputs order
      const [seller, , amount, , , expiry] = result;
      const zeroAddr = "0x0000000000000000000000000000000000000000";

      // A listing is invalid if:
      // 1. Seller is 0x0 (deleted)
      // 2. Amount is 0 (sold out)
      // 3. Expired
      if (seller === zeroAddr) return false;
      if (amount === 0n) return false;

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (Number(expiry) < nowSeconds) return false;

      return true;
    } catch (err) {
      this.logger.error(`On-chain listing check failed for ${listingId}: ${err}`);
      return false;
    }
  }
}
