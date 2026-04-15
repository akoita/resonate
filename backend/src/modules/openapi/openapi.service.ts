import { Injectable } from '@nestjs/common';
import { X402Config } from '../x402/x402.config';
import { X402_RETRY_HEADERS } from '../x402/x402.public';

type OpenApiDocument = Record<string, unknown>;
type OpenApiSchema = Record<string, unknown>;
type WellKnownDocument = Record<string, unknown>;

@Injectable()
export class OpenApiService {
  constructor(private readonly x402Config: X402Config) {}

  buildDocument(baseUrl: string): OpenApiDocument {
    return {
      openapi: '3.1.0',
      info: {
        title: 'Resonate API',
        version: '0.1.0',
        description:
          'Machine-readable contract for the public Resonate discovery, storefront, pricing, and x402 payment surfaces.',
        'x-guidance': [
          '# Resonate API',
          '',
          'Recommended flow:',
          '1. Call GET /api/storefront/stems to discover purchasable stems.',
          '2. Call GET /api/storefront/stems/{stemId} or GET /api/stems/{stemId}/x402/info to inspect pricing and licensing.',
          `3. Call GET /api/stems/{stemId}/x402 and handle the 402 challenge via ${X402_RETRY_HEADERS.join(' or ')}.`,
          '4. Retry the paid GET request and read the response receipt headers.',
        ].join('\n'),
      },
      servers: [{ url: baseUrl }],
      paths: {
        '/catalog/published': {
          get: {
            summary: 'List published releases',
            description:
              'Public catalog discovery endpoint returning published releases.',
            parameters: [
              {
                name: 'limit',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
              },
              {
                name: 'primaryArtist',
                in: 'query',
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'Published releases returned successfully.',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ReleaseSummary' },
                    },
                  },
                },
              },
            },
          },
        },
        '/catalog/releases/{releaseId}': {
          get: {
            summary: 'Get release detail',
            parameters: [
              {
                name: 'releaseId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'Release detail returned successfully.',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ReleaseDetail' },
                  },
                },
              },
              '404': {
                description: 'Release not found.',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                  },
                },
              },
            },
          },
        },
        '/catalog/tracks/{trackId}': {
          get: {
            summary: 'Get track detail',
            parameters: [
              {
                name: 'trackId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'Track detail returned successfully.',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/TrackDetail' },
                  },
                },
              },
              '404': {
                description: 'Track not found.',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                  },
                },
              },
            },
          },
        },
        '/api/storefront/stems': {
          get: {
            summary: 'Search public storefront stems',
            description:
              'Primary machine-first discovery endpoint for purchasable public stems.',
            parameters: [
              {
                name: 'q',
                in: 'query',
                schema: { type: 'string' },
              },
              {
                name: 'stemType',
                in: 'query',
                schema: { type: 'string' },
              },
              {
                name: 'hasIpnft',
                in: 'query',
                schema: { type: 'boolean' },
              },
              {
                name: 'limit',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: 100, default: 24 },
              },
            ],
            responses: {
              '200': {
                description: 'Storefront search results returned successfully.',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/StorefrontStemSearchResponse' },
                  },
                },
              },
            },
          },
        },
        '/api/storefront/stems/{stemId}': {
          get: {
            summary: 'Get public storefront stem detail',
            parameters: [
              {
                name: 'stemId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'Storefront stem detail returned successfully.',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/StorefrontStemDetail' },
                  },
                },
              },
              '404': {
                description: 'Public storefront stem not found.',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                  },
                },
              },
            },
          },
        },
        '/api/stem-pricing/templates': {
          get: {
            summary: 'List pricing templates',
            responses: {
              '200': {
                description: 'Pricing templates returned successfully.',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { type: 'object', additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
        },
        '/api/stem-pricing/batch-get': {
          get: {
            summary: 'Fetch pricing for multiple stems',
            parameters: [
              {
                name: 'stemIds',
                in: 'query',
                required: true,
                schema: { type: 'string' },
                description: 'Comma-separated stem ids.',
              },
            ],
            responses: {
              '200': {
                description: 'Stem pricing returned successfully.',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: {
                        $ref: '#/components/schemas/StemPricing',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        '/api/stem-pricing/{stemId}': {
          get: {
            summary: 'Fetch pricing for a single stem',
            parameters: [
              {
                name: 'stemId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'Stem pricing returned successfully.',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/StemPricing' },
                  },
                },
              },
            },
          },
        },
        '/api/stems/{stemId}/x402/info': {
          get: {
            summary: 'Inspect x402 purchase metadata for a stem',
            description:
              'Free endpoint used to discover pricing, license options, and payment instructions before paying.',
            parameters: [
              {
                name: 'stemId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'Stem x402 metadata returned successfully.',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/X402StemInfo' },
                  },
                },
              },
              '404': {
                description: 'Stem not found or x402 disabled.',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                  },
                },
              },
            },
          },
        },
        '/api/stems/{stemId}/x402': {
          get: {
            summary: 'Purchase and download a stem via x402',
            description:
              'Paid endpoint. Call the free info endpoint first, handle the x402 challenge, then retry with PAYMENT-SIGNATURE. Legacy X-PAYMENT retries remain supported for compatibility.',
            'x-payment-info': {
              price: {
                mode: 'dynamic',
                currency: 'USD',
                min: '0.01',
                max: '50',
              },
              protocols: [
                {
                  x402: {
                    quoteEndpoint: '/api/stems/{stemId}/x402/info',
                  },
                },
              ],
            },
            parameters: [
              {
                name: 'stemId',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            responses: {
              '200': {
                description: 'Stem audio returned after successful x402 payment.',
                headers: {
                  'X-Resonate-License': {
                    schema: { type: 'string' },
                    description: 'Resolved license key attached to the paid download.',
                  },
                  'X-Resonate-Receipt': {
                    schema: { type: 'string' },
                    description:
                      'Base64url-encoded machine-readable purchase receipt.',
                  },
                  'X-Resonate-Receipt-Id': {
                    schema: { type: 'string' },
                    description: 'Stable purchase receipt identifier.',
                  },
                  'X-Resonate-Receipt-Content-Type': {
                    schema: { type: 'string' },
                    description:
                      'Receipt media type for the X-Resonate-Receipt payload.',
                  },
                },
                content: {
                  'application/octet-stream': {
                    schema: {
                      type: 'string',
                      format: 'binary',
                    },
                  },
                },
              },
              '402': {
                description: 'Payment required. Retry after satisfying the x402 challenge.',
                headers: {
                  'PAYMENT-REQUIRED': {
                    schema: { type: 'string' },
                    description:
                      'Base64-encoded x402 v2 payment challenge mirrored from the JSON response body.',
                  },
                },
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/X402PaymentRequired' },
                  },
                },
              },
              '404': {
                description: 'Stem not found, unavailable, or x402 disabled.',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                  },
                },
              },
              '500': {
                description: 'Download failed.',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ErrorResponse' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          ErrorResponse: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
            },
            required: ['error'],
          },
          ReleaseSummary: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              primaryArtist: { type: 'string', nullable: true },
              genre: { type: 'string', nullable: true },
              artworkUrl: { type: 'string', nullable: true },
            },
            required: ['id', 'title'],
          },
          ReleaseDetail: {
            allOf: [
              { $ref: '#/components/schemas/ReleaseSummary' },
              {
                type: 'object',
                properties: {
                  tracks: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/TrackDetail' },
                  },
                },
              },
            ],
          },
          TrackDetail: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              artist: { type: 'string', nullable: true },
              stems: {
                type: 'array',
                items: { $ref: '#/components/schemas/StemSummary' },
              },
            },
            required: ['id', 'title'],
          },
          StemSummary: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string' },
              title: { type: 'string', nullable: true },
            },
            required: ['id', 'type'],
          },
          StemPricing: {
            type: 'object',
            properties: {
              stemId: { type: 'string' },
              basePlayPriceUsd: { type: 'number', nullable: true },
              remixLicenseUsd: { type: 'number', nullable: true },
              commercialLicenseUsd: { type: 'number', nullable: true },
              floorUsd: { type: 'number', nullable: true },
              ceilingUsd: { type: 'number', nullable: true },
              listingDurationDays: { type: 'integer', nullable: true },
              computed: {
                type: 'object',
                properties: {
                  personal: { type: 'number' },
                  remix: { type: 'number' },
                  commercial: { type: 'number' },
                },
                additionalProperties: false,
                nullable: true,
              },
            },
            required: ['stemId'],
            additionalProperties: true,
          },
          StorefrontStemSearchResponse: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: { $ref: '#/components/schemas/StorefrontStemItem' },
              },
              meta: {
                type: 'object',
                properties: {
                  count: { type: 'integer' },
                  limit: { type: 'integer' },
                },
                required: ['count', 'limit'],
              },
            },
            required: ['items', 'meta'],
          },
          StorefrontStemItem: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              artist: { type: 'string', nullable: true },
              releaseId: { type: 'string' },
              releaseTitle: { type: 'string' },
              trackId: { type: 'string' },
              trackTitle: { type: 'string' },
              stemType: { type: 'string' },
              stemTypes: {
                type: 'array',
                items: { type: 'string' },
              },
              hasIpnft: { type: 'boolean' },
              price: { $ref: '#/components/schemas/UsdcPrice' },
              licenseOptions: {
                type: 'array',
                items: { $ref: '#/components/schemas/LicenseOption' },
              },
              priceSummary: { $ref: '#/components/schemas/PriceSummary' },
              alternativeOffers: {
                type: 'array',
                items: { $ref: '#/components/schemas/AlternativeOffer' },
              },
              previewUrl: { type: 'string' },
              quoteUrl: { type: 'string' },
              purchaseUrl: { type: 'string' },
            },
            required: [
              'id',
              'title',
              'releaseId',
              'releaseTitle',
              'trackId',
              'trackTitle',
              'stemType',
              'stemTypes',
              'hasIpnft',
              'price',
              'licenseOptions',
              'priceSummary',
              'alternativeOffers',
              'previewUrl',
              'quoteUrl',
              'purchaseUrl',
            ],
          },
          StorefrontStemDetail: {
            allOf: [
              { $ref: '#/components/schemas/StorefrontStemItem' },
              {
                type: 'object',
                properties: {
                  preview: {
                    type: 'object',
                    properties: {
                      url: { type: 'string' },
                      mimeType: { type: 'string' },
                    },
                    required: ['url', 'mimeType'],
                  },
                  pricing: {
                    type: 'object',
                    properties: {
                      currency: { type: 'string' },
                      licenses: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/LicenseOption' },
                      },
                      summary: { $ref: '#/components/schemas/PriceSummary' },
                    },
                    required: ['currency', 'licenses', 'summary'],
                  },
                  rights: {
                    type: 'object',
                    properties: {
                      availableLicenses: {
                        type: 'array',
                        items: { type: 'string' },
                      },
                      assetAccess: { type: 'string' },
                      discoveryAccess: { type: 'string' },
                    },
                    required: ['availableLicenses', 'assetAccess', 'discoveryAccess'],
                  },
                  payment: {
                    type: 'object',
                    properties: {
                      protocol: { type: 'string' },
                      network: { type: 'string' },
                      quoteUrl: { type: 'string' },
                      purchaseUrl: { type: 'string' },
                    },
                    required: ['protocol', 'network', 'quoteUrl', 'purchaseUrl'],
                  },
                  asset: {
                    type: 'object',
                    properties: {
                      kind: { type: 'string' },
                      delivery: { type: 'string' },
                      mimeType: { type: 'string' },
                      durationSeconds: { type: 'number', nullable: true },
                    },
                    required: ['kind', 'delivery', 'mimeType', 'durationSeconds'],
                  },
                },
                required: ['preview', 'pricing', 'rights', 'payment', 'asset'],
              },
            ],
          },
          UsdcPrice: this.buildUsdcPriceSchema(),
          PriceSummary: {
            type: 'object',
            properties: {
              currency: { type: 'string' },
              from: { type: 'string' },
              to: { type: 'string' },
              display: { type: 'string' },
            },
            required: ['currency', 'from', 'to', 'display'],
          },
          LicenseOption: {
            type: 'object',
            properties: {
              key: { type: 'string', enum: ['personal', 'remix', 'commercial'] },
              price: {
                type: 'object',
                properties: {
                  currency: { type: 'string' },
                  amount: { type: 'string' },
                },
                required: ['currency', 'amount'],
              },
              displayPrice: { type: 'string' },
            },
            required: ['key', 'price', 'displayPrice'],
          },
          AlternativeOffer: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              currency: { type: 'string' },
              amountWei: { type: 'string' },
            },
            required: ['type', 'currency', 'amountWei'],
          },
          X402StemInfo: {
            type: 'object',
            properties: {
              stemId: { type: 'string' },
              type: { type: 'string' },
              title: { type: 'string', nullable: true },
              trackTitle: { type: 'string', nullable: true },
              artist: { type: 'string', nullable: true },
              releaseTitle: { type: 'string', nullable: true },
              hasNft: { type: 'boolean' },
              tokenId: { type: 'string', nullable: true },
              price: { $ref: '#/components/schemas/UsdcPrice' },
              priceSummary: { $ref: '#/components/schemas/PriceSummary' },
              licenseOptions: {
                type: 'array',
                items: { $ref: '#/components/schemas/LicenseOption' },
              },
              purchase: {
                type: 'object',
                properties: {
                  protocol: { type: 'string' },
                  scheme: { type: 'string' },
                  network: { type: 'string' },
                  payTo: { type: 'string' },
                  endpoint: { type: 'string' },
                  quoteUrl: { type: 'string' },
                },
                required: ['protocol', 'scheme', 'network', 'payTo', 'endpoint', 'quoteUrl'],
              },
              x402: {
                type: 'object',
                properties: {
                  network: { type: 'string' },
                  payTo: { type: 'string' },
                  scheme: { type: 'string' },
                  endpoint: { type: 'string' },
                  quoteUrl: { type: 'string' },
                },
                required: ['network', 'payTo', 'scheme', 'endpoint', 'quoteUrl'],
              },
              alternativeOffers: {
                type: 'array',
                items: { $ref: '#/components/schemas/AlternativeOffer' },
              },
            },
            required: [
              'stemId',
              'type',
              'hasNft',
              'price',
              'priceSummary',
              'licenseOptions',
              'purchase',
              'x402',
              'alternativeOffers',
            ],
          },
          X402PaymentRequired: {
            type: 'object',
            properties: {
              x402Version: { type: 'integer', enum: [2] },
              error: { type: 'string' },
              resource: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                  description: { type: 'string' },
                  mimeType: { type: 'string' },
                },
                required: ['url', 'description', 'mimeType'],
              },
              accepts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    scheme: { type: 'string' },
                    network: { type: 'string' },
                    amount: { type: 'string' },
                    asset: { type: 'string' },
                    payTo: { type: 'string' },
                    maxTimeoutSeconds: { type: 'integer' },
                    extra: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        version: { type: 'string' },
                        displayPrice: { type: 'string' },
                      },
                      required: ['name', 'version', 'displayPrice'],
                    },
                  },
                  required: [
                    'scheme',
                    'network',
                    'amount',
                    'asset',
                    'payTo',
                    'maxTimeoutSeconds',
                    'extra',
                  ],
                },
              },
            },
            required: ['x402Version', 'error', 'resource', 'accepts'],
          },
        },
      },
    };
  }

  buildWellKnownDocument(baseUrl: string): WellKnownDocument {
    return {
      version: 1,
      provider: 'Resonate',
      protocol: 'x402',
      openapi: `${baseUrl}/openapi.json`,
      network: this.x402Config.network,
      resources: [`GET ${baseUrl}/api/stems/{stemId}/x402`],
      instructions: [
        'Discover public stems with GET /api/storefront/stems.',
        'Inspect pricing with GET /api/stems/{stemId}/x402/info.',
        `Handle the 402 challenge on GET /api/stems/{stemId}/x402 and retry with ${X402_RETRY_HEADERS.join(' or ')}.`,
      ].join(' '),
    };
  }

  private buildUsdcPriceSchema(): OpenApiSchema {
    return {
      type: 'object',
      properties: {
        currency: { type: 'string', enum: ['USDC'] },
        amount: { type: 'string' },
        display: { type: 'string' },
        usd: { type: 'number' },
      },
      required: ['currency', 'amount', 'display', 'usd'],
    };
  }
}
