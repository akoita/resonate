// @ts-nocheck - Prisma strict types conflict with mock null values for fallback testing
import { MetadataController } from "../modules/contracts/metadata.controller";
import { ContractsService } from "../modules/contracts/contracts.service";
import { NotFoundException } from "@nestjs/common";

// ============ Prisma Mock ============

const mockStemNftMints = new Map<string, any>();

jest.mock("../db/prisma", () => {
    return {
        prisma: {
            stemNftMint: {
                findUnique: jest.fn(async ({ where }: any) => mockStemNftMints.get(where.stemId) ?? null),
            },
        },
    };
});

// ============ ContractsService Mock ============

function createMockContractsService(): jest.Mocked<ContractsService> {
    return {
        onModuleInit: jest.fn(),
        getListings: jest.fn().mockResolvedValue([]),
        getListingById: jest.fn().mockResolvedValue(null),
        getStemNftData: jest.fn().mockResolvedValue(null),
        getRoyaltyPayments: jest.fn().mockResolvedValue([]),
        getArtistEarnings: jest.fn().mockResolvedValue({
            totalWei: "0",
            totalPayments: 0,
            payments: [],
        }),
        getStemData: jest.fn().mockResolvedValue(null),
        getStemsByOwner: jest.fn().mockResolvedValue([]),
    } as any;
}

// ============ Tests ============

describe("MetadataController", () => {
    let controller: MetadataController;
    let contractsService: jest.Mocked<ContractsService>;

    beforeEach(() => {
        mockStemNftMints.clear();
        contractsService = createMockContractsService();
        controller = new MetadataController(contractsService);
    });

    // ============ getStemNftInfo ============

    describe("getStemNftInfo", () => {
        it("returns null when stem has no NFT mint", async () => {
            const result = await controller.getStemNftInfo("nonexistent");
            expect(result).toBeNull();
        });

        it("returns formatted NFT info when mint exists", async () => {
            const now = new Date();
            mockStemNftMints.set("stem_1", {
                tokenId: 42n,
                chainId: 31337,
                contractAddress: "0xStemNFT",
                creatorAddress: "0xCreator",
                transactionHash: "0xmint_hash",
                mintedAt: now,
            });

            const result = await controller.getStemNftInfo("stem_1");
            expect(result).toEqual({
                tokenId: "42",
                chainId: 31337,
                contractAddress: "0xStemNFT",
                creator: "0xCreator",
                transactionHash: "0xmint_hash",
                mintedAt: now.toISOString(),
            });
        });
    });

    // ============ getCollection ============

    describe("getCollection", () => {
        it("returns empty collection for wallet with no stems", async () => {
            const result = await controller.getCollection("0xEmpty");
            expect(result.total).toBe(0);
            expect(result.stems).toEqual([]);
        });

        it("returns formatted stems for wallet", async () => {
            contractsService.getStemsByOwner.mockResolvedValueOnce([
                {
                    id: "stem_1",
                    type: "vocals",
                    title: "Lead Vocals",
                    uri: "ipfs://QmStem1",
                    artworkUrl: null,
                    durationSeconds: 180,
                    tokenId: 1n,
                    chainId: 31337,
                    purchasedAt: new Date("2026-01-01"),
                    track: {
                        title: "My Song",
                        release: {
                            title: "My Album",
                            primaryArtist: "Artist",
                            genre: "Electronic",
                            artworkUrl: "ipfs://QmArt",
                        },
                    },
                },
            ]);

            const result = await controller.getCollection("0xOwner");
            expect(result.total).toBe(1);
            expect(result.stems[0].title).toBe("Lead Vocals");
            expect(result.stems[0].artist).toBe("Artist");
        });
    });

    // ============ getListings ============

    describe("getListings", () => {
        it("returns formatted listings with stem metadata", async () => {
            const now = new Date();
            contractsService.getListings.mockResolvedValueOnce([
                {
                    listingId: 1n,
                    tokenId: 42n,
                    chainId: 31337,
                    sellerAddress: "0xseller",
                    pricePerUnit: "1000000000000000000",
                    amount: 50n,
                    status: "active",
                    expiresAt: now,
                    listedAt: now,
                    transactionHash: "0xlist",
                    blockNumber: 100n,
                    stem: {
                        id: "stem_1",
                        type: "bass",
                        title: "Bass Line",
                        uri: "ipfs://QmStem",
                        artworkUrl: null,
                        track: {
                            id: "track_1",
                            title: "Track Title",
                            release: {
                                id: "release_1",
                                primaryArtist: "DJ Artist",
                                artistId: "artist_1",
                                artworkUrl: null,
                                artworkMimeType: "image/png",
                            },
                        },
                    },
                    purchases: [],
                },
            ]);

            const result = await controller.getListings("active");
            expect(result.total).toBe(1);
            expect(result.listings[0].listingId).toBe("1");
            expect(result.listings[0].stem?.title).toBe("Bass Line");
            expect(result.listings[0].stem?.artist).toBe("DJ Artist");
        });

        it("parses chainId, limit, and offset from strings", async () => {
            await controller.getListings(undefined, undefined, "31337", undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, "10", "5");
            expect(contractsService.getListings).toHaveBeenCalledWith(
                expect.objectContaining({ chainId: 31337, limit: 10, offset: 5 })
            );
        });

        it("defaults limit to 20 and offset to 0", async () => {
            await controller.getListings();
            expect(contractsService.getListings).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 20, offset: 0 })
            );
        });
    });

    // ============ getListingById ============

    describe("getListingById", () => {
        it("throws NotFoundException when listing not found", async () => {
            await expect(controller.getListingById("31337", "999")).rejects.toThrow(NotFoundException);
        });

        it("returns formatted listing with purchases", async () => {
            const now = new Date();
            contractsService.getListingById.mockResolvedValueOnce({
                listingId: 1n,
                tokenId: 42n,
                chainId: 31337,
                sellerAddress: "0xseller",
                pricePerUnit: "1000000000000000000",
                amount: 50n,
                paymentToken: "0x0000000000000000000000000000000000000000",
                status: "active",
                expiresAt: now,
                listedAt: now,
                soldAt: null,
                stem: {
                    id: "stem_1",
                    type: "drums",
                    title: "Drum Pattern",
                    uri: "ipfs://QmStem",
                    artworkUrl: null,
                    track: {
                        title: "Beat",
                        release: {
                            id: "rel_1",
                            primaryArtist: "Producer",
                            artistId: "art_1",
                            artworkUrl: null,
                        },
                    },
                },
                purchases: [
                    {
                        buyerAddress: "0xbuyer",
                        amount: 10n,
                        totalPaid: "10000000000000000000",
                        purchasedAt: now,
                    },
                ],
            });

            const result = await controller.getListingById("31337", "1");
            expect(result.listingId).toBe("1");
            expect(result.stem?.title).toBe("Drum Pattern");
            expect(result.purchases).toHaveLength(1);
            expect(result.purchases[0].buyer).toBe("0xbuyer");
        });
    });

    // ============ getEarnings ============

    describe("getEarnings", () => {
        it("returns formatted earnings with ETH conversion", async () => {
            contractsService.getArtistEarnings.mockResolvedValueOnce({
                totalWei: "3500000000000000000",
                totalPayments: 2,
                payments: [
                    {
                        tokenId: 1n,
                        amount: "2000000000000000000",
                        paidAt: new Date("2026-01-15"),
                        transactionHash: "0xroyalty1",
                    },
                    {
                        tokenId: 2n,
                        amount: "1500000000000000000",
                        paidAt: new Date("2026-01-20"),
                        transactionHash: "0xroyalty2",
                    },
                ],
            });

            const result = await controller.getEarnings("0xArtist");
            expect(result.address).toBe("0xArtist");
            expect(result.totalWei).toBe("3500000000000000000");
            expect(result.totalEth).toBe("3.5");
            expect(result.totalPayments).toBe(2);
            expect(result.recentPayments).toHaveLength(2);
        });

        it("returns zero ETH for no earnings", async () => {
            contractsService.getArtistEarnings.mockResolvedValueOnce({
                totalWei: "0",
                totalPayments: 0,
                payments: [],
            });

            const result = await controller.getEarnings("0xNobody");
            expect(result.totalEth).toBe("0");
            expect(result.totalPayments).toBe(0);
        });
    });

    // ============ getContractMetadata ============

    describe("getContractMetadata", () => {
        it("returns collection-level metadata", async () => {
            const result = await controller.getContractMetadata("31337");
            expect(result.name).toBe("Resonate Stems");
            expect(result.description).toContain("Audio stem NFTs");
            expect(result.seller_fee_basis_points).toBe(500);
        });
    });

    // ============ getTokenMetadata ============

    describe("getTokenMetadata", () => {
        it("throws NotFoundException when token not found", async () => {
            await expect(controller.getTokenMetadata("31337", "999")).rejects.toThrow(NotFoundException);
        });

        it("returns OpenSea-compatible metadata for existing token", async () => {
            contractsService.getStemNftData.mockResolvedValueOnce({
                tokenId: 42n,
                chainId: 31337,
                contractAddress: "0xStemNFT",
                creatorAddress: "0xCreator",
                royaltyBps: 500,
                remixable: true,
                stem: {
                    id: "stem_1",
                    type: "vocals",
                    title: "Lead Vocals",
                    uri: "ipfs://QmAudioFile",
                    artworkUrl: "ipfs://QmArtwork",
                    durationSeconds: 240,
                    storageProvider: "ipfs",
                    track: {
                        title: "My Song",
                        release: {
                            title: "My Album",
                            primaryArtist: "Singer",
                            genre: "Pop",
                        },
                    },
                },
            });

            const result = await controller.getTokenMetadata("31337", "42");
            expect(result.name).toBe("Lead Vocals");
            expect(result.description).toContain("Vocals stem");
            expect(result.image).toBe("https://ipfs.io/ipfs/QmArtwork");
            expect(result.properties.creator).toBe("0xCreator");
            expect(result.properties.royalty_bps).toBe(500);
            expect(result.properties.remixable).toBe(true);
            expect(result.attributes).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ trait_type: "Type", value: "vocals" }),
                    expect.objectContaining({ trait_type: "Artist", value: "Singer" }),
                    expect.objectContaining({ trait_type: "Remixable", value: "Yes" }),
                    expect.objectContaining({ trait_type: "Royalty", value: "5%" }),
                ])
            );
        });
    });

    // ============ getMetadataByStemId ============

    describe("getMetadataByStemId", () => {
        it("throws NotFoundException when stem not found", async () => {
            await expect(controller.getMetadataByStemId("31337", "nonexistent")).rejects.toThrow(NotFoundException);
        });

        it("returns metadata for existing stem", async () => {
            contractsService.getStemData.mockResolvedValueOnce({
                id: "stem_1",
                type: "bass",
                title: "Bass Line",
                uri: "https://example.com/audio.mp3",
                artworkUrl: null,
                durationSeconds: 120,
                track: {
                    title: "Groove",
                    release: {
                        title: "Bass Album",
                        primaryArtist: "Bassist",
                        genre: "Funk",
                    },
                },
                nftMint: {
                    creatorAddress: "0xBassist",
                    royaltyBps: 300,
                    remixable: false,
                },
            });

            const result = await controller.getMetadataByStemId("31337", "stem_1");
            expect(result.name).toBe("Bass Line");
            expect(result.description).toContain("Bass stem");
            expect(result.properties.creator).toBe("0xBassist");
        });
    });

    // ============ Helper Methods (via public methods) ============

    describe("toPublicUrl (via getTokenMetadata)", () => {
        it("converts ipfs:// protocol to public gateway", async () => {
            contractsService.getStemNftData.mockResolvedValueOnce({
                creatorAddress: "0x",
                royaltyBps: 500,
                remixable: true,
                contractAddress: "0x",
                stem: {
                    type: "vocals",
                    artworkUrl: "ipfs://QmHash123",
                    uri: null,
                    track: null,
                },
            });

            const result = await controller.getTokenMetadata("31337", "1");
            expect(result.image).toBe("https://ipfs.io/ipfs/QmHash123");
        });

        it("converts Lighthouse gateway URLs to ipfs.io", async () => {
            contractsService.getStemNftData.mockResolvedValueOnce({
                creatorAddress: "0x",
                royaltyBps: 500,
                remixable: true,
                contractAddress: "0x",
                stem: {
                    type: "drums",
                    artworkUrl: "https://gateway.lighthouse.storage/ipfs/QmLighthouse",
                    uri: null,
                    track: null,
                },
            });

            const result = await controller.getTokenMetadata("31337", "2");
            expect(result.image).toBe("https://ipfs.io/ipfs/QmLighthouse");
        });
    });

    describe("buildDescription", () => {
        it("returns default description when no metadata available", async () => {
            contractsService.getStemNftData.mockResolvedValueOnce({
                creatorAddress: "0x",
                royaltyBps: 500,
                remixable: true,
                contractAddress: "0x",
                stem: {
                    type: null,
                    artworkUrl: null,
                    uri: null,
                    track: null,
                },
            });

            const result = await controller.getTokenMetadata("31337", "3");
            expect(result.description).toBe("Audio stem NFT from Resonate Protocol");
        });
    });
});
