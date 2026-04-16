import { X402Controller } from '../modules/x402/x402.controller';
import { X402Config } from '../modules/x402/x402.config';

jest.mock('../db/prisma', () => ({
  prisma: {
    stem: {
      findUnique: jest.fn(),
    },
    stemListing: {
      findFirst: jest.fn(),
    },
    stemPricing: {
      findUnique: jest.fn(),
    },
    contractEvent: {
      create: jest.fn(),
    },
  },
}));

const { prisma } = jest.requireMock('../db/prisma') as {
  prisma: {
    stem: { findUnique: jest.Mock };
    stemListing: { findFirst: jest.Mock };
    stemPricing: { findUnique: jest.Mock };
    contractEvent: { create: jest.Mock };
  };
};

function createMockConfig(overrides: Partial<X402Config> = {}): X402Config {
  return {
    enabled: true,
    payoutAddress: '0xTestPayoutAddr',
    facilitatorUrl: 'https://x402.org/facilitator',
    network: 'eip155:84532',
    chainId: 84532,
    ...overrides,
  } as X402Config;
}

function createMockRes() {
  const res: any = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
    set(headers: Record<string, any>) {
      Object.assign(res.headers, headers);
      return res;
    },
    send(data: any) {
      res.body = data;
      return res;
    },
  };
  return res;
}

describe('X402Controller', () => {
  const encryptionService = {
    decrypt: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
    } as Response) as jest.Mock;
  });

  it('adds a structured receipt artifact to successful paid downloads', async () => {
    prisma.stem.findUnique.mockResolvedValue({
      id: 'stem_1',
      type: 'vocals',
      title: 'Hook Vocals',
      uri: 'https://example.com/stem.mp3',
      encryptionMetadata: null,
      nftMint: { tokenId: BigInt(42) },
      track: {
        title: 'Midnight Run',
        release: {
          title: 'Neon Heat',
          primaryArtist: 'Koita',
        },
      },
    });
    prisma.stemPricing.findUnique.mockResolvedValue({
      basePlayPriceUsd: 0.75,
    });

    const controller = new X402Controller(
      createMockConfig(),
      encryptionService as any,
    );
    const req: any = { headers: { 'x-payment': 'proof-abc' } };
    const res = createMockRes();

    await controller.downloadWithPayment('stem_1', req, res);

    expect(res.headers['Content-Type']).toBe('audio/mpeg');
    expect(res.headers['X-Resonate-License']).toBe('personal');
    expect(res.headers['X-Resonate-Receipt-Id']).toMatch(/^x402r_/);
    expect(res.headers['X-Resonate-Receipt-Content-Type']).toBe(
      'application/vnd.resonate.purchase-receipt+json',
    );

    const decodedReceipt = JSON.parse(
      Buffer.from(res.headers['X-Resonate-Receipt'], 'base64url').toString(
        'utf8',
      ),
    );
    expect(decodedReceipt.resource.stemId).toBe('stem_1');
    expect(decodedReceipt.payment.amount).toBe('0.75');
    expect(decodedReceipt.license.key).toBe('personal');
    expect(res.body).toBeInstanceOf(Buffer);

    expect(prisma.contractEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventName: 'x402.purchase',
        chainId: 84532,
        args: expect.objectContaining({
          stemId: 'stem_1',
          receiptId: decodedReceipt.receiptId,
          amount: '0.75',
          currency: 'USDC',
        }),
      }),
    });
  });

  it('resolves relative local blob URLs and records PAYMENT-SIGNATURE receipts', async () => {
    prisma.stem.findUnique.mockResolvedValue({
      id: 'stem_local',
      type: 'vocals',
      title: 'Local Stem',
      uri: '/catalog/stems/e2e-x402.m4a/blob',
      mimeType: 'audio/mp4',
      encryptionMetadata: null,
      nftMint: null,
      track: {
        title: 'Local Track',
        release: {
          title: 'Local Release',
          primaryArtist: 'Koita',
        },
      },
    });
    prisma.stemPricing.findUnique.mockResolvedValue({
      basePlayPriceUsd: 0.05,
    });

    const controller = new X402Controller(
      createMockConfig({ network: 'eip155:8453' }),
      encryptionService as any,
    );
    const req: any = {
      protocol: 'http',
      headers: { 'payment-signature': 'proof-v2' },
      get: jest.fn((header: string) =>
        header.toLowerCase() === 'host' ? 'localhost:3000' : undefined,
      ),
    };
    const res = createMockRes();

    await controller.downloadWithPayment('stem_local', req, res);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/catalog/stems/e2e-x402.m4a/blob',
    );
    expect(res.headers['Content-Type']).toBe('audio/mp4');
    expect(res.headers['Content-Disposition']).toContain('Local Stem.m4a');
    expect(prisma.contractEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        chainId: 8453,
      }),
    });

    const decodedReceipt = JSON.parse(
      Buffer.from(res.headers['X-Resonate-Receipt'], 'base64url').toString(
        'utf8',
      ),
    );
    expect(decodedReceipt.payment.paymentProofSha256).toBeDefined();
    expect(decodedReceipt.resource.mimeType).toBe('audio/mp4');
  });

  it('returns storefront-grade x402 info metadata with payment aliases', async () => {
    prisma.stem.findUnique.mockResolvedValue({
      id: 'stem_1',
      type: 'vocals',
      title: 'Hook Vocals',
      ipnftId: 'ipnft_1',
      mimeType: 'audio/mpeg',
      durationSeconds: 12.5,
      track: {
        id: 'track_1',
        title: 'Midnight Run',
        artist: 'Koita',
        stems: [
          { id: 'stem_2', type: 'drums' },
          { id: 'stem_1', type: 'vocals' },
        ],
        release: {
          id: 'release_1',
          title: 'Neon Heat',
          primaryArtist: 'Koita',
        },
      },
      nftMint: { tokenId: BigInt(42) },
    });
    prisma.stemListing.findFirst.mockResolvedValue({
      pricePerUnit: '12300000000000000',
    });
    prisma.stemPricing.findUnique.mockResolvedValue({
      basePlayPriceUsd: 0.05,
      remixLicenseUsd: 5,
      commercialLicenseUsd: 25,
    });

    const controller = new X402Controller(
      createMockConfig(),
      encryptionService as any,
    );

    const result = await controller.getStemInfo('stem_1');

    expect(result).toEqual({
      id: 'stem_1',
      stemId: 'stem_1',
      title: 'Hook Vocals',
      artist: 'Koita',
      releaseId: 'release_1',
      releaseTitle: 'Neon Heat',
      trackId: 'track_1',
      trackTitle: 'Midnight Run',
      stemType: 'vocals',
      stemTypes: ['drums', 'vocals'],
      type: 'vocals',
      hasNft: true,
      hasIpnft: true,
      tokenId: '42',
      price: {
        currency: 'USDC',
        amount: '0.05',
        display: '0.05 USDC',
        usd: 0.05,
      },
      licenseOptions: [
        {
          key: 'personal',
          price: { currency: 'USDC', amount: '0.05' },
          displayPrice: '0.05 USDC',
        },
        {
          key: 'remix',
          price: { currency: 'USDC', amount: '5' },
          displayPrice: '5 USDC',
        },
        {
          key: 'commercial',
          price: { currency: 'USDC', amount: '25' },
          displayPrice: '25 USDC',
        },
      ],
      priceSummary: {
        currency: 'USDC',
        from: '0.05',
        to: '25',
        display: '0.05-25 USDC',
      },
      alternativeOffers: [
        {
          type: 'marketplace_listing',
          currency: 'ETH',
          amountWei: '12300000000000000',
        },
      ],
      previewUrl: '/catalog/stems/stem_1/preview',
      quoteUrl: '/api/stems/stem_1/x402/info',
      purchaseUrl: '/api/stems/stem_1/x402',
      preview: {
        url: '/catalog/stems/stem_1/preview',
        mimeType: 'audio/mpeg',
      },
      pricing: {
        currency: 'USDC',
        licenses: [
          {
            key: 'personal',
            price: { currency: 'USDC', amount: '0.05' },
            displayPrice: '0.05 USDC',
          },
          {
            key: 'remix',
            price: { currency: 'USDC', amount: '5' },
            displayPrice: '5 USDC',
          },
          {
            key: 'commercial',
            price: { currency: 'USDC', amount: '25' },
            displayPrice: '25 USDC',
          },
        ],
        summary: {
          currency: 'USDC',
          from: '0.05',
          to: '25',
          display: '0.05-25 USDC',
        },
      },
      rights: {
        availableLicenses: ['personal', 'remix', 'commercial'],
        assetAccess: 'paid',
        discoveryAccess: 'public',
      },
      payment: {
        protocol: 'x402',
        network: 'eip155:84532',
        quoteUrl: '/api/stems/stem_1/x402/info',
        purchaseUrl: '/api/stems/stem_1/x402',
      },
      asset: {
        kind: 'stem',
        delivery: 'audio-download',
        mimeType: 'audio/mpeg',
        durationSeconds: 12.5,
      },
      purchase: {
        protocol: 'x402',
        scheme: 'exact',
        network: 'eip155:84532',
        payTo: '0xTestPayoutAddr',
        endpoint: '/api/stems/stem_1/x402',
        quoteUrl: '/api/stems/stem_1/x402/info',
      },
      x402: {
        network: 'eip155:84532',
        payTo: '0xTestPayoutAddr',
        scheme: 'exact',
        endpoint: '/api/stems/stem_1/x402',
        quoteUrl: '/api/stems/stem_1/x402/info',
      },
    });
  });
});
