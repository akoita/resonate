/**
 * Upload limits and publishing without a deposit (#2659) — Testcontainers Postgres.
 *
 * Verifies:
 *   - an account that is not verified may upload up to each limit and is
 *     refused one past it, with the typed `upload_limit_reached` error;
 *   - verified artists and accounts an operator lifted are not limited, and
 *     restoring the limits applies them again;
 *   - `unlimited` turns a single limit off;
 *   - with `PUBLISH_DEPOSIT_MODE=none` the stake requirement reads zero while
 *     the listing price cap keeps the tier's nominal deposit.
 *
 * Run: npm run test:integration
 */

import { ConfigService } from "@nestjs/config";
import { prisma } from "../db/prisma";
import { TrustService } from "../modules/trust/trust.service";
import {
  UPLOAD_LIMIT_REACHED_CODE,
  UploadLimitReachedException,
  assertWithinUploadLimits,
  getUploadAllowance,
  resolveUploadLimits,
  setUploadLimitsLifted,
} from "../modules/trust/upload_limits";

const TEST_PREFIX = `uplimits_${Date.now()}_`;
const NEW_ARTIST = `${TEST_PREFIX}artist_new`;
const VERIFIED_ARTIST = `${TEST_PREFIX}artist_verified`;
const USER_IDS = [`${TEST_PREFIX}user_new`, `${TEST_PREFIX}user_verified`];

const LIMITS_ENV = {
  UPLOAD_LIMIT_RELEASES_PER_DAY: "2",
  UPLOAD_LIMIT_TRACKS_PER_DAY: "3",
  UPLOAD_LIMIT_RELEASES_TOTAL: "4",
  UPLOAD_LIMIT_TRACKS_TOTAL: "10",
} as NodeJS.ProcessEnv;

async function seedRelease(artistId: string, trackCount: number, createdAt = new Date()) {
  const release = await prisma.release.create({
    data: { artistId, title: `${TEST_PREFIX}release`, createdAt },
  });
  for (let i = 0; i < trackCount; i += 1) {
    await prisma.track.create({
      data: { releaseId: release.id, title: `${TEST_PREFIX}track_${i}`, createdAt },
    });
  }
  return release;
}

async function expectRefusal(promise: Promise<unknown>, limit: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(UploadLimitReachedException);
  expect((error as UploadLimitReachedException).getResponse()).toMatchObject({
    code: UPLOAD_LIMIT_REACHED_CODE,
    limit,
  });
}

describe("Upload limits (integration)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: USER_IDS.map((id) => ({ id, email: `${id}@test.resonate` })),
    });
    await prisma.artist.create({
      data: { id: NEW_ARTIST, userId: USER_IDS[0], displayName: "New Artist" },
    });
    await prisma.artist.create({
      data: { id: VERIFIED_ARTIST, userId: USER_IDS[1], displayName: "Verified Artist" },
    });
    await prisma.creatorTrust.create({ data: { artistId: VERIFIED_ARTIST, tier: "verified" } });
  });

  afterAll(async () => {
    const artistIds = [NEW_ARTIST, VERIFIED_ARTIST];
    await prisma.track.deleteMany({ where: { release: { artistId: { in: artistIds } } } });
    await prisma.release.deleteMany({ where: { artistId: { in: artistIds } } });
    await prisma.creatorTrust.deleteMany({ where: { artistId: { in: artistIds } } });
    await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
    await prisma.user.deleteMany({ where: { id: { in: USER_IDS } } });
  });

  it("reads defaults, numbers and `unlimited` from the environment", () => {
    expect(resolveUploadLimits({} as NodeJS.ProcessEnv)).toEqual({
      releasesPerDay: 5,
      tracksPerDay: 50,
      releasesTotal: 50,
      tracksTotal: 500,
    });
    expect(
      resolveUploadLimits({
        UPLOAD_LIMIT_RELEASES_PER_DAY: "unlimited",
        UPLOAD_LIMIT_TRACKS_PER_DAY: "0",
        UPLOAD_LIMIT_RELEASES_TOTAL: "nonsense",
        UPLOAD_LIMIT_TRACKS_TOTAL: "7",
      } as NodeJS.ProcessEnv),
    ).toEqual({ releasesPerDay: null, tracksPerDay: null, releasesTotal: 50, tracksTotal: 7 });
  });

  it("allows uploads up to the daily limits and refuses one past them", async () => {
    // Day one: an upload of 3 tracks fills the daily track limit exactly.
    await expect(assertWithinUploadLimits(NEW_ARTIST, 3, LIMITS_ENV)).resolves.toBeUndefined();
    await seedRelease(NEW_ARTIST, 3);

    await expectRefusal(assertWithinUploadLimits(NEW_ARTIST, 1, LIMITS_ENV), "tracksPerDay");

    const allowance = await getUploadAllowance(NEW_ARTIST, LIMITS_ENV);
    expect(allowance.limited).toBe(true);
    expect(allowance.used).toMatchObject({ releasesPerDay: 1, tracksPerDay: 3 });
    expect(allowance.remaining).toMatchObject({ releasesPerDay: 1, tracksPerDay: 0 });
  });

  it("counts only the last 24 hours against the daily limits", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await seedRelease(NEW_ARTIST, 2, twoDaysAgo);
    const allowance = await getUploadAllowance(NEW_ARTIST, LIMITS_ENV);
    expect(allowance.used).toMatchObject({ releasesPerDay: 1, releasesTotal: 2, tracksTotal: 5 });
  });

  it("refuses an upload past the total release limit", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await seedRelease(NEW_ARTIST, 0, twoDaysAgo);
    await seedRelease(NEW_ARTIST, 0, twoDaysAgo);
    // 4 releases in total now; the daily limits are not reached for releases.
    await expectRefusal(
      assertWithinUploadLimits(NEW_ARTIST, 1, { ...LIMITS_ENV, UPLOAD_LIMIT_TRACKS_PER_DAY: "unlimited" }),
      "releasesTotal",
    );
  });

  it("lets an operator lift and restore the limits for one account", async () => {
    await expect(setUploadLimitsLifted(NEW_ARTIST, true, `${TEST_PREFIX}operator`)).resolves.toMatchObject({
      artistId: NEW_ARTIST,
      liftedAt: expect.any(String),
    });
    const trust = await prisma.creatorTrust.findUnique({ where: { artistId: NEW_ARTIST } });
    expect(trust?.uploadLimitsLiftedBy).toBe(`${TEST_PREFIX}operator`);

    const lifted = await getUploadAllowance(NEW_ARTIST, LIMITS_ENV);
    expect(lifted.limited).toBe(false);
    expect(lifted.remaining.tracksPerDay).toBeNull();
    await expect(assertWithinUploadLimits(NEW_ARTIST, 20, LIMITS_ENV)).resolves.toBeUndefined();

    await expect(setUploadLimitsLifted(NEW_ARTIST, false, `${TEST_PREFIX}operator`)).resolves.toEqual({
      artistId: NEW_ARTIST,
      liftedAt: null,
    });
    await expectRefusal(assertWithinUploadLimits(NEW_ARTIST, 1, LIMITS_ENV), "tracksPerDay");
  });

  it("does not limit verified artists", async () => {
    await seedRelease(VERIFIED_ARTIST, 5);
    const allowance = await getUploadAllowance(VERIFIED_ARTIST, LIMITS_ENV);
    expect(allowance.limited).toBe(false);
    await expect(assertWithinUploadLimits(VERIFIED_ARTIST, 20, LIMITS_ENV)).resolves.toBeUndefined();
  });

  it("does nothing for an unknown artist", async () => {
    await expect(setUploadLimitsLifted(`${TEST_PREFIX}missing`, true, "op")).resolves.toEqual({
      artistId: `${TEST_PREFIX}missing`,
      liftedAt: null,
    });
  });
});

describe("Publishing without a deposit (integration)", () => {
  const ARTIST = `${TEST_PREFIX}artist_deposit`;
  const USER = `${TEST_PREFIX}user_deposit`;

  beforeAll(async () => {
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.resonate` } });
    await prisma.artist.create({ data: { id: ARTIST, userId: USER, displayName: "Deposit Artist" } });
  });

  afterAll(async () => {
    await prisma.creatorTrust.deleteMany({ where: { artistId: ARTIST } });
    await prisma.artist.deleteMany({ where: { id: ARTIST } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  function trustService(env: Record<string, string | undefined>) {
    return new TrustService({ get: (key: string) => env[key] } as unknown as ConfigService);
  }

  it("requires the tier's deposit by default", async () => {
    const requirement = await trustService({}).getStakeRequirement(ARTIST);
    expect(requirement.depositWaived).toBe(false);
    expect(BigInt(requirement.stakeAmountWei)).toBeGreaterThan(0n);
  });

  it("reads zero with PUBLISH_DEPOSIT_MODE=none and keeps the listing cap", async () => {
    const required = await trustService({}).getStakeRequirement(ARTIST);
    const waived = await trustService({ PUBLISH_DEPOSIT_MODE: "none" }).getStakeRequirement(ARTIST);
    expect(waived.depositWaived).toBe(true);
    expect(waived.stakeAmountWei).toBe("0");
    expect(waived.stakeAmountUsd).toBe("0");
    expect(waived.maxListingPriceUncapped).toBe(required.maxListingPriceUncapped);
    expect(waived.maxListingPriceWei).toBe(required.maxListingPriceWei);
  });
});
