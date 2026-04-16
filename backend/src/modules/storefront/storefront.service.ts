import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { PUBLIC_RELEASE_ROUTES } from "../catalog/catalog-public.constants";
import { X402Config } from "../x402/x402.config";
import {
  buildStorefrontStemDetail,
  buildStorefrontStemItem,
  StorefrontStemPresentationRow,
} from "./storefront.presenter";

type StorefrontStemSearchFilters = {
  q?: string;
  stemType?: string;
  hasIpnft?: boolean;
  limit?: number;
};

type StorefrontStemRow = StorefrontStemPresentationRow & {
  track: StorefrontStemPresentationRow["track"] & {
    contentStatus: string;
    release: StorefrontStemPresentationRow["track"]["release"] & {
      status: string;
    };
  };
};

@Injectable()
export class StorefrontService {
  private readonly logger = new Logger(StorefrontService.name);

  constructor(private readonly x402Config: X402Config) {}

  async searchStems(filters: StorefrontStemSearchFilters) {
    const limit = Math.min(Math.max(filters.limit ?? 24, 1), 100);
    const rows = await this.findPublicStems({
      ...filters,
      limit,
    });

    return {
      items: rows.map((row) => buildStorefrontStemItem(row, this.x402Config)),
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

    return buildStorefrontStemDetail(row, this.x402Config);
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
}
