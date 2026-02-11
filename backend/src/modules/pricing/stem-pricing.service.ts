import { Injectable, Logger, ForbiddenException, NotFoundException } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { calculatePrice, PricingInput } from "../../pricing/pricing";

export interface StemPricingDto {
  basePlayPriceUsd: number;
  remixLicenseUsd: number;
  commercialLicenseUsd: number;
  floorUsd: number;
  ceilingUsd: number;
  listingDurationDays: number | null;
}

export interface PricingTemplate {
  id: string;
  name: string;
  description: string;
  pricing: Omit<StemPricingDto, "listingDurationDays">;
}

export interface ComputedPrices {
  personal: number;
  remix: number;
  commercial: number;
}

const PRICING_TEMPLATES: PricingTemplate[] = [
  {
    id: "free",
    name: "Free Tier",
    description: "Free streaming, minimal licensing fees",
    pricing: {
      basePlayPriceUsd: 0,
      remixLicenseUsd: 0,
      commercialLicenseUsd: 0,
      floorUsd: 0,
      ceilingUsd: 0,
    },
  },
  {
    id: "standard",
    name: "Standard",
    description: "Balanced pricing for most artists",
    pricing: {
      basePlayPriceUsd: 0.05,
      remixLicenseUsd: 5.0,
      commercialLicenseUsd: 25.0,
      floorUsd: 0.01,
      ceilingUsd: 50.0,
    },
  },
  {
    id: "premium",
    name: "Premium",
    description: "Higher base price with strong remix protection",
    pricing: {
      basePlayPriceUsd: 0.15,
      remixLicenseUsd: 15.0,
      commercialLicenseUsd: 75.0,
      floorUsd: 0.05,
      ceilingUsd: 100.0,
    },
  },
  {
    id: "exclusive",
    name: "Exclusive",
    description: "Premium pricing for high-demand content",
    pricing: {
      basePlayPriceUsd: 0.5,
      remixLicenseUsd: 50.0,
      commercialLicenseUsd: 250.0,
      floorUsd: 0.1,
      ceilingUsd: 500.0,
    },
  },
];

@Injectable()
export class StemPricingService {
  private readonly logger = new Logger(StemPricingService.name);

  /**
   * Validate that the requesting user owns the stem (via stem → track → release → artist → user)
   */
  async validateOwnership(stemId: string, userId: string): Promise<void> {
    const stem = await prisma.stem.findUnique({
      where: { id: stemId },
      include: {
        track: {
          include: {
            release: {
              include: { artist: true },
            },
          },
        },
      },
    });

    if (!stem) {
      throw new NotFoundException(`Stem ${stemId} not found`);
    }

    if (stem.track.release.artist.userId !== userId) {
      throw new ForbiddenException("You do not own this stem");
    }
  }

  /**
   * Get pricing for a single stem (returns defaults if not configured)
   */
  async getPricing(stemId: string) {
    const pricing = await prisma.stemPricing.findUnique({
      where: { stemId },
    });

    if (!pricing) {
      return {
        stemId,
        basePlayPriceUsd: 0.05,
        remixLicenseUsd: 5.0,
        commercialLicenseUsd: 25.0,
        floorUsd: 0.01,
        ceilingUsd: 50.0,
        listingDurationDays: null,
        computed: this.computePrices({
          basePlayPriceUsd: 0.05,
          remixLicenseUsd: 5.0,
          commercialLicenseUsd: 25.0,
        }),
      };
    }

    return {
      ...pricing,
      computed: this.computePrices({
        basePlayPriceUsd: pricing.basePlayPriceUsd,
        remixLicenseUsd: pricing.remixLicenseUsd,
        commercialLicenseUsd: pricing.commercialLicenseUsd,
      }),
    };
  }

  /**
   * Batch-get pricing for multiple stems (public, no auth).
   * Returns a map of stemId → pricing with computed prices.
   * Stems without custom pricing get standard defaults.
   */
  async batchGetPricing(stemIds: string[]) {
    if (stemIds.length === 0) return {};

    const pricingRows = await prisma.stemPricing.findMany({
      where: { stemId: { in: stemIds } },
    });

    const pricingMap = new Map(pricingRows.map((p) => [p.stemId, p]));
    const result: Record<string, unknown> = {};

    for (const stemId of stemIds) {
      const pricing = pricingMap.get(stemId);
      if (!pricing) {
        result[stemId] = {
          stemId,
          basePlayPriceUsd: 0.05,
          remixLicenseUsd: 5.0,
          commercialLicenseUsd: 25.0,
          floorUsd: 0.01,
          ceilingUsd: 50.0,
          listingDurationDays: null,
          computed: this.computePrices({
            basePlayPriceUsd: 0.05,
            remixLicenseUsd: 5.0,
            commercialLicenseUsd: 25.0,
          }),
        };
      } else {
        result[stemId] = {
          ...pricing,
          computed: this.computePrices({
            basePlayPriceUsd: pricing.basePlayPriceUsd,
            remixLicenseUsd: pricing.remixLicenseUsd,
            commercialLicenseUsd: pricing.commercialLicenseUsd,
          }),
        };
      }
    }

    return result;
  }

  /**
   * Upsert pricing for a stem
   */
  async upsertPricing(stemId: string, userId: string, dto: StemPricingDto) {
    await this.validateOwnership(stemId, userId);

    const pricing = await prisma.stemPricing.upsert({
      where: { stemId },
      create: {
        stemId,
        ...dto,
      },
      update: dto,
    });

    this.logger.log(`Pricing updated for stem ${stemId} by user ${userId}`);

    return {
      ...pricing,
      computed: this.computePrices({
        basePlayPriceUsd: pricing.basePlayPriceUsd,
        remixLicenseUsd: pricing.remixLicenseUsd,
        commercialLicenseUsd: pricing.commercialLicenseUsd,
      }),
    };
  }

  /**
   * Batch-update pricing for all stems of a release
   */
  async batchUpdateByRelease(releaseId: string, userId: string, dto: StemPricingDto) {
    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      include: {
        artist: true,
        tracks: {
          include: {
            stems: {
              where: { type: { not: "ORIGINAL" } },
            },
          },
        },
      },
    });

    if (!release) {
      throw new NotFoundException(`Release ${releaseId} not found`);
    }

    if (release.artist.userId !== userId) {
      throw new ForbiddenException("You do not own this release");
    }

    const stemIds: string[] = [];
    for (const track of release.tracks) {
      for (const stem of track.stems) {
        stemIds.push(stem.id);
      }
    }

    if (stemIds.length === 0) {
      return { updated: 0, stemIds: [] };
    }

    await prisma.$transaction(
      stemIds.map((stemId: string) =>
        prisma.stemPricing.upsert({
          where: { stemId },
          create: { stemId, ...dto },
          update: dto,
        }),
      ),
    );

    this.logger.log(
      `Batch pricing updated: ${stemIds.length} stems in release ${releaseId}`,
    );

    return { updated: stemIds.length, stemIds };
  }

  /**
   * Get available pricing templates
   */
  getTemplates(): PricingTemplate[] {
    return PRICING_TEMPLATES;
  }

  /**
   * Compute final prices — personal uses floor/ceiling from calculatePrice,
   * remix and commercial are flat independent amounts.
   */
  private computePrices(input: {
    basePlayPriceUsd: number;
    remixLicenseUsd: number;
    commercialLicenseUsd: number;
  }): ComputedPrices {
    return {
      personal: input.basePlayPriceUsd,
      remix: input.remixLicenseUsd,
      commercial: input.commercialLicenseUsd,
    };
  }
}
