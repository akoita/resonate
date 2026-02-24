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

                    // Handle status filter (supports { in: [...] } and string)
                    if (args?.where?.status) {
                        const statusFilter = args.where.status;
                        if (statusFilter.in) {
                            results = results.filter(r => statusFilter.in.includes(r.status));
                        } else if (typeof statusFilter === 'string') {
                            results = results.filter(r => r.status === statusFilter);
                        }
                    }

                    // Handle primaryArtist filter (case-insensitive equals)
                    if (args?.where?.primaryArtist) {
                        const artistFilter = args.where.primaryArtist;
                        if (artistFilter.equals) {
                            const target = artistFilter.equals.toLowerCase();
                            results = results.filter(r =>
                                (r.primaryArtist || '').toLowerCase() === target
                            );
                        }
                    }

                    // Handle search (OR with title contains)
                    if (args?.where?.OR) {
                        const query = args.where.OR.find((cond: any) => cond.title?.contains)?.title?.contains?.toLowerCase();
                        if (query) {
                            results = results.filter(r => r.title.toLowerCase().includes(query));
                        }
                    }

                    // Handle limit
                    if (args?.take) {
                        results = results.slice(0, args.take);
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
        const mockEncryptionService = {} as any;
        const mockStorageProvider = {} as any;
        service = new CatalogService(eventBus, mockEncryptionService, mockStorageProvider);
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
        const r1 = await service.createRelease({ userId: "user-search-1", title: "Ambient Morning" });
        const r2 = await service.createRelease({ userId: "user-search-1", title: "Deep Night" });
        // Search filters by status='ready', so update from draft
        mockReleases.set(r1.id, { ...mockReleases.get(r1.id), status: "ready" });
        mockReleases.set(r2.id, { ...mockReleases.get(r2.id), status: "ready" });
        // Clear search cache to ensure fresh results
        (service as any).searchCache.clear();

        const results = await service.search("ambient");
        expect(results.items.length).toBe(1);
        expect((results.items[0] as any).title).toBe("Ambient Morning");
    });

    describe("listPublished", () => {
        beforeEach(async () => {
            // Seed releases with different statuses and artists
            // Manually insert so we control status
            mockReleases.set("r1", {
                id: "r1", title: "Ready Track", status: "ready",
                primaryArtist: "Human Artist", tracks: [],
            });
            mockReleases.set("r2", {
                id: "r2", title: "AI Funky Beat", status: "published",
                primaryArtist: "AI (Lyria)", tracks: [],
            });
            mockReleases.set("r3", {
                id: "r3", title: "AI Chill Vibes", status: "published",
                primaryArtist: "AI (Lyria)", tracks: [],
            });
            mockReleases.set("r4", {
                id: "r4", title: "Draft Song", status: "draft",
                primaryArtist: "Human Artist", tracks: [],
            });
        });

        it("returns both 'ready' and 'published' releases", async () => {
            const results = await service.listPublished();
            expect(results.length).toBe(3); // r1 (ready) + r2, r3 (published)
            const statuses = results.map((r: any) => r.status);
            expect(statuses).toContain("ready");
            expect(statuses).toContain("published");
            expect(statuses).not.toContain("draft");
        });

        it("filters by primaryArtist (case-insensitive)", async () => {
            const results = await service.listPublished(20, "AI (Lyria)");
            expect(results.length).toBe(2);
            expect(results.every((r: any) => r.primaryArtist === "AI (Lyria)")).toBe(true);
        });

        it("filters by primaryArtist case-insensitively", async () => {
            const results = await service.listPublished(20, "ai (lyria)");
            expect(results.length).toBe(2);
        });

        it("returns empty when artist has no published releases", async () => {
            const results = await service.listPublished(20, "Unknown Artist");
            expect(results.length).toBe(0);
        });

        it("excludes draft releases even with artist filter", async () => {
            const results = await service.listPublished(20, "Human Artist");
            expect(results.length).toBe(1);
            expect(results[0].status).toBe("ready");
        });
    });
});
