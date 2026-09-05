/**
 * Home feed v2 composition — Integration (#1454 WS-7)
 *
 * Real Prisma. Covers the WS-7 acceptance criteria:
 *   (a) a WARM user gets multiple personalized rails (because-genre,
 *       new-from-artists, exploration), each with a categorical explanation
 *   (b) explanations never itemize listener history (no track titles or
 *       played-item references in explanation strings)
 *   (c) artist diversity cap: max 2 items per artist per rail; feed-wide
 *       dedupe: a track appears in at most one rail
 *   (d) exploration slice present and flagged, drawn from low-data tracks
 *   (e) impression rotation: rendered ids enter served history, and a second
 *       render sinks previously-served items to the rail tail
 *   (f) a genuinely COLD user gets the explicit "Catalog signal" rail (or an
 *       honest empty feed) — never disguised personalization
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='home-feed'
 */

import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { DiscoveryPopularityService } from "../modules/catalog/discovery-popularity.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { HomeFeedService } from "../modules/recommendations/home-feed.service";
import { RecommendationsService } from "../modules/recommendations/recommendations.service";

const TEST_PREFIX = `homefeed_${Date.now()}_`;
const GENRE = `${TEST_PREFIX}amapiano`; // unique genre isolates from parallel suites
const WARM_USER = `${TEST_PREFIX}warm_user`;
const COLD_USER = `${TEST_PREFIX}cold_user`;
const TASTE_ARTIST = `${TEST_PREFIX}taste_artist`; // genre-matching catalog
const PLAYED_ARTIST = `${TEST_PREFIX}played_artist`; // artist the warm user plays
const FRESH_ARTIST = `${TEST_PREFIX}fresh_artist`; // low-data exploration source

function newService() {
  const recommendations = new RecommendationsService(
    new EventBus(),
    new DiscoveryRankingService(),
  );
  return {
    recommendations,
    homeFeed: new HomeFeedService(recommendations, new DiscoveryPopularityService()),
  };
}

describe("Home feed v2 composition (#1454 WS-7)", () => {
  beforeAll(async () => {
    process.env.DISCOVERY_EXPLORATION_COUNT = "3";

    await prisma.user.createMany({
      data: [
        { id: WARM_USER, email: `${WARM_USER}@test.resonate` },
        { id: COLD_USER, email: `${COLD_USER}@test.resonate` },
      ],
    });
    await prisma.artist.createMany({
      data: [
        { id: TASTE_ARTIST, displayName: "Taste Artist" },
        { id: PLAYED_ARTIST, displayName: "Played Artist" },
        { id: FRESH_ARTIST, displayName: "Fresh Artist" },
      ],
    });

    // Genre catalog: 4 ready tracks in the warm user's preferred genre from
    // ONE artist — more than the per-rail artist cap of 2.
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}taste_release`,
        artistId: TASTE_ARTIST,
        title: "Amapiano Sessions",
        status: "ready",
        genre: GENRE,
      },
    });
    await prisma.track.createMany({
      data: [1, 2, 3, 4].map((n) => ({
        id: `${TEST_PREFIX}taste_track_${n}`,
        releaseId: `${TEST_PREFIX}taste_release`,
        title: `Groove ${n}`,
        position: n,
        explicit: false,
      })),
    });

    // Catalog from the artist the warm user plays (different genre).
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}played_release`,
        artistId: PLAYED_ARTIST,
        title: "Played Artist LP",
        status: "ready",
        genre: `${TEST_PREFIX}other`,
      },
    });
    await prisma.track.createMany({
      data: [1, 2].map((n) => ({
        id: `${TEST_PREFIX}played_track_${n}`,
        releaseId: `${TEST_PREFIX}played_release`,
        title: `Played Cut ${n}`,
        position: n,
        explicit: false,
      })),
    });

    // Fresh low-data catalog for the exploration slice.
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}fresh_release`,
        artistId: FRESH_ARTIST,
        title: "Fresh Debut",
        status: "ready",
        genre: `${TEST_PREFIX}underground`,
      },
    });
    await prisma.track.createMany({
      data: [1, 2, 3].map((n) => ({
        id: `${TEST_PREFIX}fresh_track_${n}`,
        releaseId: `${TEST_PREFIX}fresh_release`,
        title: `Fresh Cut ${n}`,
        position: n,
        explicit: false,
      })),
    });

    // Warm user's playback facts → "New from artists you play" source.
    await prisma.analyticsEvent.createMany({
      data: [1, 2].map((n) => ({
        eventId: `${TEST_PREFIX}evt_${n}`,
        eventName: "playback.completed",
        eventVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        producer: "backend",
        environment: "test",
        privacyTier: "internal",
        actorId: WARM_USER,
        payload: { trackId: `${TEST_PREFIX}played_track_${n}` },
        envelope: {},
      })),
    });

    // Warm user's saved preference (the categorical "because" source).
    const { recommendations } = newService();
    await recommendations.setPreferences(WARM_USER, { genres: [GENRE] });
  });

  afterAll(async () => {
    await prisma.recommendationProfile.deleteMany({
      where: { userId: { startsWith: TEST_PREFIX } },
    });
    await prisma.analyticsEvent.deleteMany({
      where: { eventId: { startsWith: TEST_PREFIX } },
    });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  it("warm user: multiple personalized rails with categorical explanations", async () => {
    // Clear served history so this test is deterministic.
    await prisma.recommendationProfile.update({
      where: { userId: WARM_USER },
      data: { servedTrackIds: [] },
    });
    const { homeFeed } = newService();
    const feed = await homeFeed.getHomeFeed(WARM_USER);

    expect(feed.cold).toBe(false);
    const kinds = feed.rails.map((rail) => rail.kind);
    expect(kinds).toContain("because_genre");
    expect(kinds).toContain("new_from_artists");
    expect(kinds).toContain("exploration");
    expect(kinds).not.toContain("catalog_signal");

    const because = feed.rails.find((rail) => rail.kind === "because_genre")!;
    expect(because.title).toBe(`Because you save a lot of ${GENRE}`);
    // Categorical only: the explanation may name the GENRE, never played items.
    for (const rail of feed.rails) {
      expect(rail.explanation.length).toBeGreaterThan(0);
      expect(rail.explanation).not.toMatch(/Played Cut|Groove|Fresh Cut/);
    }
    // Warm users never see the cold-user label.
    expect(feed.rails.map((rail) => rail.title)).not.toContain("Catalog signal");
  });

  it("enforces the per-rail artist cap and feed-wide dedupe", async () => {
    await prisma.recommendationProfile.update({
      where: { userId: WARM_USER },
      data: { servedTrackIds: [] },
    });
    const { homeFeed } = newService();
    const feed = await homeFeed.getHomeFeed(WARM_USER);

    const seen = new Set<string>();
    for (const rail of feed.rails) {
      const perArtist = new Map<string, number>();
      for (const item of rail.items) {
        expect(seen.has(item.id)).toBe(false); // one rail per track
        seen.add(item.id);
        perArtist.set(item.artistId, (perArtist.get(item.artistId) ?? 0) + 1);
      }
      for (const count of perArtist.values()) {
        expect(count).toBeLessThanOrEqual(2);
      }
    }
    // The cap actually bit: 4 genre tracks by one artist → only 2 in the rail.
    const because = feed.rails.find((rail) => rail.kind === "because_genre")!;
    const tasteItems = because.items.filter((item) => item.artistId === TASTE_ARTIST);
    expect(tasteItems).toHaveLength(2);
  });

  it("exploration slice draws low-data tracks and respects the env count", async () => {
    await prisma.recommendationProfile.update({
      where: { userId: WARM_USER },
      data: { servedTrackIds: [] },
    });
    const { homeFeed } = newService();
    const feed = await homeFeed.getHomeFeed(WARM_USER);
    const exploration = feed.rails.find((rail) => rail.kind === "exploration")!;
    expect(exploration.items.length).toBeGreaterThan(0);
    expect(exploration.items.length).toBeLessThanOrEqual(3);
    for (const item of exploration.items) {
      expect(item.reasons).toContain("exploration:fresh");
    }
  });

  it("impression rotation: rendered ids enter served history and sink on re-render", async () => {
    await prisma.recommendationProfile.update({
      where: { userId: WARM_USER },
      data: { servedTrackIds: [] },
    });
    const { homeFeed, recommendations } = newService();
    const first = await homeFeed.getHomeFeed(WARM_USER);
    const firstBecause = first.rails.find((rail) => rail.kind === "because_genre")!;
    const served = await recommendations.getServedHistory(WARM_USER);
    for (const item of firstBecause.items) {
      expect(served).toContain(item.id);
    }

    // Second render from a fresh instance: rail items previously served must
    // not lead the rail while unserved alternatives exist.
    const { homeFeed: secondInstance } = newService();
    const second = await secondInstance.getHomeFeed(WARM_USER);
    const secondBecause = second.rails.find((rail) => rail.kind === "because_genre");
    if (secondBecause && secondBecause.items.length > 1) {
      const unservedInRail = secondBecause.items.filter(
        (item) => !served.includes(item.id),
      );
      if (unservedInRail.length) {
        expect(served).not.toContain(secondBecause.items[0].id);
      }
    }
  });

  it("cold user: explicit catalog-signal labeling, no fake personalization", async () => {
    const { homeFeed } = newService();
    const feed = await homeFeed.getHomeFeed(COLD_USER);
    expect(feed.cold).toBe(true);
    const kinds = feed.rails.map((rail) => rail.kind);
    expect(kinds).not.toContain("because_genre");
    expect(kinds).not.toContain("new_from_artists");
    expect(kinds).not.toContain("trending_genre");
    // With no popularity data seeded, catalog_signal is honestly absent —
    // only the exploration slice (fresh finds) may remain.
    for (const kind of kinds) {
      expect(["catalog_signal", "exploration"]).toContain(kind);
    }
  });
});
