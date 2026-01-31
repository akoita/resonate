import { CatalogService } from "../modules/catalog/catalog.service";
import { EventBus } from "../modules/shared/event_bus";

const mockReleases = new Map<string, any>();
const mockTracks = new Map<string, any>();

jest.mock("../db/prisma", () => {
    return {
        prisma: {
            release: {
                create: async ({ data }: any) => {
                    const id = `release_${mockReleases.size + 1}`;
                    const record = { id, status: "draft", ...data, tracks: [] };
                    mockReleases.set(id, record);
                    return record;
                },
                findUnique: async ({ where }: any) => mockReleases.get(where.id) ?? null,
                update: async ({ where, data }: any) => {
                    const existing = mockReleases.get(where.id);
                    if (!existing) throw new Error("Release not found");
                    const updated = { ...existing, ...data };
                    mockReleases.set(where.id, updated);
                    return updated;
                },
                findMany: async (args: any) => {
                    let results = Array.from(mockReleases.values());
                    if (args?.where?.OR) {
                        const query = args.where.OR.find((cond: any) => cond.title?.contains)?.title?.contains?.toLowerCase();
                        if (query) {
                            results = results.filter(r => r.title.toLowerCase().includes(query));
                        }
                    }
                    return results;
                },
            },
            track: {
                upsert: async ({ where, create, update }: any) => {
                    const id = where.id || `track_${mockTracks.size + 1}`;
                    const existing = mockTracks.get(id);
                    const record = existing ? { ...existing, ...update } : { id, ...create };
                    mockTracks.set(id, record);
                    return record;
                },
                findUnique: async ({ where }: any) => mockTracks.get(where.id) ?? null,
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
        mockReleases.clear();
        mockTracks.clear();
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
