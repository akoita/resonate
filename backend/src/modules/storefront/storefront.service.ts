import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { PUBLIC_RELEASE_ROUTES } from "../catalog/catalog-public.constants";
import { buildStemX402Quote } from "../x402/x402.quote";

type StorefrontStemSearchFilters = {
  q?: string;
  stemType?: string;
  hasIpnft?: boolean;
  limit?: number;
};

type StorefrontStemRow = {
  id: string;
  type: string;
  title: string | null;
  ipnftId: string | null;
  mimeType?: string | null;
  durationSeconds?: number | null;
  track: {
    id: string;
    title: string;
    artist: string | null;
    contentStatus: string;
    stems: Array<{ id: string; type: string }>;
    release: {
      id: string;
      title: string;
      primaryArtist: string | null;
      status: string;
    };
  };
  pricing: {
    basePlayPriceUsd: number;
    remixLicenseUsd: number;
    commercialLicenseUsd: number;
  } | null;
};

@Injectable()
export class StorefrontService {
  private readonly logger = new Logger(StorefrontService.name);

  async searchStems(filters: StorefrontStemSearchFilters) {
    const limit = Math.min(Math.max(filters.limit ?? 24, 1), 100);
    const rows = await this.findPublicStems({
      ...filters,
      limit,
    });

    return {
      items: rows.map((row) => this.toStorefrontItem(row)),
      meta: {
        count: rows.length,
        limit,
      },
    };
  }

  async getStemDetail(stemId: string) {
    const row = await this.findPublicStemById(stemId);
    if (!row) {
      throw new NotFoundException(`Public storefront stem ${stemId} not found`);
    }

    const item = this.toStorefrontItem(row);

    return {
      ...item,
      preview: {
        url: item.previewUrl,
        mimeType: row.mimeType ?? "audio/mpeg",
      },
      pricing: {
        currency: item.price.currency,
        licenses: item.licenseOptions,
        summary: item.priceSummary,
      },
      rights: {
        availableLicenses: item.licenseOptions.map((option) => option.key),
        assetAccess: "paid",
        discoveryAccess: "public",
      },
      payment: {
        protocol: "x402",
        network: process.env.X402_NETWORK || "eip155:84532",
        quoteUrl: item.quoteUrl,
        purchaseUrl: item.purchaseUrl,
      },
      asset: {
        kind: "stem",
        delivery: "audio-download",
        mimeType: row.mimeType ?? "audio/mpeg",
        durationSeconds: row.durationSeconds ?? null,
      },
    };
  }

  protected async findPublicStems(
    filters: Required<Pick<StorefrontStemSearchFilters, "limit">> &
      Omit<StorefrontStemSearchFilters, "limit">,
  ): Promise<StorefrontStemRow[]> {
    const query = filters.q?.trim();

    try {
      return await prisma.stem.findMany({
        where: {
          ...(filters.stemType
            ? { type: { equals: filters.stemType, mode: "insensitive" } }
            : {}),
          ...(filters.hasIpnft !== undefined
            ? filters.hasIpnft
              ? { ipnftId: { not: null } }
              : { ipnftId: null }
            : {}),
          ...(query
            ? {
                OR: [
                  { title: { contains: query, mode: "insensitive" } },
                  {
                    track: {
                      title: { contains: query, mode: "insensitive" },
                    },
                  },
                  {
                    track: {
                      artist: { contains: query, mode: "insensitive" },
                    },
                  },
                  {
                    track: {
                      release: {
                        title: { contains: query, mode: "insensitive" },
                      },
                    },
                  },
                  {
                    track: {
                      release: {
                        primaryArtist: {
                          contains: query,
                          mode: "insensitive",
                        },
                      },
                    },
                  },
                  {
                    track: {
                      release: {
                        featuredArtists: {
                          contains: query,
                          mode: "insensitive",
                        },
                      },
                    },
                  },
                ],
              }
            : {}),
          track: {
            contentStatus: "clean",
            release: {
              status: { in: ["ready", "published"] },
              OR: [
                { rightsRoute: null },
                { rightsRoute: { in: [...PUBLIC_RELEASE_ROUTES] } },
              ],
            },
          },
        },
        orderBy: [
          { track: { release: { createdAt: "desc" } } },
          { type: "asc" },
        ],
        take: filters.limit,
        select: {
          id: true,
          type: true,
          title: true,
          ipnftId: true,
          mimeType: true,
          durationSeconds: true,
          pricing: {
            select: {
              basePlayPriceUsd: true,
              remixLicenseUsd: true,
              commercialLicenseUsd: true,
            },
          },
          track: {
            select: {
              id: true,
              title: true,
              artist: true,
              contentStatus: true,
              stems: {
                select: {
                  id: true,
                  type: true,
                },
                orderBy: { type: "asc" },
              },
              release: {
                select: {
                  id: true,
                  title: true,
                  primaryArtist: true,
                  status: true,
                },
              },
            },
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Storefront search failed: ${message}`);
      throw error;
    }
  }

  protected async findPublicStemById(
    stemId: string,
  ): Promise<StorefrontStemRow | null> {
    try {
      return await prisma.stem.findFirst({
        where: {
          id: stemId,
          track: {
            contentStatus: "clean",
            release: {
              status: { in: ["ready", "published"] },
              OR: [
                { rightsRoute: null },
                { rightsRoute: { in: [...PUBLIC_RELEASE_ROUTES] } },
              ],
            },
          },
        },
        select: {
          id: true,
          type: true,
          title: true,
          ipnftId: true,
          mimeType: true,
          durationSeconds: true,
          pricing: {
            select: {
              basePlayPriceUsd: true,
              remixLicenseUsd: true,
              commercialLicenseUsd: true,
            },
          },
          track: {
            select: {
              id: true,
              title: true,
              artist: true,
              contentStatus: true,
              stems: {
                select: {
                  id: true,
                  type: true,
                },
                orderBy: { type: "asc" },
              },
              release: {
                select: {
                  id: true,
                  title: true,
                  primaryArtist: true,
                  status: true,
                },
              },
            },
          },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Storefront detail failed: ${message}`);
      throw error;
    }
  }

  private toStorefrontItem(row: StorefrontStemRow) {
    const artist = row.track.release.primaryArtist ?? row.track.artist ?? null;
    const stemLabel = row.title ?? `${row.track.title} — ${row.type}`;
    const quote = buildStemX402Quote({
      stemId: row.id,
      type: row.type,
      title: row.title,
      trackTitle: row.track.title,
      artist,
      releaseTitle: row.track.release.title,
      hasNft: Boolean(row.ipnftId),
      tokenId: row.ipnftId,
      basePlayPriceUsd: row.pricing?.basePlayPriceUsd,
      remixLicenseUsd: row.pricing?.remixLicenseUsd,
      commercialLicenseUsd: row.pricing?.commercialLicenseUsd,
      network: process.env.X402_NETWORK || "eip155:84532",
      payTo: process.env.X402_PAYOUT_ADDRESS || "",
    });

    return {
      id: row.id,
      title: stemLabel,
      artist,
      releaseId: row.track.release.id,
      releaseTitle: row.track.release.title,
      trackId: row.track.id,
      trackTitle: row.track.title,
      stemType: row.type,
      stemTypes: row.track.stems.map((stem) => stem.type),
      hasIpnft: Boolean(row.ipnftId),
      price: quote.price,
      licenseOptions: quote.licenseOptions,
      priceSummary: quote.priceSummary,
      alternativeOffers: quote.alternativeOffers,
      previewUrl: `/catalog/stems/${row.id}/preview`,
      quoteUrl: quote.purchase.quoteUrl,
      purchaseUrl: quote.purchase.endpoint,
    };
  }
}
