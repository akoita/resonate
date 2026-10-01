import { prisma } from "../db/prisma";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { TrackEmbeddingService } from "../modules/embeddings/track_embedding.service";
import {
  trackEmbeddingContentHash,
  trackEmbeddingText,
} from "../modules/embeddings/track_embedding_text";
import { EventBus } from "../modules/shared/event_bus";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";

const TEST_PREFIX = `trkemb_${Date.now()}_`;
const HASH_MODEL = "hash-v1";

const ids = {
  userFox: `${TEST_PREFIX}user-fox`,
  userCrane: `${TEST_PREFIX}user-crane`,
  userSteel: `${TEST_PREFIX}user-steel`,
  artistFox: `${TEST_PREFIX}artist-fox`,
  artistCrane: `${TEST_PREFIX}artist-crane`,
  artistSteel: `${TEST_PREFIX}artist-steel`,
  relSeed: `${TEST_PREFIX}rel-seed`,
  relCold: `${TEST_PREFIX}rel-cold`,
  relCrane: `${TEST_PREFIX}rel-crane`,
  relJazz: `${TEST_PREFIX}rel-jazz`,
  relMetal: `${TEST_PREFIX}rel-metal`,
  relDraft: `${TEST_PREFIX}rel-draft`,
  seed: `${TEST_PREFIX}track-seed`,
  cold: `${TEST_PREFIX}track-cold`,
  crane: `${TEST_PREFIX}track-crane`,
  jazz: `${TEST_PREFIX}track-jazz`,
  metal: `${TEST_PREFIX}track-metal`,
  draft: `${TEST_PREFIX}track-draft`,
  explicit: `${TEST_PREFIX}track-explicit`,
  aiOnly: `${TEST_PREFIX}track-ai`,
};
const listable = [
  ids.seed,
  ids.cold,
  ids.crane,
  ids.jazz,
  ids.metal,
  ids.explicit,
  ids.aiOnly,
];

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

describe("TrackEmbeddingService (integration)", () => {
  const embeddingService = new EmbeddingService();
  const store = new EmbeddingStore();
  const service = new TrackEmbeddingService(embeddingService, store);
  const originalProvider = process.env.TRACK_EMBEDDING_PROVIDER;

  const embeddedIds = async () =>
    (
      await prisma.trackEmbedding.findMany({
        where: { trackId: { startsWith: TEST_PREFIX } },
        select: { trackId: true },
      })
    ).map((row) => row.trackId);

  const clearOurEmbeddings = () =>
    prisma.trackEmbedding.deleteMany({
      where: { trackId: { startsWith: TEST_PREFIX } },
    });

  beforeAll(async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "hash";

    for (const [user, artist, name, address] of [
      [ids.userFox, ids.artistFox, "Quiet Fox", "a"],
      [ids.userCrane, ids.artistCrane, "Amber Crane", "b"],
      [ids.userSteel, ids.artistSteel, "Steel Hammer", "c"],
    ] as const) {
      await prisma.user.create({
        data: { id: user, email: `${user}@test.resonate` },
      });
      await prisma.artist.create({
        data: {
          id: artist,
          userId: user,
          displayName: name,
          payoutAddress: `0x${address.repeat(40)}`,
        },
      });
    }

    const releases = [
      [ids.relSeed, ids.artistFox, "Rainy Day Tapes", "lofi-emb", ["chill"], "published"],
      [ids.relCold, ids.artistFox, "Quiet Hours", "lofi-emb", ["chill", "mellow"], "ready"],
      [ids.relCrane, ids.artistCrane, "Loops", "lofi-emb", ["chill"], "published"],
      [ids.relJazz, ids.artistFox, "Smoke Room", "jazz-emb", ["smooth"], "published"],
      [ids.relMetal, ids.artistSteel, "Iron Storm", "metal-emb", ["aggressive"], "published"],
      [ids.relDraft, ids.artistFox, "Unfinished Lofi", "lofi-emb", ["chill"], "processing"],
    ] as const;
    // Newest last so `createdAt` ordering is deterministic across the fixtures.
    let offset = 0;
    for (const [id, artistId, title, genre, moods, status] of releases) {
      await prisma.release.create({
        data: {
          id,
          artistId,
          title,
          genre,
          moods: [...moods],
          status,
          createdAt: new Date(Date.UTC(2026, 0, 1 + offset++)),
        },
      });
    }

    const tracks = [
      [ids.seed, ids.relSeed, "Rainy Lofi Study Beats", {}],
      // The cold-start track: nobody has played it.
      [ids.cold, ids.relCold, "Late Night Study Session", {}],
      [ids.crane, ids.relCrane, "Sunday Study Loop", {}],
      [ids.jazz, ids.relJazz, "Blue Corner", {}],
      [ids.metal, ids.relMetal, "Brutal Riff Thunder", {}],
      [ids.draft, ids.relDraft, "Lofi Study Draft", {}],
      [ids.explicit, ids.relCrane, "Explicit Lofi Study Jam", { explicit: true }],
      [ids.aiOnly, ids.relCrane, "Generated Lofi Study Mix", { aiDisclosureLevel: "ALL" }],
    ] as const;
    let position = 1;
    for (const [id, releaseId, title, extra] of tracks) {
      await prisma.track.create({
        data: {
          id,
          releaseId,
          title,
          position: position++,
          createdAt: new Date(Date.UTC(2026, 1, position)),
          ...extra,
        },
      });
    }
  });

  afterAll(async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = originalProvider;
    if (originalProvider === undefined) delete process.env.TRACK_EMBEDDING_PROVIDER;

    await clearOurEmbeddings().catch(() => {});
    // Backfill may also have embedded other suites' tracks under hash-v1.
    await prisma.trackEmbedding.deleteMany({ where: { model: HASH_MODEL } }).catch(() => {});
    await prisma.track
      .deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
      .catch(() => {});
    await prisma.release
      .deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
      .catch(() => {});
    await prisma.artist
      .deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
      .catch(() => {});
    await prisma.user
      .deleteMany({ where: { id: { startsWith: TEST_PREFIX } } })
      .catch(() => {});
  });

  beforeEach(async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "hash";
    await prisma.trackEmbedding.deleteMany({ where: { model: HASH_MODEL } });
    await clearOurEmbeddings();
    jest.restoreAllMocks();
  });

  describe("embedTracks", () => {
    it("embeds only publicly listable tracks and records model and content hash", async () => {
      const result = await service.embedTracks([...listable, ids.draft]);

      expect(result).toMatchObject({
        model: HASH_MODEL,
        embedded: listable.length,
        failed: 0,
      });
      // The draft release's track is skipped, not embedded.
      expect(result.skipped).toBe(1);
      expect((await embeddedIds()).sort()).toEqual([...listable].sort());

      const track = await prisma.track.findUniqueOrThrow({
        where: { id: ids.seed },
        select: {
          title: true,
          artist: true,
          release: {
            select: {
              title: true,
              genre: true,
              moods: true,
              primaryArtist: true,
              featuredArtists: true,
              artist: { select: { displayName: true } },
              artistCredits: { select: { role: true, displayName: true } },
            },
          },
        },
      });
      const stored = await prisma.trackEmbedding.findUniqueOrThrow({
        where: { trackId: ids.seed },
        select: { model: true, contentHash: true },
      });
      expect(stored.model).toBe(HASH_MODEL);
      expect(stored.contentHash).toBe(
        trackEmbeddingContentHash(trackEmbeddingText(track), HASH_MODEL),
      );
    });

    it("is idempotent: unchanged tracks are not re-embedded", async () => {
      await service.embedTracks(listable);
      const spy = jest.spyOn(embeddingService, "embedDocuments");

      const second = await service.embedTracks(listable);

      expect(second.embedded).toBe(0);
      expect(second.skipped).toBe(listable.length);
      expect(spy).not.toHaveBeenCalled();
    });

    it("re-embeds only the track whose metadata changed", async () => {
      await service.embedTracks(listable);
      const before = await prisma.trackEmbedding.findUniqueOrThrow({
        where: { trackId: ids.jazz },
        select: { contentHash: true },
      });

      await prisma.track.update({
        where: { id: ids.jazz },
        data: { title: "Blue Corner (Extended)" },
      });
      const result = await service.embedTracks(listable);

      expect(result.embedded).toBe(1);
      const after = await prisma.trackEmbedding.findUniqueOrThrow({
        where: { trackId: ids.jazz },
        select: { contentHash: true },
      });
      expect(after.contentHash).not.toBe(before.contentHash);
      await prisma.track.update({
        where: { id: ids.jazz },
        data: { title: "Blue Corner" },
      });
    });

    it("re-embeds vectors that belong to another model", async () => {
      await store.upsert(
        ids.seed,
        new Array(768).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
        "some-other-model",
        "whatever",
      );
      const result = await service.embedTracks([ids.seed]);
      expect(result.embedded).toBe(1);
      expect(await store.get(ids.seed, HASH_MODEL)).not.toBeNull();
    });

    it("is a no-op when the provider is disabled", async () => {
      process.env.TRACK_EMBEDDING_PROVIDER = "disabled";
      await expect(service.embedTracks(listable)).resolves.toEqual({
        model: null,
        embedded: 0,
        skipped: 0,
        failed: 0,
      });
      expect(await embeddedIds()).toEqual([]);
    });

    it("counts failures instead of throwing when the provider is unavailable", async () => {
      jest.spyOn(embeddingService, "embedDocuments").mockResolvedValue(null);
      const result = await service.embedTracks([ids.seed, ids.cold]);
      expect(result).toMatchObject({ embedded: 0, failed: 2 });
      expect(await embeddedIds()).toEqual([]);
    });
  });

  describe("backfill", () => {
    async function drain() {
      let last = await service.backfill({ limit: 200 });
      for (let i = 0; i < 25 && last.remaining > 0; i += 1) {
        last = await service.backfill({ limit: 200 });
      }
      return last;
    }

    it("embeds every listable track, then a second run embeds nothing", async () => {
      const first = await drain();
      expect(first.status).toBe("ok");
      expect(first.model).toBe(HASH_MODEL);
      expect(first.remaining).toBe(0);
      expect(await embeddedIds()).toEqual(expect.arrayContaining(listable));
      expect(await embeddedIds()).not.toContain(ids.draft);

      const second = await service.backfill({ limit: 200 });
      expect(second.embedded).toBe(0);
      expect(second.failed).toBe(0);
      expect(second.remaining).toBe(0);
    });

    it("clamps the limit and reports remaining work", async () => {
      const result = await service.backfill({ limit: 1 });
      expect(result.scanned).toBe(1);
      expect(result.embedded).toBe(1);
      expect(result.remaining).toBeGreaterThanOrEqual(listable.length - 1);

      // A nonsense limit falls back to the bounded default rather than erroring.
      const nonsense = await service.backfill({ limit: Number.NaN });
      expect(nonsense.scanned).toBeLessThanOrEqual(200);
      const huge = await service.backfill({ limit: 1_000_000 });
      expect(huge.scanned).toBeLessThanOrEqual(200);
    });

    it("re-embeds a stale vector (hash mismatch) picked up by the rotating verify pass", async () => {
      await drain();
      await prisma.$executeRaw`
        UPDATE "TrackEmbedding"
        SET "contentHash" = 'stale', "updatedAt" = '2000-01-01T00:00:00Z'
        WHERE "trackId" = ${ids.metal}
      `;

      // Nothing is missing, so the single slot goes to the stalest vector.
      const result = await service.backfill({ limit: 1 });

      expect(result.embedded).toBe(1);
      const row = await prisma.trackEmbedding.findUniqueOrThrow({
        where: { trackId: ids.metal },
        select: { contentHash: true },
      });
      expect(row.contentHash).not.toBe("stale");
    });

    it("reports provider_disabled without embedding when the provider is off", async () => {
      process.env.TRACK_EMBEDDING_PROVIDER = "disabled";
      const result = await service.backfill({ limit: 10 });
      expect(result).toMatchObject({
        status: "provider_disabled",
        model: null,
        scanned: 0,
        embedded: 0,
      });
      expect(result.remaining).toBeGreaterThan(0);
    });
  });

  describe("embed on ingest", () => {
    it("embeds a release's tracks on catalog.release_ready without blocking the publisher", async () => {
      const bus = new EventBus();
      const ingest = new TrackEmbeddingService(embeddingService, store, bus);
      ingest.onModuleInit();
      try {
        expect(await embeddedIds()).toEqual([]);

        bus.publish({
          eventName: "catalog.release_ready",
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          releaseId: ids.relCrane,
          artistId: ids.artistCrane,
        });

        const done = await waitFor(async () => {
          const embedded = await embeddedIds();
          return [ids.crane, ids.explicit, ids.aiOnly].every((id) => embedded.includes(id));
        });
        expect(done).toBe(true);
        // Only that release's tracks.
        expect(await embeddedIds()).not.toContain(ids.seed);
      } finally {
        ingest.onModuleDestroy();
        bus.destroy();
      }
    });

    it("re-embeds a track on catalog.updated", async () => {
      const bus = new EventBus();
      const ingest = new TrackEmbeddingService(embeddingService, store, bus);
      ingest.onModuleInit();
      try {
        bus.publish({
          eventName: "catalog.updated",
          eventVersion: 1,
          occurredAt: new Date().toISOString(),
          trackId: ids.jazz,
          status: "ready",
          version: 2,
        });
        expect(await waitFor(async () => (await embeddedIds()).includes(ids.jazz))).toBe(true);
      } finally {
        ingest.onModuleDestroy();
        bus.destroy();
      }
    });

    it("swallows provider failures so the publisher is never affected", async () => {
      const bus = new EventBus();
      const ingest = new TrackEmbeddingService(embeddingService, store, bus);
      ingest.onModuleInit();
      const spy = jest.spyOn(embeddingService, "embedDocuments").mockResolvedValue(null);
      try {
        expect(() =>
          bus.publish({
            eventName: "catalog.release_ready",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            releaseId: ids.relSeed,
            artistId: ids.artistFox,
          }),
        ).not.toThrow();
        expect(await waitFor(async () => spy.mock.calls.length > 0)).toBe(true);
        expect(await embeddedIds()).toEqual([]);
      } finally {
        ingest.onModuleDestroy();
        bus.destroy();
      }
    });

    it("stops listening after onModuleDestroy", async () => {
      const bus = new EventBus();
      const ingest = new TrackEmbeddingService(embeddingService, store, bus);
      ingest.onModuleInit();
      ingest.onModuleDestroy();
      const spy = jest.spyOn(embeddingService, "embedDocuments");
      bus.publish({
        eventName: "catalog.release_ready",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        releaseId: ids.relSeed,
        artistId: ids.artistFox,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(spy).not.toHaveBeenCalled();
      bus.destroy();
    });
  });

  describe("similarTracks", () => {
    it("cold start: a zero-play track semantically close to the seed is returned", async () => {
      await service.embedTracks(listable);
      // The cold track has no recorded interaction of any kind.
      expect(await prisma.agentSignal.count({ where: { trackId: ids.cold } })).toBe(0);

      const embedSpy = jest.spyOn(embeddingService, "embedDocuments");
      const querySpy = jest.spyOn(embeddingService, "embedQuery");
      const result = await service.similarTracks(ids.seed, { limit: 10 });

      expect(result.source).toBe("embedding");
      expect(result.model).toBe(HASH_MODEL);
      const order = result.results.map((row) => row.trackId);
      expect(order[0]).toBe(ids.cold);
      expect(order).not.toContain(ids.seed);
      // Closer lofi track before the jazz and metal ones.
      expect(order.indexOf(ids.crane)).toBeLessThan(order.indexOf(ids.jazz));
      expect(order.indexOf(ids.jazz)).toBeLessThan(order.indexOf(ids.metal));
      for (let i = 1; i < result.results.length; i += 1) {
        expect(result.results[i - 1].score).toBeGreaterThanOrEqual(result.results[i].score);
      }
      // Similar-tracks reads stored vectors only: no model call.
      expect(embedSpy).not.toHaveBeenCalled();
      expect(querySpy).not.toHaveBeenCalled();
    });

    it("keeps explicit and fully AI-generated tracks out unless allowed", async () => {
      await service.embedTracks(listable);
      const result = await service.similarTracks(ids.seed, { limit: 20 });
      const order = result.results.map((row) => row.trackId);
      expect(order).not.toContain(ids.explicit);
      expect(order).not.toContain(ids.aiOnly);

      const withExplicit = await service.similarTracks(ids.seed, {
        limit: 20,
        allowExplicit: true,
      });
      expect(withExplicit.results.map((row) => row.trackId)).toContain(ids.explicit);
      // ADR-BM-5: AI-generated stays out of promotional seams regardless.
      expect(withExplicit.results.map((row) => row.trackId)).not.toContain(ids.aiOnly);
    });

    it("respects the requested limit", async () => {
      await service.embedTracks(listable);
      const result = await service.similarTracks(ids.seed, { limit: 2 });
      expect(result.results).toHaveLength(2);
      expect(result.results[0].trackId).toBe(ids.cold);
    });

    it("works with the provider down: stored vectors are enough", async () => {
      await service.embedTracks(listable);
      jest.spyOn(embeddingService, "embedQuery").mockResolvedValue(null);
      jest.spyOn(embeddingService, "embedDocuments").mockResolvedValue(null);
      const result = await service.similarTracks(ids.seed, { limit: 5 });
      expect(result.source).toBe("embedding");
      expect(result.results[0].trackId).toBe(ids.cold);
    });

    it("falls back to same genre, then same artist, newest first when the seed has no vector", async () => {
      // Only other tracks are embedded; the seed itself has no vector.
      await service.embedTracks(listable.filter((id) => id !== ids.seed));

      const result = await service.similarTracks(ids.seed, { limit: 10 });

      expect(result.source).toBe("metadata_fallback");
      const order = result.results.map((row) => row.trackId);
      expect(order).not.toContain(ids.seed);
      expect(order).not.toContain(ids.draft);
      expect(order).not.toContain(ids.metal);
      // Same-genre tracks come first, newest first (crane is newer than cold
      // although cold shares the artist); the artist-only jazz track follows.
      expect(order).toEqual([ids.crane, ids.cold, ids.jazz]);
      expect(result.results.map((row) => row.score)).toEqual([0.5, 0.75, 0.25]);
    });

    it("falls back when the provider is disabled, even if the seed has a vector", async () => {
      await service.embedTracks(listable);
      process.env.TRACK_EMBEDDING_PROVIDER = "disabled";
      const result = await service.similarTracks(ids.seed, { limit: 10 });
      expect(result.source).toBe("metadata_fallback");
      expect(result.model).toBeNull();
      expect(result.results.map((row) => row.trackId)).toEqual([
        ids.crane,
        ids.cold,
        ids.jazz,
      ]);
    });

    it("falls back when the seed's vector belongs to another model", async () => {
      await store.upsert(
        ids.seed,
        new Array(768).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
        "some-other-model",
        "whatever",
      );
      const result = await service.similarTracks(ids.seed, { limit: 10 });
      expect(result.source).toBe("metadata_fallback");
    });

    it("returns nothing for an unknown seed", async () => {
      await expect(service.similarTracks(`${TEST_PREFIX}missing`)).resolves.toMatchObject({
        source: "metadata_fallback",
        results: [],
      });
    });
  });

  describe("embeddings.similarity tool", () => {
    const registry = () => new ToolRegistry(embeddingService, store);

    it("lazily embeds candidates and ranks them against the query", async () => {
      const output = await registry().get("embeddings.similarity").run({
        query: "lofi study",
        candidates: [ids.metal, ids.jazz, ids.cold],
      });

      expect(output.status).toBe("ok");
      const ranked = output.ranked as Array<{ trackId: string; score: number }>;
      expect(ranked.map((row) => row.trackId)).toHaveLength(3);
      expect(ranked[0].trackId).toBe(ids.cold);
      expect(await embeddedIds()).toEqual(
        expect.arrayContaining([ids.metal, ids.jazz, ids.cold]),
      );
    });

    it("returns an empty ranking with status unavailable when the provider is off", async () => {
      process.env.TRACK_EMBEDDING_PROVIDER = "disabled";
      await expect(
        registry().get("embeddings.similarity").run({
          query: "lofi study",
          candidates: [ids.cold],
        }),
      ).resolves.toEqual({ ranked: [], status: "unavailable" });
    });

    it("returns unavailable (never throws) when the query embedding fails", async () => {
      jest.spyOn(embeddingService, "embedQuery").mockResolvedValue(null);
      await expect(
        registry().get("embeddings.similarity").run({
          query: "lofi study",
          candidates: [ids.cold],
        }),
      ).resolves.toEqual({ ranked: [], status: "unavailable" });
    });
  });
});
