import { prisma } from "../db/prisma";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "../modules/analytics/analytics_consent.service";
import { LISTENING_STATS_SCHEMA_VERSION } from "../modules/listening_stats/listening_stats.aggregate";
import { ListeningStatsService } from "../modules/listening_stats/listening_stats.service";

const TEST_PREFIX = `lstats_${Date.now()}_`;
const NOW = new Date("2026-06-15T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const LISTENER = `${TEST_PREFIX}listener`;
const OTHER = `${TEST_PREFIX}other`;
const RESET = `${TEST_PREFIX}reset`;
const USERS = [LISTENER, OTHER, RESET];

const ids = {
  account: `${TEST_PREFIX}account`,
  credited: `${TEST_PREFIX}credited`,
  older: `${TEST_PREFIX}older`,
};

async function seedRelease(name: string, artistId: string, options: { credit?: string; genre?: string; moods?: string[]; status?: string } = {}) {
  const releaseId = `${TEST_PREFIX}release_${name}`;
  await prisma.release.create({
    data: {
      id: releaseId,
      artistId,
      title: `Release ${name}`,
      genre: options.genre ?? "House",
      moods: options.moods ?? [],
      status: options.status ?? "published",
      primaryArtist: `Primary ${name}`,
    },
  });
  if (options.credit) {
    await prisma.releaseArtistCredit.create({
      data: { releaseId, artistId: options.credit, role: "main", displayName: "Credited Star" },
    });
  }
  const trackId = `${TEST_PREFIX}track_${name}`;
  await prisma.track.create({ data: { id: trackId, releaseId, title: `Song ${name}`, position: 1 } });
  return trackId;
}

async function signal(userId: string, trackId: string, action: string, at: Date, outcome: Record<string, unknown> = {}) {
  await prisma.agentSignal.create({
    data: {
      userId,
      trackId,
      action,
      weight: 1,
      createdAt: at,
      metadata: {
        source: "web_player",
        localHourBucket: "night",
        weekdayKind: "weekend",
        outcome: { type: "playback_completed", durationMs: 180_000, completionRatio: 1, playedThrough: true, ...outcome },
      },
    },
  });
}

describe("ListeningStatsService (integration)", () => {
  const service = new ListeningStatsService();
  const tracks: Record<string, string> = {};

  beforeAll(async () => {
    for (const id of USERS) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    await prisma.analyticsConsent.create({
      data: { userId: LISTENER, productAnalytics: true, decidedAt: ago(30 * DAY), policyVersion: ANALYTICS_CONSENT_POLICY_VERSION },
    });
    await prisma.artist.create({ data: { id: ids.account, displayName: "Uploader account" } });
    await prisma.artist.create({ data: { id: ids.credited, displayName: "Credited Star" } });
    await prisma.artist.create({ data: { id: ids.older, displayName: "Older account" } });

    tracks.credited1 = await seedRelease("c1", ids.account, { credit: ids.credited, genre: "Afrobeats", moods: ["Uplifting"] });
    tracks.credited2 = await seedRelease("c2", ids.account, { credit: ids.credited, genre: "Afrobeats", moods: ["Uplifting", "Warm"] });
    tracks.primary = await seedRelease("p", ids.account, { genre: "Jazz" });
    tracks.older = await seedRelease("o", ids.older, { genre: "Soul" });
    tracks.withdrawn = await seedRelease("w", ids.older, { status: "withdrawn" });

    // Inside the 7-day window.
    await signal(LISTENER, tracks.credited1, "complete", ago(HOUR));
    await signal(LISTENER, tracks.credited1, "replay", ago(2 * HOUR));
    await signal(LISTENER, tracks.credited2, "complete", ago(DAY), { completionRatio: 0.5, playedThrough: false });
    await signal(LISTENER, tracks.primary, "complete", ago(2 * DAY));
    await signal(LISTENER, tracks.older, "complete", ago(3 * DAY));
    await signal(LISTENER, tracks.withdrawn, "complete", ago(3 * DAY));
    await signal(LISTENER, tracks.primary, "save", ago(2 * DAY));
    await signal(LISTENER, tracks.primary, "skip", ago(2 * DAY));
    // Previous window, and an older play of the "older" artist.
    await signal(LISTENER, tracks.older, "complete", ago(10 * DAY));
    // Another listener's plays never count.
    await signal(OTHER, tracks.credited1, "complete", ago(HOUR));

    // A taste reset forgets everything before it.
    await prisma.listenerTasteMemorySettings.create({ data: { userId: RESET, resetAt: ago(DAY + HOUR) } });
    await signal(RESET, tracks.primary, "complete", ago(2 * DAY));
    await signal(RESET, tracks.primary, "complete", ago(HOUR));
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.analyticsConsent.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.releaseArtistCredit.deleteMany({ where: { releaseId: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  });

  it("summarises only the listener's own counted plays", async () => {
    const stats = await service.getStats(LISTENER, { windowDays: 7, now: NOW });
    expect(stats.schemaVersion).toBe(LISTENING_STATS_SCHEMA_VERSION);
    expect(stats.recording).toBe(true);
    expect(stats.summary.plays).toBe(6);
    expect(stats.summary.saves).toBe(1);
    expect(stats.summary.previous.plays).toBe(1);
    // 5 full plays of 3 min plus one half play.
    expect(stats.summary.minutes).toBe(17);
    expect(stats.summary.playedThroughRate).toBeCloseTo(5 / 6, 3);
    expect(stats.activity.reduce((sum, [, plays]) => sum + plays, 0)).toBe(7);
    expect(stats.moments.night).toBe(6);
    expect(stats.weekendPlays).toBe(6);
  });

  it("ranks artists by the credited artist, not the uploader account", async () => {
    const stats = await service.getStats(LISTENER, { windowDays: 7, now: NOW });
    expect(stats.topArtists[0]).toMatchObject({ name: "Credited Star", artistId: ids.credited, plays: 3, tracks: 2 });
    expect(stats.topArtists.map((artist) => artist.name)).toContain("Primary p");
    expect(stats.topArtists.map((artist) => artist.name)).not.toContain("Uploader account");
    expect(stats.topTracks[0]).toMatchObject({ trackId: tracks.credited1, plays: 2, available: true });
    expect(stats.topTracks.find((track) => track.trackId === tracks.withdrawn)?.available).toBe(false);
    expect(stats.genres[0]).toMatchObject({ name: "Afrobeats", plays: 3 });
    expect(stats.moods[0]).toMatchObject({ name: "Uplifting", plays: 3 });
  });

  it("counts an artist played before the window as not new", async () => {
    const stats = await service.getStats(LISTENER, { windowDays: 7, now: NOW });
    // Credited Star, Primary p, Primary w are new; the "older" artist was played 10 days ago.
    expect(stats.summary.artists).toBe(4);
    expect(stats.summary.newArtists).toBe(3);
  });

  it("forgets plays before a taste reset and reports that nothing is recorded without consent", async () => {
    const stats = await service.getStats(RESET, { windowDays: 7, now: NOW });
    expect(stats.summary.plays).toBe(1);
    expect(stats.summary.previous.plays).toBe(0);
    expect(stats.recording).toBe(false);
  });
});
