import { CatalogService } from "../modules/catalog/catalog.service";
import { EventBus } from "../modules/shared/event_bus";
import { StemsProcessedEvent } from "../events/event_types";

let trackCounter = 0;
jest.mock("../db/prisma", () => {
    const releases = new Map<string, any>();
    const tracks = new Map<string, any>();
    return {
        prisma: {
            release: {
                create: async ({ data }: any) => {
                    const id = `release_${releases.size + 1}`;
                    const record = { id, status: "draft", ...data, tracks: [] };
                    releases.set(id, record);
                    return record;
                },
                findUnique: async ({ where }: any) => releases.get(where.id) ?? null,
                update: async ({ where, data }: any) => {
                    const existing = releases.get(where.id);
                    if (!existing) throw new Error("Release not found");
                    const updated = { ...existing, ...data };
                    releases.set(where.id, updated);
                    return updated;
                },
                findMany: async () => Array.from(releases.values()),
            },
            track: {
                upsert: async ({ where, create, update }: any) => {
                    const id = where.id || `track_${tracks.size + 1}`;
                    const existing = tracks.get(id);
                    const record = existing ? { ...existing, ...update } : { id, ...create };
                    tracks.set(id, record);
                    return record;
                },
                findUnique: async ({ where }: any) => tracks.get(where.id) ?? null,
            },
            artist: {
                findUnique: async ({ where }: any) => ({
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
    let service: CatalogService;
    let eventBus: EventBus;

    beforeEach(() => {
        eventBus = new EventBus();
        service = new CatalogService(eventBus);
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
        expect((results.items[0] as any).title).toBe("Ambient Morning");
    });
});
