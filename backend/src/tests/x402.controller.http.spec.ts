import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EncryptionService } from '../modules/encryption/encryption.service';
import { X402Config } from '../modules/x402/x402.config';
import { X402Controller } from '../modules/x402/x402.controller';
import { X402Middleware } from '../modules/x402/x402.middleware';

jest.mock('../db/prisma', () => ({
  prisma: {
    stem: {
      findUnique: jest.fn(),
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
    stemPricing: { findUnique: jest.Mock };
    contractEvent: { create: jest.Mock };
  };
};

const mockEncryptionService = {
  decrypt: jest.fn(),
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        () => ({
          X402_ENABLED: 'true',
          X402_PAYOUT_ADDRESS: '0xTestPayoutAddr',
          X402_NETWORK: 'eip155:84532',
          X402_FACILITATOR_URL: 'https://x402.org/facilitator',
        }),
      ],
    }),
  ],
  controllers: [X402Controller],
  providers: [
    X402Config,
    {
      provide: EncryptionService,
      useValue: mockEncryptionService,
    },
  ],
})
class TestX402HttpModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(X402Middleware)
      .forRoutes({ path: 'api/stems/:stemId/x402', method: RequestMethod.GET });
  }
}

describe('X402Controller HTTP contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestX402HttpModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
    } as Response) as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('GET /api/stems/:stemId/x402 returns a 402 challenge with PAYMENT-REQUIRED', async () => {
    prisma.stem.findUnique.mockResolvedValue({
      id: 'stem_1',
      uri: 'https://example.com/stem.mp3',
      mimeType: 'audio/mpeg',
    });
    prisma.stemPricing.findUnique.mockResolvedValue({
      basePlayPriceUsd: 0.05,
    });

    const res = await request(app.getHttpServer())
      .get('/api/stems/stem_1/x402')
      .expect(402);

    expect(res.headers['payment-required']).toBeDefined();
    expect(res.body).toEqual(
      expect.objectContaining({
        x402Version: 2,
        resource: expect.objectContaining({
          url: '/api/stems/stem_1/x402',
          mimeType: 'audio/mpeg',
        }),
        accepts: expect.arrayContaining([
          expect.objectContaining({
            scheme: 'exact',
            network: 'eip155:84532',
            payTo: '0xTestPayoutAddr',
          }),
        ]),
      }),
    );
  });

  it('GET /api/stems/:stemId/x402 returns receipt headers after a paid retry', async () => {
    jest
      .spyOn(X402Middleware.prototype as any, 'buildPaymentContext')
      .mockResolvedValue({
        paymentPayload: { signature: 'proof-v2' },
        paymentRequirements: {
          scheme: 'exact',
          network: 'eip155:84532',
          amount: '50000',
          asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          payTo: '0xTestPayoutAddr',
          maxTimeoutSeconds: 300,
          extra: {
            name: 'USDC',
            version: '2',
            displayPrice: '0.05 USDC',
          },
        },
      });
    jest
      .spyOn(X402Middleware.prototype as any, 'verifyPayment')
      .mockResolvedValue(true);
    jest
      .spyOn(X402Middleware.prototype as any, 'settlePayment')
      .mockResolvedValue(undefined);

    prisma.stem.findUnique
      .mockResolvedValueOnce({
        id: 'stem_local',
        uri: '/catalog/stems/e2e-x402.m4a/blob',
        mimeType: 'audio/mp4',
      })
      .mockResolvedValueOnce({
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
    prisma.stemPricing.findUnique
      .mockResolvedValueOnce({ basePlayPriceUsd: 0.05 })
      .mockResolvedValueOnce({ basePlayPriceUsd: 0.05 });

    const res = await request(app.getHttpServer())
      .get('/api/stems/stem_local/x402')
      .set('PAYMENT-SIGNATURE', 'proof-v2')
      .expect(200);

    expect(res.headers['content-type']).toContain('audio/mp4');
    expect(res.headers['x-resonate-license']).toBe('personal');
    expect(res.headers['x-resonate-receipt']).toBeDefined();
    expect(res.headers['x-resonate-receipt-id']).toMatch(/^x402r_/);
    expect(res.headers['x-resonate-receipt-content-type']).toBe(
      'application/vnd.resonate.purchase-receipt+json',
    );
    expect(res.headers['content-disposition']).toContain('Local Stem.m4a');
    expect(prisma.contractEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventName: 'x402.purchase',
        chainId: 84532,
      }),
    });
  });

  it('GET /api/stems/:stemId/x402 returns 404 instead of a challenge for missing stems', async () => {
    prisma.stem.findUnique.mockResolvedValue(null);

    await request(app.getHttpServer())
      .get('/api/stems/missing/x402')
      .expect(404)
      .expect({
        error: 'Stem not found',
      });
  });
});
