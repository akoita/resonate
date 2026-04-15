import { Injectable, Logger } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { PUBLIC_RELEASE_ROUTES } from "../catalog/catalog-public.constants";

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

  private toStorefrontItem(row: StorefrontStemRow) {
    const pricing = row.pricing ?? {
      basePlayPriceUsd: 0.05,
      remixLicenseUsd: 5,
      commercialLicenseUsd: 25,
    };
    const artist = row.track.release.primaryArtist ?? row.track.artist ?? null;
    const stemLabel = row.title ?? `${row.track.title} — ${row.type}`;

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
      licenseOptions: [
        { key: "personal", priceUsd: pricing.basePlayPriceUsd },
        { key: "remix", priceUsd: pricing.remixLicenseUsd },
        { key: "commercial", priceUsd: pricing.commercialLicenseUsd },
      ],
      priceSummary: {
        currency: "USD",
        fromUsd: pricing.basePlayPriceUsd,
        toUsd: pricing.commercialLicenseUsd,
      },
      previewUrl: `/catalog/stems/${row.id}/preview`,
      quoteUrl: `/api/stems/${row.id}/x402/info`,
      purchaseUrl: `/api/stems/${row.id}/x402`,
    };
  }
}
