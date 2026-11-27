import { prisma } from "../db/prisma";
import { ANALYTICS_CONSENT_POLICY_VERSION } from "../modules/analytics/analytics_consent.service";
import { LISTENING_RECENT_SCHEMA_VERSION } from "../modules/listening_stats/listening_recent.aggregate";
import { ListeningRecentService } from "../modules/listening_stats/listening_recent.service";

const TEST_PREFIX = `lrecent_${Date.now()}_`;
const NOW = new Date("2026-06-15T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const LISTENER = `${TEST_PREFIX}listener`;
const OTHER = `${TEST_PREFIX}other`;
const RESET = `${TEST_PREFIX}reset`;
const USERS = [LISTENER, OTHER, RESET];
const ARTIST = `${TEST_PREFIX}artist`;

const playlists = {
  own: `${TEST_PREFIX}pl_own`,
  public: `${TEST_PREFIX}pl_public`,
  othersPrivate: `${TEST_PREFIX}pl_private`,
};

async function seedRelease(name: string, options: { status?: string; type?: string } = {}) {
  const releaseId = `${TEST_PREFIX}release_${name}`;
  await prisma.release.create({
    data: {
      id: releaseId,
      artistId: ARTIST,
      title: `Release ${name}`,
      type: options.type ?? "album",
      status: options.status ?? "published",
      primaryArtist: `Artist ${name}`,
    },
  });
  const trackId = `${TEST_PREFIX}track_${name}`;
  await prisma.track.create({ data: { id: trackId, releaseId, title: `Song ${name}`, position: 1 } });
  return { releaseId, trackId };
}

async function play(userId: string, trackId: string, at: Date, playlistId?: string) {
  await prisma.agentSignal.create({
    data: {
      userId,
      trackId,
      action: "complete",
      weight: 1,
      createdAt: at,
      metadata: { source: "web_player", ...(playlistId ? { playlistId } : {}) },
    },
  });
}

describe("ListeningRecentService (integration)", () => {
  const service = new ListeningRecentService();
  const r: Record<string, { releaseId: string; trackId: string }> = {};

  beforeAll(async () => {
    for (const id of USERS) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    await prisma.analyticsConsent.create({
      data: { userId: LISTENER, productAnalytics: true, decidedAt: ago(30 * DAY), policyVersion: ANALYTICS_CONSENT_POLICY_VERSION },
    });
    await prisma.artist.create({ data: { id: ARTIST, displayName: "Artist account" } });
    r.a = await seedRelease("a");
    r.b = await seedRelease("b", { type: "single" });
    r.c = await seedRelease("c");
    r.withdrawn = await seedRelease("w", { status: "withdrawn" });
    r.old = await seedRelease("old");

    await prisma.playlist.create({ data: { id: playlists.own, userId: LISTENER, name: "Mine", trackIds: [r.a.trackId] } });
    await prisma.playlist.create({ data: { id: playlists.public, userId: OTHER, name: "Theirs", visibility: "public", trackIds: [r.b.trackId, r.c.trackId] } });
    await prisma.playlist.create({ data: { id: playlists.othersPrivate, userId: OTHER, name: "Secret", trackIds: [r.c.trackId] } });

    await play(LISTENER, r.a.trackId, ago(2 * HOUR));
    await play(LISTENER, r.b.trackId, ago(3 * DAY), playlists.public);
    await play(LISTENER, r.c.trackId, ago(4 * DAY), playlists.othersPrivate);
    await play(LISTENER, r.a.trackId, ago(10 * DAY), playlists.own);
    await play(LISTENER, r.withdrawn.trackId, ago(1 * HOUR));
    await play(LISTENER, r.old.trackId, ago(400 * DAY));
    await play(OTHER, r.c.trackId, ago(1 * HOUR));

    await prisma.listenerTasteMemorySettings.create({ data: { userId: RESET, resetAt: ago(DAY) } });
    await play(RESET, r.a.trackId, ago(2 * DAY));
    await play(RESET, r.b.trackId, ago(HOUR));
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.analyticsConsent.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.playlist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  });

  it("lists the listener's own recent releases and openable playlists, newest first", async () => {
    const recent = await service.getRecent(LISTENER, { limit: 12, now: NOW });
    expect(recent.schemaVersion).toBe(LISTENING_RECENT_SCHEMA_VERSION);
    expect(recent.recording).toBe(true);
    expect(recent.items.map((item) => (item.kind === "release" ? item.releaseId : item.playlistId))).toEqual([
      r.a.releaseId,
      playlists.public,
      // A private playlist of another listener is never named: the play counts for its release.
      r.c.releaseId,
      playlists.own,
    ]);
    expect(recent.items[0]).toMatchObject({ kind: "release", title: "Release a", lastTrackId: r.a.trackId });
    expect(recent.items[1]).toMatchObject({ kind: "playlist", name: "Theirs", isOwner: false, trackCount: 2 });
    expect(recent.items[3]).toMatchObject({ kind: "playlist", name: "Mine", isOwner: true });
  });

  it("honors the limit", async () => {
    const recent = await service.getRecent(LISTENER, { limit: 2, now: NOW });
    expect(recent.items).toHaveLength(2);
  });

  it("forgets plays before a taste reset", async () => {
    const recent = await service.getRecent(RESET, { limit: 12, now: NOW });
    expect(recent.recording).toBe(false);
    expect(recent.items.map((item) => item.kind === "release" && item.releaseId)).toEqual([r.b.releaseId]);
  });
});
