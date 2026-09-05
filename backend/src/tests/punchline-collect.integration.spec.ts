/**
 * Punchline collect / ownership grant — Integration Test (Testcontainers) (#485)
 *
 * Real Prisma + real EventBus. Covers:
 *   (a) free-claim happy path: grant persisted (owned, edition 1, free_claim
 *       rail), queryable via listMyCollectibles, moment_collected event
 *   (b) one-per-fan cap → already_collected
 *   (c) edition scarcity under CONCURRENT collects: N fans race a size-2
 *       moment; exactly 2 grants, unique edition numbers, losers get sold_out
 *   (d) draft-drop moment cannot be collected → drop_not_published
 *   (e) paid moment → payment_rail_pending (no rail wired in this slice)
 *   (f) set completion: collecting every moment in a drop emits
 *       punchline.set_completed and reports setCompleted: true
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='punchline-collect'
 */

import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import {
  PunchlineCollectException,
  PunchlineCollectService,
} from "../modules/punchline/punchline-collect.service";
import type { ResonateEvent } from "../events/event_types";

const TEST_PREFIX = `punchline_collect_${Date.now()}_`;

const ARTIST_USER = `${TEST_PREFIX}artist_user`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;

const DROP_PUBLISHED = `${TEST_PREFIX}drop_pub`;
const DROP_DRAFT = `${TEST_PREFIX}drop_draft`;
const DROP_SET = `${TEST_PREFIX}drop_set`;

const MOMENT_FREE = `${TEST_PREFIX}m_free`;
const MOMENT_SCARCE = `${TEST_PREFIX}m_scarce`;
const MOMENT_PAID = `${TEST_PREFIX}m_paid`;
const MOMENT_DRAFT = `${TEST_PREFIX}m_draft`;
const MOMENT_SET_A = `${TEST_PREFIX}m_set_a`;
const MOMENT_SET_B = `${TEST_PREFIX}m_set_b`;

const FANS = Array.from({ length: 5 }, (_, i) => `${TEST_PREFIX}fan_${i}`);

// Nested-create payload: the parent relation supplies dropId.
function momentData(id: string, overrides: object = {}) {
  return {
    id,
    title: `Moment ${id}`,
    lyricText: "The punchline",
    startMs: 1000,
    endMs: 6000,
    editionSize: 100,
    priceCents: 0,
    ...overrides,
  };
}

describe("Punchline collect + ownership grant (integration)", () => {
  let service: PunchlineCollectService;
  let eventBus: EventBus;
  let events: ResonateEvent[];

  beforeAll(async () => {
    eventBus = new EventBus();
    events = [];
    eventBus.subscribe("punchline.moment_collected", (event) => {
      events.push(event);
    });
    eventBus.subscribe("punchline.set_completed", (event) => {
      events.push(event);
    });
    service = new PunchlineCollectService(eventBus);

    await prisma.user.create({
      data: { id: ARTIST_USER, email: `${TEST_PREFIX}artist@test.resonate` },
    });
    await prisma.artist.create({
      data: { id: ARTIST_ID, userId: ARTIST_USER, displayName: "Collect Artist" },
    });
    for (const fan of FANS) {
      await prisma.user.create({
        data: { id: fan, email: `${fan}@test.resonate` },
      });
    }
    await prisma.release.create({
      data: {
        id: RELEASE_ID,
        artistId: ARTIST_ID,
        title: "Collect Release",
        status: "ready",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: RELEASE_ID,
        title: "Collect Track",
        position: 1,
      },
    });

    await prisma.punchlineDrop.create({
      data: {
        id: DROP_PUBLISHED,
        trackId: TRACK_ID,
        artistId: ARTIST_ID,
        status: "published",
        publishedAt: new Date(),
        moments: {
          create: [
            momentData(MOMENT_FREE),
            momentData(MOMENT_SCARCE, { editionSize: 2 }),
            momentData(MOMENT_PAID, { priceCents: 150 }),
          ],
        },
      },
    });
    await prisma.punchlineDrop.create({
      data: {
        id: DROP_DRAFT,
        trackId: TRACK_ID,
        artistId: ARTIST_ID,
        status: "draft",
        moments: { create: [momentData(MOMENT_DRAFT)] },
      },
    });
    await prisma.punchlineDrop.create({
      data: {
        id: DROP_SET,
        trackId: TRACK_ID,
        artistId: ARTIST_ID,
        status: "published",
        publishedAt: new Date(),
        moments: {
          create: [
            momentData(MOMENT_SET_A),
            momentData(MOMENT_SET_B),
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.punchlineCollectible.deleteMany({
      where: { collectorUserId: { startsWith: TEST_PREFIX } },
    });
    await prisma.punchlineMoment.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.punchlineDrop.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.artist.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  const codeOf = async (promise: Promise<unknown>): Promise<string> => {
    try {
      await promise;
      return "NO_ERROR";
    } catch (error) {
      if (error instanceof PunchlineCollectException) {
        return error.code;
      }
      throw error;
    }
  };

  it("(a) grants a free moment: owned, edition 1, free_claim, queryable, event emitted", async () => {
    const result = await service.collectMoment(FANS[0], MOMENT_FREE, {
      collectorWallet: "0x1111111111111111111111111111111111111111",
    });

    expect(result.collectible).toMatchObject({
      momentId: MOMENT_FREE,
      dropId: DROP_PUBLISHED,
      editionNumber: 1,
      status: "owned",
      paymentRail: "free_claim",
      pricePaidCents: 0,
    });
    expect(result.collectible.acquiredAt).toBeTruthy();
    expect(result.setCompleted).toBe(false);

    const inventory = await service.listMyCollectibles(FANS[0]);
    expect(inventory.items.map((i) => i.moment.id)).toContain(MOMENT_FREE);
    const item = inventory.items.find((i) => i.moment.id === MOMENT_FREE)!;
    expect(item.drop.trackTitle).toBe("Collect Track");
    expect(item.drop.releaseId).toBe(RELEASE_ID);
    expect(item.drop.momentCount).toBe(3);
    expect(item.editionSize).toBe(100);

    const collected = events.find(
      (e) =>
        e.eventName === "punchline.moment_collected" &&
        (e as any).momentId === MOMENT_FREE,
    ) as any;
    expect(collected).toBeTruthy();
    expect(collected.collectorUserId).toBe(FANS[0]);
    expect(collected.editionNumber).toBe(1);
    expect(collected.paymentRail).toBe("free_claim");
  });

  it("(b) caps one edition per fan per moment with already_collected", async () => {
    await expect(codeOf(service.collectMoment(FANS[0], MOMENT_FREE))).resolves.toBe(
      "already_collected",
    );
  });

  it("(c) enforces edition scarcity under concurrent collects", async () => {
    const outcomes = await Promise.all(
      FANS.map((fan) => codeOf(service.collectMoment(fan, MOMENT_SCARCE))),
    );

    const granted = outcomes.filter((o) => o === "NO_ERROR").length;
    const soldOut = outcomes.filter((o) => o === "sold_out").length;
    expect(granted).toBe(2);
    expect(soldOut).toBe(FANS.length - 2);

    const rows = await prisma.punchlineCollectible.findMany({
      where: { momentId: MOMENT_SCARCE },
      select: { editionNumber: true },
      orderBy: { editionNumber: "asc" },
    });
    expect(rows.map((r) => r.editionNumber)).toEqual([1, 2]);

    // A latecomer after the race is also sold out.
    await expect(
      codeOf(service.collectMoment(`${TEST_PREFIX}late`, MOMENT_SCARCE)),
    ).resolves.toBe("sold_out");
  });

  it("(d) blocks collecting from an unpublished drop", async () => {
    await expect(codeOf(service.collectMoment(FANS[1], MOMENT_DRAFT))).resolves.toBe(
      "drop_not_published",
    );
  });

  it("(e) rejects priced moments on the free endpoint with payment_required", async () => {
    await expect(codeOf(service.collectMoment(FANS[1], MOMENT_PAID))).resolves.toBe(
      "payment_required",
    );
    const grants = await prisma.punchlineCollectible.count({
      where: { momentId: MOMENT_PAID },
    });
    expect(grants).toBe(0);
  });

  it("(f) completing the set reports setCompleted and emits punchline.set_completed", async () => {
    const first = await service.collectMoment(FANS[2], MOMENT_SET_A);
    expect(first.setCompleted).toBe(false);

    const second = await service.collectMoment(FANS[2], MOMENT_SET_B);
    expect(second.setCompleted).toBe(true);

    const setEvent = events.find(
      (e) =>
        e.eventName === "punchline.set_completed" &&
        (e as any).collectorUserId === FANS[2],
    ) as any;
    expect(setEvent).toBeTruthy();
    expect(setEvent.dropId).toBe(DROP_SET);
  });
});
