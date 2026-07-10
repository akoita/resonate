/**
 * Punchline Drops — Persistence Foundation Integration Test (Testcontainers)
 *
 * Verifies the Prisma models added for Punchline Drops (#479, Sprint 7):
 * PunchlineDrop → PunchlineMoment → PunchlineCollectible, plus PunchlineUnlock.
 * Persists the full graph against real Postgres, reads it back with relations,
 * and asserts the [momentId, editionNumber] unique constraint enforces edition
 * scarcity. Models/schema only — no services/APIs exist yet.
 *
 * Run: npm run test:integration
 */

import { prisma } from "../db/prisma";

const TEST_PREFIX = `punchline_${Date.now()}_`;

const ARTIST_OWNER_ID = `${TEST_PREFIX}artist_owner`;
const COLLECTOR_ID = `${TEST_PREFIX}collector`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const VOCAL_STEM_ID = `${TEST_PREFIX}stem_vocals`;

describe("Punchline Drops models (integration)", () => {
  beforeAll(async () => {
    // FK chain: User → Artist → Release → Track → Stem(vocals). Mirrors the
    // seed order used by remix.integration.spec.ts.
    await prisma.user.create({
      data: {
        id: ARTIST_OWNER_ID,
        email: `${TEST_PREFIX}artist_owner@test.resonate`,
      },
    });
    await prisma.user.create({
      data: {
        id: COLLECTOR_ID,
        email: `${TEST_PREFIX}collector@test.resonate`,
      },
    });
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: ARTIST_OWNER_ID,
        displayName: "Punchline Test Artist",
        payoutAddress: `0x${"b2".repeat(20)}`,
      },
    });
    await prisma.release.create({
      data: {
        id: RELEASE_ID,
        artistId: ARTIST_ID,
        title: "Punchline Test Release",
        status: "ready",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: RELEASE_ID,
        title: "Bar-heavy Track",
        position: 1,
        contentStatus: "clean",
      },
    });
    await prisma.stem.create({
      data: {
        id: VOCAL_STEM_ID,
        trackId: TRACK_ID,
        type: "vocals",
        uri: "local://vocals",
      },
    });
  });

  afterAll(async () => {
    // Reverse FK order. PunchlineCollectible → PunchlineMoment (cascade from
    // drop) / PunchlineUnlock (cascade from drop) → PunchlineDrop, then base
    // seed chain.
    await prisma.punchlineCollectible.deleteMany({
      where: { collectorUserId: COLLECTOR_ID },
    });
    await prisma.punchlineDrop.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.stem.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.release.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.artist.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ARTIST_OWNER_ID, COLLECTOR_ID] } },
    });
  });

  it("persists a drop → moment → collectible → unlock graph and reads it back with relations", async () => {
    const drop = await prisma.punchlineDrop.create({
      data: {
        id: `${TEST_PREFIX}drop`,
        trackId: TRACK_ID,
        artistId: ARTIST_ID,
        title: "Legendary Lines",
        description: "The bars everybody rewinds.",
      },
    });
    // Defaults: draft status, no publishedAt.
    expect(drop.status).toBe("draft");
    expect(drop.publishedAt).toBeNull();

    const moment = await prisma.punchlineMoment.create({
      data: {
        id: `${TEST_PREFIX}moment`,
        dropId: drop.id,
        title: "The Hook",
        lyricText: "Own the line everybody rewinds",
        startMs: 12_000,
        endMs: 22_000,
        editionSize: 100,
        priceCents: 1500,
      },
    });
    // Defaults: vocals-only source, non-commercial rights, null clip until
    // extracted server-side (later workstream).
    expect(moment.sourceStemType).toBe("vocals");
    expect(moment.rightsLabel).toBe("NON_COMMERCIAL_COLLECTIBLE");
    expect(moment.clipAssetUri).toBeNull();

    const collectible = await prisma.punchlineCollectible.create({
      data: {
        id: `${TEST_PREFIX}collectible`,
        momentId: moment.id,
        collectorUserId: COLLECTOR_ID,
        editionNumber: 1,
      },
    });
    expect(collectible.status).toBe("pending");
    expect(collectible.acquiredAt).toBeNull();

    const unlock = await prisma.punchlineUnlock.create({
      data: {
        id: `${TEST_PREFIX}unlock`,
        dropId: drop.id,
        rewardMetadata: { rewardType: "audio", assetUri: "local://bonus" },
      },
    });
    expect(unlock.unlockType).toBe("complete_set");

    // Read back the full graph via relations.
    const loaded = await prisma.punchlineDrop.findUniqueOrThrow({
      where: { id: drop.id },
      include: {
        track: true,
        artist: true,
        moments: { include: { collectibles: { include: { collector: true } } } },
        unlocks: true,
      },
    });

    expect(loaded.track.id).toBe(TRACK_ID);
    expect(loaded.artist.id).toBe(ARTIST_ID);
    expect(loaded.moments).toHaveLength(1);
    expect(loaded.moments[0].id).toBe(moment.id);
    expect(loaded.moments[0].collectibles).toHaveLength(1);
    expect(loaded.moments[0].collectibles[0].collector.id).toBe(COLLECTOR_ID);
    expect(loaded.unlocks).toHaveLength(1);
    expect(loaded.unlocks[0].unlockType).toBe("complete_set");
    expect(loaded.unlocks[0].rewardMetadata).toEqual({
      rewardType: "audio",
      assetUri: "local://bonus",
    });
  });

  it("rejects a duplicate edition number for the same moment (edition scarcity)", async () => {
    const momentId = `${TEST_PREFIX}moment`;

    // editionNumber 1 already exists from the previous test.
    await expect(
      prisma.punchlineCollectible.create({
        data: {
          id: `${TEST_PREFIX}collectible_dupe`,
          momentId,
          collectorUserId: COLLECTOR_ID,
          editionNumber: 1,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    // A different edition number for the same moment is allowed.
    const second = await prisma.punchlineCollectible.create({
      data: {
        id: `${TEST_PREFIX}collectible_2`,
        momentId,
        collectorUserId: COLLECTOR_ID,
        editionNumber: 2,
      },
    });
    expect(second.editionNumber).toBe(2);
  });
});
