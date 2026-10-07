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
 *   (j) the listening rail (#2101): learned top genre that is not declared adds
 *       "Because you've been playing X" after the declared rail, never replaces
 *       it, needs 5 positive signals, and stays out when listening agrees with
 *       what the listener declared
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='home-feed'
 */

import { prisma } from "../db/prisma";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import { EventBus } from "../modules/shared/event_bus";
import { DiscoveryPopularityService } from "../modules/catalog/discovery-popularity.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import {
  DISCOVERY_EXPLANATIONS,
  DISCOVERY_REASON_CODES,
} from "../modules/recommendations/discovery-explanations";
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

describe("Home feed listening rail (#2101)", () => {
  const P = `homelisten_${Date.now()}_`;
  const DECLARED = `${P}jazz`;
  const LISTENING = `${P}techno`;
  const TREND_ONLY = `${P}trendgenre`;
  const DECLARED_USER = `${P}declared_user`; // declared jazz (prefs), plays techno
  const BOOST_LISTENER = `${P}boost_user`; // declared jazz (boost), plays techno
  const AGREE_USER = `${P}agree_user`; // declared techno, plays techno
  const PLAY_ONLY_USER = `${P}play_only_user`; // nothing declared, plays techno
  const THIN_USER = `${P}thin_user`; // declared jazz, only 4 positive signals
  const HIDDEN_USER = `${P}hidden_user`; // hides techno
  const DOWNRANK_USER = `${P}downrank_user`; // declared jazz, plays techno, asked for less techno
  const JAZZ_ARTIST = `${P}jazz_artist`;
  const TECHNO_ARTIST_A = `${P}techno_artist_a`;
  const TECHNO_ARTIST_B = `${P}techno_artist_b`;
  const TREND_ARTIST = `${P}trend_artist`;
  const technoTracks = [1, 2, 3, 4].map((n) => `${P}techno_track_${n}`);
  const USERS = [
    DECLARED_USER,
    BOOST_LISTENER,
    AGREE_USER,
    PLAY_ONLY_USER,
    THIN_USER,
    HIDDEN_USER,
    DOWNRANK_USER,
  ];

  const seedSignals = async (userId: string, count: number) => {
    await prisma.agentSignal.createMany({
      data: Array.from({ length: count }, (_, n) => ({
        userId,
        trackId: technoTracks[n % technoTracks.length],
        action: "complete",
        weight: 1.5,
        metadata: {},
        createdAt: new Date(Date.now() - n * 60_000),
      })),
    });
  };

  const playsTechno = (userId: string) => ({
    eventId: `${P}play_${userId}`,
    eventName: "playback.completed",
    eventVersion: 1,
    occurredAt: new Date(),
    receivedAt: new Date(),
    producer: "backend",
    environment: "test",
    privacyTier: "pseudonymous",
    actorId: pseudonymousAnalyticsActorId(userId),
    payload: { trackId: technoTracks[0] },
    envelope: {},
  });

  beforeAll(async () => {
    process.env.DISCOVERY_EXPLORATION_COUNT = "0";
    await prisma.user.createMany({
      data: USERS.map((id) => ({ id, email: `${id}@test.resonate` })),
    });
    await prisma.artist.createMany({
      data: [JAZZ_ARTIST, TECHNO_ARTIST_A, TECHNO_ARTIST_B, TREND_ARTIST].map((id) => ({
        id,
        displayName: id,
      })),
    });
    await prisma.release.createMany({
      data: [
        {
          id: `${P}jazz_release`,
          artistId: JAZZ_ARTIST,
          title: "Blue Room",
          genre: DECLARED,
          artworkMimeType: "image/png",
          artworkRevision: 2,
        },
        {
          id: `${P}techno_release_a`,
          artistId: TECHNO_ARTIST_A,
          title: "Warehouse A",
          genre: LISTENING,
          artworkMimeType: "image/jpeg",
          artworkRevision: 3,
        },
        { id: `${P}techno_release_b`, artistId: TECHNO_ARTIST_B, title: "Warehouse B", genre: LISTENING },
        { id: `${P}trend_release`, artistId: TREND_ARTIST, title: "Charting", genre: TREND_ONLY },
      ].map((release) => ({ ...release, status: "ready" })),
    });
    await prisma.track.createMany({
      data: [
        { id: `${P}jazz_track_1`, releaseId: `${P}jazz_release`, title: "Jazz One", position: 1 },
        { id: `${P}jazz_track_2`, releaseId: `${P}jazz_release`, title: "Jazz Two", position: 2 },
        { id: technoTracks[0], releaseId: `${P}techno_release_a`, title: "Techno One", position: 1 },
        { id: technoTracks[1], releaseId: `${P}techno_release_a`, title: "Techno Two", position: 2 },
        { id: technoTracks[2], releaseId: `${P}techno_release_b`, title: "Techno Three", position: 1 },
        { id: technoTracks[3], releaseId: `${P}techno_release_b`, title: "Techno Four", position: 2 },
        { id: `${P}trend_track`, releaseId: `${P}trend_release`, title: "Chart Topper", position: 1 },
      ].map((track) => ({ ...track, explicit: false })),
    });
    // A charting track for the listening genre, so the trending rail has
    // something to show. Its release genre differs so it is not a rail-2 match.
    await prisma.trackPopularity.create({
      data: {
        trackId: `${P}trend_track`,
        window: "7d",
        genre: LISTENING,
        score: 100,
        plays: 500,
        uniqueListeners: 500,
        saves: 10,
      },
    });

    const { recommendations, tasteMemory } = newService({ tasteAwareRecommendations: true });
    await recommendations.setPreferences(DECLARED_USER, { genres: [DECLARED] });
    await recommendations.setPreferences(AGREE_USER, { genres: [LISTENING] });
    await recommendations.setPreferences(THIN_USER, { genres: [DECLARED] });
    await tasteMemory.applyTasteEdits(BOOST_LISTENER, [
      { kind: "boost_genre", signalType: "genre", value: DECLARED, action: "boosted" },
    ]);
    await prisma.listenerTasteSignalControl.create({
      data: { userId: HIDDEN_USER, signalType: "genre", value: LISTENING, action: "hidden" },
    });

    await seedSignals(DECLARED_USER, 6);
    await seedSignals(BOOST_LISTENER, 6);
    await seedSignals(AGREE_USER, 6);
    await seedSignals(PLAY_ONLY_USER, 6);
    await seedSignals(THIN_USER, 4);
    await recommendations.setPreferences(DOWNRANK_USER, { genres: [DECLARED] });
    await prisma.listenerTasteSignalControl.create({
      data: { userId: DOWNRANK_USER, signalType: "genre", value: LISTENING, action: "downranked" },
    });
    await seedSignals(DOWNRANK_USER, 6);
    await prisma.analyticsEvent.create({ data: playsTechno(PLAY_ONLY_USER) });
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.listenerTasteSignalControl.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.recommendationProfile.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.analyticsEvent.deleteMany({ where: { eventId: { startsWith: P } } });
    await prisma.trackPopularity.deleteMany({ where: { trackId: { startsWith: P } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  });

  const rail = (feed: { rails: Array<{ kind: string }> }, kind: string) =>
    feed.rails.find((candidate) => candidate.kind === kind) as
      | (typeof feed.rails[number] & { title: string; explanation: string; items: any[] })
      | undefined;

  it("declared genre first, listening genre second, one ranking call", async () => {
    const { homeFeed, recommendations } = newService({ tasteAwareRecommendations: true });
    const spy = jest.spyOn(recommendations, "getRecommendations");
    const feed = await homeFeed.getHomeFeed(DECLARED_USER);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      DECLARED_USER,
      32,
      undefined,
      expect.objectContaining({
        additionalGenres: [LISTENING],
        // The profile Home resolved is reused, not recomputed.
        learnedGenreWeights: expect.objectContaining({ [LISTENING]: expect.any(Number) }),
      }),
    );

    const kinds = feed.rails.map((candidate) => candidate.kind);
    expect(kinds.indexOf("because_genre")).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf("listening_genre")).toBe(kinds.indexOf("because_genre") + 1);
    expect(rail(feed, "because_genre")!.title).toBe(`Because you save a lot of ${DECLARED}`);

    const listening = rail(feed, "listening_genre")!;
    expect(listening.title).toBe(`Because you've been playing ${LISTENING}`);
    expect(listening.explanation).toMatch(/shifts as your listening changes/);
    expect(listening.items.length).toBeGreaterThan(0);
    for (const item of listening.items) {
      expect(item.genre).toBe(LISTENING);
      expect(item.reasonCode).toBe("listening_pattern");
      expect(item.explanations).toEqual([DISCOVERY_EXPLANATIONS.listening_pattern]);
    }
    // Release artwork flows through both genre rails (tiles otherwise fall back
    // to a letter monogram): seeded on the techno A and jazz releases only.
    const withArtwork = listening.items.find((item) => item.releaseId === `${P}techno_release_a`);
    expect(withArtwork).toMatchObject({ artworkMimeType: "image/jpeg", artworkRevision: 3 });
    const withoutArtwork = listening.items.find((item) => item.releaseId === `${P}techno_release_b`);
    expect(withoutArtwork).toMatchObject({ artworkMimeType: null, artworkRevision: 1 });
    const becauseItems = rail(feed, "because_genre")!.items;
    expect(becauseItems.length).toBeGreaterThan(0);
    for (const item of becauseItems) {
      expect(item).toMatchObject({ artworkMimeType: "image/png", artworkRevision: 2 });
    }
    // Feed-wide dedupe still holds across the two genre rails.
    const ids = feed.rails.flatMap((candidate: any) => candidate.items.map((item: any) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a declared boost anchors the first rail, listening still adds its own", async () => {
    const { homeFeed } = newService({ tasteAwareRecommendations: true });
    const feed = await homeFeed.getHomeFeed(BOOST_LISTENER);
    const kinds = feed.rails.map((candidate) => candidate.kind);
    expect(rail(feed, "because_genre")!.title).toBe(`Because you save a lot of ${DECLARED}`);
    expect(kinds.indexOf("listening_genre")).toBe(kinds.indexOf("because_genre") + 1);
  });

  it("no listening rail when listening agrees with the declared genre", async () => {
    const { homeFeed, recommendations } = newService({ tasteAwareRecommendations: true });
    const spy = jest.spyOn(recommendations, "getRecommendations");
    const feed = await homeFeed.getHomeFeed(AGREE_USER);
    expect(feed.rails.map((candidate) => candidate.kind)).not.toContain("listening_genre");
    expect(rail(feed, "because_genre")!.title).toContain(LISTENING);
    expect(spy).toHaveBeenCalledWith(
      AGREE_USER,
      24,
      undefined,
      expect.not.objectContaining({ additionalGenres: expect.anything() }),
    );
  });

  it("a listener with nothing declared gets the listening rail and trending on it", async () => {
    const { homeFeed } = newService({ tasteAwareRecommendations: true });
    const feed = await homeFeed.getHomeFeed(PLAY_ONLY_USER);
    expect(feed.cold).toBe(false);
    const kinds = feed.rails.map((candidate) => candidate.kind);
    expect(kinds).not.toContain("because_genre");
    expect(rail(feed, "listening_genre")!.title).toBe(`Because you've been playing ${LISTENING}`);
    const trending = rail(feed, "trending_genre");
    expect(trending?.title).toBe(`Trending in ${LISTENING}`);
    expect(kinds.indexOf("trending_genre")).toBeGreaterThan(kinds.indexOf("listening_genre"));
  });

  it("no listening rail for a genre the listener asked for less of (ADR-TE-5)", async () => {
    const { homeFeed } = newService({ tasteAwareRecommendations: true });
    const feed = await homeFeed.getHomeFeed(DOWNRANK_USER);
    expect(feed.rails.map((candidate) => candidate.kind)).not.toContain("listening_genre");
    expect(rail(feed, "because_genre")!.title).toContain(DECLARED);
  });

  it("fewer than five positive signals: no listening rail", async () => {
    const { homeFeed, recommendations } = newService({ tasteAwareRecommendations: true });
    const spy = jest.spyOn(recommendations, "getRecommendations");
    const feed = await homeFeed.getHomeFeed(THIN_USER);
    expect(feed.rails.map((candidate) => candidate.kind)).not.toContain("listening_genre");
    expect(spy).toHaveBeenCalledWith(
      THIN_USER,
      24,
      undefined,
      expect.not.objectContaining({ additionalGenres: expect.anything() }),
    );
  });

  it("a hidden genre is never added as an extra preference term", async () => {
    const { recommendations } = newService({ tasteAwareRecommendations: true });
    const result = await recommendations.getRecommendations(HIDDEN_USER, 24, undefined, {
      additionalGenres: [LISTENING],
    });
    const reasons = result.items.flatMap((item) => item.reasons);
    expect(reasons).not.toContain(`genre:${LISTENING}`);
    expect(result.items.some((item) => item.genre === LISTENING)).toBe(false);

    // Without the policy in the way the same term does match (earlier renders
    // recorded served tracks, which the ranker would otherwise skip).
    await prisma.recommendationProfile.updateMany({
      where: { userId: PLAY_ONLY_USER },
      data: { servedTrackIds: [] },
    });
    const open = await newService({ tasteAwareRecommendations: true }).recommendations
      .getRecommendations(PLAY_ONLY_USER, 24, undefined, { additionalGenres: [LISTENING] });
    expect(open.items.flatMap((item) => item.reasons)).toContain(`genre:${LISTENING}`);
  });
});
