/**
 * #2088: AI DJ retrieval understands meaning. Real Postgres (Testcontainers).
 * Catalog genres are free text, so a "World" session must reach an "African"
 * release, "Hip-Hop" must reach "Hip Hop", and catalog-wide semantic search
 * must respect the session's explicit choice and the similarity floor.
 */
import { prisma } from "../db/prisma";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { TrackEmbeddingService } from "../modules/embeddings/track_embedding.service";

const TEST_PREFIX = `agsem_${Date.now()}_`;
// Unique lexical token so the hash embedder (lexical, not semantic) ranks our
// tracks above anything another suite left behind.
const UNIQ = `zq${Date.now().toString(36)}`;

const ids = {
  user: `${TEST_PREFIX}user`,
  artist: `${TEST_PREFIX}artist`,
  relAfrican: `${TEST_PREFIX}rel_african`,
  relHipHop: `${TEST_PREFIX}rel_hiphop`,
  relTechno: `${TEST_PREFIX}rel_techno`,
  african: `${TEST_PREFIX}african`,
  africanExplicit: `${TEST_PREFIX}african_explicit`,
  hipHop: `${TEST_PREFIX}hiphop`,
  hipHopExplicit: `${TEST_PREFIX}hiphop_explicit`,
  techno: `${TEST_PREFIX}techno`,
  africanAi: `${TEST_PREFIX}african_ai`,
};
const allTrackIds = [
  ids.african,
  ids.africanExplicit,
  ids.africanAi,
  ids.hipHop,
  ids.hipHopExplicit,
  ids.techno,
];

describe("AI DJ semantic retrieval (integration)", () => {
  const embeddingService = new EmbeddingService();
  const store = new EmbeddingStore();
  const trackEmbeddings = new TrackEmbeddingService(embeddingService, store);
  const tools = new ToolRegistry(embeddingService, store, undefined, trackEmbeddings);
  const original = {
    provider: process.env.TRACK_EMBEDDING_PROVIDER,
    floor: process.env.AGENT_SEMANTIC_MIN_SIMILARITY,
  };
  const restore = (key: keyof typeof original, envName: string) => {
    if (original[key] === undefined) delete process.env[envName];
    else process.env[envName] = original[key];
  };
  const idsOf = (items: unknown) => (items as Array<{ id: string }>).map((item) => item.id);

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ids.user, email: `${ids.user}@test.resonate` } });
    await prisma.artist.create({
      data: {
        id: ids.artist,
        userId: ids.user,
        displayName: "Semantic Artist",
        payoutAddress: `0x${"A".repeat(40)}`,
      },
    });
    await prisma.release.createMany({
      data: [
        { id: ids.relAfrican, title: "Savanna Tapes", artistId: ids.artist, status: "published", genre: "African" },
        { id: ids.relHipHop, title: "Cipher Tapes", artistId: ids.artist, status: "published", genre: "Hip Hop" },
        { id: ids.relTechno, title: "Warehouse Tapes", artistId: ids.artist, status: "published", genre: "Techno" },
      ],
    });
    await prisma.track.createMany({
      data: [
        { id: ids.african, title: `Kora Sunrise ${UNIQ}`, releaseId: ids.relAfrican, position: 1 },
        { id: ids.africanExplicit, title: `Explicit Kora ${UNIQ}`, releaseId: ids.relAfrican, position: 2, explicit: true },
        {
          id: ids.africanAi,
          title: `Generated Kora ${UNIQ}`,
          releaseId: ids.relAfrican,
          position: 3,
          aiDisclosureLevel: "ALL",
          aiDisclosureSource: "artist",
        },
        { id: ids.hipHop, title: `Cipher Night ${UNIQ}`, releaseId: ids.relHipHop, position: 1 },
        { id: ids.hipHopExplicit, title: `Explicit Cipher ${UNIQ}`, releaseId: ids.relHipHop, position: 2, explicit: true },
        { id: ids.techno, title: `Warehouse Pulse ${UNIQ}`, releaseId: ids.relTechno, position: 1 },
      ],
    });
  });

  afterAll(async () => {
    restore("provider", "TRACK_EMBEDDING_PROVIDER");
    restore("floor", "AGENT_SEMANTIC_MIN_SIMILARITY");
    await prisma.trackEmbedding.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
  });

  describe("catalog.search expands genre families", () => {
    it("returns an African release for a World query", async () => {
      const result = await tools.get("catalog.search").run({ query: "World", limit: 50 });
      const found = idsOf(result.items);
      expect(found).toContain(ids.african);
      expect(found).not.toContain(ids.techno);
      // Explicit and fully AI-generated tracks stay out.
      expect(found).not.toContain(ids.africanExplicit);
      expect(found).not.toContain(ids.africanAi);
    });

    it("returns a Hip Hop release for a Hip-Hop query, and explicit only when allowed", async () => {
      const strict = await tools.get("catalog.search").run({ query: "Hip-Hop", limit: 50 });
      expect(idsOf(strict.items)).toContain(ids.hipHop);
      expect(idsOf(strict.items)).not.toContain(ids.hipHopExplicit);

      const open = await tools
        .get("catalog.search")
        .run({ query: "Hip-Hop", limit: 50, allowExplicit: true });
      expect(idsOf(open.items)).toEqual(expect.arrayContaining([ids.hipHop, ids.hipHopExplicit]));
    });

    it("keeps the empty query and title match unchanged", async () => {
      const byTitle = await tools.get("catalog.search").run({ query: `Warehouse Pulse ${UNIQ}` });
      expect(idsOf(byTitle.items)).toEqual([ids.techno]);
      const all = await tools.get("catalog.search").run({ query: "", limit: 50 });
      expect(all.items).toBeInstanceOf(Array);
    });
  });

  describe("catalog.semantic_search", () => {
    it("reports unavailable, without throwing, when embeddings are disabled", async () => {
      process.env.TRACK_EMBEDDING_PROVIDER = "disabled";
      const result = await tools.get("catalog.semantic_search").run({ query: "world music" });
      expect(result).toEqual({ items: [], status: "unavailable" });
    });

    describe("with the hash provider", () => {
      beforeAll(async () => {
        process.env.TRACK_EMBEDDING_PROVIDER = "hash";
        await trackEmbeddings.embedTracks(allTrackIds);
      });
      beforeEach(() => {
        process.env.TRACK_EMBEDDING_PROVIDER = "hash";
        process.env.AGENT_SEMANTIC_MIN_SIMILARITY = "0";
      });
      afterAll(async () => {
        await prisma.trackEmbedding.deleteMany({ where: { model: "hash-v1" } }).catch(() => {});
      });

      it("returns nearest tracks with their score, in neighbour order, annotated like catalog.search", async () => {
        const result = await tools.get("catalog.semantic_search").run({
          query: `Kora Sunrise ${UNIQ} African`,
          limit: 10,
        });
        expect(result.status).toBe("ok");
        const items = result.items as Array<{ id: string; semanticScore: number; hasListing: boolean; aiDisclosure: unknown }>;
        expect(items[0].id).toBe(ids.african);
        expect(typeof items[0].semanticScore).toBe("number");
        expect(items[0]).toHaveProperty("hasListing", false);
        expect(items[0]).toHaveProperty("aiDisclosure");
        const scores = items.map((item) => item.semanticScore);
        expect(scores).toEqual([...scores].sort((a, b) => b - a));
      });

      it("respects explicit filtering, AI eligibility and excludeTrackIds", async () => {
        const query = `Explicit Kora ${UNIQ}`;
        const strict = await tools.get("catalog.semantic_search").run({ query, limit: 50 });
        expect(idsOf(strict.items)).not.toContain(ids.africanExplicit);
        expect(idsOf(strict.items)).not.toContain(ids.africanAi);

        const open = await tools
          .get("catalog.semantic_search")
          .run({ query, limit: 50, allowExplicit: true });
        expect(idsOf(open.items)).toContain(ids.africanExplicit);
        expect(idsOf(open.items)).not.toContain(ids.africanAi);

        const excluded = await tools.get("catalog.semantic_search").run({
          query,
          limit: 50,
          allowExplicit: true,
          excludeTrackIds: [ids.africanExplicit],
        });
        expect(idsOf(excluded.items)).not.toContain(ids.africanExplicit);
      });

      it("drops neighbours below the similarity floor", async () => {
        process.env.AGENT_SEMANTIC_MIN_SIMILARITY = "1";
        const result = await tools.get("catalog.semantic_search").run({
          query: `unrelated words nobody tagged ${UNIQ}x`,
          limit: 10,
        });
        expect(result).toEqual({ items: [], status: "ok" });
      });
    });
  });

  describe("selector", () => {
    it("selects the African track for a World session through keyword families alone", async () => {
      process.env.TRACK_EMBEDDING_PROVIDER = "disabled";
      const selector = new AgentSelectorService(tools, new DiscoveryRankingService());
      const result = await selector.select({
        queries: ["World", "Musiques du monde"],
        requestedTerms: ["World", "Musiques du monde"],
        recentTrackIds: [],
        limit: 20,
        semanticQuery: "Genres: World, Musiques du monde.",
      });
      expect(result.selected.map((track) => track.id)).toContain(ids.african);
      expect(result.selected.map((track) => track.id)).not.toContain(ids.techno);
      const african = result.selected.find((track) => track.id === ids.african) as any;
      expect(african.agentRecommendation.signals).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: "session_request" })]),
      );
    });

    it("adds semantic candidates whose genre text matches no keyword", async () => {
      process.env.TRACK_EMBEDDING_PROVIDER = "hash";
      process.env.AGENT_SEMANTIC_MIN_SIMILARITY = "0";
      await trackEmbeddings.embedTracks(allTrackIds);
      const selector = new AgentSelectorService(tools, new DiscoveryRankingService());
      const result = await selector.select({
        queries: ["Reggae"],
        recentTrackIds: [],
        limit: 20,
        semanticQuery: `Warehouse Pulse ${UNIQ}`,
      });
      expect(result.candidates).toContain(ids.techno);
      await prisma.trackEmbedding.deleteMany({ where: { model: "hash-v1" } });
    });
  });
});
