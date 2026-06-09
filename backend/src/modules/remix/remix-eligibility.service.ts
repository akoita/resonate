import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";
import {
  evaluateRemixEligibility,
  REMIX_ELIGIBLE_ROUTES,
  type RemixEligibilityDecision,
  type RemixStemPolicyInput,
} from "./remix-eligibility.policy";

export type RemixEligibilityResult = RemixEligibilityDecision & {
  source: {
    trackId: string;
    rightsRoute: string | null;
    contentStatus: string;
  };
  stems: Array<{
    stemId: string;
    remixable: boolean | null;
    licensed: boolean;
  }>;
};

@Injectable()
export class RemixEligibilityService {
  async checkEligibility(input: {
    userId: string;
    trackId: string;
    stemIds?: string[];
  }): Promise<RemixEligibilityResult> {
    const track = await prisma.track.findUnique({
      where: { id: input.trackId },
      select: {
        id: true,
        contentStatus: true,
        rightsRoute: true,
        release: { select: { rightsRoute: true } },
        stems: {
          select: {
            id: true,
            nftMint: { select: { remixable: true } },
          },
        },
      },
    });
    if (!track) {
      throw new NotFoundException(`Track ${input.trackId} not found`);
    }

    const requestedStemIds = input.stemIds?.length
      ? Array.from(new Set(input.stemIds))
      : track.stems.map((stem) => stem.id);
    const trackStemsById = new Map(track.stems.map((stem) => [stem.id, stem]));
    const unknownStemIds = requestedStemIds.filter(
      (stemId) => !trackStemsById.has(stemId),
    );
    if (unknownStemIds.length > 0) {
      throw new BadRequestException(
        `Stems do not belong to track ${input.trackId}: ${unknownStemIds.join(", ")}`,
      );
    }

    const rightsRoute = track.rightsRoute ?? track.release?.rightsRoute ?? null;
    const licensedStemIds = await this.findLicensedStemIds(
      input.userId,
      requestedStemIds,
    );

    const stems: RemixStemPolicyInput[] = requestedStemIds.map((stemId) => ({
      stemId,
      mintRemixable: trackStemsById.get(stemId)?.nftMint?.remixable ?? null,
      licensed: licensedStemIds.has(stemId),
    }));

    const decision = evaluateRemixEligibility({
      rightsRoute,
      contentStatus: track.contentStatus,
      sourceOptedIn: this.isSourceOptedIn(rightsRoute),
      stems,
    });

    return {
      ...decision,
      source: {
        trackId: track.id,
        rightsRoute,
        contentStatus: track.contentStatus,
      },
      stems: stems.map((stem) => ({
        stemId: stem.stemId,
        remixable: stem.mintRemixable,
        licensed: stem.licensed,
      })),
    };
  }

  /**
   * Conservative source opt-in hook. Until artist-level remix opt-in settings
   * exist, sources on remix-eligible rights routes are treated as opted in.
   * Replacing this with an explicit artist/release flag must not change the
   * eligibility API shape.
   */
  private isSourceOptedIn(rightsRoute: string | null): boolean {
    return (
      !!rightsRoute &&
      (REMIX_ELIGIBLE_ROUTES as readonly string[]).includes(rightsRoute)
    );
  }

  /**
   * A stem counts as remix-licensed for the user when their wallet bought a
   * marketplace listing with a remix license, or holds a listing-backed x402
   * settlement whose listing carries a remix license. Server-side records
   * only; client claims are never trusted.
   */
  private async findLicensedStemIds(
    userId: string,
    stemIds: string[],
  ): Promise<Set<string>> {
    if (stemIds.length === 0) {
      return new Set();
    }
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      select: { address: true },
    });
    if (!wallet?.address) {
      return new Set();
    }

    const [purchases, settlements] = await Promise.all([
      prisma.stemPurchase.findMany({
        where: {
          licenseType: "remix",
          buyerAddress: { equals: wallet.address, mode: "insensitive" },
          listing: { stemId: { in: stemIds } },
        },
        select: { listing: { select: { stemId: true } } },
      }),
      prisma.x402Settlement.findMany({
        where: {
          stemId: { in: stemIds },
          payerAddress: { equals: wallet.address, mode: "insensitive" },
          listing: { licenseType: "remix" },
          // Rows persist for failed listing settlements too
          // (status = contract_settlement_failed); only a granted settlement
          // proves the listing-backed remix license.
          status: "download_granted",
        },
        select: { stemId: true },
      }),
    ]);

    const licensed = new Set<string>();
    for (const purchase of purchases) {
      if (purchase.listing.stemId) {
        licensed.add(purchase.listing.stemId);
      }
    }
    for (const settlement of settlements) {
      licensed.add(settlement.stemId);
    }
    return licensed;
  }
}
