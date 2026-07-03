import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";
import {
  evaluateRemixEligibility,
  type RemixEligibilityDecision,
  type RemixStemPolicyInput,
} from "./remix-eligibility.policy";

export type RemixEligibilityResult = RemixEligibilityDecision & {
  /**
   * True when the caller owns the source artist profile (#1174). Ownership
   * satisfies the license requirement only — content-status, rights-route,
   * consent, and remixable checks still apply unchanged. Surfaced so
   * analytics can distinguish owner remixes from licensed-buyer remixes.
   */
  creatorOwner: boolean;
  source: {
    trackId: string;
    rightsRoute: string | null;
    contentStatus: string;
  };
  stems: Array<{
    stemId: string;
    remixable: boolean | null;
    licensed: boolean;
    exportLicensed: boolean;
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
        release: {
          select: {
            rightsRoute: true,
            artist: { select: { remixConsent: true, userId: true } },
          },
        },
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

    // Artist-owner access (#1174): owning the source artist profile stands
    // in for a purchased remix license on the artist's own material. It
    // satisfies ONLY the license requirement — the policy still evaluates
    // content status, rights route, consent, and per-mint remixability, so
    // a quarantined track or disabled consent denies the owner too.
    const sourceArtistUserId = track.release?.artist?.userId ?? null;
    const creatorOwner =
      !!sourceArtistUserId && sourceArtistUserId === input.userId;

    // Owning the source artist profile (#1174) satisfies the license
    // requirement on the artist's own material — for both the remix license
    // and the export/commercial license (owners hold full rights to their own
    // work). Non-owners must prove a purchased remix (and, for export, a
    // commercial) license per stem.
    const licensedStemIds = creatorOwner
      ? new Set(requestedStemIds)
      : await this.findLicensedStemIds(input.userId, requestedStemIds);
    const exportLicensedStemIds = creatorOwner
      ? new Set(requestedStemIds)
      : await this.findExportLicensedStemIds(input.userId, requestedStemIds);

    const stems: RemixStemPolicyInput[] = requestedStemIds.map((stemId) => ({
      stemId,
      mintRemixable: trackStemsById.get(stemId)?.nftMint?.remixable ?? null,
      licensed: licensedStemIds.has(stemId),
      exportLicensed: exportLicensedStemIds.has(stemId),
    }));

    const decision = evaluateRemixEligibility({
      rightsRoute,
      contentStatus: track.contentStatus,
      sourceOptedIn: this.isSourceOptedIn(track.release?.artist?.remixConsent),
      artistRemixConsent:
        track.release?.artist?.remixConsent === "disabled"
          ? "disabled"
          : "allowed",
      explicitStemSelection: !!input.stemIds?.length,
      stems,
    });

    return {
      ...decision,
      creatorOwner,
      source: {
        trackId: track.id,
        rightsRoute,
        contentStatus: track.contentStatus,
      },
      stems: stems.map((stem) => ({
        stemId: stem.stemId,
        remixable: stem.mintRemixable,
        licensed: stem.licensed,
        exportLicensed: stem.exportLicensed ?? false,
      })),
    };
  }

  /**
   * Artist-level remix consent is a revocation hook layered on top of
   * per-stem remixable mints. Default/null keeps existing artists allowed.
   */
  private isSourceOptedIn(remixConsent?: string | null): boolean {
    return remixConsent !== "disabled";
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

  /**
   * A stem counts as export-licensed for the user when their wallet bought a
   * marketplace listing with a commercial license, or holds a listing-backed
   * x402 settlement whose listing carries a commercial license. The commercial
   * tier grants export/download (off-platform/monetized use) on top of the
   * remix tier's private drafts + in-Resonate publish. Server-side records
   * only; client claims are never trusted. Mirrors findLicensedStemIds with
   * licenseType: "commercial".
   */
  private async findExportLicensedStemIds(
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
          licenseType: "commercial",
          buyerAddress: { equals: wallet.address, mode: "insensitive" },
          listing: { stemId: { in: stemIds } },
        },
        select: { listing: { select: { stemId: true } } },
      }),
      prisma.x402Settlement.findMany({
        where: {
          stemId: { in: stemIds },
          payerAddress: { equals: wallet.address, mode: "insensitive" },
          listing: { licenseType: "commercial" },
          // Rows persist for failed listing settlements too
          // (status = contract_settlement_failed); only a granted settlement
          // proves the listing-backed commercial license.
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
