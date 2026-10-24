/**
 * #2246: trending as a capped hybrid retrieval source, against real Postgres
 * (Testcontainers). The popularity SERVING TABLES (`TrackPopularity`) are seeded
 * directly and read through the real `DiscoveryPopularityService` and the real
 * `catalog.trending` / `catalog.search` tools:
 *  - a trending track outside the request never enters a request session, not
 *    even when similar sounds are allowed, and never displaces a request match;
 *  - what only trending finds fills at most the configured share;
 *  - rows under `DISCOVERY_MIN_AUDIENCE` and stale rows show nothing;
 *  - the explanation is the shared "Trending in <family> this week" sentence.
 */
import { prisma } from "../db/prisma";
import { AgentAudioFeatureService } from "../modules/agents/agent_audio_feature.service";
import { HYBRID_RETRIEVAL_VARIANT } from "../modules/agents/agent_hybrid_retrieval";
import { requestScopeFor } from "../modules/agents/agent_session_request";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { DiscoveryPopularityService } from "../modules/catalog/discovery-popularity.service";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { buildGoldenSelector, scopeToIdPrefix } from "./dj_retrieval_golden/harness";

const TEST_PREFIX = `trend_${Date.now()}_`;
const ids = { user: `${TEST_PREFIX}user`, artist: `${TEST_PREFIX}artist` };
const key = (name: string) => `${TEST_PREFIX}${name}`;

/** 30 African-genre tracks, newest first: the keyword budget (20) reaches w00..w19 only. */
const WORLD = Array.from({ length: 30 }, (_, i) => `w${String(i).padStart(2, "0")}`);
/** Old, popular, and beyond the keyword budget: only the trending source can find these. */
const WORLD_TRENDING = WORLD.slice(25);
const KEYWORD_REACH = WORLD.slice(0, 20);
const ROCK_HOT = "rock_hot";
const WORLD_LOW_DATA = "w_low";

describe("trending source (integration)", () => {
  const popularity = new DiscoveryPopularityService();
  const registry = new ToolRegistry(
    new EmbeddingService(),
    new EmbeddingStore(),
    undefined,
    undefined,
    popularity,
  );
  const selector = buildGoldenSelector(scopeToIdPrefix(registry, TEST_PREFIX), new AgentAudioFeatureService());
  const saved = {
    share: process.env.AGENT_RETRIEVAL_TRENDING_MAX_SHARE_PERCENT,
    minAudience: process.env.DISCOVERY_MIN_AUDIENCE,
  };
  const strip = (id: string) => id.slice(TEST_PREFIX.length);

  const worldRequest = (fillSimilar = false) => ({
    queries: ["World"],
    recentTrackIds: [] as string[],
    requestedGenres: ["World"],
    requestScope: requestScopeFor({ sessionGenres: ["World"], fillSimilar })!,
    limit: 40,
    retrievalVariant: HYBRID_RETRIEVAL_VARIANT,
  });
  const tasteSession = () => ({
    queries: ["African"],
    recentTrackIds: [] as string[],
    learnedGenreWeights: { African: 5 },
    limit: 40,
    retrievalVariant: HYBRID_RETRIEVAL_VARIANT,
  });

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ids.user, email: `${TEST_PREFIX}@test.resonate` } });
    await prisma.artist.create({
      data: { id: ids.artist, userId: ids.user, displayName: "Trending Fixture", payoutAddress: `0x${"c".repeat(40)}` },
    });
    const all = [
      ...WORLD.map((name) => ({ name, genre: "African" })),
      { name: WORLD_LOW_DATA, genre: "African" },
      { name: ROCK_HOT, genre: "Hard Rock" },
    ];
    const newest = Date.now() + 180_000;
    await prisma.release.createMany({
      data: all.map((track, index) => ({
        id: key(`rel_${track.name}`),
        artistId: ids.artist,
        title: `Release ${track.name}`,
        primaryArtist: `Artist ${track.name}`,
        genre: track.genre,
        status: "published",
        createdAt: new Date(newest - index * 1000),
      })),
    });
    await prisma.track.createMany({
      data: all.map((track, index) => ({
        id: key(track.name),
        releaseId: key(`rel_${track.name}`),
        title: `Piece ${track.name}`,
        artist: `Artist ${track.name}`,
        position: 1,
        createdAt: new Date(newest - index * 1000),
      })),
    });
    const row = (trackId: string, genre: string, score: number, uniqueListeners: number) => ({
      trackId: key(trackId),
      window: "7d",
      genre,
      score,
      plays: uniqueListeners * 3,
      uniqueListeners,
      saves: 0,
    });
    const rows = [
      ...WORLD_TRENDING.flatMap((name, i) => [row(name, "", 50 + i, 5), row(name, "African", 50 + i, 5)]),
      // The most-played track in the catalog, but not in the request's family.
      row(ROCK_HOT, "", 999, 40),
      row(ROCK_HOT, "Hard Rock", 999, 40),
      // A World track with a huge score but too few listeners: never shown (minimum audience).
      row(WORLD_LOW_DATA, "", 500, 1),
      row(WORLD_LOW_DATA, "African", 500, 1),
    ];
    await prisma.trackPopularity.createMany({ data: rows });
  });

  afterEach(() => {
    for (const [name, value] of [
      ["AGENT_RETRIEVAL_TRENDING_MAX_SHARE_PERCENT", saved.share],
      ["DISCOVERY_MIN_AUDIENCE", saved.minAudience],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  afterAll(async () => {
    await prisma.trackPopularity.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: ids.artist } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: ids.user } }).catch(() => {});
  });

  it("serves the family from the serving tables, honouring the minimum audience", async () => {
    const rows = await popularity.getTrendingForGenreTerms({ terms: ["World"], limit: 50 });
    const mine = rows.map((r) => r.trackId).filter((id) => id.startsWith(TEST_PREFIX)).map(strip);
    expect(mine).toEqual(expect.arrayContaining(WORLD_TRENDING));
    expect(mine).not.toContain(WORLD_LOW_DATA);
    expect(mine).not.toContain(ROCK_HOT);
    // Best score first.
    const scores = rows.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("a request session gets the on-request trending tracks beyond the keyword budget, and no off-request one", async () => {
    for (const fillSimilar of [false, true]) {
      const result = await selector.select(worldRequest(fillSimilar));
      const candidates = result.candidates.map(strip);
      // The request matches keyword found are all still there: trending displaced nothing.
      expect(candidates).toEqual(expect.arrayContaining(KEYWORD_REACH));
      // Trending adds the older popular World tracks keyword could not reach (within the cap: 20 others -> 5).
      expect(candidates).toEqual(expect.arrayContaining(WORLD_TRENDING));
      // Never the off-request chart-topper, never a below-threshold row.
      expect(candidates).not.toContain(ROCK_HOT);
      expect(candidates).not.toContain(WORLD_LOW_DATA);
      expect(result.retrieval?.sources.find((s) => s.source === "trending")).toMatchObject({ status: "ok" });
      for (const track of result.selected) expect(track.requestTier).toMatch(/^[AB]$/);
    }
  });

  it("caps what only trending found at the configured share", async () => {
    process.env.AGENT_RETRIEVAL_TRENDING_MAX_SHARE_PERCENT = "10";
    const result = await selector.select(worldRequest());
    const trendingOnly = result.candidates.map(strip).filter((id) => WORLD_TRENDING.includes(id));
    // 20 other candidates -> floor(20 * 0.1 / 0.9) = 2.
    expect(trendingOnly).toHaveLength(2);
    expect(result.retrieval?.capped).toEqual({ trending: 3 });
    expect(result.retrieval?.onlyFrom.trending).toBe(2);
  });

  it("with no request, uses the listener's top families and says why in the shared vocabulary", async () => {
    const result = await selector.select(tasteSession());
    const found = result.selected.filter((track) => WORLD_TRENDING.includes(strip(track.id)));
    expect(found.length).toBeGreaterThan(0);
    for (const track of found) {
      expect(track.agentRecommendation?.retrievedBy).toEqual(["trending"]);
      expect(track.agentRecommendation?.explanation.some((line) => /^Trending in (World|African) this week$/.test(line))).toBe(true);
    }
    // Popularity is not a ranking input and the chart-topper of another family is not asked for.
    expect(result.candidates.map(strip)).not.toContain(ROCK_HOT);
  });

  it("shows nothing when the data is below the minimum audience", async () => {
    process.env.DISCOVERY_MIN_AUDIENCE = "100";
    const result = await selector.select(worldRequest());
    const candidates = result.candidates.map(strip);
    expect(candidates.filter((id) => WORLD_TRENDING.includes(id))).toEqual([]);
    expect(candidates).toEqual(expect.arrayContaining(KEYWORD_REACH));
    expect(result.retrieval?.sources.find((s) => s.source === "trending")).toMatchObject({ status: "ok", candidates: 0 });
  });

  it("shows nothing when the serving rows are stale (recency is never a fallback)", async () => {
    await prisma.trackPopularity.updateMany({
      where: { trackId: { startsWith: TEST_PREFIX } },
      data: { computedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    try {
      const result = await selector.select(worldRequest());
      expect(result.candidates.map(strip).filter((id) => WORLD_TRENDING.includes(id))).toEqual([]);
    } finally {
      await prisma.trackPopularity.updateMany({
        where: { trackId: { startsWith: TEST_PREFIX } },
        data: { computedAt: new Date() },
      });
    }
  });
});
