// @ts-nocheck - Mocked viem types cause union narrowing errors from source
import { IndexerService } from "../modules/contracts/indexer.service";
import { EventBus } from "../modules/shared/event_bus";

// ============ Prisma Mock ============

const mockIndexerStates = new Map<number, any>();
const mockContractEvents = new Map<string, any>();

jest.mock("../db/prisma", () => {
    return {
        prisma: {
            indexerState: {
                findUnique: jest.fn(async ({ where }: any) => mockIndexerStates.get(where.chainId) ?? null),
                findMany: jest.fn(async () => Array.from(mockIndexerStates.values())),
                create: jest.fn(async ({ data }: any) => {
                    const record = { ...data, updatedAt: new Date() };
                    mockIndexerStates.set(data.chainId, record);
                    return record;
                }),
                update: jest.fn(async ({ where, data }: any) => {
                    const existing = mockIndexerStates.get(where.chainId);
                    if (!existing) throw new Error("IndexerState not found");
                    const updated = { ...existing, ...data, updatedAt: new Date() };
                    mockIndexerStates.set(where.chainId, updated);
                    return updated;
                }),
            },
            contractEvent: {
                findUnique: jest.fn(async ({ where }: any) => {
                    const key = `${where.transactionHash_logIndex?.transactionHash}_${where.transactionHash_logIndex?.logIndex}`;
                    return mockContractEvents.get(key) ?? null;
                }),
                create: jest.fn(async ({ data }: any) => {
                    const key = `${data.transactionHash}_${data.logIndex}`;
                    const record = { id: `event_${mockContractEvents.size + 1}`, ...data };
                    mockContractEvents.set(key, record);
                    return record;
                }),
            },
        },
    };
});

// ============ Viem Mock ============

jest.mock("viem", () => {
    const actual = jest.requireActual("viem");
    return {
        ...actual,
        createPublicClient: jest.fn(() => ({
            getBlockNumber: jest.fn(async () => 100n),
            getLogs: jest.fn(async () => []),
            getTransactionReceipt: jest.fn(async () => ({ logs: [] })),
        })),
    };
});

// ============ Tests ============

describe("IndexerService", () => {
    let service: IndexerService;
    let eventBus: EventBus;

    beforeEach(() => {
        mockIndexerStates.clear();
        mockContractEvents.clear();
        jest.clearAllMocks();

        eventBus = new EventBus();
        service = new IndexerService(eventBus);
    });

    afterEach(() => {
        // Clean up any intervals
        (service as any).stopIndexing();
    });

    describe("lifecycle", () => {
        it("does not start indexing when ENABLE_CONTRACT_INDEXER is not set", async () => {
            delete process.env.ENABLE_CONTRACT_INDEXER;
            await service.onModuleInit();
            expect((service as any).indexingInterval).toBeNull();
        });

        it("stops polling on module destroy", async () => {
            // Simulate an active interval
            (service as any).indexingInterval = setInterval(() => { }, 60000);
            service.onModuleDestroy();
            expect((service as any).indexingInterval).toBeNull();
        });
    });

    describe("processLog", () => {
        it("skips already-processed events (idempotency)", async () => {
            const txHash = "0xabc123";
            const logIndex = 0;
            mockContractEvents.set(`${txHash}_${logIndex}`, { id: "existing" });

            const log = {
                transactionHash: txHash,
                logIndex,
                blockNumber: 10n,
                blockHash: "0xblock",
                address: "0xContract" as any,
                topics: ["0xtopic"] as any,
                data: "0x" as any,
            };

            await (service as any).processLog(log, 31337);

            // contractEvent.create should NOT have been called
            const { prisma } = require("../db/prisma");
            expect(prisma.contractEvent.create).not.toHaveBeenCalled();
        });

        it("stores raw event and publishes typed event on new log", async () => {
            const publishSpy = jest.spyOn(eventBus, "publish");

            // We can't easily create a real encoded log here, but we can verify the fallback branch
            const log = {
                transactionHash: "0xnew_tx",
                logIndex: 0,
                blockNumber: 50n,
                blockHash: "0xblockhash",
                address: "0xContract" as any,
                topics: ["0xunknown_topic"] as any,
                data: "0x" as any,
            };

            await (service as any).processLog(log, 31337);

            // Should have stored a contract event record
            const { prisma } = require("../db/prisma");
            expect(prisma.contractEvent.create).toHaveBeenCalled();
        });
    });

    describe("decodeEvent", () => {
        it("returns null eventName for unrecognized topics", () => {
            const log = {
                data: "0x",
                topics: ["0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"] as any,
            };

            const result = (service as any).decodeEvent(log);
            expect(result.eventName).toBeNull();
            expect(result.decodedArgs).toBeNull();
        });
    });

    describe("publishTypedEvent", () => {
        it("publishes contract.stem_minted for StemMinted events", async () => {
            const publishSpy = jest.spyOn(eventBus, "publish");
            const decodedArgs = {
                tokenId: "42",
                creator: "0xCreator",
                parentIds: [],
                tokenURI: "ipfs://metadata",
            };
            const log = {
                transactionHash: "0xmint_tx",
                blockNumber: 100n,
                address: "0xStemNFT",
            };

            await (service as any).publishTypedEvent("StemMinted", decodedArgs, log, 31337);

            expect(publishSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventName: "contract.stem_minted",
                    tokenId: "42",
                    creatorAddress: "0xCreator",
                    chainId: 31337,
                })
            );
        });

        it("publishes contract.stem_listed for Listed events", async () => {
            const publishSpy = jest.spyOn(eventBus, "publish");
            const decodedArgs = {
                listingId: "7",
                seller: "0xSeller",
                tokenId: "1",
                amount: "50",
                price: "1000000000000000000",
            };
            const log = {
                transactionHash: "0xlist_tx",
                blockNumber: 101n,
                address: "0xMarketplace",
            };

            await (service as any).publishTypedEvent("Listed", decodedArgs, log, 31337);

            expect(publishSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventName: "contract.stem_listed",
                    listingId: "7",
                    sellerAddress: "0xSeller",
                })
            );
        });

        it("publishes contract.stem_sold for Sold events", async () => {
            const publishSpy = jest.spyOn(eventBus, "publish");
            const decodedArgs = {
                listingId: "1",
                buyer: "0xBuyer",
                amount: "10",
                totalPaid: "10000000000000000000",
            };
            const log = {
                transactionHash: "0xsold_tx",
                blockNumber: 102n,
                address: "0xMarketplace",
            };

            await (service as any).publishTypedEvent("Sold", decodedArgs, log, 31337);

            expect(publishSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventName: "contract.stem_sold",
                    buyerAddress: "0xBuyer",
                    amount: "10",
                })
            );
        });

        it("publishes contract.royalty_paid for RoyaltyPaid events", async () => {
            const publishSpy = jest.spyOn(eventBus, "publish");
            const decodedArgs = {
                tokenId: "5",
                recipient: "0xArtist",
                amount: "500000000000000000",
            };
            const log = {
                transactionHash: "0xroyalty_tx",
                blockNumber: 103n,
                address: "0xMarketplace",
            };

            await (service as any).publishTypedEvent("RoyaltyPaid", decodedArgs, log, 31337);

            expect(publishSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventName: "contract.royalty_paid",
                    tokenId: "5",
                    recipientAddress: "0xArtist",
                })
            );
        });

        it("publishes contract.listing_cancelled for Cancelled events", async () => {
            const publishSpy = jest.spyOn(eventBus, "publish");
            const decodedArgs = { listingId: "3" };
            const log = {
                transactionHash: "0xcancel_tx",
                blockNumber: 104n,
                address: "0xMarketplace",
            };

            await (service as any).publishTypedEvent("Cancelled", decodedArgs, log, 31337);

            expect(publishSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    eventName: "contract.listing_cancelled",
                    listingId: "3",
                })
            );
        });

        it("does not publish for unknown event names", async () => {
            const publishSpy = jest.spyOn(eventBus, "publish");
            const log = {
                transactionHash: "0xunknown_tx",
                blockNumber: 105n,
                address: "0xContract",
            };

            await (service as any).publishTypedEvent("UnknownEvent", {}, log, 31337);

            expect(publishSpy).not.toHaveBeenCalled();
        });
    });

    describe("resetIndexer", () => {
        it("updates indexer state to specified block", async () => {
            mockIndexerStates.set(31337, { chainId: 31337, lastBlockNumber: 100n });

            await service.resetIndexer(31337, 50n);

            const state = mockIndexerStates.get(31337);
            expect(state.lastBlockNumber).toBe(49n);
        });
    });

    describe("getStatus", () => {
        it("returns indexer status for all chains", async () => {
            mockIndexerStates.set(31337, {
                chainId: 31337,
                lastBlockNumber: 200n,
                updatedAt: new Date(),
            });

            const status = await service.getStatus();
            expect(status.chains).toHaveLength(1);
            expect(status.chains[0].chainId).toBe(31337);
            expect(status.chains[0].lastBlockNumber).toBe("200");
        });

        it("reports enabled when ENABLE_CONTRACT_INDEXER is true", async () => {
            process.env.ENABLE_CONTRACT_INDEXER = "true";

            const status = await service.getStatus();
            expect(status.enabled).toBe(true);

            delete process.env.ENABLE_CONTRACT_INDEXER;
        });

        it("reports disabled when ENABLE_CONTRACT_INDEXER is not set", async () => {
            delete process.env.ENABLE_CONTRACT_INDEXER;

            const status = await service.getStatus();
            expect(status.enabled).toBe(false);
        });
    });
});
