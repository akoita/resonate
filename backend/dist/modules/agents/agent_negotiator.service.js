"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AgentNegotiatorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentNegotiatorService = void 0;
const common_1 = require("@nestjs/common");
const viem_1 = require("viem");
const chains_1 = require("viem/chains");
const prisma_1 = require("../../db/prisma");
const tool_registry_1 = require("./tools/tool_registry");
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
];
let AgentNegotiatorService = AgentNegotiatorService_1 = class AgentNegotiatorService {
    tools;
    logger = new common_1.Logger(AgentNegotiatorService_1.name);
    rpcUrl;
    marketplaceAddress;
    constructor(tools) {
        this.tools = tools;
        this.rpcUrl = process.env.RPC_URL ?? "http://localhost:8545";
        this.marketplaceAddress = (process.env.MARKETPLACE_ADDRESS ??
            "0x0000000000000000000000000000000000000000");
    }
    async negotiate(input) {
        const tool = this.tools.get("pricing.quote");
        const quote = await tool.run({
            licenseType: input.licenseType ?? "personal",
            volume: false,
        });
        const priceUsd = Number(quote.priceUsd ?? 0);
        const allowed = priceUsd <= input.budgetRemainingUsd;
        const result = {
            licenseType: input.licenseType ?? "personal",
            priceUsd,
            allowed,
            reason: allowed ? "within_budget" : "over_budget",
            listings: [],
        };
        if (!allowed)
            return result;
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
                this.logger.debug(`Found ${filtered.length} active listing(s) for track ${input.trackId}: ${filtered.map((l) => `${l.stemType}#${l.listingId}`).join(", ")}`);
            }
        }
        catch (err) {
            this.logger.warn(`Failed to look up listings for track ${input.trackId}: ${err}`);
        }
        return result;
    }
    /**
     * Walk track → stems → StemListing to find ALL active on-chain listings.
     * Validates each candidate against the on-chain contract.
     * Auto-heals stale DB records if the listing doesn't exist on-chain.
     */
    async findActiveListings(trackId) {
        const stems = await prisma_1.prisma.stem.findMany({
            where: { trackId },
            include: {
                nftMint: true,
                listings: {
                    where: { status: "active" },
                    orderBy: { listedAt: "desc" },
                },
            },
        });
        const validListings = [];
        for (const stem of stems) {
            for (const listing of stem.listings) {
                const onChainValid = await this.verifyListingOnChain(listing.listingId);
                if (!onChainValid) {
                    this.logger.warn(`Listing ${listing.listingId} is active in DB but not on-chain — marking as stale`);
                    await prisma_1.prisma.stemListing.update({
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
    async verifyListingOnChain(listingId) {
        try {
            const chainId = Number(process.env.AA_CHAIN_ID ?? "11155111");
            const chain = chainId === 31337 ? chains_1.foundry : chains_1.sepolia;
            const publicClient = (0, viem_1.createPublicClient)({
                chain,
                transport: (0, viem_1.http)(this.rpcUrl),
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
            if (seller === zeroAddr)
                return false;
            if (amount === 0n)
                return false;
            const nowSeconds = Math.floor(Date.now() / 1000);
            if (Number(expiry) < nowSeconds)
                return false;
            return true;
        }
        catch (err) {
            this.logger.error(`On-chain listing check failed for ${listingId}: ${err}`);
            return false;
        }
    }
};
exports.AgentNegotiatorService = AgentNegotiatorService;
exports.AgentNegotiatorService = AgentNegotiatorService = AgentNegotiatorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [tool_registry_1.ToolRegistry])
], AgentNegotiatorService);
