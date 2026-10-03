import { prisma } from "../db/prisma";
import { DiscoveryPopularityService } from "../modules/catalog/discovery-popularity.service";
import {
  DISCOVERY_POPULARITY_CACHE_GENERATION_KEY,
  discoveryPopularityConfigFromEnv,
  popularityCacheGeneration,
} from "../modules/catalog/discovery-popularity.math";
import {
  DiscoveryPopularityExportService,
} from "../modules/catalog/discovery-popularity-export.service";
import type { DiscoveryPopularityConfig } from "../modules/catalog/discovery-popularity.math";
import type { DiscoveryPopularityBigQueryClient } from "../modules/catalog/discovery-popularity-export.service";
import { RedisCacheService } from "../modules/shared/redis_cache.service";

const TEST_PREFIX = `popularity_export_${Date.now()}_`;
const USER_ID = `${TEST_PREFIX}user`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const AI_ARTIST_ID = `${TEST_PREFIX}ai_artist`;
const AI_RELEASE_ID = `${TEST_PREFIX}ai_release`;
const AI_TRACK_ID = `${TEST_PREFIX}ai_track`;
const LOW_ARTIST_ID = `${TEST_PREFIX}low_artist`;
const LOW_RELEASE_ID = `${TEST_PREFIX}low_release`;
const LOW_TRACK_ID = `${TEST_PREFIX}low_track`;
const GENRE = `${TEST_PREFIX}ambient`;

function warehouseConfig(): DiscoveryPopularityConfig {
  return discoveryPopularityConfigFromEnv({
    DISCOVERY_POPULARITY_SOURCE: "warehouse",
    DISCOVERY_POPULARITY_BIGQUERY_PROJECT_ID: "test-project",
    DISCOVERY_POPULARITY_BIGQUERY_DATASET: "test_dataset",
    DISCOVERY_POPULARITY_EXPORT_ROW_LIMIT: "100",
  });
}

function row(
  id: string,
  genre = "",
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    track_id: id,
    window: "7d",
    genre,
    score: 42,
    plays: 10,
    unique_listeners: 3,
    saves: 2,
    purchases: 1,
    ...overrides,
  };
}

function artistRow(
  id: string,
  genre = "",
  overrides: Partial<Record<string, unknown>> = {},
) {
  const { track_id: _ignored, ...common } = row(id, genre, overrides);
  return { artist_id: id, ...common };
}

function fakeMarts(
  trackRows: Record<string, unknown>[],
  artistRows: Record<string, unknown>[],
  timestamps: { snapshot?: string; tracks?: string; artists?: string } = {},
): DiscoveryPopularityBigQueryClient {
  const current = new Date().toISOString();
  const trackSnapshot = trackRows.map((row) => ({
    computed_at: timestamps.tracks ?? current,
    ...row,
  }));
  const artistSnapshot = artistRows.map((row) => ({
    computed_at: timestamps.artists ?? current,
    ...row,
  }));
  const metadataRows = [{
    computed_at: timestamps.snapshot ?? current,
    track_rows: trackSnapshot.length,
    artist_rows: artistSnapshot.length,
  }];
  return {
    async readMart(_tableName, mart) {
      if (mart === "track") return trackSnapshot;
      if (mart === "artist") return artistSnapshot;
      return metadataRows;
    },
  };
}

describe("warehouse discovery popularity export (real Postgres + Redis)", () => {
  const redisCache = new RedisCacheService();
  const secondRedisCache = new RedisCacheService();

  beforeAll(async () => {
    process.env.DISCOVERY_MIN_AUDIENCE = "3";
    process.env.DISCOVERY_POPULARITY_SOURCE = "local";
    await redisCache.del(DISCOVERY_POPULARITY_CACHE_GENERATION_KEY);

    await prisma.user.create({ data: { id: USER_ID, email: `${USER_ID}@test.resonate` } });
    await prisma.artist.create({ data: { id: ARTIST_ID, displayName: "Credited Artist" } });
    await prisma.artist.create({ data: { id: AI_ARTIST_ID, displayName: "AI Artist" } });
    await prisma.artist.create({ data: { id: LOW_ARTIST_ID, displayName: "Low Audience Artist" } });
    await prisma.release.create({
      data: {
        id: RELEASE_ID,
        artistId: ARTIST_ID,
        title: "Human release",
        status: "ready",
        genre: GENRE,
        primaryArtist: "Credited Artist",
        artistCredits: {
          create: { artistId: ARTIST_ID, role: "main", displayName: "Credited Artist", identityStatus: "selected" },
        },
      },
    });
    await prisma.release.create({
      data: {
        id: AI_RELEASE_ID,
        artistId: AI_ARTIST_ID,
        title: "AI release",
        status: "ready",
        genre: GENRE,
        primaryArtist: "AI Artist",
        artistCredits: {
          create: { artistId: AI_ARTIST_ID, role: "main", displayName: "AI Artist", identityStatus: "selected" },
        },
      },
    });
    await prisma.release.create({
      data: {
        id: LOW_RELEASE_ID,
        artistId: LOW_ARTIST_ID,
        title: "Low audience release",
        status: "ready",
        genre: GENRE,
      },
    });
    await prisma.track.create({
      data: { id: TRACK_ID, releaseId: RELEASE_ID, title: "Human track", position: 1, explicit: false, artist: "Credited Artist", aiDisclosureLevel: "NONE" },
    });
    await prisma.track.create({
      data: { id: AI_TRACK_ID, releaseId: AI_RELEASE_ID, title: "AI track", position: 1, explicit: false, artist: "AI Artist", aiDisclosureLevel: "ALL" },
    });
    await prisma.track.create({
      data: { id: LOW_TRACK_ID, releaseId: LOW_RELEASE_ID, title: "Low audience track", position: 1, explicit: false },
    });

    await prisma.trackPopularity.create({
      data: {
        trackId: TRACK_ID,
        window: "7d",
        genre: "",
        score: 1,
        plays: 1,
        uniqueListeners: 3,
        saves: 0,
        purchases: 0,
      },
    });
    await prisma.artistEngagement.create({
      data: {
        artistId: ARTIST_ID,
        window: "7d",
        genre: "",
        score: 1,
        plays: 1,
        uniqueListeners: 3,
        saves: 0,
        purchases: 0,
      },
    });
  });

  afterAll(async () => {
    await prisma.trackPopularity.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } });
    await prisma.artistEngagement.deleteMany({ where: { artistId: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await redisCache.del(DISCOVERY_POPULARITY_CACHE_GENERATION_KEY);
    await redisCache.onModuleDestroy();
    await secondRedisCache.onModuleDestroy();
  });

  it("atomically replaces both marts, filters fully AI rows, and invalidates shared caches", async () => {
    const oldGeneration = await popularityCacheGeneration(redisCache);
    const firstService = new DiscoveryPopularityService(redisCache);
    const previousResult = await firstService.getTrendingTracks({ window: "7d", limit: 1 }) as {
      items: Array<{ score: number }>;
    };
    expect(previousResult.items[0]?.score).toBe(1);

    const exporter = new DiscoveryPopularityExportService(
      redisCache,
      warehouseConfig(),
      fakeMarts(
        [
          row(TRACK_ID),
          row(TRACK_ID, GENRE),
          row(AI_TRACK_ID, "", { score: 100, unique_listeners: 5 }),
        ],
        [
          artistRow(ARTIST_ID),
          artistRow(ARTIST_ID, GENRE),
          artistRow(AI_ARTIST_ID, "", { score: 100, unique_listeners: 5 }),
        ],
      ),
    );
    await expect(exporter.refreshFromWarehouse()).resolves.toMatchObject({ trackRows: 2, artistRows: 2 });
    const newGeneration = await popularityCacheGeneration(redisCache);
    expect(newGeneration).not.toBe(oldGeneration);

    const snapshot = await prisma.trackPopularity.findMany({
      where: { trackId: { startsWith: TEST_PREFIX } },
      orderBy: { genre: "asc" },
    });
    expect(snapshot).toHaveLength(2);
    expect(snapshot.every((item) => item.score === 42)).toBe(true);
    expect(await prisma.trackPopularity.count({ where: { trackId: AI_TRACK_ID } })).toBe(0);
    expect(await prisma.artistEngagement.count({ where: { artistId: AI_ARTIST_ID } })).toBe(0);

    const secondService = new DiscoveryPopularityService(secondRedisCache);
    const refreshedResult = await secondService.getTrendingTracks({ window: "7d", limit: 1 }) as {
      items: Array<{ score: number }>;
    };
    expect(refreshedResult.items[0]?.score).toBe(42);

    await prisma.trackPopularity.create({
      data: {
        trackId: LOW_TRACK_ID,
        window: "7d",
        genre: GENRE,
        score: 999,
        plays: 999,
        uniqueListeners: 2,
        saves: 0,
        purchases: 0,
      },
    });
    await prisma.artistEngagement.create({
      data: {
        artistId: LOW_ARTIST_ID,
        window: "7d",
        genre: GENRE,
        score: 999,
        plays: 999,
        uniqueListeners: 2,
        saves: 0,
        purchases: 0,
      },
    });
    const thresholdResult = await secondService.getTrendingTracks({ window: "7d", genre: GENRE, limit: 2 }) as {
      items: Array<{ trackId: string }>;
    };
    expect(thresholdResult.items.map((item) => item.trackId)).toEqual([TRACK_ID]);

    const artistThresholdResult = await secondService.getTopArtists({ window: "7d", genre: GENRE, limit: 2 }) as {
      items: Array<{ artistId: string }>;
    };
    expect(artistThresholdResult.items.map((item) => item.artistId)).toEqual([ARTIST_ID]);

    await prisma.trackPopularity.update({
      where: { trackId_window_genre: { trackId: LOW_TRACK_ID, window: "7d", genre: GENRE } },
      data: { uniqueListeners: 4, computedAt: new Date(Date.now() - 121 * 60_000) },
    });
    await prisma.artistEngagement.update({
      where: { artistId_window_genre: { artistId: LOW_ARTIST_ID, window: "7d", genre: GENRE } },
      data: { uniqueListeners: 4, computedAt: new Date(Date.now() - 121 * 60_000) },
    });
    const freshTrackRows = await secondService.getTrendingTracks({ window: "7d", genre: GENRE, limit: 3 }) as {
      items: Array<{ trackId: string }>;
    };
    expect(freshTrackRows.items.map((item) => item.trackId)).toEqual([TRACK_ID]);
    const freshArtistRows = await secondService.getTopArtists({ window: "7d", genre: GENRE, limit: 3 }) as {
      items: Array<{ artistId: string }>;
    };
    expect(freshArtistRows.items.map((item) => item.artistId)).toEqual([ARTIST_ID]);
  });

  it("rejects incomplete or below-threshold marts before changing the current snapshot", async () => {
    const exporter = (client: DiscoveryPopularityBigQueryClient) =>
      new DiscoveryPopularityExportService(redisCache, warehouseConfig(), client);
    const before = await prisma.trackPopularity.findUnique({
      where: { trackId_window_genre: { trackId: TRACK_ID, window: "7d", genre: "" } },
    });
    expect(before?.score).toBe(42);

    await expect(exporter({
      async readMart() {
        throw new Error("BigQuery result was incomplete");
      },
    }).refreshFromWarehouse()).rejects.toThrow("BigQuery result was incomplete");

    await expect(exporter(fakeMarts(
      [row(TRACK_ID, "", { unique_listeners: 2 })],
      [artistRow(ARTIST_ID)],
    )).refreshFromWarehouse()).rejects.toThrow("below minimum audience 3");

    const staleTimestamp = new Date(Date.now() - 121 * 60_000).toISOString();
    await expect(exporter(fakeMarts(
      [row(TRACK_ID)],
      [artistRow(ARTIST_ID)],
      { tracks: staleTimestamp },
    )).refreshFromWarehouse()).rejects.toThrow("older than 120 minutes");

    const after = await prisma.trackPopularity.findUnique({
      where: { trackId_window_genre: { trackId: TRACK_ID, window: "7d", genre: "" } },
    });
    expect(after?.score).toBe(42);
  });
});
