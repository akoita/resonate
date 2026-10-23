/**
 * #2244: seeded AI DJ sessions against real Postgres/pgvector (Testcontainers).
 * The embedding provider is the offline hash embedder (lexical, deterministic):
 * the fixture tracks that are meant to be neighbours share a distinctive word,
 * so "nearest" is predictable without a model.
 *
 * Covers each seed kind (track, artist, playlist), the playlist source's access
 * rule (own or public, never someone else's private playlist), the cap on the
 * playlist's own tracks, and the session plumbing: the seed is resolved by the
 * server, kept for the live session, shown in Session History as kind + label
 * only, and published as its kind only.
 */
import { ForbiddenException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AgentConfigController } from "../modules/agents/agent_config.controller";
import { HYBRID_RETRIEVAL_VARIANT } from "../modules/agents/agent_hybrid_retrieval";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { selectorSeedsFor } from "../modules/agents/agent_session_seed";
import { resolveSessionSeed } from "../modules/agents/agent_session_seed_resolver";
import { ToolRegistry, PLAYLIST_SEED_OWN_TRACKS } from "../modules/agents/tools/tool_registry";
import { TrackDescriptorTagger } from "../modules/descriptors/track_descriptor_tagger";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { TrackEmbeddingService } from "../modules/embeddings/track_embedding.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { SessionsService } from "../modules/sessions/sessions.service";
import { EventBus } from "../modules/shared/event_bus";

const TEST_PREFIX = `seeded_${Date.now()}_`;
const UNIQ = `zq${Date.now().toString(36)}`;
const LISTENER = `${TEST_PREFIX}listener`;
const OTHER = `${TEST_PREFIX}other`;
const UPLOADER = `${TEST_PREFIX}uploader`;
const SEEDED_ARTIST = `${TEST_PREFIX}seeded_artist`;
const SEEDED_ARTIST_NAME = `Quenby ${UNIQ} Trio`;
const key = (name: string) => `${TEST_PREFIX}${name}`;

const playlistTracks = [1, 2, 3, 4, 5, 6].map((n) => `pl${n}`);
const neighbours = [1, 2, 3, 4, 5, 6].map((n) => `nb${n}`);
const unrelated = ["un1", "un2"];
const familyOnly = "fam1";
const noVector = "nov1";
const artistTracks = [1, 2, 3].map((n) => `ar${n}`);
const allTracks = [...playlistTracks, ...neighbours, ...unrelated, familyOnly, noVector, ...artistTracks];

const PLAYLISTS = {
  mine: key("playlist_mine"),
  publicOfOther: key("playlist_public_other"),
  privateOfOther: key("playlist_private_other"),
  noVectors: key("playlist_no_vectors"),
};

describe("seeded AI DJ sessions (integration)", () => {
  const embeddingService = new EmbeddingService();
  const store = new EmbeddingStore();
  const trackEmbeddings = new TrackEmbeddingService(embeddingService, store);
  const tools = new ToolRegistry(embeddingService, store, undefined, trackEmbeddings);
  const selector = new AgentSelectorService(tools, new DiscoveryRankingService());
  const original = {
    provider: process.env.TRACK_EMBEDDING_PROVIDER,
    floor: process.env.AGENT_SEMANTIC_MIN_SIMILARITY,
  };
  const mine = (items: unknown) =>
    (items as Array<{ id: string }>).map((entry) => entry.id).filter((id) => id.startsWith(TEST_PREFIX));
  const names = (ids: string[]) => ids.map((id) => id.slice(TEST_PREFIX.length));
  const playlistSeed = (input: Record<string, unknown>) =>
    tools.get("catalog.playlist_seed").run({
      playlistId: PLAYLISTS.mine,
      userId: LISTENER,
      limit: 20,
      calibratedFloor: true,
      allowExplicit: false,
      ...input,
    });

  beforeAll(async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "hash";
    delete process.env.AGENT_SEMANTIC_MIN_SIMILARITY;
    await prisma.user.createMany({
      data: [
        { id: LISTENER, email: `${LISTENER}@test.resonate` },
        { id: OTHER, email: `${OTHER}@test.resonate` },
        { id: UPLOADER, email: `${UPLOADER}@test.resonate` },
      ],
    });
    await prisma.artist.createMany({
      data: [
        { id: `${TEST_PREFIX}artist`, userId: UPLOADER, displayName: "Fixture uploader", payoutAddress: `0x${"c".repeat(40)}` },
        { id: SEEDED_ARTIST, displayName: SEEDED_ARTIST_NAME, payoutAddress: `0x${"d".repeat(40)}` },
      ],
    });
    const newest = Date.now() + 120_000;
    const releaseOf = (name: string, index: number) => {
      const isPlaylist = playlistTracks.includes(name);
      const isNeighbour = neighbours.includes(name);
      const isArtist = artistTracks.includes(name);
      return {
        id: key(`rel_${name}`),
        artistId: isArtist ? SEEDED_ARTIST : `${TEST_PREFIX}artist`,
        title: isPlaylist || isNeighbour ? `Lantern ${UNIQ} moss ${name}` : unrelated.includes(name) ? "Quarry Drill" : `Release ${name}`,
        primaryArtist: isArtist ? SEEDED_ARTIST_NAME : isPlaylist ? "Playlist Artist" : `Artist ${name}`,
        genre: unrelated.includes(name) ? "Death Metal" : "Deep House",
        status: "published",
        createdAt: new Date(newest - index * 1000),
      };
    };
    await prisma.release.createMany({ data: allTracks.map(releaseOf) });
    await prisma.track.createMany({
      data: allTracks.map((name, index) => ({
        id: key(name),
        releaseId: key(`rel_${name}`),
        title:
          playlistTracks.includes(name) || neighbours.includes(name)
            ? `Lantern ${UNIQ} moss ${name}`
            : unrelated.includes(name)
              ? "Quarry Drill"
              : `Piece ${name}`,
        artist: artistTracks.includes(name) ? SEEDED_ARTIST_NAME : playlistTracks.includes(name) ? "Playlist Artist" : `Artist ${name}`,
        position: 1,
        createdAt: new Date(newest - index * 1000),
      })),
    });
    await new TrackDescriptorTagger({ env: {} }).tagTracks(allTracks.map(key), { apply: true });
    // Everything except `nov1` has a stored vector.
    await trackEmbeddings.embedTracks(allTracks.filter((name) => name !== noVector).map(key));
    await prisma.playlist.createMany({
      data: [
        { id: PLAYLISTS.mine, userId: LISTENER, name: "My late night", visibility: "private", trackIds: playlistTracks.map(key) },
        { id: PLAYLISTS.publicOfOther, userId: OTHER, name: "Open crate", visibility: "public", trackIds: playlistTracks.slice(0, 4).map(key) },
        { id: PLAYLISTS.privateOfOther, userId: OTHER, name: "Their secret mix", visibility: "private", trackIds: playlistTracks.map(key) },
        { id: PLAYLISTS.noVectors, userId: LISTENER, name: "Unembedded", visibility: "private", trackIds: [key(noVector)] },
      ],
    });
  });

  afterAll(async () => {
    for (const [name, value] of [
      ["TRACK_EMBEDDING_PROVIDER", original.provider],
      ["AGENT_SEMANTIC_MIN_SIMILARITY", original.floor],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await prisma.license.deleteMany({ where: { session: { userId: LISTENER } } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: LISTENER } }).catch(() => {});
    await prisma.agentConfig.deleteMany({ where: { userId: LISTENER } }).catch(() => {});
    await prisma.playlist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.trackEmbedding.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.trackDescriptor.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [LISTENER, OTHER, UPLOADER] } } }).catch(() => {});
  });

  describe("catalog.playlist_seed", () => {
    it("brings in neighbours of the playlist and the family mix, with only a few of the playlist's own tracks", async () => {
      const result = await playlistSeed({});
      expect(result.status).toBe("ok");
      const items = (result.items as Array<{ id: string; playlistSeed: string }>).filter((item) =>
        item.id.startsWith(TEST_PREFIX),
      );
      const ownIds = items.filter((item) => item.playlistSeed === "own").map((item) => item.id);
      const others = items.filter((item) => item.playlistSeed !== "own").map((item) => item.id);

      // Neighbours: tracks that share the playlist's words but are not in it.
      expect(names(others)).toEqual(expect.arrayContaining(neighbours));
      // The genre-family mix reaches a track whose words are nothing like the playlist's.
      expect(items.find((item) => item.id === key(familyOnly))?.playlistSeed).toBe("family");
      // The playlist is not replayed: at most PLAYLIST_SEED_OWN_TRACKS of its tracks, the rest are new.
      expect(ownIds.length).toBeLessThanOrEqual(PLAYLIST_SEED_OWN_TRACKS);
      expect(ownIds.length).toBeGreaterThan(0);
      expect(others.length).toBeGreaterThan(ownIds.length * 2);
      for (const id of others) expect(names([id])[0]).not.toMatch(/^pl\d$/);
      // Unrelated music does not ride along.
      expect(names(items.map((item) => item.id))).not.toEqual(expect.arrayContaining(unrelated));
      // The selector is told every member, to keep the rest of them out of the pool.
      expect([...(result.playlistTrackIds as string[])].sort()).toEqual(playlistTracks.map(key).sort());
    });

    it("excludes what the session already holds, including from the playlist's own tracks", async () => {
      const result = await playlistSeed({ excludeTrackIds: [key("nb1"), key("pl1"), key("pl2"), key("pl3"), key("pl4"), key("pl5")] });
      const ids = mine(result.items);
      expect(ids).not.toContain(key("nb1"));
      expect(names(ids).filter((name) => /^pl\d$/.test(name))).toEqual(["pl6"]);
    });

    it("keeps explicit tracks out unless the listener allows them", async () => {
      await prisma.track.update({ where: { id: key("nb1") }, data: { explicit: true } });
      try {
        expect(mine((await playlistSeed({})).items)).not.toContain(key("nb1"));
        expect(mine((await playlistSeed({ allowExplicit: true })).items)).toContain(key("nb1"));
      } finally {
        await prisma.track.update({ where: { id: key("nb1") }, data: { explicit: false } });
      }
    });

    it("keeps fully AI-generated tracks out (ADR-BM-5)", async () => {
      await prisma.track.update({ where: { id: key("nb2") }, data: { aiDisclosureLevel: "ALL", aiDisclosureSource: "artist" } });
      try {
        expect(mine((await playlistSeed({})).items)).not.toContain(key("nb2"));
      } finally {
        await prisma.track.update({ where: { id: key("nb2") }, data: { aiDisclosureLevel: "UNDECLARED", aiDisclosureSource: "migration" } });
      }
    });

    it("seeds from the genre-family mix alone when the playlist has no stored vectors", async () => {
      const result = await playlistSeed({ playlistId: PLAYLISTS.noVectors });
      expect(result.status).toBe("ok");
      const items = (result.items as Array<{ id: string; playlistSeed: string }>).filter((item) => item.id.startsWith(TEST_PREFIX));
      expect(items.find((item) => item.id === key("fam1"))?.playlistSeed).toBe("family");
      // No centroid, so no neighbours: everything beyond the playlist's own track is the family mix.
      expect(items.filter((item) => item.playlistSeed === "neighbour")).toEqual([]);
      expect(items.filter((item) => item.playlistSeed === "own").map((item) => item.id)).toEqual([key(noVector)]);
    });

    it("is bounded by the limit", async () => {
      const result = await playlistSeed({ limit: 4 });
      expect((result.items as unknown[]).length).toBeLessThanOrEqual(4);
    });

    it("lets a listener seed from a public playlist of someone else", async () => {
      const result = await playlistSeed({ playlistId: PLAYLISTS.publicOfOther });
      expect(result.status).toBe("ok");
      expect(mine(result.items).length).toBeGreaterThan(0);
    });

    it("refuses someone else's private playlist, a missing one, and an anonymous caller's private one", async () => {
      for (const input of [
        { playlistId: PLAYLISTS.privateOfOther },
        { playlistId: key("no_such_playlist") },
        { playlistId: PLAYLISTS.mine, userId: OTHER },
        { playlistId: PLAYLISTS.mine, userId: "" },
      ]) {
        const result = await playlistSeed(input);
        expect(result).toMatchObject({ items: [], status: "forbidden" });
        expect(result).not.toHaveProperty("playlistTrackIds");
      }
    });
  });

  describe("selector, hybrid_rrf_v1 and the default path", () => {
    /** Every `before` track is ranked ahead of every `after` track in the selector's scored order. */
    const expectRankedBefore = (candidates: string[], before: string[], after: string[]) => {
      const rank = (name: string) => candidates.indexOf(key(name));
      for (const name of [...before, ...after]) expect(rank(name)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...before.map(rank))).toBeLessThan(Math.min(...after.map(rank)));
    };
    const run = (seeds: Parameters<typeof selectorSeedsFor>[0], extra: Record<string, unknown> = {}) =>
      selector.select({
        userId: LISTENER,
        queries: [],
        recentTrackIds: [],
        allowExplicit: false,
        seeds: selectorSeedsFor(seeds),
        limit: 12,
        ...extra,
      });

    it.each([
      ["hybrid_rrf_v1", { retrievalVariant: HYBRID_RETRIEVAL_VARIANT }],
      ["default", { retrievalVariant: "baseline" }],
    ])("a playlist-seeded session plays mostly tracks outside the playlist (%s)", async (_name, variant) => {
      const result = await run({ kind: "playlist", id: PLAYLISTS.mine, label: "My late night" }, variant);
      const picked = mine(result.selected.map((track) => ({ id: track.id })));
      const inPlaylist = picked.filter((id) => playlistTracks.map(key).includes(id));
      expect(picked.length).toBeGreaterThan(3);
      expect(inPlaylist.length).toBeLessThanOrEqual(PLAYLIST_SEED_OWN_TRACKS);
      expect(picked.length - inPlaylist.length).toBeGreaterThan(inPlaylist.length);
      // Same family: the neighbours rank ahead of the metal the newest-tracks source also brings in.
      expect(names(picked)).toEqual(expect.arrayContaining(["nb1"]));
      expectRankedBefore(result.candidates, neighbours.filter((name) => name !== "nb2"), unrelated);
    });

    it("a playlist the caller may not use seeds nothing: its tracks are not offered because of it", async () => {
      const result = await selector.select({
        userId: OTHER,
        queries: [],
        recentTrackIds: [],
        seeds: { playlistId: PLAYLISTS.mine },
        retrievalVariant: HYBRID_RETRIEVAL_VARIANT,
        limit: 12,
      });
      const seedSource = result.retrieval?.sources.find((entry) => entry.source === "seed");
      expect(seedSource).toMatchObject({ status: "ok", candidates: 0 });
      // No neighbour of the playlist is found through the seed source.
      expect(result.retrieval?.onlyFrom.seed ?? 0).toBe(0);
    });

    it("a track-seeded session starts from that track's stored vector and never replays it", async () => {
      const result = await run({ kind: "track", id: key("pl1"), label: "Lantern" }, { retrievalVariant: HYBRID_RETRIEVAL_VARIANT });
      const picked = mine(result.selected.map((track) => ({ id: track.id })));
      expect(picked).not.toContain(key("pl1"));
      expectRankedBefore(result.candidates, [...playlistTracks.filter((name) => name !== "pl1"), "nb1", "nb3"], unrelated);
    });

    it("an artist-seeded session leads with the artist's own tracks", async () => {
      const result = await run(
        { kind: "artist", id: SEEDED_ARTIST, label: SEEDED_ARTIST_NAME },
        { retrievalVariant: HYBRID_RETRIEVAL_VARIANT },
      );
      // The artist's own tracks lead (the per-artist cap lets two of them into one pick).
      expect(names(mine(result.selected.map((track) => ({ id: track.id })))).slice(0, 2)).toEqual(["ar1", "ar2"]);
      expect(result.candidates.map((id) => id.slice(TEST_PREFIX.length)).filter((name) => /^ar\d$/.test(name))).toHaveLength(3);
    });
  });

  describe("resolveSessionSeed", () => {
    it("resolves each kind to the catalog's own label, ignoring the client's", async () => {
      await expect(resolveSessionSeed(LISTENER, { kind: "playlist", id: PLAYLISTS.mine, label: "spoofed" })).resolves.toEqual({
        kind: "playlist",
        id: PLAYLISTS.mine,
        label: "My late night",
      });
      await expect(resolveSessionSeed(LISTENER, { kind: "artist", id: SEEDED_ARTIST, label: "spoofed" })).resolves.toMatchObject({
        kind: "artist",
        label: SEEDED_ARTIST_NAME,
      });
      await expect(resolveSessionSeed(LISTENER, { kind: "track", id: key("pl1") })).resolves.toMatchObject({
        kind: "track",
        label: `Lantern ${UNIQ} moss pl1`,
      });
      await expect(resolveSessionSeed(LISTENER, { kind: "playlist", id: PLAYLISTS.publicOfOther })).resolves.toMatchObject({
        label: "Open crate",
      });
    });

    it("refuses another listener's private playlist (403) and a missing one the same way", async () => {
      await expect(resolveSessionSeed(LISTENER, { kind: "playlist", id: PLAYLISTS.privateOfOther })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(resolveSessionSeed(LISTENER, { kind: "playlist", id: key("nope") })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(resolveSessionSeed(OTHER, { kind: "playlist", id: PLAYLISTS.mine })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("answers 400 for a malformed seed or a track or artist the catalog does not hold", async () => {
      for (const raw of [null, { kind: "album", id: "x" }, { kind: "track" }, { kind: "track", id: key("nope") }, { kind: "artist", id: key("nope") }]) {
        await expect(resolveSessionSeed(LISTENER, raw)).rejects.toMatchObject({ status: 400 });
      }
    });
  });

  describe("sessions", () => {
    const runtime = { run: jest.fn() };
    const runCommerce = jest.fn();
    const published: Array<Record<string, any>> = [];
    const eventBus = new EventBus();
    const wallet = { setBudget: jest.fn().mockResolvedValue({}) };
    const sessions = new SessionsService(wallet as any, eventBus, { runCommerce } as any, {} as any);
    const controller = new AgentConfigController(
      {} as any,
      runtime as any,
      { enrichConfig: jest.fn(async (config: unknown) => config) } as any,
      { resolveTasteProfile: jest.fn().mockResolvedValue(null), mergeLearnedGenres: jest.fn() } as any,
      eventBus,
    );
    const filtersOf = async (id: string) => (await prisma.session.findUniqueOrThrow({ where: { id } })).filters;
    const lastRuntimePreferences = () => runCommerce.mock.calls.at(-1)![0].preferences;

    beforeAll(async () => {
      eventBus.subscribe("session.started", (event: Record<string, any>) => published.push(event));
      await prisma.agentConfig.create({ data: { userId: LISTENER, monthlyCapUsd: 10, vibes: [] } });
    });
    beforeEach(() => {
      runtime.run.mockReset().mockResolvedValue({ status: "no_tracks", tracks: [] });
      runCommerce.mockReset().mockResolvedValue({ status: "no_tracks", tracks: [], shortfall: 1 });
      published.length = 0;
    });

    it("keeps the seed for the whole live session, with the catalog's label, and Session History shows kind + label only", async () => {
      const session = await sessions.startSession({
        userId: LISTENER,
        budgetCapUsd: 10,
        preferences: { seed: { kind: "playlist", id: PLAYLISTS.mine, label: "spoofed label" } },
      });
      expect(await filtersOf(session.id)).toEqual({
        genres: [],
        moods: [],
        explicit: false,
        seed: { kind: "playlist", label: "My late night" },
      });
      expect(JSON.stringify(await filtersOf(session.id))).not.toContain(PLAYLISTS.mine);
      // Published as its kind only: the id may name a private playlist.
      expect(published.at(-1)?.preferences).toMatchObject({ seedKind: "playlist" });
      expect(JSON.stringify(published)).not.toContain(PLAYLISTS.mine);

      // Every pick of the live session carries it, with or without the client sending it again.
      await sessions.agentNext({ sessionId: session.id, userId: LISTENER });
      expect(lastRuntimePreferences().seed).toEqual({ kind: "playlist", id: PLAYLISTS.mine, label: "My late night" });
      await sessions.agentNext({
        sessionId: session.id,
        userId: LISTENER,
        preferences: { seed: { kind: "playlist", id: PLAYLISTS.mine, label: "My late night" }, genres: ["Deep House"] },
      });
      expect(lastRuntimePreferences().seed).toMatchObject({ kind: "playlist", id: PLAYLISTS.mine });
      expect(await filtersOf(session.id)).toMatchObject({ seed: { kind: "playlist", label: "My late night" } });

      // Removing the chip drops the seed from the session and from its history.
      await sessions.agentNext({ sessionId: session.id, userId: LISTENER, preferences: { seed: null } });
      expect(lastRuntimePreferences()).not.toHaveProperty("seed");
      expect(await filtersOf(session.id)).not.toHaveProperty("seed");
      await sessions.agentNext({ sessionId: session.id, userId: LISTENER });
      expect(lastRuntimePreferences()).not.toHaveProperty("seed");
    });

    it("refuses another listener's private playlist at start and mid-session, writing and remembering nothing", async () => {
      const before = await prisma.session.count({ where: { userId: LISTENER } });
      wallet.setBudget.mockClear();
      await expect(
        sessions.startSession({
          userId: LISTENER,
          budgetCapUsd: 10,
          preferences: { seed: { kind: "playlist", id: PLAYLISTS.privateOfOther, label: "Their secret mix" } },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(await prisma.session.count({ where: { userId: LISTENER } })).toBe(before);
      expect(wallet.setBudget).not.toHaveBeenCalled();

      const session = await sessions.startSession({ userId: LISTENER, budgetCapUsd: 10, preferences: { genres: ["Deep House"] } });
      await expect(
        sessions.agentNext({
          sessionId: session.id,
          userId: LISTENER,
          preferences: { seed: { kind: "playlist", id: PLAYLISTS.privateOfOther, label: "Their secret mix" } },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(runCommerce).not.toHaveBeenCalled();
      // The rejected seed was not remembered.
      await sessions.agentNext({ sessionId: session.id, userId: LISTENER });
      expect(lastRuntimePreferences()).not.toHaveProperty("seed");
      expect(JSON.stringify(await filtersOf(session.id))).not.toContain("Their secret mix");
    });

    it("the config start route resolves the seed, stores kind + label, and hands the runtime the seed", async () => {
      const req = { user: { userId: LISTENER } };
      const started = (await controller.startSession(req, {
        preferences: { seed: { kind: "track", id: key("pl1"), label: "spoofed" } },
      })) as { sessionId: string };
      const deadline = Date.now() + 4000;
      while (runtime.run.mock.calls.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(runtime.run.mock.calls[0][0].preferences.seed).toEqual({
        kind: "track",
        id: key("pl1"),
        label: `Lantern ${UNIQ} moss pl1`,
      });
      expect(await filtersOf(started.sessionId)).toMatchObject({
        seed: { kind: "track", label: `Lantern ${UNIQ} moss pl1` },
      });

      await expect(
        controller.startSession(req, { preferences: { seed: { kind: "playlist", id: PLAYLISTS.privateOfOther } } }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.startSession(req, { preferences: { seed: { kind: "bogus", id: "x" } } })).rejects.toMatchObject({
        status: 400,
      });
    });
  });
});
