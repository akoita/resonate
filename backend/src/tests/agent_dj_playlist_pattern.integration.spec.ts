/**
 * A playlist seed follows the playlist's whole pattern, not only its two most
 * common genres, against real Postgres/pgvector (Testcontainers). The offline
 * hash embedder is lexical, so each genre's fixture tracks share a distinctive
 * word: tracks of one pocket sound alike, and unlike the other pockets.
 *
 * The playlist: 6 house, 3 jazz, 2 afrobeats and 1 metal track. Before, the
 * seed kept house and jazz only; now every genre on at least 10% of the
 * playlist (house, jazz, afrobeats) is a pocket with its share of the
 * candidates, and the metal one-off is not.
 */
import { prisma } from "../db/prisma";
import { ToolRegistry, PLAYLIST_SEED_OWN_TRACKS } from "../modules/agents/tools/tool_registry";
import { TrackDescriptorTagger } from "../modules/descriptors/track_descriptor_tagger";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";
import { TrackEmbeddingService } from "../modules/embeddings/track_embedding.service";

const TEST_PREFIX = `pattern_${Date.now()}_`;
const UNIQ = `zp${Date.now().toString(36)}`;
const LISTENER = `${TEST_PREFIX}listener`;
const UPLOADER = `${TEST_PREFIX}uploader`;
const PLAYLIST = `${TEST_PREFIX}playlist`;
const key = (name: string) => `${TEST_PREFIX}${name}`;

type Genre = "house" | "jazz" | "afro" | "metal";
const GENRES: Record<Genre, { genre: string; word: string; moods: string[] }> = {
  house: { genre: "Deep House", word: `lantern${UNIQ}`, moods: ["Hypnotic"] },
  jazz: { genre: "Jazz", word: `velvet${UNIQ}`, moods: ["Chill"] },
  afro: { genre: "Afrobeats", word: `sunlit${UNIQ}`, moods: ["Warm"] },
  metal: { genre: "Death Metal", word: `quarry${UNIQ}`, moods: ["Aggressive"] },
};
const names = (genre: Genre, prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}_${genre}${index + 1}`);
// In the playlist.
const inPlaylist = [...names("house", "pl", 6), ...names("jazz", "pl", 3), ...names("afro", "pl", 2), ...names("metal", "pl", 1)];
// In the catalog, not in the playlist.
const outside = [...names("house", "cat", 6), ...names("jazz", "cat", 4), ...names("afro", "cat", 4), ...names("metal", "cat", 3)];
const genreOf = (name: string): Genre => (Object.keys(GENRES) as Genre[]).find((genre) => name.includes(`_${genre}`))!;

describe("playlist seed follows the playlist's pattern (integration)", () => {
  const embeddingService = new EmbeddingService();
  const store = new EmbeddingStore();
  const trackEmbeddings = new TrackEmbeddingService(embeddingService, store);
  const tools = new ToolRegistry(embeddingService, store, undefined, trackEmbeddings);
  const original = {
    provider: process.env.TRACK_EMBEDDING_PROVIDER,
    floor: process.env.AGENT_SEMANTIC_MIN_SIMILARITY,
  };
  const seed = (input: Record<string, unknown> = {}) =>
    tools.get("catalog.playlist_seed").run({
      playlistId: PLAYLIST,
      userId: LISTENER,
      limit: 20,
      calibratedFloor: true,
      allowExplicit: false,
      ...input,
    });
  const ours = (items: unknown) =>
    (items as Array<{ id: string; playlistSeed: string }>)
      .filter((item) => item.id.startsWith(TEST_PREFIX))
      .map((item) => ({ ...item, name: item.id.slice(TEST_PREFIX.length) }));

  beforeAll(async () => {
    process.env.TRACK_EMBEDDING_PROVIDER = "hash";
    delete process.env.AGENT_SEMANTIC_MIN_SIMILARITY;
    await prisma.user.createMany({
      data: [
        { id: LISTENER, email: `${LISTENER}@test.resonate` },
        { id: UPLOADER, email: `${UPLOADER}@test.resonate` },
      ],
    });
    await prisma.artist.create({
      data: { id: `${TEST_PREFIX}artist`, userId: UPLOADER, displayName: "Pattern uploader", payoutAddress: `0x${"e".repeat(40)}` },
    });
    const all = [...inPlaylist, ...outside];
    const newest = Date.now() + 120_000;
    await prisma.release.createMany({
      data: all.map((name, index) => {
        const genre = GENRES[genreOf(name)];
        return {
          id: key(`rel_${name}`),
          artistId: `${TEST_PREFIX}artist`,
          title: `${genre.word} ${name}`,
          primaryArtist: `Artist ${name}`,
          genre: genre.genre,
          moods: genre.moods,
          status: "published",
          createdAt: new Date(newest - index * 1000),
        };
      }),
    });
    await prisma.track.createMany({
      data: all.map((name, index) => ({
        id: key(name),
        releaseId: key(`rel_${name}`),
        title: `${GENRES[genreOf(name)].word} ${GENRES[genreOf(name)].word} ${name}`,
        artist: `Artist ${name}`,
        position: 1,
        createdAt: new Date(newest - index * 1000),
      })),
    });
    await new TrackDescriptorTagger({ env: {} }).tagTracks(all.map(key), { apply: true });
    await trackEmbeddings.embedTracks(all.map(key));
    await prisma.playlist.create({
      data: { id: PLAYLIST, userId: LISTENER, name: "Mixed bag", visibility: "private", trackIds: inPlaylist.map(key) },
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
    await prisma.playlist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.trackEmbedding.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.trackDescriptor.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [LISTENER, UPLOADER] } } }).catch(() => {});
  });

  it("covers every genre on a fair share of the playlist, a third genre included, and not a one-off", async () => {
    const result = await seed();
    expect(result.status).toBe("ok");
    const others = ours(result.items).filter((item) => item.playlistSeed !== "own");
    const genres = new Set(others.map((item) => genreOf(item.name)));
    expect(genres).toEqual(new Set<Genre>(["house", "jazz", "afro"]));
    // The playlist is still not replayed.
    expect(others.every((item) => item.name.startsWith("cat_"))).toBe(true);
  });

  it("keeps the playlist's mix in the order, so a short batch still holds each genre", async () => {
    const result = await seed({ limit: 6 + PLAYLIST_SEED_OWN_TRACKS });
    const others = ours(result.items).filter((item) => item.playlistSeed !== "own");
    expect(others.length).toBeGreaterThanOrEqual(5);
    const count = (genre: Genre) => others.filter((item) => genreOf(item.name) === genre).length;
    expect(count("house")).toBeGreaterThanOrEqual(1);
    expect(count("jazz")).toBeGreaterThanOrEqual(1);
    expect(count("afro")).toBeGreaterThanOrEqual(1);
    // House holds the largest share of the playlist, so it leads the batch.
    expect(count("house")).toBeGreaterThanOrEqual(count("jazz"));
    expect(count("metal")).toBe(0);
  });

  it("takes the playlist's own tracks across its genres, not only from the largest one", async () => {
    const result = await seed();
    const own = ours(result.items).filter((item) => item.playlistSeed === "own");
    expect(own.length).toBe(PLAYLIST_SEED_OWN_TRACKS);
    expect(new Set(own.map((item) => genreOf(item.name))).size).toBeGreaterThan(1);
  });
});
