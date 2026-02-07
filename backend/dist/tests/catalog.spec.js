"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const catalog_service_1 = require("../modules/catalog/catalog.service");
const event_bus_1 = require("../modules/shared/event_bus");
const mockReleases = new Map();
const mockTracks = new Map();
jest.mock("../db/prisma", () => {
    return {
        prisma: {
            release: {
                create: async ({ data }) => {
                    const id = `release_${mockReleases.size + 1}`;
                    const record = { id, status: "draft", ...data, tracks: [] };
                    mockReleases.set(id, record);
                    return record;
                },
                findUnique: async ({ where }) => mockReleases.get(where.id) ?? null,
                update: async ({ where, data }) => {
                    const existing = mockReleases.get(where.id);
                    if (!existing)
                        throw new Error("Release not found");
                    const updated = { ...existing, ...data };
                    mockReleases.set(where.id, updated);
                    return updated;
                },
                findMany: async (args) => {
                    let results = Array.from(mockReleases.values());
                    if (args?.where?.OR) {
                        const query = args.where.OR.find((cond) => cond.title?.contains)?.title?.contains?.toLowerCase();
                        if (query) {
                            results = results.filter(r => r.title.toLowerCase().includes(query));
                        }
                    }
                    return results;
                },
            },
            track: {
                upsert: async ({ where, create, update }) => {
                    const id = where.id || `track_${mockTracks.size + 1}`;
                    const existing = mockTracks.get(id);
                    const record = existing ? { ...existing, ...update } : { id, ...create };
                    mockTracks.set(id, record);
                    return record;
                },
                findUnique: async ({ where }) => mockTracks.get(where.id) ?? null,
            },
            artist: {
                findUnique: async ({ where }) => ({
                    id: `artist_of_${where.userId}`,
                    userId: where.userId,
                    displayName: "Mock Artist"
                }),
            },
            stem: {
                upsert: async () => ({ id: "stem-1" }),
            }
        },
    };
});
describe("catalog", () => {
    let service;
    let eventBus;
    beforeEach(() => {
        mockReleases.clear();
        mockTracks.clear();
        eventBus = new event_bus_1.EventBus();
        service = new catalog_service_1.CatalogService(eventBus);
        service.onModuleInit();
    });
    it("creates a release in draft status", async () => {
        const release = await service.createRelease({
            userId: "user-1",
            title: "New Release",
        });
        expect(release.title).toBe("New Release");
        expect(release.status).toBe("draft");
    });
    it("searches releases by title", async () => {
        await service.createRelease({ userId: "user-search-1", title: "Ambient Morning" });
        await service.createRelease({ userId: "user-search-1", title: "Deep Night" });
        const results = await service.search("ambient");
        expect(results.items.length).toBe(1);
        expect(results.items[0].title).toBe("Ambient Morning");
    });
});
