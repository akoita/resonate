import { createHash } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
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

function createConfig(): X402Config {
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
  } as X402Config;
}

function createResponse() {
  const state = { statusCode: 200, body: null as unknown };
  const res = {
    setHeader: jest.fn(),
    status: jest.fn((statusCode: number) => {
      state.statusCode = statusCode;
      return res;
    }),
    json: jest.fn((body: unknown) => {
      state.body = body;
      return res;
    }),
  } as unknown as Response;
  return { res, state };
}

function createRequest(headers: Record<string, string> = {}) {
  return {
    path: `/api/stems/${STEM_ID}/x402`,
    headers,
    query: {},
  } as unknown as Request;
}

describe("X402Middleware current stem purchase gate (integration)", () => {
  let paymentService: {
    buildPaymentChallenge: jest.Mock;
    verifyAndSettle: jest.Mock;
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
          isCurrent: true,
        },
      ],
    });

    paymentService = {
      buildPaymentChallenge: jest.fn(),
      verifyAndSettle: jest.fn(),
    };
    middleware = new X402Middleware(
      createConfig(),
      paymentService as unknown as X402PaymentService,
    );
  });

  afterAll(async () => {
    await prisma.x402Settlement.deleteMany({ where: { stemId: STEM_ID } });
    await prisma.stem.deleteMany({ where: { trackId: TRACK_ID } });
    await prisma.track.deleteMany({ where: { id: TRACK_ID } });
    await prisma.release.deleteMany({ where: { id: RELEASE_ID } });
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
  });

  beforeEach(() => {
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

  it("returns current-only sibling summaries and withholds historical quotes", async () => {
    const controller = new X402Controller(createConfig(), {} as never);
    const currentInfo = await controller.getStemInfo(CURRENT_STEM_ID);
    expect(currentInfo).toHaveProperty("stemTypes", ["drums"]);

    await expect(controller.getStemInfo(STEM_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("declines new smart-account entitlements for historical stems", async () => {
    const controller = new X402Controller(createConfig(), {} as never);
    const { res, state } = createResponse();
    const txHash = `0x${"c".repeat(64)}`;
    await controller.downloadWithSmartAccountPayment(
      STEM_ID,
      { txHash, payer: `0x${"d1".repeat(20)}` },
      createRequest(),
      res,
    );

    expect(state.statusCode).toBe(409);
    expect(state.body).toEqual(
      expect.objectContaining({
        error: "Stem no longer available for purchase",
        message: expect.stringContaining("will not record a download entitlement"),
      }),
    );
  });

  it("keeps an already-settled smart-account replay eligible for exact download", async () => {
    const txHash = `0x${"e".repeat(64)}`;
    await prisma.x402Settlement.create({
      data: {
        resourceKind: "stem",
        stemId: STEM_ID,
        paymentTransactionHash: txHash,
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

    const controller = new X402Controller(createConfig(), {} as never);
    const verifiedPayment = {
      txHash,
      payer: `0x${"d1".repeat(20)}`,
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
      createRequest(),
      res,
    );

    expect(verify).toHaveBeenCalledWith(STEM_ID, {
      txHash,
      payer: verifiedPayment.payer,
    });
    expect(serve).toHaveBeenCalledWith(
      expect.objectContaining({ stemId: STEM_ID, eventTransactionHash: txHash }),
    );
    expect(state.statusCode).toBe(200);
  });
});
