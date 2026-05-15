/**
 * PaymentRouterService x402 rail integration test.
 *
 * Uses real Testcontainer Postgres for stem/pricing/provenance records while
 * stubbing the external x402 facilitator helper.
 */

import { prisma } from "../db/prisma";
import { PaymentRouterService } from "../modules/agents/payment_router.service";
import { PolicyGuardService } from "../modules/agents/policy_guard.service";

const TEST_PREFIX = `router_x402_${Date.now()}_`;

describe("PaymentRouterService x402 rail (integration)", () => {
  let stemId: string;

  const x402Config = {
    enabled: true,
    payoutAddress: "0x1111111111111111111111111111111111111111",
    facilitatorUrl: "https://facilitator.example.test",
    network: "eip155:84532",
    chainId: 84532,
  };

  const challenge = {
    scheme: "x402" as const,
    facilitatorUrl: x402Config.facilitatorUrl,
    paymentRequirements: {
      scheme: "exact",
      network: x402Config.network,
      amount: "5000000",
      asset: "0x2222222222222222222222222222222222222222",
      payTo: x402Config.payoutAddress,
    },
  };

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: `${TEST_PREFIX}user`,
        email: `${TEST_PREFIX}user@test.resonate`,
      },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: "Router x402 Artist",
        payoutAddress: "0x" + "A".repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: `${TEST_PREFIX}artist`,
        title: "Router x402 Release",
        primaryArtist: "Router x402 Artist",
        status: "published",
      },
    });
    await prisma.track.create({
      data: {
        id: `${TEST_PREFIX}track`,
        releaseId: `${TEST_PREFIX}release`,
        title: "Router x402 Track",
        position: 1,
      },
    });
    const stem = await prisma.stem.create({
      data: {
        id: `${TEST_PREFIX}stem`,
        trackId: `${TEST_PREFIX}track`,
        type: "vocals",
        uri: "/uploads/router-x402.mp3",
        title: "Router x402 Vocals",
        mimeType: "audio/mpeg",
      },
    });
    stemId = stem.id;
    await prisma.stemPricing.create({
      data: {
        stemId,
        basePlayPriceUsd: 0.25,
        remixLicenseUsd: 5,
        commercialLicenseUsd: 25,
      },
    });
  });

  afterAll(async () => {
    await prisma.contractEvent.deleteMany({
      where: { transactionHash: { startsWith: `x402:agent:${stemId}:` } },
    }).catch(() => {});
    await prisma.stemPricing.deleteMany({ where: { stemId } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { id: stemId } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: `${TEST_PREFIX}track` } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  function makeService(verifyResult: { ok: true } | { ok: false; reason: string } = { ok: true }) {
    const x402Rail = {
      resolveLicenseAmountUsd: jest.fn((pricing, licenseType) => {
        if (licenseType === "commercial") return pricing.commercialLicenseUsd;
        if (licenseType === "remix") return pricing.remixLicenseUsd;
        return pricing.basePlayPriceUsd;
      }),
      buildPaymentChallenge: jest.fn().mockResolvedValue(challenge),
      verifyAndSettle: jest.fn().mockResolvedValue(verifyResult),
    };
    const paymentsService = {
      getPaymentAssets: jest.fn().mockReturnValue({ assets: [] }),
    };

    return {
      x402Rail,
      service: new PaymentRouterService(
        new PolicyGuardService(),
        { purchase: jest.fn() } as any,
        x402Rail as any,
        x402Config as any,
        paymentsService as any,
      ),
    };
  }

  it("returns a payment challenge before settlement", async () => {
    const { service, x402Rail } = makeService();

    const result = await service.purchase({
      sessionId: `${TEST_PREFIX}session`,
      userId: `${TEST_PREFIX}user`,
      rail: "x402",
      stemId,
      licenseType: "remix",
      budgetRemainingUsd: 10,
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        rail: "x402",
        status: "payment_required",
        reason: "payment_required",
        stemId,
        licenseType: "remix",
        priceUsd: 5,
        remaining: 5,
        paymentChallenge: challenge,
      }),
    );
    expect(x402Rail.verifyAndSettle).not.toHaveBeenCalled();
  });

  it("rejects over-budget x402 purchases before verification", async () => {
    const { service, x402Rail } = makeService();

    const result = await service.purchase({
      sessionId: `${TEST_PREFIX}session`,
      userId: `${TEST_PREFIX}user`,
      rail: "x402",
      stemId,
      licenseType: "commercial",
      budgetRemainingUsd: 10,
      paymentProof: "proof",
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        rail: "x402",
        status: "rejected",
        reason: "budget_exceeded",
        priceUsd: 25,
      }),
    );
    expect(x402Rail.verifyAndSettle).not.toHaveBeenCalled();
  });

  it("normalizes x402 verification failures", async () => {
    const { service } = makeService({ ok: false, reason: "invalid_payment" });

    const result = await service.purchase({
      sessionId: `${TEST_PREFIX}session`,
      userId: `${TEST_PREFIX}user`,
      rail: "x402",
      stemId,
      licenseType: "personal",
      budgetRemainingUsd: 10,
      paymentProof: "bad-proof",
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        rail: "x402",
        status: "failed",
        reason: "invalid_payment",
        priceUsd: 0.25,
      }),
    );
  });

  it("settles x402 payments and records normalized receipt provenance", async () => {
    const { service, x402Rail } = makeService();

    const result = await service.purchase({
      sessionId: `${TEST_PREFIX}session`,
      userId: `${TEST_PREFIX}user`,
      rail: "x402",
      stemId,
      licenseType: "remix",
      budgetRemainingUsd: 10,
      paymentProof: "paid-proof",
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        rail: "x402",
        status: "confirmed",
        reason: "payment_confirmed",
        stemId,
        licenseType: "remix",
        priceUsd: 5,
        remaining: 5,
      }),
    );
    expect(result.receiptId).toMatch(/^x402r_/);
    expect(result.receipt?.license.key).toBe("remix");
    expect(x402Rail.verifyAndSettle).toHaveBeenCalledWith(
      "paid-proof",
      challenge.paymentRequirements,
    );

    const event = await prisma.contractEvent.findFirst({
      where: {
        eventName: "x402.purchase",
        transactionHash: result.txHash,
      },
    });
    expect(event).not.toBeNull();
    expect(event!.args).toEqual(
      expect.objectContaining({
        source: "agent_payment_router",
        stemId,
        receiptId: result.receiptId,
        licenseKey: "remix",
        amountUsd: "5",
      }),
    );
  });
});
