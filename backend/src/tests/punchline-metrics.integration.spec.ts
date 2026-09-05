/**
 * Punchline artist metrics — Integration Test (Testcontainers) (#489)
 *
 * Real Prisma. Seeds a published two-moment drop, collectibles, an unlock
 * grant, and analytics facts (drop_viewed / preview_played / collect_started),
 * then asserts the owner metrics aggregation:
 *   (a) drop totals: views, previews, collect starts, collected, conversion,
 *       set completions; per-moment splits incl. sold-out
 *   (b) owner scoping: a non-owner gets 403, a missing drop 404
 *   (c) facts for OTHER drops never bleed into the numbers
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='punchline-metrics'
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { PunchlineMetricsService } from "../modules/punchline/punchline-metrics.service";

const TEST_PREFIX = `punchline_metrics_${Date.now()}_`;

const OWNER_USER = `${TEST_PREFIX}owner`;
const STRANGER_USER = `${TEST_PREFIX}stranger`;
const FAN = `${TEST_PREFIX}fan`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const STRANGER_ARTIST_ID = `${TEST_PREFIX}artist2`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const DROP_ID = `${TEST_PREFIX}drop`;
const OTHER_DROP_ID = `${TEST_PREFIX}other_drop`;
const MOMENT_A = `${TEST_PREFIX}m_a`;
const MOMENT_B = `${TEST_PREFIX}m_b`;

let factSeq = 0;
function fact(eventName: string, payload: Prisma.InputJsonObject) {
  factSeq += 1;
  const now = new Date();
  return prisma.analyticsEvent.create({
    data: {
      eventId: `${TEST_PREFIX}evt_${factSeq}`,
      eventName,
      eventVersion: 1,
      occurredAt: now,
      receivedAt: now,
      producer: "web-app",
      environment: "test",
      privacyTier: "pseudonymous",
      payload,
      envelope: { eventName, payload },
    },
  });
}

describe("Punchline artist metrics (integration)", () => {
  const service = new PunchlineMetricsService();

  beforeAll(async () => {
    for (const [user, artist] of [
      [OWNER_USER, ARTIST_ID],
      [STRANGER_USER, STRANGER_ARTIST_ID],
    ] as const) {
      await prisma.user.create({
        data: { id: user, email: `${user}@test.resonate` },
      });
      await prisma.artist.create({
        data: { id: artist, userId: user, displayName: user },
      });
    }
    await prisma.user.create({
      data: { id: FAN, email: `${FAN}@test.resonate` },
    });
    await prisma.release.create({
      data: { id: RELEASE_ID, artistId: ARTIST_ID, title: "M", status: "ready" },
    });
    await prisma.track.create({
      data: { id: TRACK_ID, releaseId: RELEASE_ID, title: "M", position: 1 },
    });
    await prisma.punchlineDrop.create({
      data: {
        id: DROP_ID,
        trackId: TRACK_ID,
        artistId: ARTIST_ID,
        status: "published",
        publishedAt: new Date(),
        moments: {
          create: [
            {
              id: MOMENT_A,
              title: "A",
              lyricText: "a",
              startMs: 0,
              endMs: 4000,
              editionSize: 1,
              priceCents: 0,
            },
            {
              id: MOMENT_B,
              title: "B",
              lyricText: "b",
              startMs: 4000,
              endMs: 8000,
              editionSize: 10,
              priceCents: 0,
            },
          ],
        },
        unlocks: {
          create: [
            {
              unlockType: "complete_set",
              rewardMetadata: {
                kind: "bonus_clip",
                startMs: 0,
                endMs: 4000,
                message: null,
                clipAssetUri: null,
              },
            },
          ],
        },
      },
    });
    await prisma.punchlineDrop.create({
      data: {
        id: OTHER_DROP_ID,
        trackId: TRACK_ID,
        artistId: ARTIST_ID,
        status: "published",
        publishedAt: new Date(),
      },
    });

    // Fan owns both moments (set complete): moment A sold out (size 1).
    await prisma.punchlineCollectible.createMany({
      data: [
        {
          id: `${TEST_PREFIX}c_a`,
          momentId: MOMENT_A,
          collectorUserId: FAN,
          editionNumber: 1,
          status: "owned",
          acquiredAt: new Date(),
        },
        {
          id: `${TEST_PREFIX}c_b`,
          momentId: MOMENT_B,
          collectorUserId: FAN,
          editionNumber: 1,
          status: "owned",
          acquiredAt: new Date(),
        },
      ],
    });
    const unlock = await prisma.punchlineUnlock.findFirst({
      where: { dropId: DROP_ID },
    });
    await prisma.punchlineUnlockGrant.create({
      data: { unlockId: unlock!.id, collectorUserId: FAN },
    });

    // Funnel facts: 4 views, 3 previews (2×A + 1×B), 2 collect starts (A, B).
    for (let i = 0; i < 4; i++) {
      await fact("punchline.drop_viewed", {
        dropId: DROP_ID,
        trackId: TRACK_ID,
        momentCount: 2,
        source: "release_page",
      });
    }
    await fact("punchline.preview_played", { dropId: DROP_ID, momentId: MOMENT_A });
    await fact("punchline.preview_played", { dropId: DROP_ID, momentId: MOMENT_A });
    await fact("punchline.preview_played", { dropId: DROP_ID, momentId: MOMENT_B });
    await fact("punchline.collect_started", { dropId: DROP_ID, momentId: MOMENT_A });
    await fact("punchline.collect_started", { dropId: DROP_ID, momentId: MOMENT_B });
    // Noise for another drop — must never bleed in.
    await fact("punchline.drop_viewed", { dropId: OTHER_DROP_ID });
    await fact("punchline.preview_played", {
      dropId: OTHER_DROP_ID,
      momentId: `${TEST_PREFIX}other_m`,
    });
  });

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({
      where: { eventId: { startsWith: TEST_PREFIX } },
    });
    await prisma.punchlineUnlockGrant.deleteMany({
      where: { collectorUserId: { startsWith: TEST_PREFIX } },
    });
    await prisma.punchlineCollectible.deleteMany({
      where: { collectorUserId: { startsWith: TEST_PREFIX } },
    });
    await prisma.punchlineDrop.deleteMany({ where: { trackId: TRACK_ID } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.artist.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  it("(a) aggregates the drop funnel with per-moment splits", async () => {
    const metrics = await service.getDropMetrics(OWNER_USER, DROP_ID);

    expect(metrics).toMatchObject({
      dropId: DROP_ID,
      views: 4,
      previews: 3,
      collectStarts: 2,
      collected: 2,
      totalEditions: 11,
      setCompletions: 1,
    });
    expect(metrics.conversion).toBeCloseTo(0.5);

    const a = metrics.moments.find((m) => m.momentId === MOMENT_A)!;
    expect(a).toMatchObject({
      previews: 2,
      collectStarts: 1,
      collected: 1,
      editionSize: 1,
      soldOut: true,
    });
    const b = metrics.moments.find((m) => m.momentId === MOMENT_B)!;
    expect(b).toMatchObject({
      previews: 1,
      collectStarts: 1,
      collected: 1,
      editionSize: 10,
      soldOut: false,
    });
  });

  it("(b) enforces ownership and existence", async () => {
    await expect(
      service.getDropMetrics(STRANGER_USER, DROP_ID),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.getDropMetrics(OWNER_USER, `${TEST_PREFIX}missing`),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("(c) another drop's facts never bleed in", async () => {
    const other = await service.getDropMetrics(OWNER_USER, OTHER_DROP_ID);
    expect(other.views).toBe(1);
    expect(other.previews).toBe(1);
    expect(other.collected).toBe(0);
    expect(other.conversion).toBe(0);
  });
});
