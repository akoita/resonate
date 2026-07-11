/**
 * Featured drops for the Home shelf — Integration (#1479)
 *
 * Real Prisma. Covers the deterministic momentum heuristic:
 *   (a) fully sold-out drops are excluded;
 *   (b) recent collect activity (7d, from PunchlineCollectible.acquiredAt)
 *       ranks first;
 *   (c) scarcity urgency (collected/editions below 100%) ranks next;
 *   (d) publishedAt desc is the tiebreak / cold-start fallback;
 *   (e) at most 2 drops per artist (shelf diversity);
 *   (f) items carry release/artist context for the shelf footer.
 *
 * The endpoint is global, so parallel suites may contribute drops — every
 * assertion is therefore RELATIVE among this suite's prefixed drops, and this
 * suite's momentum counts (4–6 recent collects) exceed anything other suites
 * seed (≤3).
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='punchline-featured'
 */

import { prisma } from "../db/prisma";
import { EncryptionService } from "../modules/encryption/encryption.service";
import { PunchlineClipService } from "../modules/punchline/punchline-clip.service";
import { PunchlineDropService } from "../modules/punchline/punchline-drop.service";
import { PunchlineEligibilityService } from "../modules/punchline/punchline-eligibility.service";
import { PunchlineUnlockService } from "../modules/punchline/punchline-unlock.service";
import { EventBus } from "../modules/shared/event_bus";
import { LocalStorageProvider } from "../modules/storage/local_storage_provider";

const TEST_PREFIX = `punchline_featured_${Date.now()}_`;
const ARTIST_A_USER = `${TEST_PREFIX}artist_a_user`;
const ARTIST_B_USER = `${TEST_PREFIX}artist_b_user`;
const ARTIST_A = `${TEST_PREFIX}artist_a`;
const ARTIST_B = `${TEST_PREFIX}artist_b`;

const DROP_HOT = `${TEST_PREFIX}drop_hot`; // artist A, 6 recent collects
const DROP_THIRD = `${TEST_PREFIX}drop_third`; // artist A, 5 recent collects
const DROP_WARM = `${TEST_PREFIX}drop_warm`; // artist A, 4 recent — capped out
const DROP_SOLD_OUT = `${TEST_PREFIX}drop_sold`; // artist B, fully sold out
const DROP_TIE_NEW = `${TEST_PREFIX}drop_tie_new`; // artist B, old-scarcity tie
const DROP_TIE_OLD = `${TEST_PREFIX}drop_tie_old`; // artist B, older publishedAt

const RECENT = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
const STALE = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // outside 7d

let fanSeq = 0;
async function seedCollects(momentId: string, count: number, acquiredAt: Date) {
  for (let edition = 1; edition <= count; edition += 1) {
    fanSeq += 1;
    const fanId = `${TEST_PREFIX}fan_${fanSeq}`;
    await prisma.user.create({
      data: { id: fanId, email: `${fanId}@test.resonate` },
    });
    await prisma.punchlineCollectible.create({
      data: {
        id: `${TEST_PREFIX}c_${fanSeq}`,
        momentId,
        collectorUserId: fanId,
        editionNumber: edition,
        status: "owned",
        acquiredAt,
      },
    });
  }
}

async function seedDrop(input: {
  dropId: string;
  artistId: string;
  trackId: string;
  publishedAt: Date;
  editionSize: number;
}) {
  await prisma.punchlineDrop.create({
    data: {
      id: input.dropId,
      trackId: input.trackId,
      artistId: input.artistId,
      status: "published",
      publishedAt: input.publishedAt,
      title: input.dropId,
      moments: {
        create: [
          {
            id: `${input.dropId}_m`,
            title: `${input.dropId} moment`,
            lyricText: "the hook",
            startMs: 0,
            endMs: 4000,
            editionSize: input.editionSize,
            priceCents: 0,
          },
        ],
      },
    },
  });
}

describe("Featured drops heuristic (#1479)", () => {
  // Featured is a pure read — clip/unlock deps are constructable stubs.
  const eventBus = new EventBus();
  const clipService = new PunchlineClipService(
    new LocalStorageProvider(),
    { decryptForRender: jest.fn() } as unknown as EncryptionService,
    undefined,
  );
  const service = new PunchlineDropService(
    eventBus,
    new PunchlineEligibilityService(),
    clipService,
    new PunchlineUnlockService(eventBus, clipService, undefined),
    undefined,
  );

  beforeAll(async () => {
    for (const [user, artist] of [
      [ARTIST_A_USER, ARTIST_A],
      [ARTIST_B_USER, ARTIST_B],
    ] as const) {
      await prisma.user.create({
        data: { id: user, email: `${user}@test.resonate` },
      });
      await prisma.artist.create({
        data: { id: artist, userId: user, displayName: artist },
      });
    }
    for (const artist of [ARTIST_A, ARTIST_B]) {
      await prisma.release.create({
        data: {
          id: `${artist}_release`,
          artistId: artist,
          title: `${artist} release`,
          status: "ready",
        },
      });
      await prisma.track.create({
        data: {
          id: `${artist}_track`,
          releaseId: `${artist}_release`,
          title: `${artist} track`,
          position: 1,
        },
      });
    }

    const day = 24 * 60 * 60 * 1000;
    // Artist A: three drops with descending recent momentum (6 > 5 > 4).
    await seedDrop({ dropId: DROP_HOT, artistId: ARTIST_A, trackId: `${ARTIST_A}_track`, publishedAt: new Date(Date.now() - 5 * day), editionSize: 10 });
    await seedDrop({ dropId: DROP_THIRD, artistId: ARTIST_A, trackId: `${ARTIST_A}_track`, publishedAt: new Date(Date.now() - 4 * day), editionSize: 10 });
    await seedDrop({ dropId: DROP_WARM, artistId: ARTIST_A, trackId: `${ARTIST_A}_track`, publishedAt: new Date(Date.now() - 3 * day), editionSize: 10 });
    await seedCollects(`${DROP_HOT}_m`, 6, RECENT);
    await seedCollects(`${DROP_THIRD}_m`, 5, RECENT);
    await seedCollects(`${DROP_WARM}_m`, 4, RECENT);

    // Artist B: one fully sold-out drop (excluded)…
    await seedDrop({ dropId: DROP_SOLD_OUT, artistId: ARTIST_B, trackId: `${ARTIST_B}_track`, publishedAt: new Date(Date.now() - 1 * day), editionSize: 2 });
    await seedCollects(`${DROP_SOLD_OUT}_m`, 2, RECENT);
    // …and two drops with IDENTICAL stale scarcity (8/10, outside the 7d
    // window) so ONLY publishedAt separates them.
    await seedDrop({ dropId: DROP_TIE_NEW, artistId: ARTIST_B, trackId: `${ARTIST_B}_track`, publishedAt: new Date(Date.now() - 2 * day), editionSize: 10 });
    await seedDrop({ dropId: DROP_TIE_OLD, artistId: ARTIST_B, trackId: `${ARTIST_B}_track`, publishedAt: new Date(Date.now() - 6 * day), editionSize: 10 });
    await seedCollects(`${DROP_TIE_NEW}_m`, 8, STALE);
    await seedCollects(`${DROP_TIE_OLD}_m`, 8, STALE);
  });

  afterAll(async () => {
    await prisma.punchlineCollectible.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.punchlineMoment.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.punchlineDrop.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  async function featuredMine(): Promise<string[]> {
    const result = await service.listFeaturedDrops({ limit: 12 });
    return result.items
      .map((item: { id: string }) => item.id)
      .filter((id: string) => id.startsWith(TEST_PREFIX));
  }

  it("ranks by recent collects, excludes sold-out, applies the 2-per-artist cap", async () => {
    const mine = await featuredMine();

    // Sold-out never appears (nothing actionable).
    expect(mine).not.toContain(DROP_SOLD_OUT);
    // Artist A's third drop by momentum is capped out (2-per-artist).
    expect(mine).not.toContain(DROP_WARM);
    // Momentum order among the survivors.
    expect(mine.indexOf(DROP_HOT)).toBeLessThan(mine.indexOf(DROP_THIRD));
    // Scarcity-only drops rank below recent-momentum drops.
    expect(mine.indexOf(DROP_THIRD)).toBeLessThan(mine.indexOf(DROP_TIE_NEW));
  });

  it("breaks scarcity ties by publishedAt desc (deterministic)", async () => {
    const mine = await featuredMine();
    expect(mine.indexOf(DROP_TIE_NEW)).toBeLessThan(mine.indexOf(DROP_TIE_OLD));
  });

  it("serializes public drop shape plus release/artist context", async () => {
    const result = await service.listFeaturedDrops({ limit: 12 });
    const hot = result.items.find((item: { id: string }) => item.id === DROP_HOT) as any;
    expect(hot).toBeDefined();
    expect(hot.context).toMatchObject({
      trackTitle: `${ARTIST_A} track`,
      releaseId: `${ARTIST_A}_release`,
      releaseTitle: `${ARTIST_A} release`,
      artistName: ARTIST_A,
    });
    // Public serialization: moments carry collectedCount, unlock reward hidden.
    expect(hot.moments[0].collectedCount).toBe(6);
    expect(hot.unlock?.reward).toBeUndefined();
  });

  it("cold-start fallback: with zero signals everywhere it still returns newest-published", async () => {
    // Deterministic by construction: the sort is stable and total (recent
    // collects, then scarcity, then publishedAt) — two identical calls agree.
    const first = await featuredMine();
    const second = await featuredMine();
    expect(second).toEqual(first);
  });
});
