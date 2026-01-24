"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const catalog_service_1 = require("../modules/catalog/catalog.service");
const event_bus_1 = require("../modules/shared/event_bus");
let trackCounter = 0;
jest.mock("../db/prisma", () => {
    const tracks = new Map();
    return {
        prisma: {
            track: {
                create: async ({ data }) => {
                    trackCounter++;
                    const record = { id: `track_${trackCounter}`, createdAt: new Date(), stems: [], ...data };
                    tracks.set(record.id, record);
                    return record;
                },
                findUnique: async ({ where }) => {
                    return tracks.get(where.id) ?? null;
                },
                findMany: async ({ where, take }) => {
                    let results = [...tracks.values()];
                    if (where?.artistId) {
                        results = results.filter((t) => t.artistId === where.artistId);
                    }
                    if (where?.status) {
                        results = results.filter((t) => t.status === where.status);
                    }
                    if (where?.title?.contains) {
                        const query = where.title.contains.toLowerCase();
                        results = results.filter((t) => t.title.toLowerCase().includes(query));
                    }
                    return results.slice(0, take ?? 50);
                },
                update: async ({ where, data }) => {
                    const existing = tracks.get(where.id);
                    if (!existing)
                        throw new Error("Track not found");
                    const updated = { ...existing, ...data };
                    tracks.set(where.id, updated);
                    return updated;
                },
            },
            stem: {
                createMany: async () => ({ count: 1 }),
            }
        },
    };
});
describe("catalog", () => {
    let service;
    let eventBus;
    beforeEach(() => {
        eventBus = new event_bus_1.EventBus();
        service = new catalog_service_1.CatalogService(eventBus);
        service.onModuleInit();
    });
    it("creates a track in draft status", async () => {
        const track = await service.createTrack({
            artistId: "artist-1",
            title: "New Track",
        });
        expect(track.title).toBe("New Track");
        expect(track.status).toBe("draft");
    });
    it("lists tracks by artist", async () => {
        await service.createTrack({ artistId: "artist-list-1", title: "Track A" });
        await service.createTrack({ artistId: "artist-list-1", title: "Track B" });
        await service.createTrack({ artistId: "artist-list-2", title: "Track C" });
        const tracks = await service.listByArtist("artist-list-1");
        expect(tracks.length).toBe(2);
        expect(tracks.every((t) => t.artistId === "artist-list-1")).toBe(true);
    });
    it("updates track status on stems processed event", async () => {
        const track = await service.createTrack({ artistId: "artist-event-1", title: "Processing" });
        // Simulate event bus message
        const event = {
            eventName: "stems.processed",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            trackId: track.id,
            stemIds: ["stem-1"],
            modelVersion: "v1",
            durationMs: 120000,
            stems: [{ id: "stem-1", type: "mixed", uri: "ipfs://..." }],
        };
        await eventBus.publish(event);
        // Wait for async processing in onModuleInit
        await new Promise((resolve) => setTimeout(resolve, 100));
        const updated = await service.getTrack(track.id);
        expect(updated?.status).toBe("ready");
    });
    it("searches tracks by title", async () => {
        await service.createTrack({ artistId: "artist-search-1", title: "Ambient Morning" });
        await service.createTrack({ artistId: "artist-search-1", title: "Deep Night" });
        const results = await service.search("ambient");
        expect(results.items.length).toBe(1);
        expect(results.items[0].title).toBe("Ambient Morning");
    });
});
