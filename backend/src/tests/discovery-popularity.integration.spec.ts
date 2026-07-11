/**
 * True Trending & Top Artists serving — Integration (#1451 WS-4)
 *
 * Real Prisma. Covers the WS-4 acceptance criteria:
 *   (a) refresh() aggregates local AnalyticsEvent facts into the WS-3
 *       serving tables (TrackPopularity / ArtistEngagement) with
 *       completion-weighted, time-decayed scores and unique listeners
 *   (b) minimum-audience honesty: tracks/artists below
 *       DISCOVERY_MIN_AUDIENCE unique listeners are NEVER written, so the
 *       endpoints return an empty list instead of a fake chart
 *   (c) genre dimension: per-genre rows re-rank independently of overall
 *   (d) getTrendingTracks / getTopArtists return ranked, hydrated items
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='discovery-popularity'
 */

import { prisma } from "../db/prisma";
import { DiscoveryPopularityService } from "../modules/catalog/discovery-popularity.service";

const TEST_PREFIX = `pop_${Date.now()}_`;
const GENRE = `${TEST_PREFIX}hiphop`; // unique genre isolates rank assertions
const QUIET_GENRE = `${TEST_PREFIX}jazz`; // below-threshold everywhere
const USER_ID = `${TEST_PREFIX}owner`;
const HOT_ARTIST = `${TEST_PREFIX}hot_artist`;
const QUIET_ARTIST = `${TEST_PREFIX}quiet_artist`;
const HOT_RELEASE = `${TEST_PREFIX}hot_release`;
const QUIET_RELEASE = `${TEST_PREFIX}quiet_release`;
const TRACK_A = `${TEST_PREFIX}track_a`; // 4 listeners, full completions
const TRACK_B = `${TEST_PREFIX}track_b`; // 3 listeners + a playlist save
const TRACK_C = `${TEST_PREFIX}track_c`; // 2 listeners — below threshold

let eventSeq = 0;
async function seedEvent(
  eventName: string,
  trackId: string,
  actorId: string,
  payloadExtra: Record<string, unknown> = {},
) {
  eventSeq += 1;
  await prisma.analyticsEvent.create({
    data: {
      eventId: `${TEST_PREFIX}evt_${eventSeq}`,
      eventName,
      eventVersion: 1,
      occurredAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago — in-window
      receivedAt: new Date(),
      producer: "backend",
      environment: "test",
      privacyTier: "internal",
      actorId,
      payload: { trackId, ...payloadExtra },
      envelope: {},
    },
  });
}

describe("Discovery popularity serving (#1451 WS-4)", () => {
  const service = new DiscoveryPopularityService();

  beforeAll(async () => {
    process.env.DISCOVERY_MIN_AUDIENCE = "3";

    await prisma.user.create({
      data: { id: USER_ID, email: `${USER_ID}@test.resonate` },
    });
    await prisma.artist.create({
      data: { id: HOT_ARTIST, displayName: "Hot Artist" },
    });
    await prisma.artist.create({
      data: { id: QUIET_ARTIST, displayName: "Quiet Artist" },
    });
    await prisma.release.create({
      data: {
        id: HOT_RELEASE,
        artistId: HOT_ARTIST,
        title: "Hot Release",
        status: "ready",
        genre: GENRE,
      },
    });
    await prisma.release.create({
      data: {
        id: QUIET_RELEASE,
        artistId: QUIET_ARTIST,
        title: "Quiet Release",
        status: "ready",
        genre: QUIET_GENRE,
      },
    });
    await prisma.track.createMany({
      data: [
        { id: TRACK_A, releaseId: HOT_RELEASE, title: "Anthem", position: 1, explicit: false },
        { id: TRACK_B, releaseId: HOT_RELEASE, title: "Deep Cut", position: 2, explicit: false },
        { id: TRACK_C, releaseId: QUIET_RELEASE, title: "Quiet Tune", position: 1, explicit: false },
      ],
    });

    // TRACK_A: 4 unique listeners, full completions → strongest score.
    for (const listener of ["l1", "l2", "l3", "l4"]) {
      await seedEvent("playback.completed", TRACK_A, `${TEST_PREFIX}${listener}`, {
        completionRatio: 1,
      });
    }
    // TRACK_B: 3 unique listeners with partial completions + one save.
    for (const listener of ["l1", "l2", "l3"]) {
      await seedEvent("playback.completed", TRACK_B, `${TEST_PREFIX}${listener}`, {
        completionRatio: 0.5,
      });
    }
    await seedEvent("playlist.track_added", TRACK_B, `${TEST_PREFIX}l1`);
    // TRACK_C: only 2 unique listeners — must stay below the threshold.
    for (const listener of ["l1", "l2"]) {
      await seedEvent("playback.completed", TRACK_C, `${TEST_PREFIX}${listener}`, {
        completionRatio: 1,
      });
    }

    await service.refresh("7d");
  });

  afterAll(async () => {
    await prisma.trackPopularity.deleteMany({
      where: { trackId: { startsWith: TEST_PREFIX } },
    });
    await prisma.artistEngagement.deleteMany({
      where: { artistId: { startsWith: TEST_PREFIX } },
    });
    await prisma.analyticsEvent.deleteMany({
      where: { eventId: { startsWith: TEST_PREFIX } },
    });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  it("writes serving rows for qualifying tracks (overall + genre dimension)", async () => {
    const overall = await prisma.trackPopularity.findUnique({
      where: { trackId_window_genre: { trackId: TRACK_A, window: "7d", genre: "" } },
    });
    const genreRow = await prisma.trackPopularity.findUnique({
      where: { trackId_window_genre: { trackId: TRACK_A, window: "7d", genre: GENRE } },
    });
    expect(overall).not.toBeNull();
    expect(genreRow).not.toBeNull();
    expect(overall!.uniqueListeners).toBe(4);
    expect(overall!.plays).toBe(4);
    expect(genreRow!.score).toBeCloseTo(overall!.score, 6);
  });

  it("never writes rows below the minimum-audience threshold", async () => {
    const trackRows = await prisma.trackPopularity.findMany({
      where: { trackId: TRACK_C },
    });
    const artistRows = await prisma.artistEngagement.findMany({
      where: { artistId: QUIET_ARTIST },
    });
    expect(trackRows).toHaveLength(0);
    expect(artistRows).toHaveLength(0);
  });

  it("counts playlist saves into score and the saves column", async () => {
    const row = await prisma.trackPopularity.findUnique({
      where: { trackId_window_genre: { trackId: TRACK_B, window: "7d", genre: "" } },
    });
    expect(row).not.toBeNull();
    expect(row!.saves).toBe(1);
    expect(row!.uniqueListeners).toBe(3);
  });

  it("getTrendingTracks returns ranked hydrated items for the genre", async () => {
    const result = (await service.getTrendingTracks({
      window: "7d",
      genre: GENRE,
      limit: 10,
    })) as { items: any[]; genre: string | null; minimumAudience: number };
    expect(result.genre).toBe(GENRE);
    expect(result.minimumAudience).toBe(3);
    expect(result.items.map((item) => item.trackId)).toEqual([TRACK_A, TRACK_B]);
    expect(result.items[0]).toMatchObject({
      rank: 1,
      title: "Anthem",
      artistId: HOT_ARTIST,
      releaseId: HOT_RELEASE,
      uniqueListeners: 4,
    });
    expect(result.items[0].score).toBeGreaterThan(result.items[1].score);
  });

  it("getTrendingTracks is honestly empty for a below-threshold genre", async () => {
    const result = (await service.getTrendingTracks({
      window: "7d",
      genre: QUIET_GENRE,
    })) as { items: any[] };
    expect(result.items).toHaveLength(0);
  });

  it("getTopArtists rolls tracks up per artist with unioned listeners", async () => {
    const result = (await service.getTopArtists({
      window: "7d",
      genre: GENRE,
    })) as { items: any[] };
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      rank: 1,
      artistId: HOT_ARTIST,
      name: "Hot Artist",
      // 4 listeners on A ∪ 3 on B (same actor ids) = 4, not 7
      uniqueListeners: 4,
    });
  });

  it("re-refresh replaces the window snapshot instead of accumulating", async () => {
    await service.refresh("7d");
    const rows = await prisma.trackPopularity.findMany({
      where: { trackId: TRACK_A, window: "7d" },
    });
    // exactly one overall + one genre row — no duplicates after second run
    expect(rows).toHaveLength(2);
  });
});
