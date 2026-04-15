import { X402Middleware } from '../modules/x402/x402.middleware';
import { X402Config } from '../modules/x402/x402.config';
import { Request, Response, NextFunction } from 'express';

// Mock prisma
jest.mock('../db/prisma', () => ({
  prisma: {
    stemListing: {
      findFirst: jest.fn().mockResolvedValue(null),
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
    ...overrides,
  } as X402Config;
}

function createMockReq(path: string, headers: Record<string, string> = {}): Partial<Request> {
  return {
    path,
    headers: { ...headers },
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
  describe('disabled mode', () => {
    it('should pass through when x402 is disabled', async () => {
      const config = createMockConfig({ enabled: false });
      const middleware = new X402Middleware(config);
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
      const middleware = new X402Middleware(config);
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
            }),
          ]),
        }),
      );
    });

    it('should include stemId in the payment resource URL', async () => {
      const config = createMockConfig();
      const middleware = new X402Middleware(config);
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

    it('should pass through non-x402 routes', async () => {
      const config = createMockConfig();
      const middleware = new X402Middleware(config);
      const req = createMockReq('/api/stems/abc/info');
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('should pass through the /info sub-route', async () => {
      const config = createMockConfig();
      const middleware = new X402Middleware(config);
      const req = createMockReq('/api/stems/abc/x402/info');
      const { res } = createMockRes();
      const next = jest.fn();

      await middleware.use(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
    });

    it('should use the canonical storefront default price when no listing exists', async () => {
      const config = createMockConfig();
      const middleware = new X402Middleware(config);
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
      const middleware = new X402Middleware(config);
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
  });
});
