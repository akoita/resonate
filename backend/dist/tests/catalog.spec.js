"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const catalog_service_1 = require("../modules/catalog/catalog.service");
const event_bus_1 = require("../modules/shared/event_bus");
let trackCounter = 0;
jest.mock("../db/prisma", () => {
    const releases = new Map();
    const tracks = new Map();
    return {
        prisma: {
            release: {
                create: async ({ data }) => {
                    const id = `release_${releases.size + 1}`;
                    const record = { id, status: "draft", ...data, tracks: [] };
                    releases.set(id, record);
                    return record;
                },
                findUnique: async ({ where }) => releases.get(where.id) ?? null,
                update: async ({ where, data }) => {
                    const existing = releases.get(where.id);
                    if (!existing)
                        throw new Error("Release not found");
                    const updated = { ...existing, ...data };
                    releases.set(where.id, updated);
                    return updated;
                },
                findMany: async () => Array.from(releases.values()),
            },
            track: {
                upsert: async ({ where, create, update }) => {
                    const id = where.id || `track_${tracks.size + 1}`;
                    const existing = tracks.get(id);
                    const record = existing ? { ...existing, ...update } : { id, ...create };
                    tracks.set(id, record);
                    return record;
                },
                findUnique: async ({ where }) => tracks.get(where.id) ?? null,
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
