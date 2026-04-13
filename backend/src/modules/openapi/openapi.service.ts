import { Injectable } from "@nestjs/common";

type OpenApiDocument = Record<string, unknown>;

@Injectable()
export class OpenApiService {
  buildDocument(baseUrl: string): OpenApiDocument {
    return {
      openapi: "3.1.0",
      info: {
        title: "Resonate API",
        version: "0.1.0",
        description:
          "Machine-readable contract for the public Resonate discovery, pricing, and x402 payment surfaces.",
        "x-guidance": [
          "# Resonate API",
          "",
          "Recommended flow:",
          "1. Call GET /catalog/published to discover public releases.",
          "2. Call GET /catalog/tracks/{trackId} to inspect available stems.",
          "3. Call GET /api/stem-pricing/{stemId} for public pricing hints.",
          "4. Call GET /api/stems/{stemId}/x402/info before attempting a paid stem request.",
        ].join("\n"),
      },
      servers: [{ url: baseUrl }],
      paths: {
        "/catalog/published": {
          get: {
            summary: "List published releases",
            description:
              "Public catalog discovery endpoint returning published releases.",
            parameters: [
              {
                name: "limit",
                in: "query",
                schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
              },
              {
                name: "primaryArtist",
                in: "query",
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "Published releases returned successfully.",
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ReleaseSummary" },
                    },
                  },
                },
              },
            },
          },
        },
        "/catalog/releases/{releaseId}": {
          get: {
            summary: "Get release detail",
            parameters: [
              {
                name: "releaseId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "Release detail returned successfully.",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/ReleaseDetail" },
                  },
                },
              },
              "404": {
                description: "Release not found.",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/ErrorResponse" },
                  },
                },
              },
            },
          },
        },
        "/catalog/tracks/{trackId}": {
          get: {
            summary: "Get track detail",
            parameters: [
              {
                name: "trackId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "Track detail returned successfully.",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/TrackDetail" },
                  },
                },
              },
              "404": {
                description: "Track not found.",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/ErrorResponse" },
                  },
                },
              },
            },
          },
        },
        "/api/stem-pricing/templates": {
          get: {
            summary: "List pricing templates",
            responses: {
              "200": {
                description: "Pricing templates returned successfully.",
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      items: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
        },
        "/api/stem-pricing/batch-get": {
          get: {
            summary: "Fetch pricing for multiple stems",
            parameters: [
              {
                name: "stemIds",
                in: "query",
                required: true,
                schema: { type: "string" },
                description: "Comma-separated stem ids.",
              },
            ],
            responses: {
              "200": {
                description: "Stem pricing returned successfully.",
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      items: { $ref: "#/components/schemas/StemPricing" },
                    },
                  },
                },
              },
            },
          },
        },
        "/api/stem-pricing/{stemId}": {
          get: {
            summary: "Fetch pricing for a single stem",
            parameters: [
              {
                name: "stemId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "Stem pricing returned successfully.",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/StemPricing" },
                  },
                },
              },
            },
          },
        },
        "/api/stems/{stemId}/x402/info": {
          get: {
            summary: "Inspect x402 purchase metadata for a stem",
            description:
              "Free endpoint used to discover pricing and payment instructions before paying.",
            parameters: [
              {
                name: "stemId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "Stem x402 metadata returned successfully.",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/X402StemInfo" },
                  },
                },
              },
              "404": {
                description: "Stem not found or x402 disabled.",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/ErrorResponse" },
                  },
                },
              },
            },
          },
        },
        "/api/stems/{stemId}/x402": {
          get: {
            summary: "Purchase and download a stem via x402",
            description:
              "Paid endpoint. Clients should call the free info endpoint first, then handle the 402 payment challenge and retry with the payment header.",
            parameters: [
              {
                name: "stemId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: {
              "200": {
                description: "Stem audio returned after successful x402 payment.",
                content: {
                  "audio/mpeg": {
                    schema: {
                      type: "string",
                      format: "binary",
                    },
                  },
                },
              },
              "402": {
                description: "Payment required. Retry after satisfying the x402 challenge.",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/X402PaymentRequired" },
                  },
                },
              },
              "404": {
                description: "Stem not found or x402 disabled.",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/ErrorResponse" },
                  },
                },
              },
              "500": {
                description: "Download failed.",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/ErrorResponse" },
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
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
            },
            required: ["error"],
          },
          ReleaseSummary: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              primaryArtist: { type: "string", nullable: true },
              genre: { type: "string", nullable: true },
              artworkUrl: { type: "string", nullable: true },
            },
            required: ["id", "title"],
          },
          ReleaseDetail: {
            allOf: [
              { $ref: "#/components/schemas/ReleaseSummary" },
              {
                type: "object",
                properties: {
                  tracks: {
                    type: "array",
                    items: { $ref: "#/components/schemas/TrackDetail" },
                  },
                },
              },
            ],
          },
          TrackDetail: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              artist: { type: "string", nullable: true },
              stems: {
                type: "array",
                items: { $ref: "#/components/schemas/StemSummary" },
              },
            },
            required: ["id", "title"],
          },
          StemSummary: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: { type: "string" },
              title: { type: "string", nullable: true },
            },
            required: ["id", "type"],
          },
          StemPricing: {
            type: "object",
            properties: {
              stemId: { type: "string" },
              basePlayPriceUsd: { type: "number", nullable: true },
              remixPriceUsd: { type: "number", nullable: true },
              commercialPriceUsd: { type: "number", nullable: true },
            },
            required: ["stemId"],
            additionalProperties: true,
          },
          X402StemInfo: {
            type: "object",
            properties: {
              stemId: { type: "string" },
              type: { type: "string" },
              title: { type: "string", nullable: true },
              trackTitle: { type: "string", nullable: true },
              artist: { type: "string", nullable: true },
              releaseTitle: { type: "string", nullable: true },
              hasNft: { type: "boolean" },
              tokenId: { type: "string", nullable: true },
              price: {
                type: "object",
                properties: {
                  wei: { type: "string", nullable: true },
                  usd: { type: "number", nullable: true },
                },
                nullable: true,
              },
              x402: {
                type: "object",
                properties: {
                  network: { type: "string" },
                  payTo: { type: "string" },
                  scheme: { type: "string" },
                  endpoint: { type: "string" },
                },
                required: ["network", "payTo", "scheme", "endpoint"],
              },
            },
            required: ["stemId", "type", "hasNft", "x402"],
          },
          X402PaymentRequired: {
            type: "object",
            properties: {
              error: { type: "string", enum: ["payment_required"] },
              accepts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    scheme: { type: "string" },
                    network: { type: "string" },
                    payTo: { type: "string" },
                    maxAmountRequired: { type: "string" },
                    resource: { type: "string" },
                    description: { type: "string" },
                    mimeType: { type: "string" },
                  },
                  required: [
                    "scheme",
                    "network",
                    "payTo",
                    "maxAmountRequired",
                    "resource",
                  ],
                },
              },
            },
            required: ["error", "accepts"],
          },
        },
      },
    };
  }
}
