/**
 * Home embedding candidates — Integration Test (Testcontainers) (#2003, #2006).
 *
 * Stored-vector neighbours of what the listener saved or finished, and of their
 * written taste notes, join Home's candidate pool. Uses the deterministic
 * `hash` embedding provider (no network). With the provider disabled, or with
 * no vectors, Home must rank exactly as it did before this source existed.
 *
 * Run: npm run test:integration
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { TasteNoteEmbeddingService } from "../modules/embeddings/taste_note_embedding.service";
import { TrackEmbeddingService } from "../modules/embeddings/track_embedding.service";
import { DISCOVERY_EXPLANATIONS, DISCOVERY_EXPLANATION_VARIANTS } from "../modules/recommendations/discovery-explanations";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { RecommendationsService } from "../modules/recommendations/recommendations.service";
import { TasteMemoryService } from "../modules/recommendations/taste_memory.service";
import { EventBus } from "../modules/shared/event_bus";

const TEST_PREFIX = `home_emb_${Date.now()}_`;
const HASH_MODEL = "hash-v1";
const USER_ID = `${TEST_PREFIX}listener`;
const GENRE = "lofihm";
const NOTE_TEXT = "late night study session lofihm chill mellow";
const FILLER_COUNT = 14;

const ids = {
  seed: `${TEST_PREFIX}track-seed`,
  cold: `${TEST_PREFIX}track-cold`,
  explicit: `${TEST_PREFIX}track-explicit`,
  filler: (i: number) => `${TEST_PREFIX}track-filler-${i}`,
};
const allTrackIds = [
  ids.seed,
  ids.cold,
  ids.explicit,
  ...Array.from({ length: FILLER_COUNT }, (_, i) => ids.filler(i)),
];

describe("Home embedding candidates (integration)", () => {
  const originalProvider = process.env.TRACK_EMBEDDING_PROVIDER;
  const embeddingService = new EmbeddingService();
  const store = new EmbeddingStore();
  const trackEmbeddings = new TrackEmbeddingService(embeddingService, store);
  const noteEmbeddings = new TasteNoteEmbeddingService(embeddingService, store, trackEmbeddings);
  let tasteMemory: TasteMemoryService;
  let withEmbeddings: RecommendationsService;
  let baseline: RecommendationsService;

  const setProvider = (mode: "hash" | "disabled") => {
    process.env.TRACK_EMBEDDING_PROVIDER = mode;
  };

  // Served history would hide tracks a previous call returned, so every call
  // starts from a clean history.
  const home = async (service: RecommendationsService) => {
    await prisma.recommendationProfile.deleteMany({ where: { userId: USER_ID } });
    const result = await service.getRecommendations(USER_ID, 50);
    return result.items.filter((item) => item.id.startsWith(TEST_PREFIX));
  };
  const shape = (items: Awaited<ReturnType<typeof home>>) =>
    items
      .map((item) => ({
        id: item.id,
        score: item.score,
        reasonCode: item.reasonCode,
        reasons: item.reasons,
        explanations: item.explanations,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  const byId = (items: Awaited<ReturnType<typeof home>>, id: string) =>
    items.find((item) => item.id === id);
  const similar = (items: Awaited<ReturnType<typeof home>>) =>
    items.filter((item) => item.reasonCode === "similar_sound");

  const signal = (
    trackId: string,
    action: string,
    extra: { createdAt?: Date; metadata?: Prisma.InputJsonObject } = {},
  ) =>
    prisma.agentSignal.create({
      data: {
        userId: USER_ID,
        trackId,
        action,
        weight: action === "save" ? 3 : 1.5,
        createdAt: extra.createdAt,
        metadata: extra.metadata,
      },
    });

  const noteVectorCount = async () => {
    const rows = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM "ListenerTasteNoteEmbedding" e
      JOIN "ListenerTasteSignalControl" c ON c."id" = e."controlId"
      WHERE c."userId" = ${USER_ID}
    `;
    return rows[0].n;
  };

  const applyNote = (text = NOTE_TEXT) =>
    tasteMemory.applyTasteEdits(USER_ID, [
      { signalType: "note", value: text, action: "declared" },
    ]);

  beforeAll(async () => {
    setProvider("hash");
    await prisma.user.create({
      data: { id: USER_ID, email: `${USER_ID}@test.resonate` },
    });

    // One artist per track: the policy stage caps two tracks per artist per
    // page, which would otherwise hide neighbours from the page.
    const fixtures: Array<{
      id: string;
      title: string;
      genre: string;
      moods: string[];
      explicit?: boolean;
    }> = [
      { id: ids.seed, title: "Rainy Lofi Study Beats", genre: GENRE, moods: ["chill"] },
      { id: ids.cold, title: "Late Night Study Session", genre: GENRE, moods: ["chill", "mellow"] },
      { id: ids.explicit, title: "Explicit Lofi Study Jam", genre: GENRE, moods: ["chill"], explicit: true },
      ...Array.from({ length: FILLER_COUNT }, (_, i) => ({
        id: ids.filler(i),
        title: `Zephyr Quartz ${i}`,
        genre: `filler${i}`,
        moods: [`far${i}`],
      })),
    ];
    for (const [index, fixture] of fixtures.entries()) {
      await prisma.artist.create({
        data: {
          id: `${fixture.id}-artist`,
          displayName: `Home Emb Artist ${index}`,
          payoutAddress: `0x${"e".repeat(40)}`,
        },
      });
      await prisma.release.create({
        data: {
          id: `${fixture.id}-release`,
          artistId: `${fixture.id}-artist`,
          title: `Release ${index}`,
          status: "published",
          genre: fixture.genre,
          moods: fixture.moods,
        },
      });
      await prisma.track.create({
        data: {
          id: fixture.id,
          releaseId: `${fixture.id}-release`,
          title: fixture.title,
          position: 1,
          explicit: fixture.explicit ?? false,
        },
      });
    }
  });

  afterAll(async () => {
    if (originalProvider === undefined) delete process.env.TRACK_EMBEDDING_PROVIDER;
    else process.env.TRACK_EMBEDDING_PROVIDER = originalProvider;

    await prisma.agentSignal.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.recommendationProfile.deleteMany({ where: { userId: USER_ID } }).catch(() => {});
    await prisma.trackEmbedding
      .deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } })
      .catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.user.delete({ where: { id: USER_ID } }).catch(() => {});
  });

  beforeEach(async () => {
    setProvider("hash");
    await prisma.agentSignal.deleteMany({ where: { userId: USER_ID } });
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: USER_ID } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: USER_ID } });
    await prisma.recommendationProfile.deleteMany({ where: { userId: USER_ID } });
    await prisma.trackEmbedding.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } });

    const eventBus = new EventBus();
    tasteMemory = new TasteMemoryService(eventBus, noteEmbeddings);
    const ranking = new DiscoveryRankingService();
    withEmbeddings = new RecommendationsService(
      eventBus,
      ranking,
      tasteMemory,
      undefined,
      undefined,
      undefined,
      trackEmbeddings,
      noteEmbeddings,
    );
    baseline = new RecommendationsService(eventBus, ranking, tasteMemory);
  });

  afterEach(() => jest.restoreAllMocks());

  const embedFixtures = async () => {
    const result = await trackEmbeddings.embedTracks(allTrackIds);
    expect(result.failed).toBe(0);
    expect(result.embedded).toBeGreaterThan(0);
  };

  describe("seed-track neighbours", () => {
    it("pulls in the nearest neighbours of a saved seed, including a never-played track", async () => {
      await embedFixtures();
      await signal(ids.seed, "save");

      const before = await home(baseline);
      expect(byId(before, ids.cold)?.reasonCode).toBe("catalog");

      const items = await home(withEmbeddings);
      const cold = byId(items, ids.cold);

      // `cold` has no play, save or purchase anywhere: only its vector reaches it.
      expect(await prisma.agentSignal.count({ where: { trackId: ids.cold } })).toBe(0);
      expect(cold).toBeDefined();
      expect(cold!.reasonCode).toBe("similar_sound");
      expect(cold!.explanations).toContain(DISCOVERY_EXPLANATIONS.similar_sound);
      expect(cold!.score).toBeGreaterThan(byId(before, ids.cold)!.score);

      // Bounded: ten neighbours per seed, never the seed itself, never a track
      // the listener's explicit setting excludes.
      expect(similar(items).length).toBeLessThanOrEqual(10);
      expect(byId(items, ids.seed)?.reasonCode).not.toBe("similar_sound");
      expect(byId(items, ids.explicit)).toBeUndefined();
    });

    it("seeds from a finished play but not from a short one", async () => {
      await embedFixtures();
      await signal(ids.seed, "complete", { metadata: { outcome: { completionRatio: 0.3 } } });
      expect(similar(await home(withEmbeddings))).toHaveLength(0);

      await signal(ids.seed, "complete", { metadata: { outcome: { completionRatio: 0.95 } } });
      expect(byId(await home(withEmbeddings), ids.cold)?.reasonCode).toBe("similar_sound");
    });

    it("equals today's Home when the provider is disabled, without touching vectors", async () => {
      await embedFixtures();
      await signal(ids.seed, "save");
      setProvider("disabled");
      const neighbours = jest.spyOn(trackEmbeddings, "embeddingNeighbours");
      const embedQuery = jest.spyOn(embeddingService, "embedQuery");
      const embedDocuments = jest.spyOn(embeddingService, "embedDocuments");

      const expected = shape(await home(baseline));
      const actual = shape(await home(withEmbeddings));

      expect(actual).toEqual(expected);
      expect(similar(await home(withEmbeddings))).toHaveLength(0);
      expect(neighbours).not.toHaveBeenCalled();
      expect(embedQuery).not.toHaveBeenCalled();
      expect(embedDocuments).not.toHaveBeenCalled();
    });

    it("equals today's Home when no vectors exist (no metadata fallback on Home)", async () => {
      await signal(ids.seed, "save");
      const fallback = jest.spyOn(trackEmbeddings, "similarTracks");
      const embedDocuments = jest.spyOn(embeddingService, "embedDocuments");

      const expected = shape(await home(baseline));
      const actual = shape(await home(withEmbeddings));

      expect(actual).toEqual(expected);
      expect(fallback).not.toHaveBeenCalled();
      // Home never calls the model.
      expect(embedDocuments).not.toHaveBeenCalled();
      expect(await prisma.trackEmbedding.count({ where: { trackId: { startsWith: TEST_PREFIX } } })).toBe(0);
    });

    it("equals today's Home for a listener with no positive signals", async () => {
      await embedFixtures();
      await signal(ids.seed, "skip");
      await signal(ids.seed, "accept");

      expect(shape(await home(withEmbeddings))).toEqual(shape(await home(baseline)));
    });
  });

  describe("consent and taste memory", () => {
    it("never seeds from a hidden genre", async () => {
      await embedFixtures();
      await signal(ids.seed, "save");
      await tasteMemory.upsertSignalControl(USER_ID, { signalType: "genre", value: GENRE, action: "hidden" });

      const items = await home(withEmbeddings);

      expect(similar(items)).toHaveLength(0);
      expect(byId(items, ids.cold)).toBeUndefined();
    });

    it("never seeds from a downranked artist", async () => {
      await embedFixtures();
      await signal(ids.seed, "save");
      await tasteMemory.upsertSignalControl(USER_ID, {
        signalType: "artist",
        value: "Home Emb Artist 0",
        action: "downranked",
      });

      expect(similar(await home(withEmbeddings))).toHaveLength(0);
    });

    it("ignores signals from before a taste reset, and uses ones after it", async () => {
      await embedFixtures();
      await signal(ids.seed, "save");
      await tasteMemory.resetTasteMemory(USER_ID);

      expect(similar(await home(withEmbeddings))).toHaveLength(0);

      await signal(ids.seed, "save", { createdAt: new Date(Date.now() + 60_000) });
      expect(byId(await home(withEmbeddings), ids.cold)?.reasonCode).toBe("similar_sound");
    });

    it("ignores AI DJ playback when that training is off, but keeps the listener's own saves", async () => {
      await embedFixtures();
      await tasteMemory.updateSettings(USER_ID, { agentPlaybackTrainingEnabled: false });
      await signal(ids.seed, "save", { metadata: { source: "agent_session" } });

      expect(similar(await home(withEmbeddings))).toHaveLength(0);

      await signal(ids.seed, "save", { metadata: { source: "player" } });
      expect(byId(await home(withEmbeddings), ids.cold)?.reasonCode).toBe("similar_sound");
    });

    it("has no seeds without the taste-memory policy (consent cannot be checked)", async () => {
      await embedFixtures();
      await signal(ids.seed, "save");
      const noPolicy = new RecommendationsService(
        new EventBus(),
        new DiscoveryRankingService(),
        undefined,
        undefined,
        undefined,
        undefined,
        trackEmbeddings,
        undefined,
      );

      expect(similar(await home(noPolicy))).toHaveLength(0);
    });
  });

  describe("written taste notes", () => {
    it("embeds a confirmed note and uses it to pull in nearest tracks", async () => {
      await embedFixtures();

      await applyNote();

      expect(await noteVectorCount()).toBe(1);
      const stored = await prisma.$queryRaw<Array<{ model: string }>>`
        SELECT e."model" FROM "ListenerTasteNoteEmbedding" e
        JOIN "ListenerTasteSignalControl" c ON c."id" = e."controlId"
        WHERE c."userId" = ${USER_ID}
      `;
      expect(stored[0].model).toBe(HASH_MODEL);

      const items = await home(withEmbeddings);
      const cold = byId(items, ids.cold);
      expect(cold!.reasonCode).toBe("taste_match");
      expect(cold!.explanations).toContain(DISCOVERY_EXPLANATION_VARIANTS.declared_taste);
      expect(cold!.score).toBeGreaterThan(byId(await home(baseline), ids.cold)!.score);
      // Notes contribute at most ten neighbours.
      expect(items.filter((item) => item.reasonCode === "taste_match").length).toBeLessThanOrEqual(10);
    });

    it("re-saving the same note does not call the model again", async () => {
      await applyNote();
      const embedQuery = jest.spyOn(embeddingService, "embedQuery");

      await applyNote();

      expect(embedQuery).not.toHaveBeenCalled();
      expect(await noteVectorCount()).toBe(1);
    });

    it("deletes the vector with the note, and the note stops steering Home", async () => {
      await embedFixtures();
      await applyNote();
      expect(byId(await home(withEmbeddings), ids.cold)?.reasonCode).toBe("taste_match");

      const control = await prisma.listenerTasteSignalControl.findFirstOrThrow({
        where: { userId: USER_ID, signalType: "note" },
      });
      await tasteMemory.removeSignalControl(USER_ID, control.id);

      expect(await noteVectorCount()).toBe(0);
      expect(shape(await home(withEmbeddings))).toEqual(shape(await home(baseline)));
    });

    it("keeps a note's vector through a taste reset, like the note itself", async () => {
      await applyNote();
      await tasteMemory.resetTasteMemory(USER_ID);

      expect(await noteVectorCount()).toBe(1);
    });

    it("has no effect with the provider disabled, and writes no vector", async () => {
      await embedFixtures();
      setProvider("disabled");
      const embedQuery = jest.spyOn(embeddingService, "embedQuery");

      await applyNote();

      expect(await noteVectorCount()).toBe(0);
      expect(embedQuery).not.toHaveBeenCalled();
      expect(shape(await home(withEmbeddings))).toEqual(shape(await home(baseline)));
    });

    it("stops steering Home when the provider is switched off after the note was saved", async () => {
      await embedFixtures();
      await applyNote();
      setProvider("disabled");

      expect(shape(await home(withEmbeddings))).toEqual(shape(await home(baseline)));
    });

    it("never fails the apply when embedding fails, and never logs the note text", async () => {
      jest.spyOn(embeddingService, "embedQuery").mockRejectedValue(new Error(`boom ${NOTE_TEXT}`));
      const warn = jest.spyOn(
        (noteEmbeddings as unknown as { logger: { warn: (m: string) => void } }).logger,
        "warn",
      );

      const memory = await applyNote();

      expect(memory.edits.appliedCount).toBe(1);
      expect(memory.controls.map((control) => control.signalType)).toContain("note");
      expect(await noteVectorCount()).toBe(0);
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain("late night");
    });

    it("leaves the note without a vector when the provider returns nothing", async () => {
      jest.spyOn(embeddingService, "embedQuery").mockResolvedValue(null);

      const memory = await applyNote();

      expect(memory.edits.appliedCount).toBe(1);
      expect(await noteVectorCount()).toBe(0);
    });
  });
});
