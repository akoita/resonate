import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { OpenApiController, WellKnownController } from '../modules/openapi/openapi.controller';
import { OpenApiService } from '../modules/openapi/openapi.service';
import { X402Config } from '../modules/x402/x402.config';

function createMockConfig(overrides: Partial<X402Config> = {}): X402Config {
  return {
    enabled: true,
    payoutAddress: '0xTestPayoutAddr',
    facilitatorUrl: 'https://facilitator.payai.network',
    network: 'eip155:8453',
    chainId: 8453,
    ...overrides,
  } as X402Config;
}

describe('OpenApiService', () => {
  it('builds a machine-first contract for storefront discovery and x402 payment', () => {
    const service = new OpenApiService(createMockConfig());
    const doc = service.buildDocument('http://localhost:3000') as any;

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toEqual([{ url: 'http://localhost:3000' }]);
    expect(doc.info['x-guidance']).toContain('/api/storefront/stems');

    expect(doc.paths['/api/storefront/stems']).toBeDefined();
    expect(doc.paths['/api/storefront/stems/{stemId}']).toBeDefined();
    expect(doc.paths['/api/stems/{stemId}/x402']).toBeDefined();
    expect(doc.paths['/api/stems/{stemId}/x402/info']).toBeDefined();
    expect(doc.paths['/api/storefront/stems'].get['x-payment-info']).toEqual({
      authMode: 'free',
    });
    expect(
      doc.paths['/api/stems/{stemId}/x402/info'].get['x-payment-info'],
    ).toEqual({
      authMode: 'free',
    });
    expect(
      doc.paths['/api/stems/{stemId}/x402'].get['x-payment-info'],
    ).toEqual({
      authMode: 'paid',
      protocol: 'x402',
      protocols: ['x402'],
      currency: 'USDC',
      asset: {
        assetId: 'base:usdc',
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
      },
      price: {
        mode: 'dynamic',
        currency: 'USDC',
        min: '0',
        max: '500',
      },
      minPrice: {
        currency: 'USDC',
        amount: '0',
      },
      maxPrice: {
        currency: 'USDC',
        amount: '500',
      },
      quote: {
        endpoint: '/api/stems/{stemId}/x402/info',
        schema: '#/components/schemas/X402StemInfo',
      },
      challenge: {
        status: 402,
        schema: '#/components/schemas/X402PaymentRequired',
      },
      x402: {
        quoteEndpoint: '/api/stems/{stemId}/x402/info',
        network: 'eip155:8453',
        retryHeaders: ['PAYMENT-SIGNATURE', 'X-PAYMENT'],
      },
    });

    expect(
      doc.paths['/api/stem-pricing/batch-get'].get.responses['200'].content[
        'application/json'
      ].schema,
    ).toEqual({
      type: 'object',
      additionalProperties: {
        $ref: '#/components/schemas/StemPricing',
      },
    });
    expect(doc.components.schemas.StemPricing.properties.remixLicenseUsd).toBeDefined();
    expect(
      doc.paths['/api/stems/{stemId}/x402'].get.responses['402'].headers[
        'PAYMENT-REQUIRED'
      ],
    ).toBeDefined();
    expect(doc.components.schemas.X402PaymentRequired.required).toEqual(
      expect.arrayContaining(['x402Version', 'resource', 'accepts']),
    );
    expect(doc.components.schemas.X402StemInfo.allOf).toEqual(
      expect.arrayContaining([
        { $ref: '#/components/schemas/StorefrontStemDetail' },
      ]),
    );
  });

  it('builds a well-known x402 discovery document', () => {
    const service = new OpenApiService(createMockConfig());
    const doc = service.buildWellKnownDocument('http://localhost:3000') as any;

    expect(doc.version).toBe(1);
    expect(doc.protocol).toBe('x402');
    expect(doc.network).toBe('eip155:8453');
    expect(doc.openapi).toBe('http://localhost:3000/openapi.json');
    expect(doc.resources).toEqual([
      'GET http://localhost:3000/api/stems/{stemId}/x402',
    ]);
    expect(doc.instructions).toContain('PAYMENT-SIGNATURE');
  });

  it('builds a well-known MCP discovery document', () => {
    const service = new OpenApiService(createMockConfig());
    const doc = service.buildMcpWellKnownDocument('http://localhost:3000') as any;

    expect(doc.schemaVersion).toBe(1);
    expect(doc.protocol).toBe('mcp');
    expect(doc.serverInfo).toEqual({
      name: 'resonate-mcp',
      version: '0.1.0',
    });
    expect(doc.transport).toEqual({
      type: 'streamable-http',
      endpoint: 'http://localhost:3000/mcp',
    });
    expect(doc.endpoints).toEqual({
      mcp: 'http://localhost:3000/mcp',
      capabilities: 'http://localhost:3000/mcp',
      openapi: 'http://localhost:3000/openapi.json',
    });
    expect(doc.tools).toEqual([
      'catalog.search',
      'stem.quote',
      'stem.download',
    ]);
    expect(doc.discovery.authoritativeSource).toContain('initialize response');
    expect(doc.authentication.note).toContain('x402 payment proof');
  });
});

describe('OpenApiController', () => {
  let app: INestApplication;
  const previousPublicApiUrl = process.env.PUBLIC_API_URL;

  beforeAll(async () => {
    process.env.PUBLIC_API_URL = 'http://public.example.test';

    const moduleRef = await Test.createTestingModule({
      controllers: [OpenApiController, WellKnownController],
      providers: [
        OpenApiService,
        { provide: X402Config, useValue: createMockConfig() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (previousPublicApiUrl === undefined) {
      delete process.env.PUBLIC_API_URL;
    } else {
      process.env.PUBLIC_API_URL = previousPublicApiUrl;
    }

    await app.close();
  });

  it('serves /.well-known/mcp.json discovery metadata', async () => {
    const res = await request(app.getHttpServer())
      .get('/.well-known/mcp.json')
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        protocol: 'mcp',
        transport: {
          type: 'streamable-http',
          endpoint: 'http://public.example.test/mcp',
        },
        endpoints: expect.objectContaining({
          mcp: 'http://public.example.test/mcp',
          openapi: 'http://public.example.test/openapi.json',
        }),
        tools: ['catalog.search', 'stem.quote', 'stem.download'],
      }),
    );
  });
});
