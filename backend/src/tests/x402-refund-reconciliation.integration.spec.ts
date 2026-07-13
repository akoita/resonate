/**
 * x402 refund_due reconciliation — Integration Test (Testcontainers) (#1506)
 *
 * Real Prisma + real EventBus. Exercises the operator surface over `refund_due`
 * x402 settlements and the stale-refund watchdog against the real database.
 *
 * Covers:
 *   - listRefundDue returns only refund_due rows, oldest first, correctly shaped
 *     with ageHours derived from a backdated createdAt
 *   - markRefunded happy path: status → refunded, refundTxHash + refundedAt set,
 *     immutable receipt untouched
 *   - markRefunded on an already-refunded row → Conflict
 *   - markRefunded with a malformed tx hash → BadRequest
 *   - markRefunded on an unknown id → NotFound
 *   - watchdog runSweepOnce publishes one aggregate x402.refund_due_stale event
 *     while a stale row exists, and publishes nothing once it is refunded
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='x402-refund-reconciliation'
 */

import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { X402RefundReconciliationService } from "../modules/punchline/x402-refund-reconciliation.service";
import { X402RefundWatchdogService } from "../modules/punchline/x402-refund-watchdog.service";
import type { ResonateEvent, X402RefundDueStaleEvent } from "../events/event_types";

const TEST_PREFIX = `x402refund_${Date.now()}_`;

const ARTIST_USER = `${TEST_PREFIX}artist_user`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const DROP_ID = `${TEST_PREFIX}drop`;
const MOMENT_ID = `${TEST_PREFIX}moment`;

const PAYER = "0x11111111111111111111111111111111111111bb";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const TX_REFUND_DUE = `0x${"a".repeat(64)}`;
const TX_COLLECTED = `0x${"c".repeat(64)}`;
const REFUND_TX = `0x${"f".repeat(64)}`;

/** Shared settlement column values (a moment settled ~$1.50 in USDC). */
function settlementBase(
  overrides: Partial<Prisma.X402SettlementUncheckedCreateInput> &
    Pick<Prisma.X402SettlementUncheckedCreateInput, "receiptId">,
): Prisma.X402SettlementUncheckedCreateInput {
  return {
    resourceKind: "punchline_moment",
    momentId: MOMENT_ID,
    payerAddress: PAYER,
    paymentRail: "smart_account",
    receipt: { version: "1", type: "resonate.x402.purchase_receipt" },
    paymentToken: USDC,
    paymentAssetSymbol: "USDC",
    paymentAssetDecimals: 6,
    settlementAmount: "1.50",
    settlementAmountUnits: "1500000",
    canonicalAmountUsd: "1.50",
    purchasedAt: new Date(),
    ...overrides,
  };
}

describe("x402 refund_due reconciliation (integration)", () => {
  let service: X402RefundReconciliationService;

  beforeAll(async () => {
    service = new X402RefundReconciliationService();

    await prisma.user.create({
      data: { id: ARTIST_USER, email: `${TEST_PREFIX}artist@test.resonate` },
    });
    await prisma.artist.create({
      data: { id: ARTIST_ID, userId: ARTIST_USER, displayName: "Refund Artist" },
    });
    await prisma.release.create({
      data: { id: RELEASE_ID, artistId: ARTIST_ID, title: "Refund Release", status: "ready" },
    });
    await prisma.track.create({
      data: { id: TRACK_ID, releaseId: RELEASE_ID, title: "Refund Track", position: 1 },
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
              id: MOMENT_ID,
              title: "Sold-out punchline",
              lyricText: "the line",
              startMs: 1000,
              endMs: 6000,
              editionSize: 1,
              priceCents: 150,
            },
          ],
        },
      },
    });

    // One refund_due settlement, backdated 3h so ageHours ≥ 3 and it is "stale".
    await prisma.x402Settlement.create({
      data: settlementBase({
        receiptId: `${TEST_PREFIX}receipt_refund`,
        paymentTransactionHash: TX_REFUND_DUE,
        status: "refund_due",
        contractSettlementReason: "paid_but_unfulfilled:sold_out",
        contractSettlementStatus: "not_applicable",
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      }),
    });
    // One collected settlement that must never appear in the refund surface.
    await prisma.x402Settlement.create({
      data: settlementBase({
        receiptId: `${TEST_PREFIX}receipt_collected`,
        paymentTransactionHash: TX_COLLECTED,
        status: "collected",
        contractSettlementStatus: "not_applicable",
      }),
    });
  });

  afterAll(async () => {
    await prisma.x402Settlement.deleteMany({ where: { momentId: MOMENT_ID } });
    await prisma.punchlineMoment.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.punchlineDrop.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  it("lists only refund_due rows with the correct shape and age", async () => {
    const rows = await service.listRefundDue();
    const mine = rows.filter((r) => r.momentId === MOMENT_ID);
    expect(mine).toHaveLength(1);

    const row = mine[0];
    expect(row).toMatchObject({
      receiptId: `${TEST_PREFIX}receipt_refund`,
      payerAddress: PAYER,
      paymentTransactionHash: TX_REFUND_DUE,
      settlementAmount: "1.50",
      settlementAmountUnits: "1500000",
      paymentAssetSymbol: "USDC",
      canonicalAmountUsd: "1.50",
      momentId: MOMENT_ID,
      momentTitle: "Sold-out punchline",
      reason: "paid_but_unfulfilled:sold_out",
    });
    expect(row.ageHours).toBeGreaterThanOrEqual(3);
  });

  it("marks a refund_due settlement refunded without touching the receipt", async () => {
    const before = await prisma.x402Settlement.findFirst({
      where: { paymentTransactionHash: TX_REFUND_DUE },
    });
    expect(before?.status).toBe("refund_due");

    const updated = await service.markRefunded(before!.id, REFUND_TX, "operator-1");
    expect(updated.status).toBe("refunded");
    expect(updated.refundTxHash).toBe(REFUND_TX);
    expect(updated.refundedAt).toBeInstanceOf(Date);
    // Immutable receipt is unchanged.
    expect(updated.receipt).toEqual(before!.receipt);

    // No longer surfaced in the refund_due list.
    const rows = await service.listRefundDue();
    expect(rows.some((r) => r.id === before!.id)).toBe(false);
  });

  it("rejects marking an already-refunded settlement with a Conflict", async () => {
    const row = await prisma.x402Settlement.findFirst({
      where: { paymentTransactionHash: TX_REFUND_DUE },
    });
    await expect(
      service.markRefunded(row!.id, REFUND_TX, "operator-1"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects a malformed refund tx hash with a BadRequest", async () => {
    const row = await prisma.x402Settlement.findFirst({
      where: { paymentTransactionHash: TX_COLLECTED },
    });
    await expect(
      service.markRefunded(row!.id, "not-a-hash", "operator-1"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects an unknown settlement id with a NotFound", async () => {
    await expect(
      service.markRefunded(`${TEST_PREFIX}missing`, REFUND_TX, "operator-1"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe("stale-refund watchdog", () => {
    const STALE_TX = `0x${"b".repeat(64)}`;
    let eventBus: EventBus;
    let events: ResonateEvent[];
    let watchdog: X402RefundWatchdogService;

    beforeAll(async () => {
      eventBus = new EventBus();
      events = [];
      eventBus.subscribe("x402.refund_due_stale", (e) => events.push(e));
      watchdog = new X402RefundWatchdogService(eventBus);

      // A fresh stale refund_due row backdated well past the 2h default.
      await prisma.x402Settlement.create({
        data: settlementBase({
          receiptId: `${TEST_PREFIX}receipt_stale`,
          paymentTransactionHash: STALE_TX,
          status: "refund_due",
          contractSettlementReason: "paid_but_unfulfilled:already_collected",
          contractSettlementStatus: "not_applicable",
          createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        }),
      });
    });

    afterEach(() => {
      events.length = 0;
    });

    it("publishes one aggregate alert while a stale refund_due row exists", async () => {
      await watchdog.runSweepOnce();
      const alerts = events.filter(
        (e) => e.eventName === "x402.refund_due_stale",
      ) as X402RefundDueStaleEvent[];
      expect(alerts).toHaveLength(1);
      const alert = alerts[0];
      expect(alert.outstandingCount).toBeGreaterThanOrEqual(1);
      expect(alert.oldestAgeHours).toBeGreaterThanOrEqual(5);
      expect(alert.thresholdHours).toBe(2);
      expect(alert.settlementIds.length).toBeGreaterThanOrEqual(1);
    });

    it("publishes nothing once the stale row is refunded", async () => {
      const stale = await prisma.x402Settlement.findFirst({
        where: { paymentTransactionHash: STALE_TX },
      });
      await service.markRefunded(stale!.id, REFUND_TX, "operator-1");

      await watchdog.runSweepOnce();
      const alerts = events.filter((e) => e.eventName === "x402.refund_due_stale");
      expect(alerts).toHaveLength(0);
    });
  });
});
