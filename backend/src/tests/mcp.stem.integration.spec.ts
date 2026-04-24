import { prisma } from "../db/prisma";
import { McpStemService } from "../modules/mcp/mcp-stem.service";
import { X402Config } from "../modules/x402/x402.config";
import { X402PaymentService } from "../modules/x402/x402.payment.service";

const TEST_PREFIX = `mcp_stem_${Date.now()}_`;

function mockConfig(): X402Config {
  return {
    enabled: true,
    payoutAddress: `0x${"a".repeat(40)}`,
    facilitatorUrl: "https://facilitator.example.com",
    network: "eip155:84532",
    chainId: 84532,
  } as X402Config;
}

describe("McpStemService (integration)", () => {
  let service: McpStemService;
  let paymentService: {
    buildPaymentChallenge: jest.Mock;
    resolveLicenseAmountUsd: jest.Mock;
    verifyAndSettle: jest.Mock;
  };
  const stemId = `${TEST_PREFIX}stem`;

  beforeAll(async () => {
    paymentService = {
      buildPaymentChallenge: jest.fn(async ({ stemId: quotedStemId, licenseType }) => ({
        scheme: "x402" as const,
        facilitatorUrl: "https://facilitator.example.com",
        paymentRequirements: {
          scheme: "exact",
          network: "eip155:84532",
          amount: licenseType === "commercial" ? "19000000" : "9000000",
          asset: `0x${"b".repeat(40)}`,
          payTo: `0x${"a".repeat(40)}`,
          maxTimeoutSeconds: 300,
          extra: {
            tool: "stem.download",
            stemId: quotedStemId,
            licenseType,
          },
        },
      })),
      resolveLicenseAmountUsd: jest.fn((pricing, licenseType) => {
        if (licenseType === "commercial") {
          return pricing?.commercialLicenseUsd ?? 25;
        }
        if (licenseType === "remix") {
          return pricing?.remixLicenseUsd ?? 5;
        }
        return pricing?.basePlayPriceUsd ?? 0.05;
      }),
      verifyAndSettle: jest.fn(),
    };
    service = new McpStemService(
      mockConfig(),
      paymentService as unknown as X402PaymentService,
      { decrypt: jest.fn() } as any,
    );

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
        displayName: "MCP Stem Artist",
        payoutAddress: `0x${"c".repeat(40)}`,
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: `${TEST_PREFIX}artist`,
        title: "Paid Stems",
        status: "published",
        primaryArtist: "MCP Stem Artist",
      },
    });
    await prisma.track.create({
      data: {
        id: `${TEST_PREFIX}track`,
        releaseId: `${TEST_PREFIX}release`,
        title: "Paid Stem Track",
      },
    });
    await prisma.stem.create({
      data: {
        id: stemId,
        trackId: `${TEST_PREFIX}track`,
        type: "vocals",
        title: "Paid Vocals",
        uri: "https://audio.example.com/paid-vocals.mp3",
        mimeType: "audio/mpeg",
      },
    });
    await prisma.stemPricing.create({
      data: {
        id: `${TEST_PREFIX}pricing`,
        stemId,
        basePlayPriceUsd: 0.25,
        remixLicenseUsd: 9,
        commercialLicenseUsd: 19,
      },
    });
  });

  afterAll(async () => {
    await prisma.contractEvent.deleteMany({
      where: { transactionHash: { startsWith: `x402:mcp:${stemId}` } },
    });
    await prisma.stemPricing.deleteMany({ where: { stemId } });
    await prisma.stem.deleteMany({ where: { id: stemId } });
    await prisma.track.deleteMany({
      where: { release: { artistId: `${TEST_PREFIX}artist` } },
    });
    await prisma.release.deleteMany({ where: { artistId: `${TEST_PREFIX}artist` } });
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    paymentService.verifyAndSettle.mockResolvedValue(true);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
    } as Response) as jest.Mock;
  });

  it("returns a quote with the requested license price and x402 challenge", async () => {
    const quote = await service.quote(stemId, "remix");

    expect(quote).toEqual(
      expect.objectContaining({
        stemId,
        licenseType: "remix",
        priceUsdc: "9",
        paymentChallenge: expect.objectContaining({
          scheme: "x402",
          facilitatorUrl: "https://facilitator.example.com",
        }),
        stem: expect.objectContaining({
          title: "Paid Vocals",
          trackTitle: "Paid Stem Track",
          artist: "MCP Stem Artist",
          releaseTitle: "Paid Stems",
        }),
      }),
    );
  });

  it("returns a recoverable payment error when download lacks proof", async () => {
    const result = await service.download(stemId, "commercial");

    expect(result.ok).toBe(false);
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        code: "PAYMENT_REQUIRED",
        challenge: expect.objectContaining({
          stemId,
          licenseType: "commercial",
          priceUsdc: "19",
        }),
      }),
    );
    expect(paymentService.verifyAndSettle).not.toHaveBeenCalled();
  });

  it("verifies proof, embeds the purchased stem resource, and records provenance", async () => {
    const result = await service.download(stemId, "commercial", "proof-header");

    expect(result.ok).toBe(true);
    expect(paymentService.verifyAndSettle).toHaveBeenCalledWith(
      "proof-header",
      expect.objectContaining({
        scheme: "exact",
        amount: "19000000",
      }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "https://audio.example.com/paid-vocals.mp3",
    );
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "resource",
          resource: expect.objectContaining({
            mimeType: "audio/mpeg",
            blob: Buffer.from([1, 2, 3, 4]).toString("base64"),
          }),
        }),
      ]),
    );

    const event = await prisma.contractEvent.findFirstOrThrow({
      where: { transactionHash: { startsWith: `x402:mcp:${stemId}` } },
      orderBy: { processedAt: "desc" },
    });
    expect(event.args).toEqual(
      expect.objectContaining({
        source: "mcp",
        tool: "stem.download",
        stemId,
        licenseKey: "commercial",
        amount: "19",
        currency: "USDC",
      }),
    );
  });
});
