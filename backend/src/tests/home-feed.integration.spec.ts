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
 *   (d) exploration slice present and flagged, drawn from low-data tracks:
 *       fewer than the audience floor of real listeners, whatever the
 *       popularity tables hold, and one card per release (#2050)
 *   (e) impression rotation: rendered ids enter served history, and a second
 *       render sinks previously-served items to the rail tail
 *   (f) a genuinely COLD user gets the explicit "Catalog signal" rail (or an
 *       honest empty feed) — never disguised personalization
 *   (g) every rail passes the policy stage (#1456, ADR-TE-2): an artist the
 *       listener hid leaves "New from artists you play", and every item
 *       carries a vocabulary reasonCode
 *   (h) a listener whose only taste is a declared boost (#1961) is not cold
 *       (#2006)
 *   (i) browser playback rows (pseudonymous actor id) count as listening, and
 *       a taste reset or the AI DJ training opt-out stops them counting (#2100)
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='home-feed'
 */

import { prisma } from "../db/prisma";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import { EventBus } from "../modules/shared/event_bus";
import { DiscoveryPopularityService } from "../modules/catalog/discovery-popularity.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { DISCOVERY_REASON_CODES } from "../modules/recommendations/discovery-explanations";
import { HomeFeedService } from "../modules/recommendations/home-feed.service";
import { RecommendationsService } from "../modules/recommendations/recommendations.service";
import { TasteMemoryService } from "../modules/recommendations/taste_memory.service";

const TEST_PREFIX = `homefeed_${Date.now()}_`;
const GENRE = `${TEST_PREFIX}amapiano`; // unique genre isolates from parallel suites
const WARM_USER = `${TEST_PREFIX}warm_user`;
const COLD_USER = `${TEST_PREFIX}cold_user`;
const BOOST_USER = `${TEST_PREFIX}boost_user`; // only a declared boost (#2006)
const PLAYS_USER = `${TEST_PREFIX}plays_user`; // only a browser play (#2100)
const RESET_USER = `${TEST_PREFIX}reset_user`; // browser play, then taste reset
const AGENT_USER = `${TEST_PREFIX}agent_user`; // only AI DJ session plays
const TASTE_ARTIST = `${TEST_PREFIX}taste_artist`; // genre-matching catalog
const PLAYED_ARTIST = `${TEST_PREFIX}played_artist`; // artist the warm user plays
const FRESH_ARTIST = `${TEST_PREFIX}fresh_artist`; // low-data exploration source

function newService(options: { tasteAwareRecommendations?: boolean } = {}) {
  const eventBus = new EventBus();
  const tasteMemory = new TasteMemoryService(eventBus);
  // Production wires taste memory into recommendations too; that is how a
  // declared boost reaches matching. Most cases here predate it and keep the
  // narrower wiring.
  const recommendations = new RecommendationsService(
    eventBus,
    new DiscoveryRankingService(),
    options.tasteAwareRecommendations ? tasteMemory : undefined,
  );
  return {
    recommendations,
    tasteMemory,
    homeFeed: new HomeFeedService(
      recommendations,
      new DiscoveryPopularityService(),
      tasteMemory,
    ),
  };
}

describe("Home feed v2 composition (#1454 WS-7)", () => {
  beforeAll(async () => {
    process.env.DISCOVERY_EXPLORATION_COUNT = "3";

    await prisma.user.createMany({
      data: [
        { id: WARM_USER, email: `${WARM_USER}@test.resonate` },
        { id: COLD_USER, email: `${COLD_USER}@test.resonate` },
        { id: BOOST_USER, email: `${BOOST_USER}@test.resonate` },
        { id: PLAYS_USER, email: `${PLAYS_USER}@test.resonate` },
        { id: RESET_USER, email: `${RESET_USER}@test.resonate` },
        { id: AGENT_USER, email: `${AGENT_USER}@test.resonate` },
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
        // Browser playback routes store the pseudonymous id, never the raw one.
        actorId: pseudonymousAnalyticsActorId(WARM_USER),
        payload: { trackId: `${TEST_PREFIX}played_track_${n}` },
        envelope: {},
      })),
    });

    // Warm user's saved preference (the categorical "because" source).
    const { recommendations } = newService();
    await recommendations.setPreferences(WARM_USER, { genres: [GENRE] });
  });

  afterAll(async () => {
    await prisma.listenerTasteMemorySettings.deleteMany({
      where: { userId: { startsWith: TEST_PREFIX } },
    });
    await prisma.listenerTasteSignalControl.deleteMany({
      where: { userId: { startsWith: TEST_PREFIX } },
    });
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

  it("exploration never shows two tracks from one release (#2050)", async () => {
    await prisma.recommendationProfile.update({
      where: { userId: WARM_USER },
      data: { servedTrackIds: [] },
    });
    const { homeFeed } = newService();
    const feed = await homeFeed.getHomeFeed(WARM_USER);
    const exploration = feed.rails.find((rail) => rail.kind === "exploration")!;
    const releaseIds = exploration.items.map((item) => item.releaseId);
    expect(new Set(releaseIds).size).toBe(releaseIds.length);
    // The three-track fresh release fills at most one card.
    expect(
      exploration.items.filter((item) => item.releaseId === `${TEST_PREFIX}fresh_release`).length,
    ).toBeLessThanOrEqual(1);
  });

  it("exploration tests real listening, not a missing popularity row (#2050)", async () => {
    // Two brand-new releases with no TrackPopularity row: one already heard by
    // the audience floor (3 distinct listeners), one heard by a single person.
    const heard = `${TEST_PREFIX}heard_release`;
    const quiet = `${TEST_PREFIX}quiet_release`;
    for (const id of [heard, quiet]) {
      await prisma.release.create({
        data: {
          id,
          artistId: FRESH_ARTIST,
          title: `Release ${id}`,
          status: "ready",
          genre: `${TEST_PREFIX}underground`,
        },
      });
      await prisma.track.create({
        data: { id: `${id}_track`, releaseId: id, title: "Lead", position: 1, explicit: false },
      });
    }
    const play = (track: string, actor: string, n: number) => ({
      eventId: `${TEST_PREFIX}audience_${track}_${n}`,
      eventName: "playback.started",
      eventVersion: 1,
      occurredAt: new Date(),
      receivedAt: new Date(),
      producer: "playback-service",
      environment: "test",
      privacyTier: "pseudonymous",
      consentBasis: "consent",
      subjectType: "track",
      subjectId: track,
      actorId: actor,
      payload: { trackId: track },
      envelope: {},
    });
    await prisma.analyticsEvent.createMany({
      data: [
        ...["a", "b", "c"].map((actor, n) => play(`${heard}_track`, `${TEST_PREFIX}listener_${actor}`, n)),
        play(`${quiet}_track`, `${TEST_PREFIX}listener_a`, 9),
      ],
    });
    expect(await prisma.trackPopularity.count({
      where: { trackId: { in: [`${heard}_track`, `${quiet}_track`] } },
    })).toBe(0);

    await prisma.recommendationProfile.update({
      where: { userId: WARM_USER },
      data: { servedTrackIds: [] },
    });
    const { homeFeed } = newService();
    const feed = await homeFeed.getHomeFeed(WARM_USER);
    const ids = feed.rails.find((rail) => rail.kind === "exploration")!.items.map((item) => item.id);
    expect(ids).not.toContain(`${heard}_track`);
    expect(ids).toContain(`${quiet}_track`);
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

  it("returns the ranker variant label and keeps default behavior without an experiment (#1455)", async () => {
    const previous = process.env.DISCOVERY_RANKER_EXPERIMENT;
    try {
      delete process.env.DISCOVERY_RANKER_EXPERIMENT;
      const { homeFeed } = newService();
      const plain = await homeFeed.getHomeFeed(WARM_USER);
      expect(plain.rankerVariant).toBe("baseline");
      expect(plain.experimentKey).toBeNull();

      process.env.DISCOVERY_RANKER_EXPERIMENT = "ranker_test:candidate=100";
      const assigned = await newService().homeFeed.getHomeFeed(WARM_USER);
      expect(assigned.rankerVariant).toBe("candidate");
      expect(assigned.experimentKey).toBe("ranker_test");
    } finally {
      if (previous === undefined) delete process.env.DISCOVERY_RANKER_EXPERIMENT;
      else process.env.DISCOVERY_RANKER_EXPERIMENT = previous;
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

  it("a declared boost alone lifts a listener out of the cold-start rail (#2006)", async () => {
    const { homeFeed, tasteMemory } = newService({ tasteAwareRecommendations: true });
    await tasteMemory.applyTasteEdits(BOOST_USER, [
      { kind: "boost_genre", signalType: "genre", value: GENRE, action: "boosted" },
    ]);
    const feed = await homeFeed.getHomeFeed(BOOST_USER);
    expect(feed.cold).toBe(false);
    const kinds = feed.rails.map((rail) => rail.kind);
    expect(kinds).not.toContain("catalog_signal");
    // The boost is the only taste signal, and it anchors the personalized rail.
    expect(kinds).toContain("because_genre");

    // Removing the boost returns the listener to the honest cold start.
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: BOOST_USER } });
    const after = await homeFeed.getHomeFeed(BOOST_USER);
    expect(after.cold).toBe(true);
  });

  /** A browser-style playback row: pseudonymous actor id, as production writes it. */
  const browserPlay = (
    eventId: string,
    userId: string,
    payload: Record<string, unknown> = {},
  ) => ({
    eventId: `${TEST_PREFIX}${eventId}`,
    eventName: "playback.started",
    eventVersion: 1,
    occurredAt: new Date(),
    receivedAt: new Date(),
    producer: "backend",
    environment: "test",
    privacyTier: "pseudonymous",
    actorId: pseudonymousAnalyticsActorId(userId),
    payload: { trackId: `${TEST_PREFIX}played_track_1`, ...payload },
    envelope: {},
  });

  it("a browser play alone lifts a listener out of the cold-start rail (#2100)", async () => {
    await prisma.analyticsEvent.create({ data: browserPlay("plays_evt", PLAYS_USER) });
    const { homeFeed } = newService();
    const feed = await homeFeed.getHomeFeed(PLAYS_USER);
    expect(feed.cold).toBe(false);
    const kinds = feed.rails.map((rail) => rail.kind);
    expect(kinds).not.toContain("catalog_signal");
    expect(kinds).toContain("new_from_artists");
  });

  it("a taste reset stops earlier plays counting as taste (#2100)", async () => {
    await prisma.analyticsEvent.create({ data: browserPlay("reset_evt", RESET_USER) });
    const { homeFeed, tasteMemory } = newService();
    expect((await homeFeed.getHomeFeed(RESET_USER)).cold).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await tasteMemory.resetTasteMemory(RESET_USER);
    expect((await homeFeed.getHomeFeed(RESET_USER)).cold).toBe(true);
  });

  it("AI DJ session plays count only while playback training is enabled (#2100)", async () => {
    await prisma.analyticsEvent.create({
      data: browserPlay("agent_evt", AGENT_USER, { agentSessionId: `${TEST_PREFIX}session` }),
    });
    const { homeFeed, tasteMemory } = newService();
    expect((await homeFeed.getHomeFeed(AGENT_USER)).cold).toBe(false);

    await tasteMemory.updateSettings(AGENT_USER, { agentPlaybackTrainingEnabled: false });
    expect((await homeFeed.getHomeFeed(AGENT_USER)).cold).toBe(true);

    await tasteMemory.updateSettings(AGENT_USER, { agentPlaybackTrainingEnabled: true });
    expect((await homeFeed.getHomeFeed(AGENT_USER)).cold).toBe(false);
  });

  it("every rail passes the policy stage: hidden artists leave, every item has a reason", async () => {
    await prisma.recommendationProfile.update({
      where: { userId: WARM_USER },
      data: { servedTrackIds: [] },
    });
    const { homeFeed } = newService();

    const before = await homeFeed.getHomeFeed(WARM_USER);
    const artistsRail = before.rails.find((rail) => rail.kind === "new_from_artists")!;
    expect(artistsRail.items.every((item) => item.artistId === PLAYED_ARTIST)).toBe(true);
    for (const rail of before.rails) {
      for (const item of rail.items) {
        expect(DISCOVERY_REASON_CODES).toContain(item.reasonCode);
        expect(item.explanations.length).toBeGreaterThan(0);
      }
    }
    expect(artistsRail.items[0].reasonCode).toBe("listening_pattern");

    // The listener hides the artist they play: no rail may show it anymore.
    await prisma.listenerTasteSignalControl.create({
      data: {
        userId: WARM_USER,
        signalType: "artist",
        value: PLAYED_ARTIST,
        action: "hidden",
      },
    });
    try {
      await prisma.recommendationProfile.update({
        where: { userId: WARM_USER },
        data: { servedTrackIds: [] },
      });
      const after = await homeFeed.getHomeFeed(WARM_USER);
      expect(after.rails.map((rail) => rail.kind)).not.toContain("new_from_artists");
      const shown = after.rails.flatMap((rail) => rail.items);
      expect(shown.some((item) => item.artistId === PLAYED_ARTIST)).toBe(false);
    } finally {
      await prisma.listenerTasteSignalControl.deleteMany({
        where: { userId: WARM_USER },
      });
    }
  });
});
