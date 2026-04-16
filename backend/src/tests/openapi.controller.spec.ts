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
    expect(
      doc.paths['/api/stems/{stemId}/x402'].get['x-payment-info'],
    ).toEqual({
      price: {
        mode: 'dynamic',
        currency: 'USDC',
        min: '0.05',
        max: '50',
      },
      quote: {
        endpoint: '/api/stems/{stemId}/x402/info',
        schema: '#/components/schemas/X402StemInfo',
      },
      challenge: {
        status: 402,
        schema: '#/components/schemas/X402PaymentRequired',
      },
      protocols: [
        {
          x402: {
            quoteEndpoint: '/api/stems/{stemId}/x402/info',
            network: 'eip155:8453',
            retryHeaders: ['PAYMENT-SIGNATURE', 'X-PAYMENT'],
          },
        },
      ],
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
});
