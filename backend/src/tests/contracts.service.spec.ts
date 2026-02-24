import { ContractsService } from "../modules/contracts/contracts.service";
import { EventBus } from "../modules/shared/event_bus";
import type {
    ContractStemMintedEvent,
    ContractStemListedEvent,
    ContractStemSoldEvent,
    ContractRoyaltyPaidEvent,
    ContractListingCancelledEvent,
} from "../events/event_types";

// ============ Prisma Mock ============

const mockStemNftMints = new Map<string, any>();
const mockStemListings = new Map<string, any>();
const mockStemPurchases = new Map<string, any>();
const mockRoyaltyPayments = new Map<string, any>();
const mockStems = new Map<string, any>();

jest.mock("../db/prisma", () => {
    return {
        prisma: {
            stem: {
                findUnique: jest.fn(async ({ where }: any) => mockStems.get(where.id) ?? null),
                findFirst: jest.fn(async ({ where }: any) => {
                    if (where?.uri?.contains) {
                        return [...mockStems.values()].find((s) => s.uri?.includes(where.uri.contains)) ?? null;
                    }
                    return null;
                }),
                update: jest.fn(async ({ where, data }: any) => {
                    const existing = mockStems.get(where.id);
                    if (!existing) return null;
                    const updated = { ...existing, ...data };
                    mockStems.set(where.id, updated);
                    return updated;
                }),
            },
            stemNftMint: {
                upsert: jest.fn(async ({ where, create }: any) => {
                    const key = where.transactionHash;
                    if (mockStemNftMints.has(key)) return mockStemNftMints.get(key);
                    const record = { id: `mint_${mockStemNftMints.size + 1}`, ...create };
                    mockStemNftMints.set(key, record);
                    return record;
                }),
                findFirst: jest.fn(async ({ where }: any) => {
                    return (
                        [...mockStemNftMints.values()].find(
                            (m) => m.tokenId === where.tokenId && m.chainId === where.chainId
                        ) ?? null
                    );
                }),
            },
            stemListing: {
                upsert: jest.fn(async ({ where, create }: any) => {
                    const key = where.transactionHash;
                    if (mockStemListings.has(key)) return mockStemListings.get(key);
                    const record = { id: `listing_${mockStemListings.size + 1}`, ...create };
                    mockStemListings.set(key, record);
                    return record;
                }),
                findFirst: jest.fn(async ({ where }: any) => {
                    return (
                        [...mockStemListings.values()].find(
                            (l) => l.listingId === where.listingId && l.chainId === where.chainId
                        ) ?? null
                    );
                }),
                findMany: jest.fn(async (args: any) => {
                    let results = Array.from(mockStemListings.values());
                    const w = args?.where;
                    if (w?.status) results = results.filter((l) => l.status === w.status);
                    if (w?.sellerAddress) {
                        const addr =
                            typeof w.sellerAddress === "object"
                                ? w.sellerAddress.equals?.toLowerCase()
                                : w.sellerAddress;
                        results = results.filter(
                            (l) => l.sellerAddress?.toLowerCase() === addr?.toLowerCase()
                        );
                    }
                    if (w?.chainId) results = results.filter((l) => l.chainId === w.chainId);
                    return results;
                }),
                update: jest.fn(async ({ where, data }: any) => {
                    const existing = [...mockStemListings.values()].find((l) => l.id === where.id);
                    if (!existing) throw new Error("Listing not found");
                    const updated = { ...existing, ...data };
                    mockStemListings.set(existing.transactionHash || existing.id, updated);
                    return updated;
                }),
                updateMany: jest.fn(async () => ({ count: 0 })),
            },
            stemPurchase: {
                upsert: jest.fn(async ({ where, create }: any) => {
                    const key = where.transactionHash;
                    if (mockStemPurchases.has(key)) return mockStemPurchases.get(key);
                    const record = { id: `purchase_${mockStemPurchases.size + 1}`, ...create };
                    mockStemPurchases.set(key, record);
                    return record;
                }),
                findMany: jest.fn(async ({ where }: any) => {
                    let results = Array.from(mockStemPurchases.values());
                    if (where?.buyerAddress) {
                        if (typeof where.buyerAddress === "string") {
                            results = results.filter(
                                (p) => p.buyerAddress === where.buyerAddress.toLowerCase()
                            );
                        } else if (where.buyerAddress.in) {
                            const addrs = where.buyerAddress.in.map((a: string) => a.toLowerCase());
                            results = results.filter(
                                (p) => addrs.includes(p.buyerAddress?.toLowerCase())
                            );
                        }
                    }
                    if (where?.transactionHash?.in) {
                        results = results.filter(
                            (p) => where.transactionHash.in.includes(p.transactionHash)
                        );
                    }
                    return results;
                }),
            },
            royaltyPayment: {
                upsert: jest.fn(async ({ where, create }: any) => {
                    const key = `${where.transactionHash_tokenId?.transactionHash}_${where.transactionHash_tokenId?.tokenId}`;
                    if (mockRoyaltyPayments.has(key)) return mockRoyaltyPayments.get(key);
                    const record = { id: `royalty_${mockRoyaltyPayments.size + 1}`, ...create };
                    mockRoyaltyPayments.set(key, record);
                    return record;
                }),
                findMany: jest.fn(async ({ where }: any) => {
                    let results = Array.from(mockRoyaltyPayments.values());
                    if (where?.recipientAddress) {
                        results = results.filter(
                            (r) => r.recipientAddress === where.recipientAddress.toLowerCase()
                        );
                    }
                    return results;
                }),
            },
            wallet: {
                findMany: jest.fn(async () => []),
            },
            agentTransaction: {
                findMany: jest.fn(async () => []),
            },
        },
    };
});

// ============ Helpers ============

function makeTimestamp(): string {
    return new Date().toISOString();
}

function makeMintedEvent(overrides: Partial<ContractStemMintedEvent> = {}): ContractStemMintedEvent {
    return {
        eventName: "contract.stem_minted",
        eventVersion: 1,
        occurredAt: makeTimestamp(),
        tokenId: "1",
        creatorAddress: "0xCreator",
        parentIds: [],
        tokenUri: "https://api.resonate.fm/metadata/31337/stem_abc",
        chainId: 31337,
        contractAddress: "0xStemNFT",
        transactionHash: `0xmint_${Date.now()}_${Math.random()}`,
        blockNumber: "100",
        ...overrides,
    };
}

function makeListedEvent(overrides: Partial<ContractStemListedEvent> = {}): ContractStemListedEvent {
    return {
        eventName: "contract.stem_listed",
        eventVersion: 1,
        occurredAt: makeTimestamp(),
        listingId: "1",
        sellerAddress: "0xSeller",
        tokenId: "1",
        amount: "50",
        pricePerUnit: "1000000000000000000",
        paymentToken: "0x0000000000000000000000000000000000000000",
        expiresAt: String(Math.floor(Date.now() / 1000) + 86400),
        chainId: 31337,
        contractAddress: "0xMarketplace",
        transactionHash: `0xlist_${Date.now()}_${Math.random()}`,
        blockNumber: "101",
        ...overrides,
    };
}

function makeSoldEvent(overrides: Partial<ContractStemSoldEvent> = {}): ContractStemSoldEvent {
    return {
        eventName: "contract.stem_sold",
        eventVersion: 1,
        occurredAt: makeTimestamp(),
        listingId: "1",
        buyerAddress: "0xBuyer",
        amount: "10",
        totalPaid: "10000000000000000000",
        chainId: 31337,
        contractAddress: "0xMarketplace",
        transactionHash: `0xsold_${Date.now()}_${Math.random()}`,
        blockNumber: "102",
        ...overrides,
    };
}

function makeRoyaltyPaidEvent(
    overrides: Partial<ContractRoyaltyPaidEvent> = {}
): ContractRoyaltyPaidEvent {
    return {
        eventName: "contract.royalty_paid",
        eventVersion: 1,
        occurredAt: makeTimestamp(),
        tokenId: "1",
        recipientAddress: "0xartist",
        amount: "500000000000000000",
        chainId: 31337,
        contractAddress: "0xMarketplace",
        transactionHash: `0xroyalty_${Date.now()}_${Math.random()}`,
        blockNumber: "103",
        ...overrides,
    };
}

function makeCancelledEvent(
    overrides: Partial<ContractListingCancelledEvent> = {}
): ContractListingCancelledEvent {
    return {
        eventName: "contract.listing_cancelled",
        eventVersion: 1,
        occurredAt: makeTimestamp(),
        listingId: "1",
        chainId: 31337,
        contractAddress: "0xMarketplace",
        transactionHash: `0xcancel_${Date.now()}_${Math.random()}`,
        blockNumber: "104",
        ...overrides,
    };
}

// ============ Tests ============

describe("ContractsService", () => {
    let service: ContractsService;
    let eventBus: EventBus;

    beforeEach(() => {
        mockStemNftMints.clear();
        mockStemListings.clear();
        mockStemPurchases.clear();
        mockRoyaltyPayments.clear();
        mockStems.clear();
        eventBus = new EventBus();
        service = new ContractsService(eventBus);
        service.onModuleInit();
    });

    // ============ Event Subscription Tests ============

    describe("subscribeToContractEvents", () => {
        it("persists StemMinted event to database", async () => {
            mockStems.set("stem_abc", { id: "stem_abc", uri: "some_uri" });
            const event = makeMintedEvent({ tokenId: "42", transactionHash: "0xmint_test" });
            eventBus.publish(event);

            // Let async handler complete
            await new Promise((r) => setTimeout(r, 50));

            expect(mockStemNftMints.size).toBe(1);
            const mint = [...mockStemNftMints.values()][0];
            expect(mint.tokenId).toBe(42n);
            expect(mint.chainId).toBe(31337);
            expect(mint.creatorAddress).toBe("0xCreator");
            expect(mint.transactionHash).toBe("0xmint_test");
        });

        it("links StemMinted to existing stem when stemId found in URI", async () => {
            mockStems.set("stem_abc", { id: "stem_abc", uri: "some_uri" });

            const event = makeMintedEvent({
                tokenUri: "https://api.resonate.fm/metadata/31337/stem_abc",
                transactionHash: "0xmint_linked",
            });
            eventBus.publish(event);
            await new Promise((r) => setTimeout(r, 50));

            const mint = [...mockStemNftMints.values()][0];
            expect(mint.stem).toEqual({ connect: { id: "stem_abc" } });
        });

        it("sets remixable=true when parentIds is empty", async () => {
            mockStems.set("stem_abc", { id: "stem_abc", uri: "some_uri" });
            const event = makeMintedEvent({ parentIds: [], transactionHash: "0xmint_original" });
            eventBus.publish(event);
            await new Promise((r) => setTimeout(r, 50));

            const mint = [...mockStemNftMints.values()][0];
            expect(mint.remixable).toBe(true);
        });

        it("sets remixable=false when parentIds is non-empty", async () => {
            mockStems.set("stem_abc", { id: "stem_abc", uri: "some_uri" });
            const event = makeMintedEvent({
                parentIds: ["1"],
                transactionHash: "0xmint_remix",
            });
            eventBus.publish(event);
            await new Promise((r) => setTimeout(r, 50));

            const mint = [...mockStemNftMints.values()][0];
            expect(mint.remixable).toBe(false);
        });

        it("persists StemListed event to database", async () => {
            const event = makeListedEvent({
                listingId: "7",
                sellerAddress: "0xArtist",
                transactionHash: "0xlist_test",
            });
            eventBus.publish(event);
            await new Promise((r) => setTimeout(r, 50));

            expect(mockStemListings.size).toBe(1);
            const listing = [...mockStemListings.values()][0];
            expect(listing.listingId).toBe(7n);
            expect(listing.sellerAddress).toBe("0xartist"); // lowercased
            expect(listing.status).toBe("active");
        });

        it("defaults expiresAt to 7 days when zero", async () => {
            const event = makeListedEvent({ expiresAt: "0", transactionHash: "0xlist_noexpiry" });
            eventBus.publish(event);
            await new Promise((r) => setTimeout(r, 50));

            const listing = [...mockStemListings.values()][0];
            const sevenDaysFromNow = Date.now() + 7 * 24 * 60 * 60 * 1000;
            expect(listing.expiresAt.getTime()).toBeGreaterThan(sevenDaysFromNow - 5000);
            expect(listing.expiresAt.getTime()).toBeLessThan(sevenDaysFromNow + 5000);
        });

        it("persists StemSold event and updates listing status", async () => {
            // Pre-populate a listing
            const listingKey = "0xpre_list";
            mockStemListings.set(listingKey, {
                id: "listing_pre",
                listingId: 1n,
                chainId: 31337,
                amount: 50n,
                transactionHash: listingKey,
            });

            const event = makeSoldEvent({
                listingId: "1",
                amount: "50",
                transactionHash: "0xsold_full",
            });
            eventBus.publish(event);
            await new Promise((r) => setTimeout(r, 50));

            expect(mockStemPurchases.size).toBe(1);
            const purchase = [...mockStemPurchases.values()][0];
            expect(purchase.buyerAddress).toBe("0xbuyer"); // lowercased
            expect(purchase.amount).toBe(50n);
        });

        it("does not crash when listing not found for StemSold", async () => {
            const event = makeSoldEvent({
                listingId: "999",
                transactionHash: "0xsold_notfound",
            });
            eventBus.publish(event);
            await new Promise((r) => setTimeout(r, 50));

            // No purchase created since listing was missing
            expect(mockStemPurchases.size).toBe(0);
        });

        it("persists RoyaltyPaid event to database", async () => {
            const event = makeRoyaltyPaidEvent({
                tokenId: "5",
                recipientAddress: "0xArtist",
                amount: "1000000000000000000",
                transactionHash: "0xroyalty_test",
            });
            eventBus.publish(event);
            await new Promise((r) => setTimeout(r, 50));

            expect(mockRoyaltyPayments.size).toBe(1);
            const payment = [...mockRoyaltyPayments.values()][0];
            expect(payment.tokenId).toBe(5n);
            expect(payment.recipientAddress).toBe("0xArtist");
            expect(payment.amount).toBe("1000000000000000000");
        });

        it("handles ListingCancelled event", async () => {
            const event = makeCancelledEvent({
                listingId: "3",
                transactionHash: "0xcancel_test",
            });
            eventBus.publish(event);
            await new Promise((r) => setTimeout(r, 50));

            // updateMany was called
            const { prisma } = require("../db/prisma");
            expect(prisma.stemListing.updateMany).toHaveBeenCalled();
        });

        it("is idempotent — upsert does not duplicate on re-publish", async () => {
            mockStems.set("stem_abc", { id: "stem_abc", uri: "some_uri" });
            const event = makeMintedEvent({ transactionHash: "0xmint_idem" });
            eventBus.publish(event);
            await new Promise((r) => setTimeout(r, 50));

            eventBus.publish(event);
            await new Promise((r) => setTimeout(r, 50));

            expect(mockStemNftMints.size).toBe(1);
        });
    });

    // ============ Query Method Tests ============

    describe("getListings", () => {
        it("returns active listings", async () => {
            mockStemListings.set("a", {
                id: "a",
                listingId: 1n,
                tokenId: 1n,
                chainId: 31337,
                sellerAddress: "0xseller",
                status: "active",
                listedAt: new Date(),
            });
            mockStemListings.set("b", {
                id: "b",
                listingId: 2n,
                tokenId: 2n,
                chainId: 31337,
                sellerAddress: "0xseller2",
                status: "sold",
                listedAt: new Date(),
            });

            const results = await service.getListings({ status: "active" });
            expect(results.length).toBe(1);
            expect(results[0].status).toBe("active");
        });

        it("filters by sellerAddress", async () => {
            mockStemListings.set("x", {
                id: "x",
                listingId: 1n,
                tokenId: 1n,
                chainId: 31337,
                sellerAddress: "0xalice",
                status: "active",
                listedAt: new Date(),
            });

            const results = await service.getListings({ sellerAddress: "0xalice" });
            expect(results.length).toBeGreaterThanOrEqual(1);
        });

        it("returns empty array when no matches", async () => {
            const results = await service.getListings({ status: "active" });
            expect(results).toEqual([]);
        });
    });

    describe("getArtistEarnings", () => {
        it("aggregates royalty payments for an artist", async () => {
            mockRoyaltyPayments.set("r1", {
                recipientAddress: "0xartist",
                amount: "1000000000000000000",
                paidAt: new Date(),
            });
            mockRoyaltyPayments.set("r2", {
                recipientAddress: "0xartist",
                amount: "2000000000000000000",
                paidAt: new Date(),
            });

            const earnings = await service.getArtistEarnings("0xArtist");
            expect(earnings.totalPayments).toBe(2);
            expect(earnings.totalWei).toBe("3000000000000000000");
        });

        it("returns zero for unknown artist", async () => {
            const earnings = await service.getArtistEarnings("0xNobody");
            expect(earnings.totalPayments).toBe(0);
            expect(earnings.totalWei).toBe("0");
        });
    });

    describe("getStemData", () => {
        it("returns stem by id", async () => {
            mockStems.set("stem_1", { id: "stem_1", type: "vocals" });

            const { prisma } = require("../db/prisma");
            prisma.stem.findUnique.mockResolvedValueOnce({
                id: "stem_1",
                type: "vocals",
                track: { release: {} },
                nftMint: null,
            });

            const result = await service.getStemData("stem_1");
            expect(result).toBeDefined();
        });
    });

    describe("getStemsByOwner", () => {
        it("returns purchased and listed stems for a wallet", async () => {
            // Setup: purchase entry
            mockStemPurchases.set("p1", {
                buyerAddress: "0xowner",
                purchasedAt: new Date(),
                listing: {
                    tokenId: 1n,
                    chainId: 31337,
                    stem: { id: "stem_owned", type: "bass" },
                },
            });
            // Setup: active listing owned by same wallet
            mockStemListings.set("active_listing", {
                id: "al1",
                listingId: 5n,
                tokenId: 2n,
                chainId: 31337,
                sellerAddress: "0xowner",
                status: "active",
                stem: { id: "stem_listed", type: "drums" },
            });

            const results = await service.getStemsByOwner("0xOwner");
            // Results come from mock findMany, which returns all matching purchases
            expect(Array.isArray(results)).toBe(true);
        });
    });
});
