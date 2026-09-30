/**
 * Discovery policy context loader — Integration (ADR-TE-2, taste-engine §3.4)
 *
 * Real Prisma. Verifies the two lookups the policy stage needs for its
 * exploration share: which candidate artists are human-verified (Artist.userId
 * -> CuratorReputation) and which the listener has already played (any
 * AgentSignal on a track of the artist).
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='discovery_policy_context'
 */

import { prisma } from "../db/prisma";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";

const TEST_PREFIX = `dpctx_${Date.now()}_`;
const LISTENER = `${TEST_PREFIX}listener`;
// Mixed case on purpose: the reputation row is keyed by the lowercased id.
const VERIFIED_USER = `${TEST_PREFIX}VerifiedHuman`;
const UNVERIFIED_USER = `${TEST_PREFIX}unverified`;
const PENDING_USER = `${TEST_PREFIX}pending`;
const PLAYED_USER = `${TEST_PREFIX}playedverified`;

const A_VERIFIED = `${TEST_PREFIX}artist_verified`;
const A_UNVERIFIED = `${TEST_PREFIX}artist_unverified`;
const A_PENDING = `${TEST_PREFIX}artist_pending`;
const A_NO_USER = `${TEST_PREFIX}artist_nouser`;
const A_PLAYED = `${TEST_PREFIX}artist_played`;

const ARTISTS = [
  { id: A_VERIFIED, userId: VERIFIED_USER },
  { id: A_UNVERIFIED, userId: UNVERIFIED_USER },
  { id: A_PENDING, userId: PENDING_USER },
  { id: A_NO_USER, userId: null },
  { id: A_PLAYED, userId: PLAYED_USER },
];
const trackOf = (artistId: string) => `${artistId}_track`;
const releaseOf = (artistId: string) => `${artistId}_release`;

describe("DiscoveryPolicyContextService (ADR-TE-2)", () => {
  const service = new DiscoveryPolicyContextService();

  beforeAll(async () => {
    const users = [LISTENER, VERIFIED_USER, UNVERIFIED_USER, PENDING_USER, PLAYED_USER];
    for (const id of users) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    for (const artist of ARTISTS) {
      await prisma.artist.create({
        data: { id: artist.id, userId: artist.userId, displayName: artist.id },
      });
      await prisma.release.create({
        data: {
          id: releaseOf(artist.id),
          artistId: artist.id,
          title: `${artist.id} release`,
          status: "ready",
        },
      });
      await prisma.track.create({
        data: {
          id: trackOf(artist.id),
          releaseId: releaseOf(artist.id),
          title: `${artist.id} track`,
          position: 1,
        },
      });
    }

    await prisma.curatorReputation.create({
      data: {
        walletAddress: VERIFIED_USER.toLowerCase(),
        humanVerificationStatus: "human_verified",
        humanVerifiedAt: new Date(),
      },
    });
    await prisma.curatorReputation.create({
      data: {
        walletAddress: PLAYED_USER.toLowerCase(),
        humanVerificationStatus: "human_verified",
        humanVerifiedAt: new Date(),
      },
    });
    // A reputation row that is NOT human-verified must not count.
    await prisma.curatorReputation.create({
      data: {
        walletAddress: PENDING_USER.toLowerCase(),
        humanVerificationStatus: "pending",
      },
    });

    // The listener has interacted with one artist's track (a skip counts:
    // any recorded interaction means the artist is not new to them).
    await prisma.agentSignal.create({
      data: {
        userId: LISTENER,
        trackId: trackOf(A_PLAYED),
        action: "skip",
        weight: -1,
      },
    });
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: LISTENER } });
    await prisma.curatorReputation.deleteMany({
      where: { walletAddress: { startsWith: TEST_PREFIX } },
    });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  const allIds = ARTISTS.map((artist) => artist.id);

  it("returns verified human artists and the listener's played artists", async () => {
    const context = await service.loadContext(LISTENER, allIds);

    expect([...context.verifiedHumanArtistIds].sort()).toEqual(
      [A_VERIFIED, A_PLAYED].sort(),
    );
    expect([...context.playedArtistIds]).toEqual([A_PLAYED]);
    // The exploration-eligible set the policy derives from these two:
    const exploration = allIds.filter(
      (id) => context.verifiedHumanArtistIds.has(id) && !context.playedArtistIds.has(id),
    );
    expect(exploration).toEqual([A_VERIFIED]);
  });

  it("does not treat unverified, pending or userless artists as verified humans", async () => {
    const context = await service.loadContext(LISTENER, [
      A_UNVERIFIED,
      A_PENDING,
      A_NO_USER,
    ]);
    expect(context.verifiedHumanArtistIds.size).toBe(0);
    expect(context.playedArtistIds.size).toBe(0);
  });

  it("returns an empty played set for an unknown or missing user", async () => {
    const unknown = await service.loadContext(`${TEST_PREFIX}nobody`, allIds);
    expect(unknown.playedArtistIds.size).toBe(0);
    expect(unknown.verifiedHumanArtistIds.has(A_VERIFIED)).toBe(true);

    const anonymous = await service.loadContext(undefined, allIds);
    expect(anonymous.playedArtistIds.size).toBe(0);
  });

  it("is bounded to the requested artists and tolerates empty or duplicate input", async () => {
    const scoped = await service.loadContext(LISTENER, [A_VERIFIED]);
    expect([...scoped.verifiedHumanArtistIds]).toEqual([A_VERIFIED]);
    expect(scoped.playedArtistIds.size).toBe(0);

    const empty = await service.loadContext(LISTENER, []);
    expect(empty.verifiedHumanArtistIds.size).toBe(0);
    expect(empty.playedArtistIds.size).toBe(0);

    const dupes = await service.loadContext(LISTENER, [A_PLAYED, A_PLAYED, ""]);
    expect([...dupes.playedArtistIds]).toEqual([A_PLAYED]);
  });

  it("maps track ids to artist ids in one batch, skipping unknown tracks", async () => {
    const map = await service.artistIdsForTracks([
      trackOf(A_VERIFIED),
      trackOf(A_PLAYED),
      trackOf(A_VERIFIED),
      `${TEST_PREFIX}no_such_track`,
      "",
    ]);
    expect(Object.fromEntries(map)).toEqual({
      [trackOf(A_VERIFIED)]: A_VERIFIED,
      [trackOf(A_PLAYED)]: A_PLAYED,
    });
    expect((await service.artistIdsForTracks([])).size).toBe(0);
  });
});
