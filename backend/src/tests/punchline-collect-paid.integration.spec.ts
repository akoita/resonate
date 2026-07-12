/**
 * Paid Punchline moment collects — Integration Test (Testcontainers) (#1462)
 *
 * Real Prisma + real EventBus. The x402 config is a lightweight fake and the
 * on-chain verification is stubbed via `getPublicClient()`, but everything the
 * money-safety of this feature depends on — the transactional grant+settlement,
 * idempotency, the refund_due path, and the price band — runs against the real
 * database.
 *
 * Covers:
 *   (a) x402 quote shapes for a priced/published/collectable moment, and honest
 *       errors for free / not-published / sold-out
 *   (b) paid collect happy path: verified payment → edition granted (rail
 *       "x402", real price, txHash ref) AND an X402Settlement recorded, both in
 *       one transaction; x402.purchase + moment_collected events
 *   (c) replay idempotency: same txHash twice → same edition, one collectible,
 *       one settlement
 *   (d) post-payment race → refund_due settlement + paid_but_unfulfilled, no
 *       edition granted
 *   (e) verification failure → no grant, no settlement, x402.purchase_failed
 *   (f) price-band validation on add/edit ($0.50–$9.99, free excepted)
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='punchline-collect'
 */

import { BadRequestException, ConflictException, HttpException } from "@nestjs/common";
import { encodeAbiParameters, encodeEventTopics, getAddress } from "viem";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { PunchlineCollectService } from "../modules/punchline/punchline-collect.service";
import { PunchlineDropService } from "../modules/punchline/punchline-drop.service";
import { PunchlineX402Service } from "../modules/punchline/punchline-x402.service";
import type { X402Config } from "../modules/x402/x402.config";
import type { ResonateEvent } from "../events/event_types";

const TEST_PREFIX = `punchline_paid_${Date.now()}_`;

const ARTIST_USER = `${TEST_PREFIX}artist_user`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const DROP_PUB = `${TEST_PREFIX}drop_pub`;
const DROP_DRAFT = `${TEST_PREFIX}drop_draft`;

const MOMENT_PAID = `${TEST_PREFIX}m_paid`;
const MOMENT_FREE = `${TEST_PREFIX}m_free`;
const MOMENT_SOLDOUT = `${TEST_PREFIX}m_soldout`;
const MOMENT_DRAFT = `${TEST_PREFIX}m_draft`;

const FAN_A = `${TEST_PREFIX}fan_a`;
const FAN_B = `${TEST_PREFIX}fan_b`;
const PRIOR_OWNER = `${TEST_PREFIX}prior`;

const PAYOUT = getAddress("0x22222222222222222222222222222222222222aa");
const PAYER = getAddress("0x11111111111111111111111111111111111111bb");
// Default Base Sepolia USDC (see x402.public.ts DEFAULT_USDC_ASSETS).
const USDC = getAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");

const TX_A = `0x${"a".repeat(64)}` as const;
const TX_SOLDOUT = `0x${"d".repeat(64)}` as const;
const TX_BADVERIFY = `0x${"e".repeat(64)}` as const;

function fakeX402Config(): X402Config {
  return {
    enabled: true,
    payoutAddress: PAYOUT,
    facilitatorUrl: "https://x402.org/facilitator",
    network: "eip155:84532",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    contractSettlementEnabled: false,
    settlementPrivateKey: null,
    licensePricing: {
      personal: { amountUsd: 0.05, feeBps: 1500 },
      remix: { amountUsd: 5, feeBps: 1000 },
      commercial: { amountUsd: 25, feeBps: 1000 },
    },
  } as unknown as X402Config;
}

/** A success receipt carrying a USDC Transfer(payer → PAYOUT, value). */
function receiptWithTransfer(value: bigint) {
  const topics = encodeEventTopics({
    abi: [
      {
        type: "event",
        name: "Transfer",
        inputs: [
          { indexed: true, name: "from", type: "address" },
          { indexed: true, name: "to", type: "address" },
          { indexed: false, name: "value", type: "uint256" },
        ],
      },
    ] as const,
    eventName: "Transfer",
    args: { from: PAYER, to: PAYOUT },
  });
  return {
    status: "success" as const,
    blockNumber: BigInt(123),
    blockHash: `0x${"b".repeat(64)}`,
    logs: [
      {
        address: USDC,
        data: encodeAbiParameters([{ type: "uint256" }], [value]),
        topics,
        logIndex: 3,
      },
    ],
  };
}

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

describe("Punchline paid collect (x402 rail, integration)", () => {
  let eventBus: EventBus;
  let events: ResonateEvent[];
  let collectService: PunchlineCollectService;
  let dropService: PunchlineDropService;
  let x402: PunchlineX402Service;

  beforeAll(async () => {
    eventBus = new EventBus();
    events = [];
    for (const name of [
      "punchline.moment_collected",
      "x402.purchase",
      "x402.purchase_failed",
    ] as const) {
      eventBus.subscribe(name, (event) => events.push(event));
    }
    collectService = new PunchlineCollectService(eventBus);
    x402 = new PunchlineX402Service(fakeX402Config(), collectService, eventBus);
    dropService = new PunchlineDropService(
      eventBus,
      {} as never,
      {} as never,
      {} as never,
      undefined,
    );

    await prisma.user.create({
      data: { id: ARTIST_USER, email: `${TEST_PREFIX}artist@test.resonate` },
    });
    await prisma.artist.create({
      data: { id: ARTIST_ID, userId: ARTIST_USER, displayName: "Paid Artist" },
    });
    for (const fan of [FAN_A, FAN_B, PRIOR_OWNER]) {
      await prisma.user.create({
        data: { id: fan, email: `${fan}@test.resonate` },
      });
    }
    await prisma.release.create({
      data: { id: RELEASE_ID, artistId: ARTIST_ID, title: "Paid Release", status: "ready" },
    });
    await prisma.track.create({
      data: { id: TRACK_ID, releaseId: RELEASE_ID, title: "Paid Track", position: 1 },
    });
    await prisma.punchlineDrop.create({
      data: {
        id: DROP_PUB,
        trackId: TRACK_ID,
        artistId: ARTIST_ID,
        status: "published",
        publishedAt: new Date(),
        moments: {
          create: [
            momentData(MOMENT_PAID, { priceCents: 150 }),
            momentData(MOMENT_FREE),
            momentData(MOMENT_SOLDOUT, { priceCents: 200, editionSize: 1 }),
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
        moments: { create: [momentData(MOMENT_DRAFT, { priceCents: 300 })] },
      },
    });
    // Pre-sell the single edition of the sold-out moment to force the race.
    await prisma.punchlineCollectible.create({
      data: {
        momentId: MOMENT_SOLDOUT,
        collectorUserId: PRIOR_OWNER,
        editionNumber: 1,
        status: "owned",
        paymentRail: "x402",
        pricePaidCents: 200,
        acquiredAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.x402Settlement.deleteMany({
      where: { momentId: { startsWith: TEST_PREFIX } },
    });
    await prisma.punchlineCollectible.deleteMany({
      where: { collectorUserId: { startsWith: TEST_PREFIX } },
    });
    await prisma.punchlineMoment.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.punchlineDrop.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  function stubVerified(value: bigint) {
    jest.spyOn(x402, "getPublicClient").mockReturnValue({
      waitForTransactionReceipt: jest.fn().mockResolvedValue(receiptWithTransfer(value)),
    } as never);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // (a) Quote --------------------------------------------------------------
  it("(a) builds an x402 quote with the 15% personal take and honest errors", async () => {
    const quote = await x402.buildMomentQuote(MOMENT_PAID);
    expect(quote).toMatchObject({
      momentId: MOMENT_PAID,
      resourceKind: "punchline_moment",
      priceCents: 150,
      amountUsd: 1.5,
      payTo: PAYOUT,
      amountUnits: "1500000",
      editionSize: 100,
      collectEndpoint: `/punchline/moments/${MOMENT_PAID}/collect/smart-account`,
    });
    expect(quote.breakdown.feeBps).toBe(1500);
    // 15% of $1.50 = $0.225 fee, $1.275 to the artist (≥85%).
    expect(quote.breakdown.platformFee.usd).toBeCloseTo(0.225, 6);
    expect(quote.breakdown.netToSeller.usd).toBeCloseTo(1.275, 6);
    expect(quote.editionsRemaining).toBe(100);

    await expect(x402.buildMomentQuote(MOMENT_FREE)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(x402.buildMomentQuote(MOMENT_DRAFT)).rejects.toMatchObject({
      response: { code: "drop_not_published" },
    });
    await expect(x402.buildMomentQuote(MOMENT_SOLDOUT)).rejects.toMatchObject({
      response: { code: "sold_out" },
    });
  });

  // (b) Happy path ---------------------------------------------------------
  it("(b) grants the edition and records the settlement in one transaction", async () => {
    stubVerified(BigInt(1_500_000));
    const result = await x402.collectWithSmartAccount(FAN_A, MOMENT_PAID, {
      txHash: TX_A,
      payer: PAYER,
    });

    expect(result.collectible).toMatchObject({
      momentId: MOMENT_PAID,
      editionNumber: 1,
      status: "owned",
      paymentRail: "x402",
      pricePaidCents: 150,
    });

    const collectible = await prisma.punchlineCollectible.findUnique({
      where: {
        momentId_collectorUserId: { momentId: MOMENT_PAID, collectorUserId: FAN_A },
      },
    });
    expect(collectible?.paymentRef).toBe(TX_A);

    const settlement = await prisma.x402Settlement.findFirst({
      where: { paymentTransactionHash: TX_A },
    });
    expect(settlement).toMatchObject({
      resourceKind: "punchline_moment",
      momentId: MOMENT_PAID,
      status: "collected",
      stemId: null,
      settlementAmountUnits: "1500000",
      payerAddress: PAYER.toLowerCase(),
    });

    const purchase = events.find(
      (e) => e.eventName === "x402.purchase" && (e as any).momentId === MOMENT_PAID,
    ) as any;
    expect(purchase).toBeTruthy();
    expect(purchase.resourceKind).toBe("punchline_moment");
    expect(purchase.amountUsd).toBe(1.5);

    const collected = events.find(
      (e) =>
        e.eventName === "punchline.moment_collected" &&
        (e as any).momentId === MOMENT_PAID,
    ) as any;
    expect(collected.pricePaidCents).toBe(150);
    expect(collected.paymentRail).toBe("x402");
  });

  // (c) Replay idempotency -------------------------------------------------
  it("(c) is idempotent on txHash — same edition, one collectible, one settlement", async () => {
    stubVerified(BigInt(1_500_000));
    const replay = await x402.collectWithSmartAccount(FAN_A, MOMENT_PAID, {
      txHash: TX_A,
      payer: PAYER,
    });
    expect(replay.collectible.editionNumber).toBe(1);

    const collectibles = await prisma.punchlineCollectible.count({
      where: { momentId: MOMENT_PAID, collectorUserId: FAN_A },
    });
    expect(collectibles).toBe(1);
    const settlements = await prisma.x402Settlement.count({
      where: { paymentTransactionHash: TX_A },
    });
    expect(settlements).toBe(1);
  });

  // (d) Post-payment race → refund_due ------------------------------------
  it("(d) records refund_due and returns paid_but_unfulfilled when sold out post-payment", async () => {
    stubVerified(BigInt(2_000_000));
    await expect(
      x402.collectWithSmartAccount(FAN_B, MOMENT_SOLDOUT, {
        txHash: TX_SOLDOUT,
        payer: PAYER,
      }),
    ).rejects.toMatchObject({ response: { code: "paid_but_unfulfilled" } });

    const granted = await prisma.punchlineCollectible.findUnique({
      where: {
        momentId_collectorUserId: {
          momentId: MOMENT_SOLDOUT,
          collectorUserId: FAN_B,
        },
      },
    });
    expect(granted).toBeNull();

    const refund = await prisma.x402Settlement.findFirst({
      where: { paymentTransactionHash: TX_SOLDOUT, status: "refund_due" },
    });
    expect(refund).toBeTruthy();
    expect(refund?.momentId).toBe(MOMENT_SOLDOUT);

    const failed = events.find(
      (e) =>
        e.eventName === "x402.purchase_failed" &&
        (e as any).momentId === MOMENT_SOLDOUT,
    ) as any;
    expect(failed.status).toBe("refund_due");
  });

  // (e) Verification failure ----------------------------------------------
  it("(e) fails closed when the on-chain payment cannot be verified", async () => {
    // Transfer value below the required amount → no matching transfer.
    stubVerified(BigInt(100));
    await expect(
      x402.collectWithSmartAccount(FAN_B, MOMENT_PAID, {
        txHash: TX_BADVERIFY,
        payer: PAYER,
      }),
    ).rejects.toBeInstanceOf(HttpException);

    const granted = await prisma.punchlineCollectible.findUnique({
      where: {
        momentId_collectorUserId: { momentId: MOMENT_PAID, collectorUserId: FAN_B },
      },
    });
    expect(granted).toBeNull();
    const settlement = await prisma.x402Settlement.findFirst({
      where: { paymentTransactionHash: TX_BADVERIFY },
    });
    expect(settlement).toBeNull();
  });

  // (f) Price band ---------------------------------------------------------
  it("(f) enforces the $0.50–$9.99 price band on add/edit (free excepted)", async () => {
    const base = {
      title: "Band moment",
      lyricText: "line",
      startMs: 1000,
      endMs: 6000,
      editionSize: 10,
    };
    // Below band and above band both rejected.
    await expect(
      dropService.addMoment(ARTIST_USER, DROP_DRAFT, { ...base, priceCents: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      dropService.addMoment(ARTIST_USER, DROP_DRAFT, { ...base, priceCents: 1500 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Free and in-band accepted.
    await expect(
      dropService.addMoment(ARTIST_USER, DROP_DRAFT, { ...base, priceCents: 0 }),
    ).resolves.toBeTruthy();
    await expect(
      dropService.addMoment(ARTIST_USER, DROP_DRAFT, { ...base, priceCents: 999 }),
    ).resolves.toBeTruthy();
  });
});
