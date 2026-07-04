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
    $transaction: jest.fn((operations) => Promise.all(operations)),
    stem: {
      findUnique: jest.fn(),
    },
    stemListing: {
      findFirst: jest.fn(),
    },
    x402Settlement: {
      findFirst: jest.fn(),
      create: jest.fn(),
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
    $transaction: jest.Mock;
    stem: { findUnique: jest.Mock };
    stemListing: { findFirst: jest.Mock };
    x402Settlement: { findFirst: jest.Mock; create: jest.Mock };
    stemPricing: { findUnique: jest.Mock };
    contractEvent: { findFirst: jest.Mock; create: jest.Mock };
  };
};

function createMockConfig(overrides: Partial<X402Config> = {}): X402Config {
  const licensePricing = {
    personal: { amountUsd: 0.05, feeBps: 1500 },
    remix: { amountUsd: 5, feeBps: 1000 },
    commercial: { amountUsd: 25, feeBps: 1000 },
  };
  return {
    enabled: true,
    payoutAddress: '0xTestPayoutAddr',
    facilitatorUrl: 'https://x402.org/facilitator',
    network: 'eip155:84532',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    contractSettlementEnabled: false,
    settlementPrivateKey: null,
    licensePricing,
    resolveLicenseAmountUsd: (pricing: any, licenseType: string) => {
      if (licenseType === 'remix') return pricing?.remixLicenseUsd ?? licensePricing.remix.amountUsd;
      if (licenseType === 'commercial') return pricing?.commercialLicenseUsd ?? licensePricing.commercial.amountUsd;
      return pricing?.basePlayPriceUsd ?? licensePricing.personal.amountUsd;
    },
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
    decryptBuffer: jest.fn(),
  };
  const storageProvider = {
    download: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.contractEvent.findFirst.mockResolvedValue(null);
    prisma.x402Settlement.findFirst.mockResolvedValue(null);
    prisma.stemListing.findFirst.mockResolvedValue(null);
    storageProvider.download.mockReset();
    encryptionService.decryptBuffer.mockReset();
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
    expect(decodedReceipt.settlement).toEqual(expect.objectContaining({
      rail: 'x402',
      status: 'download_only',
      entitlement: 'download_access',
    }));
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
    expect(prisma.x402Settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stemId: 'stem_1',
        receiptId: decodedReceipt.receiptId,
        status: 'download_granted',
        contractSettlementStatus: 'download_only',
        settlementAmountUnits: '750000',
      }),
    });
  });

  it('marks receipts as requiring contract settlement when an active marketplace listing exists', async () => {
    prisma.stem.findUnique.mockResolvedValue({
      id: 'stem_listed',
      type: 'bass',
      title: 'Listed Bass',
      uri: 'https://example.com/listed.mp3',
      encryptionMetadata: null,
      nftMint: { tokenId: BigInt(77) },
      track: {
        title: 'Listed Track',
        release: {
          title: 'Listed Release',
          primaryArtist: 'Koita',
        },
      },
    });
    prisma.stemListing.findFirst.mockResolvedValue({
      id: 'listing_row_1',
      listingId: BigInt(841),
      tokenId: BigInt(77),
      chainId: 84532,
      contractAddress: '0xMarketplace',
      pricePerUnit: '50000',
      paymentToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    });
    prisma.stemPricing.findUnique.mockResolvedValue({
      basePlayPriceUsd: 0.05,
    });

    const controller = new X402Controller(
      createMockConfig(),
      encryptionService as any,
    );
    const req: any = { headers: { 'payment-signature': 'proof-listed' } };
    const res = createMockRes();

    await controller.downloadWithPayment('stem_listed', req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('Marketplace contract settlement required');
    expect(res.body.settlement).toEqual(expect.objectContaining({
      status: 'contract_required_missing',
      entitlement: 'marketplace_purchase',
      listingId: '841',
      listingChainId: 84532,
      tokenId: '77',
    }));
    expect(prisma.x402Settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stemId: 'stem_listed',
        listingId: 'listing_row_1',
        listingChainId: 84532,
        listingTokenId: BigInt(77),
        status: 'contract_settlement_failed',
        contractSettlementStatus: 'contract_required_missing',
      }),
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('marks listed x402 receipts contract-backed after marketplace settlement succeeds', async () => {
    prisma.stem.findUnique.mockResolvedValue({
      id: 'stem_backed',
      type: 'bass',
      title: 'Backed Bass',
      uri: 'https://example.com/backed.mp3',
      encryptionMetadata: null,
      nftMint: { tokenId: BigInt(77) },
      track: {
        title: 'Backed Track',
        release: {
          title: 'Backed Release',
          primaryArtist: 'Koita',
        },
      },
    });
    prisma.stemListing.findFirst.mockResolvedValue({
      id: 'listing_row_backed',
      listingId: BigInt(841),
      tokenId: BigInt(77),
      chainId: 84532,
      contractAddress: '0x3333333333333333333333333333333333333333',
      pricePerUnit: '125000',
      paymentToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    });
    prisma.stemPricing.findUnique.mockResolvedValue({
      basePlayPriceUsd: 0.05,
    });

    const controller = new X402Controller(
      createMockConfig({ contractSettlementEnabled: true }),
      encryptionService as any,
    );
    jest.spyOn(controller as any, 'executeMarketplaceSettlement').mockResolvedValue({
      transactionHash: `0x${'c'.repeat(64)}`,
      eventName: 'Sold',
    });
    const req: any = {
      headers: {
        'payment-signature': 'proof-backed',
        'x-resonate-buyer': '0x1111111111111111111111111111111111111111',
      },
      query: {},
    };
    const res = createMockRes();

    await controller.downloadWithPayment('stem_backed', req, res);

    const decodedReceipt = JSON.parse(
      Buffer.from(res.headers['X-Resonate-Receipt'], 'base64url').toString(
        'utf8',
      ),
    );

    expect(decodedReceipt.payment.amount).toBe('0.125');
    expect(decodedReceipt.settlement).toEqual(expect.objectContaining({
      status: 'contract_backed',
      entitlement: 'marketplace_purchase',
      listingId: '841',
      transactionHash: `0x${'c'.repeat(64)}`,
      eventName: 'Sold',
    }));
    expect(res.headers['X-Resonate-Settlement-Status']).toBe('contract_backed');
    expect(res.body).toBeInstanceOf(Buffer);
    expect(prisma.x402Settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stemId: 'stem_backed',
        listingId: 'listing_row_backed',
        payerAddress: '0x1111111111111111111111111111111111111111',
        contractSettlementStatus: 'contract_backed',
        contractSettlementTxHash: `0x${'c'.repeat(64)}`,
        contractSettlementEventName: 'Sold',
        settlementAmountUnits: '125000',
      }),
    });
  });

  it('records failed contract settlement and does not serve audio', async () => {
    prisma.stem.findUnique.mockResolvedValue({
      id: 'stem_failed',
      type: 'drums',
      title: 'Failed Drums',
      uri: 'https://example.com/failed.mp3',
      encryptionMetadata: null,
      nftMint: { tokenId: BigInt(77) },
      track: {
        title: 'Failed Track',
        release: {
          title: 'Failed Release',
          primaryArtist: 'Koita',
        },
      },
    });
    prisma.stemListing.findFirst.mockResolvedValue({
      id: 'listing_row_failed',
      listingId: BigInt(842),
      tokenId: BigInt(77),
      chainId: 84532,
      contractAddress: '0x3333333333333333333333333333333333333333',
      pricePerUnit: '50000',
      paymentToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    });
    prisma.stemPricing.findUnique.mockResolvedValue({
      basePlayPriceUsd: 0.05,
    });

    const controller = new X402Controller(
      createMockConfig({ contractSettlementEnabled: true }),
      encryptionService as any,
    );
    jest.spyOn(controller as any, 'executeMarketplaceSettlement').mockRejectedValue(
      new Error('buyFor reverted'),
    );
    const req: any = {
      headers: {
        'payment-signature': 'proof-failed',
        'x-resonate-buyer': '0x1111111111111111111111111111111111111111',
      },
      query: {},
    };
    const res = createMockRes();

    await controller.downloadWithPayment('stem_failed', req, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('Contract settlement failed');
    expect(res.body.settlement).toEqual(expect.objectContaining({
      status: 'contract_failed',
      reason: 'buyFor reverted',
    }));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.contractEvent.create).not.toHaveBeenCalled();
    expect(prisma.x402Settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stemId: 'stem_failed',
        status: 'contract_settlement_failed',
        contractSettlementStatus: 'contract_failed',
        contractSettlementReason: 'buyFor reverted',
      }),
    });
  });

  it('reuses an existing x402 settlement for same-stem payment retries', async () => {
    const receipt = {
      receiptId: 'x402r_existing',
      license: { key: 'personal' },
      settlement: { status: 'download_only' },
      payment: { amount: '0.05' },
    };
    prisma.x402Settlement.findFirst.mockResolvedValue({
      id: 'settlement_existing',
      stemId: 'stem_1',
      receiptId: 'x402r_existing',
      status: 'download_granted',
      contractSettlementReason: null,
      receipt,
    });
    prisma.stem.findUnique.mockResolvedValue({
      id: 'stem_1',
      type: 'vocals',
      title: 'Hook Vocals',
      uri: 'https://example.com/stem.mp3',
      encryptionMetadata: null,
      nftMint: null,
      track: {
        title: 'Midnight Run',
        release: {
          title: 'Neon Heat',
          primaryArtist: 'Koita',
        },
      },
    });

    const controller = new X402Controller(
      createMockConfig(),
      encryptionService as any,
    );
    const req: any = { headers: { 'payment-signature': 'proof-abc' } };
    const res = createMockRes();

    await controller.downloadWithPayment('stem_1', req, res);

    expect(res.headers['X-Resonate-Receipt-Id']).toBe('x402r_existing');
    expect(prisma.contractEvent.create).not.toHaveBeenCalled();
    expect(prisma.x402Settlement.create).not.toHaveBeenCalled();
  });

  it('rejects an x402 payment proof that was redeemed for another stem', async () => {
    prisma.x402Settlement.findFirst.mockResolvedValue({
      id: 'settlement_existing',
      stemId: 'other_stem',
      receipt: {},
    });
    prisma.stem.findUnique.mockResolvedValue({
      id: 'stem_1',
      type: 'vocals',
      title: 'Hook Vocals',
      uri: 'https://example.com/stem.mp3',
      encryptionMetadata: null,
      nftMint: null,
      track: {
        title: 'Midnight Run',
        release: {
          title: 'Neon Heat',
          primaryArtist: 'Koita',
        },
      },
    });

    const controller = new X402Controller(
      createMockConfig(),
      encryptionService as any,
    );
    const req: any = { headers: { 'payment-signature': 'proof-abc' } };
    const res = createMockRes();

    await controller.downloadWithPayment('stem_1', req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain('different stem');
    expect(prisma.contractEvent.create).not.toHaveBeenCalled();
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
    expect(prisma.x402Settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stemId: 'stem_smart',
        paymentRail: 'smart_account',
        paymentTransactionHash: `0x${'a'.repeat(64)}`,
        payerAddress: '0x1111111111111111111111111111111111111111',
      }),
    });
  });

  it('decrypts paid x402 downloads from storage before falling back to public blob URLs', async () => {
    const encryptedData = Buffer.from('encrypted-stem');
    const decryptedData = Buffer.from('decrypted-stem');
    storageProvider.download.mockResolvedValue(encryptedData);
    encryptionService.decryptBuffer.mockResolvedValue(decryptedData);
    prisma.stem.findUnique.mockResolvedValue({
      id: 'stem_encrypted',
      type: 'drums',
      title: 'Encrypted Stem',
      uri: '/catalog/stems/stem_encrypted/blob',
      mimeType: 'audio/mpeg',
      encryptionMetadata: JSON.stringify({
        iv: 'aa',
        authTag: 'bb',
        keyId: 'stem_encrypted',
      }),
      data: null,
      nftMint: null,
      track: {
        title: 'Encrypted Track',
        release: {
          title: 'Encrypted Release',
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
      undefined,
      storageProvider as any,
    );
    const req: any = {
      protocol: 'https',
      headers: { 'payment-signature': 'proof-v2' },
      get: jest.fn((header: string) =>
        header.toLowerCase() === 'host' ? 'api.example.test' : undefined,
      ),
    };
    const res = createMockRes();

    await controller.downloadWithPayment('stem_encrypted', req, res);

    expect(storageProvider.download).toHaveBeenCalledWith(
      '/catalog/stems/stem_encrypted/blob',
    );
    expect(encryptionService.decryptBuffer).toHaveBeenCalledWith(
      encryptedData,
      expect.any(String),
      expect.objectContaining({
        sig: 'x402-payment-verified',
      }),
      '/catalog/stems/stem_encrypted/blob',
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(res.body).toEqual(decryptedData);
    expect(res.headers['X-Resonate-License']).toBe('personal');
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

  it('rejects smart-account x402 payment transactions redeemed for another stem', async () => {
    prisma.x402Settlement.findFirst.mockResolvedValue({
      id: 'settlement_existing',
      stemId: 'other_stem',
    });
    const controller = new X402Controller(
      createMockConfig(),
      encryptionService as any,
    );

    await expect(
      (controller as any).verifySmartAccountPayment('stem_smart', {
        txHash: `0x${'a'.repeat(64)}`,
        payer: '0x1111111111111111111111111111111111111111',
      }),
    ).rejects.toThrow('already been redeemed for a different stem');
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
      listingId: BigInt(123),
      chainId: 84532,
      pricePerUnit: '12300000000000000',
      paymentToken: '0x0000000000000000000000000000000000000000',
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
    const expectedLicenseOptions = [
      {
        key: 'personal',
        price: { currency: 'USDC', amount: '0.05' },
        displayPrice: '0.05 USDC',
        breakdown: {
          feeBps: 1500,
          royaltyBps: null,
          platformFee: { currency: 'USDC', amount: '0.0075', usd: 0.0075 },
          royalty: null,
          netToSeller: { currency: 'USDC', amount: '0.0425', usd: 0.0425 },
        },
      },
      {
        key: 'remix',
        price: { currency: 'USDC', amount: '5' },
        displayPrice: '5 USDC',
        breakdown: {
          feeBps: 1000,
          royaltyBps: null,
          platformFee: { currency: 'USDC', amount: '0.5', usd: 0.5 },
          royalty: null,
          netToSeller: { currency: 'USDC', amount: '4.5', usd: 4.5 },
        },
      },
      {
        key: 'commercial',
        price: { currency: 'USDC', amount: '25' },
        displayPrice: '25 USDC',
        breakdown: {
          feeBps: 1000,
          royaltyBps: null,
          platformFee: { currency: 'USDC', amount: '2.5', usd: 2.5 },
          royalty: null,
          netToSeller: { currency: 'USDC', amount: '22.5', usd: 22.5 },
        },
      },
    ];

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
      licenseOptions: expectedLicenseOptions,
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
        licenses: expectedLicenseOptions,
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
      marketplaceSettlement: {
        required: true,
        available: false,
        contractSettlementEnabled: false,
        listingId: '123',
        chainId: 84532,
        paymentToken: '0x0000000000000000000000000000000000000000',
      },
    });
  });
});
