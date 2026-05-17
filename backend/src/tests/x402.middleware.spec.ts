import { ConfigService } from '@nestjs/config';
import { X402Middleware } from '../modules/x402/x402.middleware';
import { X402Config } from '../modules/x402/x402.config';
import { X402PaymentService } from '../modules/x402/x402.payment.service';
import { PaymentsService } from '../modules/payments/payments.service';
import { Request, Response, NextFunction } from 'express';

// Mock prisma
jest.mock('../db/prisma', () => ({
  prisma: {
    stem: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'stem_1',
        uri: 'https://example.com/stem.mp3',
        mimeType: 'audio/mpeg',
      }),
    },
    stemListing: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    x402Settlement: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    stemPricing: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  },
}));

function createMockConfig(overrides: Partial<X402Config> = {}): X402Config {
  return {
    enabled: true,
    payoutAddress: '0xTestPayoutAddr',
    facilitatorUrl: 'https://x402.org/facilitator',
    network: 'eip155:84532',
    chainId: 84532,
    contractSettlementEnabled: false,
    settlementPrivateKey: null,
    ...overrides,
  } as X402Config;
}

function createMiddleware(
  config: X402Config,
  paymentService: X402PaymentService = new X402PaymentService(config),
) {
  return new X402Middleware(config, paymentService);
}

function createPaymentsService(paymentAssetsJson: string) {
  return new PaymentsService(
    { publish: jest.fn() } as any,
    new ConfigService({ PAYMENT_ASSETS_JSON: paymentAssetsJson }),
  );
}

function createMockReq(path: string, headers: Record<string, string> = {}): Partial<Request> {
  return {
    path,
    headers: { ...headers },
    query: {},
  };
}

function createMockRes(): { res: Partial<Response>; statusCode: number; body: any } {
  const state = { statusCode: 200, body: null as any };
  const res: Partial<Response> = {
    setHeader: jest.fn(),
    status: jest.fn((code: number) => {
      state.statusCode = code;
      return res as Response;
    }),
    json: jest.fn((data: any) => {
      state.body = data;
      return res as Response;
    }),
  };
  return { res, ...state };
}

describe('X402Middleware', () => {
  beforeEach(() => {
    const { prisma } = jest.requireMock('../db/prisma') as {
      prisma: {
        stem: { findUnique: jest.Mock };
        stemListing: { findFirst: jest.Mock };
        x402Settlement: { findUnique: jest.Mock };
        stemPricing: { findUnique: jest.Mock };
      };
    };

    prisma.stem.findUnique.mockResolvedValue({
      id: 'stem_1',
      uri: 'https://example.com/stem.mp3',
      mimeType: 'audio/mpeg',
    });
    prisma.stemListing.findFirst.mockResolvedValue(null);
    prisma.x402Settlement.findUnique.mockResolvedValue(null);
    prisma.stemPricing.findUnique.mockResolvedValue(null);
    global.fetch = jest.fn();
  });

  describe('disabled mode', () => {
    it('should pass through when x402 is disabled', async () => {
      const config = createMockConfig({ enabled: false });
      const middleware = createMiddleware(config);
      const req = createMockReq('/api/stems/abc/x402');
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('enabled mode', () => {
    it('should return 402 when no X-PAYMENT header', async () => {
      const config = createMockConfig();
      const middleware = createMiddleware(config);
      const req = createMockReq('/api/stems/test-stem-id/x402');
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          x402Version: 2,
          accepts: expect.arrayContaining([
            expect.objectContaining({
              scheme: 'exact',
              network: 'eip155:84532',
              asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
              payTo: '0xTestPayoutAddr',
              extra: expect.objectContaining({
                displayPrice: '0.05 USDC',
              }),
            }),
          ]),
        }),
      );
    });

    it('uses shared payment metadata for the x402 USDC challenge asset', async () => {
      const config = createMockConfig();
      const paymentsService = createPaymentsService(JSON.stringify([
        {
          assetId: 'base-sepolia:usdc',
          chainId: 84532,
          symbol: 'USDC',
          name: 'Circle USDC',
          kind: 'stablecoin',
          tokenAddress: '0x1111111111111111111111111111111111111111',
          decimals: 6,
          enabled: true,
          settlement: ['x402'],
          pricingStrategy: 'usd_pegged',
        },
      ]));
      const middleware = createMiddleware(
        config,
        new X402PaymentService(config, paymentsService),
      );
      const req = createMockReq('/api/stems/test-stem-id/x402');
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          accepts: expect.arrayContaining([
            expect.objectContaining({
              asset: '0x1111111111111111111111111111111111111111',
              extra: expect.objectContaining({
                name: 'Circle USDC',
                displayPrice: '0.05 USDC',
              }),
            }),
          ]),
        }),
      );
    });

    it('should include stemId in the payment resource URL', async () => {
      const config = createMockConfig();
      const middleware = createMiddleware(config);
      const req = createMockReq('/api/stems/my-stem-123/x402');
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: expect.objectContaining({
            url: '/api/stems/my-stem-123/x402',
          }),
        }),
      );
    });

    it('requires a buyer wallet before challenging listed contract-settled x402 stems', async () => {
      const { prisma } = jest.requireMock('../db/prisma') as {
        prisma: {
          stemListing: { findFirst: jest.Mock };
        };
      };
      prisma.stemListing.findFirst.mockResolvedValue({
        paymentToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      });
      const config = createMockConfig({ contractSettlementEnabled: true });
      const middleware = createMiddleware(config);
      const req = createMockReq('/api/stems/test-stem-id/x402');
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Buyer wallet required',
        }),
      );
    });

    it('rejects listed contract-settled x402 stems when the listing token is not the x402 asset', async () => {
      const { prisma } = jest.requireMock('../db/prisma') as {
        prisma: {
          stemListing: { findFirst: jest.Mock };
        };
      };
      prisma.stemListing.findFirst.mockResolvedValue({
        paymentToken: '0x9999999999999999999999999999999999999999',
      });
      const config = createMockConfig({ contractSettlementEnabled: true });
      const middleware = createMiddleware(config);
      const req = createMockReq('/api/stems/test-stem-id/x402', {
        'x-resonate-buyer': '0x1111111111111111111111111111111111111111',
      });
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Unsupported listing payment asset',
        }),
      );
    });

    it('uses the active listing price for contract-settled x402 challenges', async () => {
      const { prisma } = jest.requireMock('../db/prisma') as {
        prisma: {
          stemListing: { findFirst: jest.Mock };
        };
      };
      prisma.stemListing.findFirst.mockResolvedValue({
        paymentToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        pricePerUnit: '125000',
      });
      const config = createMockConfig({ contractSettlementEnabled: true });
      const middleware = createMiddleware(config);
      const req = createMockReq('/api/stems/test-stem-id/x402', {
        'x-resonate-buyer': '0x1111111111111111111111111111111111111111',
      });
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          accepts: expect.arrayContaining([
            expect.objectContaining({
              amount: '125000',
              extra: expect.objectContaining({
                displayPrice: '0.125 USDC',
              }),
            }),
          ]),
        }),
      );
    });

    it('should return 404 before challenging when the stem does not exist', async () => {
      const { prisma } = jest.requireMock('../db/prisma') as {
        prisma: {
          stem: { findUnique: jest.Mock };
        };
      };
      prisma.stem.findUnique.mockResolvedValue(null);

      const config = createMockConfig();
      const middleware = createMiddleware(config);
      const req = createMockReq('/api/stems/missing-stem/x402');
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Stem not found' });
    });

    it('should pass through non-x402 routes', async () => {
      const config = createMockConfig();
      const middleware = createMiddleware(config);
      const req = createMockReq('/api/stems/abc/info');
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('should pass through the /info sub-route', async () => {
      const config = createMockConfig();
      const middleware = createMiddleware(config);
      const req = createMockReq('/api/stems/abc/x402/info');
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('should use the canonical storefront default price when no listing exists', async () => {
      const config = createMockConfig();
      const middleware = createMiddleware(config);
      const req = createMockReq('/api/stems/unlisted-stem/x402');
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          accepts: expect.arrayContaining([
            expect.objectContaining({
              amount: '50000',
            }),
          ]),
        }),
      );
    });

    it('should ignore legacy ETH listings when no canonical USD price is stored', async () => {
      const { prisma } = jest.requireMock('../db/prisma') as {
        prisma: {
          stemListing: { findFirst: jest.Mock };
          stemPricing: { findUnique: jest.Mock };
        };
      };
      prisma.stemListing.findFirst.mockResolvedValue({
        pricePerUnit: '1000000000000000000',
      });
      prisma.stemPricing.findUnique.mockResolvedValue(null);

      const config = createMockConfig();
      const middleware = createMiddleware(config);
      const req = createMockReq('/api/stems/listed-stem/x402');
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          accepts: expect.arrayContaining([
            expect.objectContaining({
              amount: '50000',
            }),
          ]),
        }),
      );
    });

    it('should accept PAYMENT-SIGNATURE retries and continue after verification', async () => {
      const config = createMockConfig();
      const paymentService = {
        buildPaymentChallenge: jest.fn().mockResolvedValue({
          paymentRequirements: { scheme: 'exact', network: 'eip155:84532' },
        }),
        verifyAndSettle: jest.fn().mockResolvedValue({ ok: true }),
      } as unknown as X402PaymentService;
      const middleware = createMiddleware(config, paymentService);
      const req = createMockReq('/api/stems/stem_1/x402', {
        'payment-signature': 'proof-v2',
      });
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(paymentService.buildPaymentChallenge).toHaveBeenCalledWith(
        expect.objectContaining({
          stemId: 'stem_1',
          resourceUrl: '/api/stems/stem_1/x402',
          mimeType: 'audio/mpeg',
        }),
      );
      expect(paymentService.verifyAndSettle).toHaveBeenCalledWith(
        'proof-v2',
        { scheme: 'exact', network: 'eip155:84532' },
      );
      expect(next).toHaveBeenCalled();
    });

    it('should reuse same-stem x402 settlements without settling the payment again', async () => {
      const { prisma } = jest.requireMock('../db/prisma') as {
        prisma: {
          x402Settlement: { findUnique: jest.Mock };
        };
      };
      prisma.x402Settlement.findUnique.mockResolvedValue({
        id: 'settlement_1',
        stemId: 'stem_1',
      });
      const config = createMockConfig();
      const paymentService = {
        buildPaymentChallenge: jest.fn(),
        verifyAndSettle: jest.fn(),
      } as unknown as X402PaymentService;
      const middleware = createMiddleware(config, paymentService);
      const req = createMockReq('/api/stems/stem_1/x402', {
        'payment-signature': 'proof-v2',
      });
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(paymentService.verifyAndSettle).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('should reject x402 payment proof reuse across stems', async () => {
      const { prisma } = jest.requireMock('../db/prisma') as {
        prisma: {
          x402Settlement: { findUnique: jest.Mock };
        };
      };
      prisma.x402Settlement.findUnique.mockResolvedValue({
        id: 'settlement_1',
        stemId: 'other_stem',
      });
      const config = createMockConfig();
      const paymentService = {
        buildPaymentChallenge: jest.fn(),
        verifyAndSettle: jest.fn(),
      } as unknown as X402PaymentService;
      const middleware = createMiddleware(config, paymentService);
      const req = createMockReq('/api/stems/stem_1/x402', {
        'payment-signature': 'proof-v2',
      });
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Payment already redeemed',
        }),
      );
      expect(paymentService.verifyAndSettle).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('should send x402 v2 verification payloads to the facilitator', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ isValid: true }),
      });

      const config = createMockConfig({
        facilitatorUrl: 'https://facilitator.example.com',
      });
      const paymentService = new X402PaymentService(config);

      const paymentPayload = { signature: 'decoded-proof' };
      const paymentRequirements = {
        scheme: 'exact',
        network: 'eip155:84532',
        amount: '50000',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        payTo: '0xTestPayoutAddr',
        maxTimeoutSeconds: 300,
      };

      const isValid = await (paymentService as any).verifyPayment(
        paymentPayload,
        paymentRequirements,
      );

      expect(isValid).toEqual({ ok: true });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://facilitator.example.com/verify',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            x402Version: 2,
            paymentPayload,
            paymentRequirements,
          }),
        }),
      );
    });

    it('should send x402 v2 settlement payloads to the facilitator', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
      });

      const config = createMockConfig({
        facilitatorUrl: 'https://facilitator.example.com',
      });
      const paymentService = new X402PaymentService(config);

      const paymentPayload = { signature: 'decoded-proof' };
      const paymentRequirements = {
        scheme: 'exact',
        network: 'eip155:84532',
        amount: '50000',
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        payTo: '0xTestPayoutAddr',
        maxTimeoutSeconds: 300,
      };

      await (paymentService as any).settlePayment(paymentPayload, paymentRequirements);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://facilitator.example.com/settle',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            x402Version: 2,
            paymentPayload,
            paymentRequirements,
          }),
        }),
      );
    });
  });
});
