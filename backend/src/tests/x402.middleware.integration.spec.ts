import { createHash } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { getAddress } from "viem";
import { prisma } from "../db/prisma";
import { X402Config } from "../modules/x402/x402.config";
import { X402Controller } from "../modules/x402/x402.controller";
import { X402Middleware } from "../modules/x402/x402.middleware";
import { X402PaymentService } from "../modules/x402/x402.payment.service";

const TEST_PREFIX = `x402current_${Date.now()}_`;
const USER_ID = `${TEST_PREFIX}user`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const STEM_ID = `${TEST_PREFIX}stem`;
const CURRENT_STEM_ID = `${TEST_PREFIX}current_stem`;
const LISTING_ID = BigInt(Date.now()) + 50_000n;
const TOKEN_ID = LISTING_ID + 1_000n;
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
let listingRowId: string;

function createConfig(overrides: Partial<X402Config> = {}): X402Config {
  const licensePricing = {
    personal: { amountUsd: 0.05, feeBps: 1500 },
    remix: { amountUsd: 5, feeBps: 1000 },
    commercial: { amountUsd: 25, feeBps: 1000 },
  };
  return {
    enabled: true,
    payoutAddress: `0x${"a1".repeat(20)}`,
    facilitatorUrl: "https://x402.org/facilitator",
    network: "eip155:84532",
    chainId: 84532,
    contractSettlementEnabled: false,
    licensePricing,
    resolveLicenseAmountUsd: (pricing: any, licenseType: string) => {
      if (licenseType === "remix") {
        return pricing?.remixLicenseUsd ?? licensePricing.remix.amountUsd;
      }
      if (licenseType === "commercial") {
        return pricing?.commercialLicenseUsd ?? licensePricing.commercial.amountUsd;
      }
      return pricing?.basePlayPriceUsd ?? licensePricing.personal.amountUsd;
    },
    ...overrides,
  } as X402Config;
}

function createResponse() {
  const state = { statusCode: 200, body: null as unknown };
  const res = {
    setHeader: jest.fn(),
    set: jest.fn(() => res),
    status: jest.fn((statusCode: number) => {
      state.statusCode = statusCode;
      return res;
    }),
    json: jest.fn((body: unknown) => {
      state.body = body;
      return res;
    }),
    send: jest.fn((body: unknown) => {
      state.body = body;
      return res;
    }),
  } as unknown as Response;
  return { res, state };
}

function createRequest(
  headers: Record<string, string> = {},
  stemId = STEM_ID,
  userId?: string,
) {
  return {
    path: `/api/stems/${stemId}/x402`,
    headers,
    query: {},
    ...(userId ? { user: { userId } } : {}),
  } as unknown as Request;
}

const BUYER_PAYER = `0x${"d1".repeat(20)}`;

/** Real controller, with only the buyer-ownership lookup stubbed (USER_ID owns BUYER_PAYER). */
function createBuyerBoundController(
  storage: object = {},
  config: X402Config = createConfig(),
) {
  const authService = {
    isAddressForUser: jest.fn(
      async (userId: string, address: string) =>
        userId === USER_ID && address.toLowerCase() === BUYER_PAYER,
    ),
  };
  const controller = new X402Controller(
    config,
    storage as never,
    undefined,
    undefined,
    undefined,
    authService as never,
  );
  return { controller, authService };
}

describe("X402Middleware current stem purchase gate (integration)", () => {
  let paymentService: {
    buildPaymentChallenge: jest.Mock;
    verifyAndSettle: jest.Mock;
    resolveAssetInfo: jest.Mock;
  };
  let middleware: X402Middleware;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: USER_ID, email: `${TEST_PREFIX}user@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: USER_ID,
        displayName: "Historical Stem Gate Artist",
        payoutAddress: `0x${"b2".repeat(20)}`,
      },
    });
    await prisma.release.create({
      data: {
        id: RELEASE_ID,
        artistId: ARTIST_ID,
        title: "Historical Stem Gate Release",
        status: "published",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: RELEASE_ID,
        title: "Historical Stem Gate Track",
        position: 1,
      },
    });
    await prisma.stem.createMany({
      data: [
        {
          id: STEM_ID,
          trackId: TRACK_ID,
          type: "vocals",
          uri: "/test/historical-vocals.mp3",
          isCurrent: false,
        },
        {
          id: CURRENT_STEM_ID,
          trackId: TRACK_ID,
          type: "drums",
          uri: "/test/current-drums.mp3",
          data: Buffer.from([1, 2, 3, 4]),
          isCurrent: true,
        },
      ],
    });
    const listing = await prisma.stemListing.create({
      data: {
        listingId: LISTING_ID,
        stemId: CURRENT_STEM_ID,
        tokenId: TOKEN_ID,
        chainId: 84532,
        contractAddress: `0x${"c3".repeat(20)}`,
        sellerAddress: `0x${"b2".repeat(20)}`,
        pricePerUnit: "50000",
        amount: BigInt(1),
        paymentToken: USDC_ADDRESS,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        transactionHash: `${TEST_PREFIX}listing`,
        blockNumber: BigInt(1),
        listedAt: new Date(),
      },
    });
    listingRowId = listing.id;

    paymentService = {
      buildPaymentChallenge: jest.fn(),
      verifyAndSettle: jest.fn(),
      resolveAssetInfo: jest.fn(() => ({
        assetId: "base-sepolia:usdc",
        address: USDC_ADDRESS,
        symbol: "USDC",
        name: "USDC",
        version: "2",
        decimals: 6,
      })),
    };
    middleware = new X402Middleware(
      createConfig(),
      paymentService as unknown as X402PaymentService,
    );
  });

  afterAll(async () => {
    await prisma.x402Settlement.deleteMany({
      where: { stemId: { in: [STEM_ID, CURRENT_STEM_ID] } },
    });
    await prisma.stemListing.deleteMany({ where: { id: listingRowId } });
    await prisma.stem.deleteMany({ where: { trackId: TRACK_ID } });
    await prisma.track.deleteMany({ where: { id: TRACK_ID } });
    await prisma.release.deleteMany({ where: { id: RELEASE_ID } });
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
  });

  beforeEach(async () => {
    await prisma.stem.update({
      where: { id: STEM_ID },
      data: { isCurrent: false },
    });
    await prisma.stem.update({
      where: { id: CURRENT_STEM_ID },
      data: { isCurrent: true },
    });
    await prisma.stemListing.update({
      where: { id: listingRowId },
      data: {
        amount: BigInt(1),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        status: "active",
      },
    });
    paymentService.buildPaymentChallenge.mockClear();
    paymentService.verifyAndSettle.mockClear();
  });

  it("rejects a new challenge and paid retry before charging for a historical stem", async () => {
    const headerCases: Array<Record<string, string>> = [
      {},
      { "payment-signature": "new-proof" },
    ];
    for (const headers of headerCases) {
      const { res, state } = createResponse();
      const next = jest.fn() as unknown as NextFunction;

      await middleware.use(createRequest(headers), res, next);

      expect(state.statusCode).toBe(409);
      expect(state.body).toEqual(
        expect.objectContaining({
          error: "Stem no longer available for purchase",
        }),
      );
      expect(next).not.toHaveBeenCalled();
    }

    expect(paymentService.buildPaymentChallenge).not.toHaveBeenCalled();
    expect(paymentService.verifyAndSettle).not.toHaveBeenCalled();
    await expect(
      prisma.x402Settlement.findMany({ where: { stemId: STEM_ID } }),
    ).resolves.toHaveLength(0);
  });

  it("allows an already-settled exact payment proof to reach historical downloads", async () => {
    const proof = "previously-settled-proof";
    await prisma.x402Settlement.create({
      data: {
        resourceKind: "stem",
        stemId: STEM_ID,
        paymentProofSha256: createHash("sha256").update(proof).digest("hex"),
        receiptId: `${TEST_PREFIX}receipt`,
        receipt: { version: "1", type: "resonate.x402.purchase_receipt" },
        paymentToken: `0x${"0".repeat(40)}`,
        paymentAssetSymbol: "USDC",
        paymentAssetDecimals: 6,
        settlementAmount: "0.05",
        settlementAmountUnits: "50000",
        canonicalAmountUsd: "0.05",
        purchasedAt: new Date(),
      },
    });

    const { res, state } = createResponse();
    const next = jest.fn() as unknown as NextFunction;
    await middleware.use(
      createRequest({ "payment-signature": proof }),
      res,
      next,
    );

    expect(state.statusCode).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
    expect(paymentService.buildPaymentChallenge).not.toHaveBeenCalled();
    expect(paymentService.verifyAndSettle).not.toHaveBeenCalled();
  });

  it("grants the exact paid stem if it becomes historical during facilitator settlement", async () => {
    const proof = "payment-settled-during-current-transition";
    paymentService.buildPaymentChallenge.mockResolvedValue({
      paymentRequirements: { scheme: "exact" },
    });
    paymentService.verifyAndSettle.mockImplementation(async () => {
      await prisma.stem.update({
        where: { id: CURRENT_STEM_ID },
        data: { isCurrent: false },
      });
      return { ok: true };
    });

    const controller = new X402Controller(
      createConfig({ contractSettlementEnabled: true }),
      {
        loadSourceBuffer: jest.fn().mockResolvedValue(Buffer.from([1, 2, 3, 4])),
      } as never,
    );
    const marketplaceSettlement = jest
      .spyOn(controller as any, "executeMarketplaceSettlement")
      .mockResolvedValue({
        transactionHash: `0x${"e".repeat(64)}`,
        eventName: "Sold",
      });
    const req = createRequest(
      {
        "payment-signature": proof,
        "x-resonate-buyer": `0x${"d1".repeat(20)}`,
      },
      CURRENT_STEM_ID,
    );
    const { res, state } = createResponse();
    const next = jest.fn(async () =>
      controller.downloadWithPayment(CURRENT_STEM_ID, req, res),
    ) as unknown as NextFunction;
    const listedMiddleware = new X402Middleware(
      createConfig({ contractSettlementEnabled: true }),
      paymentService as unknown as X402PaymentService,
    );

    await listedMiddleware.use(req, res, next);

    expect(paymentService.verifyAndSettle).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(paymentService.resolveAssetInfo).toHaveBeenCalledTimes(1);
    expect(marketplaceSettlement).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(200);
    expect(state.body).toBeInstanceOf(Buffer);
    const settlement = await prisma.x402Settlement.findUnique({
      where: {
        paymentProofSha256: createHash("sha256").update(proof).digest("hex"),
      },
    });
    expect(settlement).toEqual(
      expect.objectContaining({
        stemId: CURRENT_STEM_ID,
        status: "download_granted",
        contractSettlementStatus: "download_only",
      }),
    );
    await expect(
      prisma.contractEvent.findFirst({
        where: {
          eventName: "x402.purchase",
          transactionHash: { contains: `x402:${CURRENT_STEM_ID}:` },
        },
      }),
    ).resolves.toEqual(expect.objectContaining({ eventName: "x402.purchase" }));
  });

  it("returns current-only sibling summaries and withholds historical quotes", async () => {
    const controller = new X402Controller(createConfig(), {} as never);
    const currentInfo = await controller.getStemInfo(CURRENT_STEM_ID);
    expect(currentInfo).toHaveProperty("stemTypes", ["drums"]);

    await expect(controller.getStemInfo(STEM_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("refuses a smart-account proof on the x402 header route without charging or granting", async () => {
    const proof = `smart-account:${BUYER_PAYER}:0x${"1".repeat(64)}`;
    for (const headerName of ["payment-signature", "x-payment"]) {
      const { res, state } = createResponse();
      const next = jest.fn() as unknown as NextFunction;

      await middleware.use(createRequest({ [headerName]: proof }), res, next);

      expect(state.statusCode).toBe(403);
      expect(state.body).toEqual(
        expect.objectContaining({ code: "smart_account_proof_not_accepted" }),
      );
      expect(next).not.toHaveBeenCalled();
    }

    // The handler refuses on its own too, in case the middleware is bypassed.
    const controller = new X402Controller(createConfig(), {} as never);
    const { res, state } = createResponse();
    await controller.downloadWithPayment(
      STEM_ID,
      createRequest({ "payment-signature": proof }),
      res,
    );
    expect(state.statusCode).toBe(403);
    expect(state.body).toEqual(
      expect.objectContaining({ code: "smart_account_proof_not_accepted" }),
    );

    expect(paymentService.buildPaymentChallenge).not.toHaveBeenCalled();
    expect(paymentService.verifyAndSettle).not.toHaveBeenCalled();
    await expect(
      prisma.x402Settlement.findMany({
        where: { stemId: STEM_ID, paymentRail: "smart_account" },
      }),
    ).resolves.toHaveLength(0);
    await expect(
      prisma.contractEvent.findFirst({
        where: { transactionHash: { contains: `x402:${STEM_ID}:` } },
      }),
    ).resolves.toBeNull();
  });

  it("never replays an already-settled smart-account settlement on the x402 header route", async () => {
    const txHash = `0x${"e".repeat(64)}`;
    const proof = `smart-account:${BUYER_PAYER}:${txHash}`;
    // A proof that is not recognizable as a smart-account proof, but whose hash
    // matches a smart-account settlement, must not be served either.
    const opaqueProof = "opaque-header-matching-a-smart-account-settlement";
    await prisma.x402Settlement.create({
      data: {
        resourceKind: "stem",
        stemId: STEM_ID,
        paymentProofSha256: createHash("sha256").update(opaqueProof).digest("hex"),
        paymentTransactionHash: txHash,
        paymentRail: "smart_account",
        receiptId: `${TEST_PREFIX}smart_header_receipt`,
        receipt: { version: "1", type: "resonate.x402.purchase_receipt" },
        paymentToken: `0x${"0".repeat(40)}`,
        paymentAssetSymbol: "USDC",
        paymentAssetDecimals: 6,
        settlementAmount: "0.05",
        settlementAmountUnits: "50000",
        canonicalAmountUsd: "0.05",
        purchasedAt: new Date(),
      },
    });

    const { res, state } = createResponse();
    const next = jest.fn() as unknown as NextFunction;
    await middleware.use(
      createRequest({ "payment-signature": opaqueProof }),
      res,
      next,
    );
    expect(state.statusCode).toBe(403);
    expect(state.body).toEqual(
      expect.objectContaining({ code: "smart_account_proof_not_accepted" }),
    );
    expect(next).not.toHaveBeenCalled();

    const controller = new X402Controller(createConfig(), {} as never);
    const serve = jest.spyOn(controller as any, "writePaidStemResponse");
    const { res: handlerRes, state: handlerState } = createResponse();
    await controller.downloadWithPayment(
      STEM_ID,
      createRequest({ "payment-signature": opaqueProof }),
      handlerRes,
    );
    expect(handlerState.statusCode).toBe(403);
    expect(handlerState.body).toEqual(
      expect.objectContaining({ code: "smart_account_proof_not_accepted" }),
    );
    expect(serve).not.toHaveBeenCalled();

    // The direct proof form is refused too, and nothing new is written.
    const { res: proofRes, state: proofState } = createResponse();
    await middleware.use(
      createRequest({ "payment-signature": proof }),
      proofRes,
      jest.fn() as unknown as NextFunction,
    );
    expect(proofState.statusCode).toBe(403);
    expect(paymentService.verifyAndSettle).not.toHaveBeenCalled();
    await expect(
      prisma.x402Settlement.findMany({
        where: { stemId: STEM_ID, paymentRail: "smart_account" },
      }),
    ).resolves.toHaveLength(1);
  });

  it("grants a historical stem for a verified buyer-bound smart-account payment and blocks cross-stem replay", async () => {
    const txHash = `0x${"c".repeat(64)}`;
    const payer = BUYER_PAYER;
    const verifiedPayment = {
      txHash,
      payer,
      assetAddress: USDC_ADDRESS,
      amountUnits: "50000",
      logIndex: 1,
      blockNumber: BigInt(1),
      blockHash: `0x${"a2".repeat(32)}`,
    };
    const { controller, authService } = createBuyerBoundController({
      loadSourceBuffer: jest.fn().mockResolvedValue(Buffer.from([1, 2, 3, 4])),
    });
    const verify = jest
      .spyOn(controller as any, "verifySmartAccountPayment")
      .mockResolvedValue(verifiedPayment);
    const { res, state } = createResponse();

    await controller.downloadWithSmartAccountPayment(
      STEM_ID,
      { txHash, payer },
      createRequest({}, STEM_ID, USER_ID),
      res,
    );

    expect(authService.isAddressForUser).toHaveBeenCalledWith(
      USER_ID,
      getAddress(payer),
    );
    expect(verify).toHaveBeenCalledWith(STEM_ID, { txHash, payer });
    expect(state.statusCode).toBe(200);
    expect(state.body).toBeInstanceOf(Buffer);
    await expect(
      prisma.x402Settlement.findUnique({
        where: { paymentTransactionHash: txHash },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        stemId: STEM_ID,
        status: "download_granted",
        paymentRail: "smart_account",
      }),
    );

    const { controller: crossStemController } = createBuyerBoundController();
    jest
      .spyOn(crossStemController as any, "verifySmartAccountPayment")
      .mockResolvedValue(verifiedPayment);
    const { res: replayRes, state: replayState } = createResponse();
    await crossStemController.downloadWithSmartAccountPayment(
      CURRENT_STEM_ID,
      { txHash, payer },
      createRequest({}, CURRENT_STEM_ID, USER_ID),
      replayRes,
    );

    expect(replayState.statusCode).toBe(409);
    expect(replayState.body).toEqual(
      expect.objectContaining({ error: "Payment already redeemed" }),
    );
    await expect(
      prisma.x402Settlement.findMany({
        where: { paymentTransactionHash: txHash },
      }),
    ).resolves.toHaveLength(1);
  });

  it("refuses to redeem a smart-account payment for a buyer who does not own the payer", async () => {
    const txHash = `0x${"b".repeat(64)}`;
    const { controller, authService } = createBuyerBoundController();
    const verify = jest.spyOn(controller as any, "verifySmartAccountPayment");
    const { res } = createResponse();

    await expect(
      controller.downloadWithSmartAccountPayment(
        STEM_ID,
        { txHash, payer: BUYER_PAYER },
        createRequest({}, STEM_ID, `${TEST_PREFIX}someone_else`),
        res,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "payer_not_linked" }),
    });

    expect(authService.isAddressForUser).toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    await expect(
      prisma.x402Settlement.findMany({
        where: { paymentTransactionHash: txHash },
      }),
    ).resolves.toHaveLength(0);
  });

  it("keeps an already-settled smart-account replay eligible for exact download by the same buyer", async () => {
    const txHash = `0x${"f".repeat(64)}`;
    await prisma.x402Settlement.create({
      data: {
        resourceKind: "stem",
        stemId: STEM_ID,
        paymentTransactionHash: txHash,
        paymentRail: "smart_account",
        receiptId: `${TEST_PREFIX}smart_receipt`,
        receipt: { version: "1", type: "resonate.x402.purchase_receipt" },
        paymentToken: `0x${"0".repeat(40)}`,
        paymentAssetSymbol: "USDC",
        paymentAssetDecimals: 6,
        settlementAmount: "0.05",
        settlementAmountUnits: "50000",
        canonicalAmountUsd: "0.05",
        purchasedAt: new Date(),
      },
    });

    const { controller } = createBuyerBoundController();
    const verifiedPayment = {
      txHash,
      payer: BUYER_PAYER,
      assetAddress: `0x${"f1".repeat(20)}`,
      amountUnits: "50000",
      logIndex: 1,
      blockNumber: BigInt(1),
      blockHash: `0x${"a2".repeat(32)}`,
    };
    const verify = jest
      .spyOn(controller as any, "verifySmartAccountPayment")
      .mockResolvedValue(verifiedPayment);
    const serve = jest
      .spyOn(controller as any, "servePaidStemDownload")
      .mockResolvedValue(undefined);
    const { res, state } = createResponse();

    await controller.downloadWithSmartAccountPayment(
      STEM_ID,
      { txHash, payer: verifiedPayment.payer },
      createRequest({}, STEM_ID, USER_ID),
      res,
    );

    expect(verify).toHaveBeenCalledWith(STEM_ID, {
      txHash,
      payer: verifiedPayment.payer,
    });
    expect(serve).toHaveBeenCalledWith(
      expect.objectContaining({
        stemId: STEM_ID,
        eventTransactionHash: txHash,
        allowSmartAccountSettlement: true,
      }),
    );
    expect(state.statusCode).toBe(200);
  });
});
