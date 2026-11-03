import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { releasedStemIds } from "../purchase_consent/purchase_consent_delivery";
import {
  evaluateRemixEligibility,
  REMIX_ACTIONS,
  type RemixAction,
  type RemixEligibilityDecision,
  type RemixStemPolicyInput,
} from "./remix-eligibility.policy";
import {
  getActiveRemixGenerationAttribution,
  type RemixGenerationAttribution,
} from "./audio-conditioned-remix-generation.provider";

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
  /**
   * Attribution the studio UI must display for the active generation provider,
   * or null when none is required (#1342). Non-null only while the
   * audio-conditioned Stable Audio 3 provider is the active backend — the
   * Stability AI Community License §IV(a) "Powered by Stability AI" gate.
   */
  generationAttribution: RemixGenerationAttribution | null;
  /**
   * Mashups (#2558): one decision per source, present only when a project
   * has a second source. The top-level decision is their combination.
   */
  sources?: RemixSourceDecision[];
};

export type RemixSourceRole = "lead" | "secondary";

export type RemixSourceDecision = {
  trackId: string;
  role: RemixSourceRole;
  allowed: boolean;
  allowedActions: RemixAction[];
  stemIds: string[];
};

@Injectable()
export class RemixEligibilityService {
  async checkEligibility(input: {
    userId: string;
    trackId: string;
    stemIds?: string[];
    allowHistoricalStemIds?: boolean;
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
          where: input.stemIds?.length
            ? { id: { in: input.stemIds } }
            : { isCurrent: true },
          select: {
            id: true,
            isCurrent: true,
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
    const historicalStemIds = requestedStemIds.filter(
      (stemId) => trackStemsById.get(stemId)?.isCurrent === false,
    );
    if (!input.allowHistoricalStemIds && historicalStemIds.length > 0) {
      throw new ConflictException(
        `Historical stems cannot be used for new remix eligibility: ${historicalStemIds.join(", ")}`,
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
      generationAttribution: getActiveRemixGenerationAttribution(),
    };
  }

  /**
   * Eligibility of a project's stems across its sources (#2558). Without a
   * second source this is exactly {@link checkEligibility} on the lead
   * source. With one, the stems are split by the track they belong to and
   * each source is checked on its own (its route, content status, artist
   * consent, mint flags and licences); an action is allowed only when every
   * source allows it, and each denial reason names its source. A source with
   * no selected stems is checked track-default, so attaching a track still
   * needs the right to remix it.
   */
  async checkSourcesEligibility(input: {
    userId: string;
    sourceTrackId: string;
    secondarySourceTrackId?: string | null;
    stemIds: string[];
    allowHistoricalStemIds?: boolean;
  }): Promise<RemixEligibilityResult> {
    const secondary = input.secondarySourceTrackId ?? null;
    if (!secondary || secondary === input.sourceTrackId) {
      return this.checkEligibility({
        userId: input.userId,
        trackId: input.sourceTrackId,
        stemIds: input.stemIds,
        allowHistoricalStemIds: input.allowHistoricalStemIds,
      });
    }

    const stemIds = Array.from(new Set(input.stemIds));
    const rows = stemIds.length
      ? await prisma.stem.findMany({
          where: { id: { in: stemIds } },
          select: { id: true, trackId: true },
        })
      : [];
    const trackByStem = new Map(rows.map((row) => [row.id, row.trackId]));
    const foreign = stemIds.filter((stemId) => {
      const trackId = trackByStem.get(stemId);
      return trackId !== input.sourceTrackId && trackId !== secondary;
    });
    if (foreign.length > 0) {
      throw new BadRequestException(
        `Stems do not belong to either source of this remix: ${foreign.join(", ")}`,
      );
    }

    const sources: Array<{ trackId: string; role: RemixSourceRole }> = [
      { trackId: input.sourceTrackId, role: "lead" },
      { trackId: secondary, role: "secondary" },
    ];
    const results = await Promise.all(
      sources.map(async (source) => {
        const sourceStemIds = stemIds.filter(
          (stemId) => trackByStem.get(stemId) === source.trackId,
        );
        const result = await this.checkEligibility({
          userId: input.userId,
          trackId: source.trackId,
          stemIds: sourceStemIds,
          allowHistoricalStemIds: input.allowHistoricalStemIds,
        });
        return { ...source, stemIds: sourceStemIds, result };
      }),
    );
    return combineSourceDecisions(results);
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
          // Commercial ⊃ Remix ⊃ Personal: a commercial license grants remix
          // rights too, so it satisfies the remix requirement.
          licenseType: { in: ["remix", "commercial"] },
          buyerAddress: { equals: wallet.address, mode: "insensitive" },
          listing: { stemId: { in: stemIds } },
        },
        select: {
          purchasedAt: true,
          transactionHash: true,
          listing: { select: { stemId: true } },
        },
      }),
      prisma.x402Settlement.findMany({
        where: {
          stemId: { in: stemIds },
          payerAddress: { equals: wallet.address, mode: "insensitive" },
          // Commercial ⊃ Remix: a commercial-tier settlement grants remix rights.
          listing: { licenseType: { in: ["remix", "commercial"] } },
          // Rows persist for failed listing settlements too
          // (status = contract_settlement_failed); only a granted settlement
          // proves the listing-backed remix license.
          status: "download_granted",
        },
        select: {
          stemId: true,
          purchasedAt: true,
          paymentTransactionHash: true,
          contractSettlementTxHash: true,
          receiptId: true,
        },
      }),
    ]);

    // #1776: a licence is active only once its purchase is delivered, that is
    // against a recorded immediate-delivery consent or after the withdrawal
    // period. A held purchase confers nothing yet.
    const candidates: Array<{
      stemId: string;
      purchasedAt: Date;
      refs: Array<string | null>;
    }> = [];
    for (const purchase of purchases) {
      if (purchase.listing.stemId) {
        candidates.push({
          stemId: purchase.listing.stemId,
          purchasedAt: purchase.purchasedAt,
          refs: [purchase.transactionHash],
        });
      }
    }
    for (const settlement of settlements) {
      // stemId is nullable since #1462 (moment settlements); the query filters
      // to stem rows, but guard the type to keep only stem licenses.
      if (settlement.stemId) {
        candidates.push({
          stemId: settlement.stemId,
          purchasedAt: settlement.purchasedAt,
          refs: [
            settlement.paymentTransactionHash,
            settlement.contractSettlementTxHash,
            settlement.receiptId,
          ],
        });
      }
    }
    return releasedStemIds(userId, candidates);
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
        select: {
          purchasedAt: true,
          transactionHash: true,
          listing: { select: { stemId: true } },
        },
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
        select: {
          stemId: true,
          purchasedAt: true,
          paymentTransactionHash: true,
          contractSettlementTxHash: true,
          receiptId: true,
        },
      }),
    ]);

    // #1776: a licence is active only once its purchase is delivered, that is
    // against a recorded immediate-delivery consent or after the withdrawal
    // period. A held purchase confers nothing yet.
    const candidates: Array<{
      stemId: string;
      purchasedAt: Date;
      refs: Array<string | null>;
    }> = [];
    for (const purchase of purchases) {
      if (purchase.listing.stemId) {
        candidates.push({
          stemId: purchase.listing.stemId,
          purchasedAt: purchase.purchasedAt,
          refs: [purchase.transactionHash],
        });
      }
    }
    for (const settlement of settlements) {
      // stemId is nullable since #1462 (moment settlements); the query filters
      // to stem rows, but guard the type to keep only stem licenses.
      if (settlement.stemId) {
        candidates.push({
          stemId: settlement.stemId,
          purchasedAt: settlement.purchasedAt,
          refs: [
            settlement.paymentTransactionHash,
            settlement.contractSettlementTxHash,
            settlement.receiptId,
          ],
        });
      }
    }
    return releasedStemIds(userId, candidates);
  }
}

/**
 * Combines per-source decisions (#2558): allowed only when every source is,
 * the actions every source allows, and every reason tagged with its source.
 * The lead source stays the `source` of the result.
 */
function combineSourceDecisions(
  results: Array<{
    trackId: string;
    role: RemixSourceRole;
    stemIds: string[];
    result: RemixEligibilityResult;
  }>,
): RemixEligibilityResult {
  const lead = results[0].result;
  const allowedActions = REMIX_ACTIONS.filter((action) =>
    results.every(({ result }) => result.allowedActions.includes(action)),
  );
  return {
    ...lead,
    allowed: results.every(({ result }) => result.allowed),
    requiredLicense: results.some(({ result }) => result.requiredLicense)
      ? "remix"
      : null,
    allowedActions,
    reasons: results.flatMap(({ trackId, role, result }) =>
      result.reasons.map((reason) => ({
        ...reason,
        sourceTrackId: trackId,
        sourceRole: role,
      })),
    ),
    creatorOwner: results.every(({ result }) => result.creatorOwner),
    // A source checked track-default (no selected stems) lists every stem
    // of its track; only the selected stems belong to the project.
    stems: results.flatMap(({ stemIds, result }) =>
      result.stems.filter((stem) => stemIds.includes(stem.stemId)),
    ),
    sources: results.map(({ trackId, role, stemIds, result }) => ({
      trackId,
      role,
      allowed: result.allowed,
      allowedActions: result.allowedActions,
      stemIds,
    })),
  };
}
