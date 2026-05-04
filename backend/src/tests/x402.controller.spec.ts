import { X402Controller } from '../modules/x402/x402.controller';
import { X402Config } from '../modules/x402/x402.config';
import { encodeAbiParameters, encodeEventTopics } from 'viem';

const ERC20_TRANSFER_EVENT = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { indexed: true, name: 'from', type: 'address' },
    { indexed: true, name: 'to', type: 'address' },
    { indexed: false, name: 'value', type: 'uint256' },
  ],
} as const;

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
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));

const { prisma } = jest.requireMock('../db/prisma') as {
  prisma: {
    stem: { findUnique: jest.Mock };
    stemListing: { findFirst: jest.Mock };
    stemPricing: { findUnique: jest.Mock };
    contractEvent: { findFirst: jest.Mock; create: jest.Mock };
  };
};

function createMockConfig(overrides: Partial<X402Config> = {}): X402Config {
  return {
    enabled: true,
    payoutAddress: '0xTestPayoutAddr',
    facilitatorUrl: 'https://x402.org/facilitator',
    network: 'eip155:84532',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
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
    prisma.contractEvent.findFirst.mockResolvedValue(null);
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

  it('serves downloads after verified smart-account x402 payments', async () => {
    prisma.stem.findUnique.mockResolvedValue({
      id: 'stem_smart',
      type: 'vocals',
      title: 'Passkey Stem',
      uri: 'https://example.com/passkey.mp3',
      mimeType: 'audio/mpeg',
      encryptionMetadata: null,
      nftMint: null,
      track: {
        title: 'Passkey Track',
        release: {
          title: 'Passkey Release',
          primaryArtist: 'Koita',
        },
      },
    });
    prisma.stemPricing.findUnique.mockResolvedValue({
      basePlayPriceUsd: 0.05,
    });

    const controller = new X402Controller(
      createMockConfig(),
      encryptionService as any,
    );
    jest.spyOn(controller as any, 'verifySmartAccountPayment').mockResolvedValue({
      txHash: `0x${'a'.repeat(64)}`,
      payer: '0x1111111111111111111111111111111111111111',
      assetAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      amountUnits: '50000',
      logIndex: 7,
      blockNumber: BigInt(123),
      blockHash: `0x${'b'.repeat(64)}`,
    });

    const req: any = { headers: {} };
    const res = createMockRes();

    await controller.downloadWithSmartAccountPayment(
      'stem_smart',
      {
        txHash: `0x${'a'.repeat(64)}`,
        payer: '0x1111111111111111111111111111111111111111',
      },
      req,
      res,
    );

    expect(res.headers['X-Resonate-License']).toBe('personal');
    expect(res.body).toBeInstanceOf(Buffer);
    expect(prisma.contractEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventName: 'x402.purchase',
        transactionHash: `0x${'a'.repeat(64)}`,
        logIndex: 7,
        blockNumber: BigInt(123),
        blockHash: `0x${'b'.repeat(64)}`,
        args: expect.objectContaining({
          payer: '0x1111111111111111111111111111111111111111',
          paymentProofSha256: expect.any(String),
        }),
      }),
    });
  });

  it('verifies smart-account x402 payments from token Transfer logs', async () => {
    const payer = '0x1111111111111111111111111111111111111111';
    const payTo = '0x2222222222222222222222222222222222222222';
    const asset = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
    const txHash = `0x${'a'.repeat(64)}`;
    prisma.stemPricing.findUnique.mockResolvedValue({
      basePlayPriceUsd: 0.05,
    });

    const topics = encodeEventTopics({
      abi: [ERC20_TRANSFER_EVENT],
      eventName: 'Transfer',
      args: { from: payer, to: payTo },
    });
    const receipt = {
      status: 'success',
      blockNumber: BigInt(123),
      blockHash: `0x${'b'.repeat(64)}`,
      logs: [
        {
          address: asset,
          data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(50_000)]),
          topics,
          logIndex: 7,
        },
      ],
    };
    const controller = new X402Controller(
      createMockConfig({ payoutAddress: payTo }),
      encryptionService as any,
    );
    jest.spyOn(controller as any, 'getX402PublicClient').mockReturnValue({
      waitForTransactionReceipt: jest.fn().mockResolvedValue(receipt),
    });

    const verified = await (controller as any).verifySmartAccountPayment(
      'stem_smart',
      { txHash, payer },
    );

    expect(verified).toEqual({
      txHash,
      payer,
      assetAddress: asset,
      amountUnits: '50000',
      logIndex: 7,
      blockNumber: BigInt(123),
      blockHash: `0x${'b'.repeat(64)}`,
    });
  });

  it('rejects reused smart-account x402 payment transactions', async () => {
    prisma.contractEvent.findFirst.mockResolvedValue({ id: 'evt_existing' });
    const controller = new X402Controller(
      createMockConfig(),
      encryptionService as any,
    );

    await expect(
      (controller as any).verifySmartAccountPayment('stem_smart', {
        txHash: `0x${'a'.repeat(64)}`,
        payer: '0x1111111111111111111111111111111111111111',
      }),
    ).rejects.toThrow('already been redeemed');
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
