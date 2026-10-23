/**
 * #2242: the real SQL behind hybrid retrieval, against Postgres/pgvector
 * (Testcontainers): `catalog.audio_range` (measured energy band and tempo
 * window; explicit and AI-promotion filters; inferred values never retrieve)
 * and the calibrated semantic floor.
 */
import { prisma } from "../db/prisma";
import { HYBRID_RETRIEVAL_VARIANT } from "../modules/agents/agent_hybrid_retrieval";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { TrackDescriptorTagger } from "../modules/descriptors/track_descriptor_tagger";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { TrackEmbeddingService } from "../modules/embeddings/track_embedding.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";

const TEST_PREFIX = `hyb_${Date.now()}_`;
const ids = {
  user: `${TEST_PREFIX}user`,
  artist: `${TEST_PREFIX}artist`,
};
const key = (name: string) => `${TEST_PREFIX}${name}`;

// Energy composite = 0.65 * clamp(rms / 0.3) + 0.35 * clamp(onsets / 8): low < 0.38, high >= 0.67.
const QUIET = { energyRms: 0.03, onsetDensity: 0.5 };
const LOUD = { energyRms: 0.3, onsetDensity: 8 };
const features = (measured: { energyRms: number; onsetDensity: number }, tempo?: { bpm: number; confidence: number }) => ({
  schemaVersion: "stem-audio-features/v1",
  extractor: { name: "librosa", version: "0.10" },
  sampleRate: 22050,
  durationSeconds: 200,
  ...(tempo ? { tempoBpm: tempo.bpm, tempoConfidence: tempo.confidence } : {}),
  ...measured,
});

const tracks = [
  { name: "quiet_slow", measured: QUIET, tempo: { bpm: 70, confidence: 0.9 } },
  { name: "quiet_122", measured: QUIET, tempo: { bpm: 122, confidence: 0.9 } },
  { name: "quiet_unsure", measured: QUIET, tempo: { bpm: 122, confidence: 0.2 } },
  { name: "loud_122", measured: LOUD, tempo: { bpm: 122, confidence: 0.9 } },
  { name: "quiet_explicit", measured: QUIET, tempo: { bpm: 70, confidence: 0.9 }, explicit: true },
  { name: "quiet_ai", measured: QUIET, tempo: { bpm: 70, confidence: 0.9 }, ai: true },
  { name: "unmeasured" },
] as const;

describe("hybrid retrieval SQL (integration)", () => {
  const embeddingService = new EmbeddingService();
  const store = new EmbeddingStore();
  const trackEmbeddings = new TrackEmbeddingService(embeddingService, store);
  const registry = new ToolRegistry(embeddingService, store, undefined, trackEmbeddings);
  const original = {
    provider: process.env.TRACK_EMBEDDING_PROVIDER,
    floor: process.env.AGENT_SEMANTIC_MIN_SIMILARITY,
  };
  const mine = (items: unknown) =>
    (items as Array<{ id: string }>).map((entry) => entry.id).filter((id) => id.startsWith(TEST_PREFIX));

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ids.user, email: `${TEST_PREFIX}@test.resonate` } });
    await prisma.artist.create({
      data: { id: ids.artist, userId: ids.user, displayName: "Hybrid Artist", payoutAddress: `0x${"b".repeat(40)}` },
    });
    const newest = Date.now() + 120_000;
    await prisma.release.createMany({
      data: tracks.map((track, index) => ({
        id: key(`rel_${track.name}`),
        artistId: ids.artist,
        title: `Rel ${track.name}`,
        genre: "Untagged",
        status: "published",
        createdAt: new Date(newest - index * 1000),
      })),
    });
    await prisma.track.createMany({
      data: tracks.map((track, index) => ({
        id: key(track.name),
        releaseId: key(`rel_${track.name}`),
        title: `Piece ${track.name}`,
        position: 1,
        explicit: "explicit" in track,
        createdAt: new Date(newest - index * 1000),
        ...("ai" in track ? { aiDisclosureLevel: "ALL", aiDisclosureSource: "artist" } : {}),
      })),
    });
    await prisma.stem.createMany({
      data: tracks.map((track) => ({
        id: key(`stem_${track.name}`),
        trackId: key(track.name),
        type: "original",
        uri: `local://${key(track.name)}.wav`,
        isCurrent: true,
        durationSeconds: 200,
        ..."measured" in track
          ? { audioFeatures: features(track.measured, "tempo" in track ? track.tempo : undefined) }
          : {},
      })),
    });
    await new TrackDescriptorTagger({ env: {} }).tagTracks(tracks.map((track) => key(track.name)), { apply: true });
  });

  afterAll(async () => {
    for (const [name, value] of [
      ["TRACK_EMBEDDING_PROVIDER", original.provider],
      ["AGENT_SEMANTIC_MIN_SIMILARITY", original.floor],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await prisma.trackEmbedding.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: ids.artist } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: ids.user } }).catch(() => {});
  });

  describe("catalog.audio_range", () => {
    const run = (input: Record<string, unknown>) =>
      registry.get("catalog.audio_range").run({ limit: 50, ...input });

    it("retrieves by measured energy band, with no tag involved, and honours explicit and AI filters", async () => {
      const low = mine((await run({ energy: "low" })).items).sort();
      expect(low).toEqual([key("quiet_122"), key("quiet_slow"), key("quiet_unsure")].sort());
      const lowWithExplicit = mine((await run({ energy: "low", allowExplicit: true })).items);
      expect(lowWithExplicit).toContain(key("quiet_explicit"));
      // Fully AI-generated music never reaches the promotional seam (ADR-BM-5).
      expect(lowWithExplicit).not.toContain(key("quiet_ai"));
      expect(mine((await run({ energy: "high" })).items)).toEqual([key("loud_122")]);
    });

    it("retrieves by measured tempo window, and ignores a tempo whose confidence is under the gate", async () => {
      const window = mine((await run({ tempoBpm: { min: 120, max: 125 } })).items).sort();
      expect(window).toEqual([key("loud_122"), key("quiet_122")].sort());
      expect(mine((await run({ tempoBpm: { min: 120, max: null } })).items)).not.toContain(key("quiet_slow"));
      expect(mine((await run({ tempoBpm: { min: null, max: 80 } })).items)).toEqual([key("quiet_slow")]);
    });

    it("combines energy and tempo, honours excludeTrackIds, and returns nothing without a request", async () => {
      expect(mine((await run({ energy: "low", tempoBpm: { min: 120, max: 125 } })).items)).toEqual([key("quiet_122")]);
      expect(mine((await run({ energy: "low", excludeTrackIds: [key("quiet_slow")] })).items)).not.toContain(key("quiet_slow"));
      expect((await run({})).items).toEqual([]);
    });

    it("never returns a track that was not measured", async () => {
      expect(mine((await run({ energy: "low" })).items)).not.toContain(key("unmeasured"));
    });
  });

  describe("selector under hybrid_rrf_v1", () => {
    it("picks the untagged low-energy tracks for a calm request, and the default path does not", async () => {
      const selector = new AgentSelectorService(registry, new DiscoveryRankingService());
      const input = { queries: ["Calm"], recentTrackIds: [], energy: "low" as const, limit: 50 };
      const fused = await selector.select({ ...input, retrievalVariant: HYBRID_RETRIEVAL_VARIANT });
      expect(mine(fused.candidates.map((id) => ({ id })))).toEqual(
        expect.arrayContaining([key("quiet_slow"), key("quiet_122")]),
      );
      expect(fused.retrieval?.sources.find((entry) => entry.source === "audio_range")?.status).toBe("ok");
      const current = await selector.select({ ...input, retrievalVariant: "baseline" });
      expect(mine(current.candidates.map((id) => ({ id })))).not.toContain(key("quiet_slow"));
    });
  });

  describe("calibrated semantic floor (hash embedder)", () => {
    beforeAll(async () => {
      process.env.TRACK_EMBEDDING_PROVIDER = "hash";
      await trackEmbeddings.embedTracks(tracks.map((track) => key(track.name)));
    });
    beforeEach(() => {
      process.env.TRACK_EMBEDDING_PROVIDER = "hash";
      delete process.env.AGENT_SEMANTIC_MIN_SIMILARITY;
    });

    it("keeps only neighbours within the relative margin of the best one, never under the absolute floor", async () => {
      const query = `Piece quiet_slow Rel quiet_slow`;
      process.env.AGENT_SEMANTIC_MIN_SIMILARITY = "0";
      const all = (await registry.get("catalog.semantic_search").run({ query, limit: 50 })).items as Array<{ semanticScore: number }>;
      delete process.env.AGENT_SEMANTIC_MIN_SIMILARITY;
      const calibrated = (await registry.get("catalog.semantic_search").run({ query, limit: 50, calibratedFloor: true }))
        .items as Array<{ semanticScore: number }>;
      const top = Math.max(...all.map((entry) => entry.semanticScore));
      expect(calibrated.length).toBeGreaterThan(0);
      expect(calibrated.length).toBeLessThanOrEqual(all.length);
      for (const entry of calibrated) {
        expect(entry.semanticScore).toBeGreaterThanOrEqual(Math.max(0.5, top - 0.15) - 1e-9);
      }
    });

    it("returns nothing for a request no neighbour resembles", async () => {
      process.env.AGENT_SEMANTIC_MIN_SIMILARITY = "1";
      const result = await registry
        .get("catalog.semantic_search")
        .run({ query: `unrelated words nobody tagged zzqx`, limit: 10, calibratedFloor: true });
      expect(result).toEqual({ items: [], status: "ok" });
    });
  });
});
