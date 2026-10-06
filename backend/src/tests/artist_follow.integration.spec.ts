import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import {
  ANALYTICS_CONSENT_POLICY_VERSION,
  AnalyticsConsentService,
} from "../modules/analytics/analytics_consent.service";
import { PrismaAnalyticsEventStore } from "../modules/analytics/analytics_event_store";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { AnalyticsInstrumentationService } from "../modules/analytics/analytics_instrumentation.service";
import { ArtistFollowService } from "../modules/artist_follows/artist_follow.service";
import { FirstListenerReceptionService } from "../modules/recommendations/first_listener_reception.service";
import { SceneScoutService } from "../modules/scene_scout/scene_scout.service";

const TEST_PREFIX = `artist_follow_${Date.now()}_`;
const DAY_MS = 24 * 60 * 60 * 1000;
const CITY = { countryCode: "CA", citySlug: "montreal", source: "user_declared", precision: "city" };

const id = (value: string) => `${TEST_PREFIX}${value}`;
const OWNER = id("owner");
const MANAGER = id("manager");
const ARTIST = id("artist");
const MANAGED_ARTIST = id("managed_artist");
const RELEASE = id("release");
const TRACK = id("track");
const FOREIGN_ARTIST = id("foreign_artist");
const FOREIGN_RELEASE = id("foreign_release");
const FOREIGN_TRACK = id("foreign_track");

const consent = new AnalyticsConsentService();
const ingest = new AnalyticsIngestService(new PrismaAnalyticsEventStore());
const follows = new ArtistFollowService(consent, new AnalyticsInstrumentationService(ingest));

async function createUser(value: string, options: { consent?: boolean; policyVersion?: string } = {}) {
  const userId = id(value);
  await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
  if (options.consent !== undefined) {
    await prisma.analyticsConsent.create({
      data: {
        userId,
        productAnalytics: options.consent,
        policyVersion: options.policyVersion ?? ANALYTICS_CONSENT_POLICY_VERSION,
        decidedAt: new Date(Date.now() - 30 * DAY_MS),
      },
    });
  }
  return userId;
}

function followEvents(artistId = ARTIST, eventName = "artist.followed") {
  return prisma.analyticsEvent.findMany({
    where: { eventName, payload: { path: ["artistId"], equals: artistId } },
    orderBy: { occurredAt: "asc" },
  });
}

describe("artist follows (integration)", () => {
  jest.setTimeout(120_000);
  let previousAudienceFloor: string | undefined;

  beforeAll(async () => {
    previousAudienceFloor = process.env.DISCOVERY_MIN_AUDIENCE;
    process.env.DISCOVERY_MIN_AUDIENCE = "3";
    await createUser("owner", { consent: true });
    await createUser("manager", { consent: true });
    await prisma.artist.create({ data: { id: ARTIST, userId: OWNER, displayName: "Followable" } });
    await prisma.artist.create({
      data: { id: MANAGED_ARTIST, managementOwnerUserId: MANAGER, displayName: "Managed" },
    });
    await prisma.release.create({ data: { id: RELEASE, artistId: ARTIST, title: "Northern Lights", status: "ready" } });
    await prisma.track.create({ data: { id: TRACK, releaseId: RELEASE, title: "First Light", position: 1 } });
    await prisma.artist.create({ data: { id: FOREIGN_ARTIST, displayName: "Someone Else" } });
    await prisma.release.create({
      data: { id: FOREIGN_RELEASE, artistId: FOREIGN_ARTIST, title: "Other", status: "ready" },
    });
    await prisma.track.create({ data: { id: FOREIGN_TRACK, releaseId: FOREIGN_RELEASE, title: "Other", position: 1 } });
  });

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({
      where: { OR: [{ eventId: { startsWith: TEST_PREFIX } }, { payload: { path: ["artistId"], string_starts_with: TEST_PREFIX } }] },
    });
    await prisma.firstListenerExposure.deleteMany({ where: { releaseId: { startsWith: TEST_PREFIX } } });
    await prisma.artistFollow.deleteMany({ where: { artistId: { startsWith: TEST_PREFIX } } });
    await prisma.sceneScoutCityDemand.deleteMany({ where: { artistId: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.analyticsConsent.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    if (previousAudienceFloor === undefined) delete process.env.DISCOVERY_MIN_AUDIENCE;
    else process.env.DISCOVERY_MIN_AUDIENCE = previousAudienceFloor;
    await prisma.$disconnect();
  });

  describe("follow state and ledger events", () => {
    it("rejects an unknown artist and a profile the caller owns or manages", async () => {
      const listener = await createUser("guard_listener", { consent: true });
      await expect(follows.follow(listener, id("missing_artist"))).rejects.toBeInstanceOf(NotFoundException);
      await expect(follows.follow(OWNER, ARTIST)).rejects.toBeInstanceOf(BadRequestException);
      await expect(follows.follow(MANAGER, MANAGED_ARTIST)).rejects.toBeInstanceOf(BadRequestException);
      await expect(prisma.artistFollow.count({ where: { artistId: { in: [ARTIST, MANAGED_ARTIST] } } })).resolves.toBe(0);
    });

    it("refuses closed and erased accounts", async () => {
      const closed = await createUser("closed_listener", { consent: true });
      await prisma.user.update({ where: { id: closed }, data: { closedAt: new Date() } });
      const erased = await createUser("erased_listener", { consent: true });
      await prisma.user.update({ where: { id: erased }, data: { erasedAt: new Date() } });
      await expect(follows.follow(closed, ARTIST)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(follows.follow(erased, ARTIST)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(prisma.artistFollow.count({ where: { userId: { in: [closed, erased] } } })).resolves.toBe(0);
    });

    it("follows and unfollows idempotently, emitting one event per real change", async () => {
      const listener = await createUser("idempotent_listener", { consent: true });
      const actorId = pseudonymousAnalyticsActorId(listener);
      await expect(follows.getStatus(listener, ARTIST)).resolves.toEqual({ following: false });

      await expect(follows.unfollow(listener, ARTIST)).resolves.toEqual({ following: false });
      await expect(follows.follow(listener, ARTIST, { releaseId: RELEASE, source: "release_page", geo: CITY })).resolves.toEqual({ following: true });
      await expect(follows.follow(listener, ARTIST, { releaseId: RELEASE })).resolves.toEqual({ following: true });
      await expect(follows.getStatus(listener, ARTIST)).resolves.toEqual({ following: true });
      await expect(prisma.artistFollow.count({ where: { userId: listener, artistId: ARTIST } })).resolves.toBe(1);

      const followed = (await followEvents()).filter((event) => event.actorId === actorId);
      expect(followed).toHaveLength(1);
      expect(followed[0]).toMatchObject({
        eventName: "artist.followed",
        consentBasis: "consent",
        privacyTier: "pseudonymous",
        producer: "artist-follow-service",
        subjectType: "artist",
        subjectId: ARTIST,
        payload: { artistId: ARTIST, releaseId: RELEASE, source: "release_page" },
      });
      expect(followed[0].envelope).toMatchObject({ geo: CITY });
      expect(JSON.stringify(followed[0])).not.toContain(listener);

      await expect(follows.unfollow(listener, ARTIST)).resolves.toEqual({ following: false });
      await expect(follows.unfollow(listener, ARTIST)).resolves.toEqual({ following: false });
      await expect(follows.getStatus(listener, ARTIST)).resolves.toEqual({ following: false });
      const unfollowed = (await followEvents(ARTIST, "artist.unfollowed")).filter((event) => event.actorId === actorId);
      expect(unfollowed).toHaveLength(1);
      expect(unfollowed[0].consentBasis).toBe("consent");

      // A new follow after an unfollow is a new ledger event.
      await follows.follow(listener, ARTIST);
      expect((await followEvents()).filter((event) => event.actorId === actorId)).toHaveLength(2);
    });

    it("writes nothing to the ledger without a current analytics consent grant", async () => {
      const undecided = await createUser("undecided_listener");
      const refused = await createUser("refused_listener", { consent: false });
      const stale = await createUser("stale_listener", { consent: true, policyVersion: "analytics-consent:old" });
      for (const listener of [undecided, refused, stale]) {
        await expect(follows.follow(listener, ARTIST, { releaseId: RELEASE, geo: CITY })).resolves.toEqual({ following: true });
        await follows.unfollow(listener, ARTIST);
        const actorId = pseudonymousAnalyticsActorId(listener);
        const events = await prisma.analyticsEvent.findMany({ where: { actorId } });
        expect(events).toEqual([]);
      }
    });

    it("drops release and track context outside the artist's own catalog", async () => {
      const foreignContext = await createUser("foreign_context_listener", { consent: true });
      const ownTrack = await createUser("own_track_listener", { consent: true });
      const mismatched = await createUser("mismatched_listener", { consent: true });

      await follows.follow(foreignContext, ARTIST, { releaseId: FOREIGN_RELEASE, trackId: FOREIGN_TRACK, geo: CITY });
      await follows.follow(ownTrack, ARTIST, { trackId: TRACK, releaseId: FOREIGN_RELEASE, geo: CITY });
      await follows.follow(mismatched, ARTIST, { releaseId: id("no_such_release"), trackId: id("no_such_track") });

      const byActor = new Map((await followEvents()).map((event) => [event.actorId, event.payload as Record<string, unknown>]));
      const foreign = byActor.get(pseudonymousAnalyticsActorId(foreignContext)!)!;
      expect(foreign).toMatchObject({ artistId: ARTIST, source: "web_app" });
      expect(foreign).not.toHaveProperty("releaseId");
      expect(foreign).not.toHaveProperty("trackId");
      expect(byActor.get(pseudonymousAnalyticsActorId(ownTrack)!)).toMatchObject({
        artistId: ARTIST, trackId: TRACK, releaseId: RELEASE,
      });
      const unknown = byActor.get(pseudonymousAnalyticsActorId(mismatched)!)!;
      expect(unknown).not.toHaveProperty("releaseId");
      expect(unknown).not.toHaveProperty("trackId");
    });
  });

  describe("Scene Scout city demand", () => {
    const scoutArtist = id("scout_artist");
    const scoutRelease = id("scout_release");
    const scoutTrack = id("scout_track");
    const scoutOwner = id("scout_owner");

    it("counts active consented follows and excludes unfollowed, unconsented, uncity'd, foreign and owner follows", async () => {
      await createUser("scout_owner", { consent: true });
      await prisma.artist.create({ data: { id: scoutArtist, userId: scoutOwner, displayName: "Scout Subject" } });
      await prisma.release.create({ data: { id: scoutRelease, artistId: scoutArtist, title: "Scout Release", status: "ready" } });
      await prisma.track.create({ data: { id: scoutTrack, releaseId: scoutRelease, title: "Scout Track", position: 1 } });

      const counted: string[] = [];
      for (const value of ["a", "b", "c", "d", "e"]) {
        const listener = await createUser(`scout_follower_${value}`, { consent: true });
        counted.push(listener);
        // One follows from the release page, one from a track context.
        await follows.follow(listener, scoutArtist, value === "e"
          ? { trackId: scoutTrack, geo: CITY }
          : { releaseId: scoutRelease, geo: CITY });
      }

      const unfollowed = await createUser("scout_unfollowed", { consent: true });
      await follows.follow(unfollowed, scoutArtist, { releaseId: scoutRelease, geo: CITY });
      await follows.unfollow(unfollowed, scoutArtist);

      const withdrawn = await createUser("scout_withdrawn", { consent: true });
      await follows.follow(withdrawn, scoutArtist, { releaseId: scoutRelease, geo: CITY });
      await consent.record(withdrawn, false);

      const noConsent = await createUser("scout_no_consent");
      await follows.follow(noConsent, scoutArtist, { releaseId: scoutRelease, geo: CITY });

      const noCity = await createUser("scout_no_city", { consent: true });
      await follows.follow(noCity, scoutArtist, { releaseId: scoutRelease });

      const noRelease = await createUser("scout_no_release", { consent: true });
      await follows.follow(noRelease, scoutArtist, { geo: CITY });

      const foreignContext = await createUser("scout_foreign_context", { consent: true });
      await follows.follow(foreignContext, scoutArtist, { releaseId: FOREIGN_RELEASE, geo: CITY });

      // A forged ledger event for someone who never followed must not count.
      const forged = await createUser("scout_forged", { consent: true });
      await ingest.ingest({
        eventName: "artist.followed",
        producer: "artist-follow-service",
        actorId: pseudonymousAnalyticsActorId(forged),
        consentBasis: "consent",
        geo: CITY as never,
        payload: { artistId: scoutArtist, releaseId: scoutRelease, source: "forged" },
      });

      // The artist's own follow row and event are excluded as well.
      await prisma.artistFollow.create({ data: { userId: scoutOwner, artistId: scoutArtist } });
      await ingest.ingest({
        eventName: "artist.followed",
        producer: "artist-follow-service",
        actorId: pseudonymousAnalyticsActorId(scoutOwner),
        consentBasis: "consent",
        geo: CITY as never,
        payload: { artistId: scoutArtist, releaseId: scoutRelease, source: "owner" },
      });

      const result = await new SceneScoutService().getArtistSceneScout(scoutArtist, {
        now: new Date(Date.now() + 60_000),
      });
      expect(result.status).toBe("ready");
      for (const windowDays of [7, 28]) {
        expect(result.cityDemand.find((row) => row.windowDays === windowDays)).toMatchObject({
          releaseId: scoutRelease,
          citySlug: "montreal",
          countryCode: "CA",
          follows: 5,
          uniqueListeners: 5,
          resonantListeners: 0,
          saves: 0,
          signalCount: 5,
        });
      }
      const snapshot = await prisma.sceneScoutCityDemand.findMany({ where: { artistId: scoutArtist, windowDays: 7 } });
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0]).toMatchObject({ follows: 5, uniqueListeners: 5 });
      expect(JSON.stringify(result)).not.toContain(counted[0]);
    });

    it("stops counting a follower after they unfollow", async () => {
      const [first] = (await prisma.artistFollow.findMany({
        where: { artistId: scoutArtist, userId: { startsWith: id("scout_follower_") } },
        orderBy: { userId: "asc" },
      })).map((row) => row.userId);
      await follows.unfollow(first, scoutArtist);
      const result = await new SceneScoutService().getArtistSceneScout(scoutArtist, {
        now: new Date(Date.now() + 60_000),
      });
      // Four followers is below the five-signal serving floor but above the audience floor.
      expect(result.status).toBe("thin_data");
      const snapshot = await prisma.sceneScoutCityDemand.findMany({ where: { artistId: scoutArtist, windowDays: 7 } });
      expect(snapshot[0]).toMatchObject({ follows: 4, uniqueListeners: 4 });
    });
  });

  describe("first-listener reception", () => {
    it("counts follows after hearing from placed, consenting listeners and applies the audience floor", async () => {
      const artistId = id("reception_artist");
      const ownerId = await createUser("reception_owner", { consent: true });
      const releaseOne = id("reception_release_one");
      const releaseTwo = id("reception_release_two");
      const trackOne = id("reception_track_one");
      const trackTwo = id("reception_track_two");
      const createdAt = new Date(Date.now() - 3 * DAY_MS);
      await prisma.artist.create({ data: { id: artistId, userId: ownerId, displayName: "Reception" } });
      for (const [releaseId, trackId] of [[releaseOne, trackOne], [releaseTwo, trackTwo]]) {
        await prisma.release.create({ data: { id: releaseId, artistId, title: releaseId, status: "ready", createdAt } });
        await prisma.track.create({ data: { id: trackId, releaseId, title: trackId, position: 1 } });
      }

      const placedAt = new Date(Date.now() - 2 * DAY_MS);
      const heardAt = new Date(Date.now() - DAY_MS);
      const hear = async (listener: string, releaseId: string, trackId: string, at = heardAt) => {
        await prisma.firstListenerExposure.upsert({
          where: { userId_releaseId: { userId: listener, releaseId } },
          create: { id: id(`exposure_${listener}_${releaseId}`), userId: listener, releaseId, placedAt },
          update: {},
        });
        await prisma.analyticsEvent.create({
          data: {
            eventId: id(`started_${listener}_${releaseId}`),
            eventName: "playback.started",
            eventVersion: 1,
            occurredAt: at,
            receivedAt: at,
            producer: "artist-follow-integration-test",
            environment: "test",
            privacyTier: "pseudonymous",
            actorId: pseudonymousAnalyticsActorId(listener),
            consentBasis: "consent",
            payload: { trackId, releaseId },
            envelope: {},
          },
        });
      };

      const followers = [];
      for (const value of ["a", "b", "c"]) {
        const listener = await createUser(`reception_follower_${value}`, { consent: true });
        followers.push(listener);
        await hear(listener, releaseOne, trackOne);
        await follows.follow(listener, artistId, { releaseId: releaseOne });
      }
      // Heard on the first release, then unfollowed: heard but not a follow.
      const unfollowed = await createUser("reception_unfollowed", { consent: true });
      await hear(unfollowed, releaseOne, trackOne);
      await follows.follow(unfollowed, artistId, { releaseId: releaseOne });
      await follows.unfollow(unfollowed, artistId);
      // Followed before hearing: the follow does not come after hearing.
      const followedFirst = await createUser("reception_followed_first", { consent: true });
      await follows.follow(followedFirst, artistId, { releaseId: releaseOne });
      await hear(followedFirst, releaseOne, trackOne, new Date(Date.now() + 60 * 60 * 1000));
      // A follower who never received the placement is not part of reception.
      const unplaced = await createUser("reception_unplaced", { consent: true });
      await follows.follow(unplaced, artistId, { releaseId: releaseOne });

      // Second release: only two of its three hearers follow, below the floor.
      await hear(followers[0], releaseTwo, trackTwo);
      await hear(followers[1], releaseTwo, trackTwo);
      await hear(unfollowed, releaseTwo, trackTwo);

      const reception = await new FirstListenerReceptionService().getArtistReception(artistId, {
        now: new Date(Date.now() + 5 * DAY_MS),
      });
      expect(reception.available).toBe(true);
      const byId = new Map(reception.releases.map((release) => [release.releaseId, release]));
      expect(byId.get(releaseOne)).toMatchObject({ heard: 5, follows: 3 });
      expect(byId.get(releaseTwo)).toMatchObject({ heard: 3, follows: null });
      expect(JSON.stringify(reception)).not.toContain(followers[0]);
    });
  });
});
