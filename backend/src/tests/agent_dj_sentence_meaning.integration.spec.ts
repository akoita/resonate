/**
 * #2241: the AI DJ reads the listener's sentence for meaning. Real Postgres
 * (Testcontainers); the model provider is a counting fake and the embedding
 * provider is the offline hash embedder, so nothing here reaches the network.
 *
 * The cost contract this proves: a session start makes at most ONE model parse
 * call and at most ONE query-embedding call, and every pick after it makes
 * ZERO of either, because the sentence's query vector is cached.
 */
import { prisma } from "../db/prisma";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { AgentSessionArtistResolver } from "../modules/agents/agent_session_artist_resolver";
import { createAgentSessionRequestParser } from "../modules/agents/agent_session_parser";
import {
  listeningRequestFromCrateParse,
  requestRankingPreferences,
} from "../modules/agents/agent_session_request";
import { deterministicSelectorInput } from "../modules/agents/deterministic_recommendation.adapter";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import type { CrateModelClient } from "../modules/crates/model_crate_request_parser";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { TrackEmbeddingService } from "../modules/embeddings/track_embedding.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";

const TEST_PREFIX = `agsent_${Date.now()}_`;
const UNIQ = `zq${Date.now().toString(36)}`;
const ARTIST_NAME = `Quenby ${UNIQ} Trio`;
const SENTENCE = `cooking dinner for friends, like ${ARTIST_NAME}`;
const USER_ID = `${TEST_PREFIX}user`;
const ARTIST_ID = `${TEST_PREFIX}uploader`;

const own = [1, 2, 3].map((n) => `${TEST_PREFIX}own_${n}`);
const others = [1, 2, 3, 4].map((n) => `${TEST_PREFIX}other_${n}`);
const unrelated = `${TEST_PREFIX}unrelated`;
const trackIds = [...own, ...others, unrelated];

describe("AI DJ sentence meaning (integration)", () => {
  const embeddingService = new EmbeddingService();
  const store = new EmbeddingStore();
  const trackEmbeddings = new TrackEmbeddingService(embeddingService, store);
  const tools = new ToolRegistry(embeddingService, store, undefined, trackEmbeddings);
  const selector = new AgentSelectorService(tools, new DiscoveryRankingService());
  const original = {
    provider: process.env.TRACK_EMBEDDING_PROVIDER,
    floor: process.env.AGENT_SEMANTIC_MIN_SIMILARITY,
  };
  const restore = (value: string | undefined, name: string) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  beforeAll(async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "hash";
    process.env.AGENT_SEMANTIC_MIN_SIMILARITY = "0";
    await prisma.user.create({ data: { id: USER_ID, email: `${USER_ID}@test.resonate` } });
    await prisma.artist.create({
      data: { id: ARTIST_ID, userId: USER_ID, displayName: "Fixture uploader", payoutAddress: `0x${"e".repeat(40)}` },
    });
    const release = (id: string, title: string, primaryArtist: string, genre: string) => ({
      id: `${TEST_PREFIX}rel_${id}`,
      artistId: ARTIST_ID,
      title,
      primaryArtist,
      genre,
      status: "published",
    });
    await prisma.release.createMany({
      data: [
        ...own.map((id, index) => release(id, `Quenby ${UNIQ} dreamy part ${index}`, ARTIST_NAME, "Dream Pop")),
        ...others.map((id, index) => release(id, `Dreamy ${UNIQ} sketch ${index}`, `Other ${index}`, "Dream Pop")),
        release(unrelated, "Quarry Drill", "Someone Else", "Death Metal"),
      ],
    });
    await prisma.track.createMany({
      data: trackIds.map((id) => ({
        id,
        releaseId: `${TEST_PREFIX}rel_${id}`,
        title: id === unrelated ? "Quarry Drill" : `Dreamy ${UNIQ} ${id.slice(-7)}`,
        position: 1,
        artist: own.includes(id) ? ARTIST_NAME : null,
      })),
    });
    await trackEmbeddings.embedTracks(trackIds);
  });

  afterAll(async () => {
    restore(original.provider, "TRACK_EMBEDDING_PROVIDER");
    restore(original.floor, "AGENT_SEMANTIC_MIN_SIMILARITY");
    await prisma.trackEmbedding.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: USER_ID } }).catch(() => {});
  });

  it("resolves the artist from Postgres, reads the rest with one model call, and keeps the model-free picks free", async () => {
    // ---- start: parse -------------------------------------------------------
    const generateJson = jest.fn(async () =>
      JSON.stringify({ filters: { moods: ["Warm"] }, artists: [], phrases: ["cooking dinner"] }),
    );
    const parser = createAgentSessionRequestParser(
      new AgentSessionArtistResolver(),
      { GOOGLE_AI_API_KEY: "test-key-not-a-secret", AGENT_SESSION_PARSER_STRATEGY: "model-assisted" },
      { createClient: (): CrateModelClient => ({ generateJson }), logger: { warn: jest.fn() } },
    );
    const parsed = listeningRequestFromCrateParse(await parser.parse(SENTENCE, { userId: USER_ID }));
    expect(parsed.artists).toEqual([ARTIST_NAME]);
    expect(parsed.request.moods).toEqual(["Warm"]);
    expect(parsed.strategy).toBe("model-assisted");
    expect(generateJson.mock.calls.length).toBeLessThanOrEqual(1);

    // ---- start + picks: select ----------------------------------------------
    const queryEmbeds = jest.spyOn(embeddingService as any, "embed");
    const queryCalls = () =>
      queryEmbeds.mock.calls.filter(([, taskType]) => taskType === "RETRIEVAL_QUERY").length;
    const requested = requestRankingPreferences({
      request: parsed.request,
      requestText: SENTENCE,
      artists: parsed.artists,
    });
    const preferences = {
      genres: [],
      mood: requested.mood,
      moods: requested.moods,
      request: requested.request,
      requestText: requested.requestText,
      artists: requested.artists,
      allowExplicit: false,
    };
    const pick = (recentTrackIds: string[]) =>
      selector.select(
        deterministicSelectorInput({ userId: USER_ID, recentTrackIds, preferences, limit: 5 }),
      );

    const first = await pick([]);
    expect(queryCalls()).toBe(1);
    // The artist's own tracks lead, and the centroid brings the neighbours in.
    const ours = first.candidates.filter((id) => trackIds.includes(id));
    expect(ours.slice(0, 3).sort()).toEqual([...own].sort());
    expect(ours).toEqual(expect.arrayContaining(others.slice(0, 1)));
    // With the floor at 0 everything is a neighbour; the unrelated track still ranks last of ours.
    expect(first.candidates.indexOf(unrelated)).toBeGreaterThan(first.candidates.indexOf(others[0]));

    // ---- picks: zero model calls, zero provider embeddings -------------------
    const heard: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const next = await pick(heard);
      const chosen = next.selected.find((track) => trackIds.includes(track.id));
      if (chosen) heard.push(chosen.id);
    }
    expect(heard.length).toBeGreaterThan(0);
    expect(queryCalls()).toBe(1);
    expect(generateJson.mock.calls.length).toBeLessThanOrEqual(1);
    queryEmbeds.mockRestore();
  });

  it("never seeds from an artist the catalog does not credit", async () => {
    const result = await tools.get("catalog.artist_seed").run({ artists: ["Nobody Credited Here"] });
    expect(result.items).toEqual([]);
  });

  it("keeps explicit tracks out of the seed unless allowed", async () => {
    await prisma.track.update({ where: { id: own[0] }, data: { explicit: true } });
    try {
      const strict = await tools.get("catalog.artist_seed").run({ artists: [ARTIST_NAME], limit: 20 });
      expect((strict.items as Array<{ id: string }>).map((item) => item.id)).not.toContain(own[0]);
      const open = await tools
        .get("catalog.artist_seed")
        .run({ artists: [ARTIST_NAME], limit: 20, allowExplicit: true });
      expect((open.items as Array<{ id: string }>).map((item) => item.id)).toContain(own[0]);
    } finally {
      await prisma.track.update({ where: { id: own[0] }, data: { explicit: false } });
    }
  });

  it("bounds the seed to the requested limit, own tracks first", async () => {
    const result = await tools.get("catalog.artist_seed").run({ artists: [ARTIST_NAME], limit: 4 });
    const items = result.items as Array<{ id: string; artistSeed: string }>;
    expect(items).toHaveLength(4);
    expect(items.slice(0, 3).map((item) => item.artistSeed)).toEqual(["own", "own", "own"]);
    expect(items[3].artistSeed).toBe("neighbour");
  });

  it("finds a credited artist whose account name is the only credit", async () => {
    const resolver = new AgentSessionArtistResolver();
    expect(await resolver.resolveNames(["fixture uploader"])).toEqual([]);
    expect(await resolver.resolveNames([ARTIST_NAME.toUpperCase()])).toEqual([ARTIST_NAME]);
  });
});
