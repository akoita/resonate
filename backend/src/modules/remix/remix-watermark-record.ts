import { prisma } from "../../db/prisma";
import type { RemixRenderWatermark } from "./remix-watermark";

/**
 * Licence proof for one source stem at render time (#2573). `basis` is what
 * let the owner render it: their own artist profile, or a purchase at the
 * commercial or remix tier. The purchase and settlement ids let an admin
 * follow the trail without re-deriving it from wallet history later.
 */
export type RemixWatermarkStemLicense = {
  stemId: string;
  basis: "owner" | "commercial" | "remix" | "none";
  stemPurchaseIds: string[];
  x402SettlementIds: string[];
};

export type RemixWatermarkStemEligibility = {
  stemId: string;
  licensed: boolean;
  exportLicensed: boolean;
};

/**
 * Pure: the licence basis per stem from the eligibility decision and the
 * purchase rows found for the owner's wallet. A stem that is licensed with no
 * purchase on record was licensed by artist ownership (#1174).
 */
export function remixWatermarkStemLicenses(
  stems: RemixWatermarkStemEligibility[],
  purchases: Array<{ id: string; stemId: string | null; licenseType: string }>,
  settlements: Array<{ id: string; stemId: string | null; licenseType: string | null }>,
): RemixWatermarkStemLicense[] {
  return stems.map((stem) => {
    const stemPurchases = purchases.filter((row) => row.stemId === stem.stemId);
    const stemSettlements = settlements.filter((row) => row.stemId === stem.stemId);
    const tiers = new Set([
      ...stemPurchases.map((row) => row.licenseType),
      ...stemSettlements.map((row) => row.licenseType),
    ]);
    const basis: RemixWatermarkStemLicense["basis"] = !stem.licensed
      ? "none"
      : tiers.has("commercial") && stem.exportLicensed
        ? "commercial"
        : tiers.has("remix") || tiers.has("commercial")
          ? "remix"
          : "owner";
    return {
      stemId: stem.stemId,
      basis,
      stemPurchaseIds: stemPurchases.map((row) => row.id),
      x402SettlementIds: stemSettlements.map((row) => row.id),
    };
  });
}

export type RecordRemixRenderWatermarkInput = {
  watermark: RemixRenderWatermark;
  remixProjectId: string;
  generationJobId: string;
  renderJobId: string;
  userId: string;
  sourceTrackId: string;
  secondarySourceTrackId: string | null;
  /** Source stems that went into the render. */
  stemIds: string[];
  /** The worker's render-time eligibility, per project stem. */
  eligibility: RemixWatermarkStemEligibility[];
  policyVersion: string;
};

/**
 * Writes the admin-only token row for a watermarked render (#2573). Reads the
 * owner's remix/commercial purchases of the rendered stems for the licence
 * proof. The caller logs and swallows any error: the render has already
 * succeeded and must not fail over its record.
 */
export async function recordRemixRenderWatermark(
  input: RecordRemixRenderWatermarkInput,
): Promise<void> {
  const rendered = new Set(input.stemIds);
  const stems = input.eligibility.filter((stem) => rendered.has(stem.stemId));
  const wallet = await prisma.wallet.findUnique({
    where: { userId: input.userId },
    select: { address: true },
  });
  const [purchases, settlements] = wallet?.address
    ? await Promise.all([
        prisma.stemPurchase.findMany({
          where: {
            licenseType: { in: ["remix", "commercial"] },
            buyerAddress: { equals: wallet.address, mode: "insensitive" },
            listing: { stemId: { in: input.stemIds } },
          },
          select: { id: true, licenseType: true, listing: { select: { stemId: true } } },
        }),
        prisma.x402Settlement.findMany({
          where: {
            stemId: { in: input.stemIds },
            payerAddress: { equals: wallet.address, mode: "insensitive" },
            listing: { licenseType: { in: ["remix", "commercial"] } },
            status: "download_granted",
          },
          select: { id: true, stemId: true, listing: { select: { licenseType: true } } },
        }),
      ])
    : [[], []];
  const stemLicenses = remixWatermarkStemLicenses(
    stems,
    purchases.map((row) => ({
      id: row.id,
      stemId: row.listing.stemId,
      licenseType: String(row.licenseType),
    })),
    settlements.map((row) => ({
      id: row.id,
      stemId: row.stemId,
      licenseType: row.listing?.licenseType ? String(row.listing.licenseType) : null,
    })),
  );
  await prisma.remixRenderWatermark.create({
    data: {
      token: input.watermark.token,
      remixProjectId: input.remixProjectId,
      generationJobId: input.generationJobId,
      renderJobId: input.renderJobId,
      userId: input.userId,
      sourceTrackId: input.sourceTrackId,
      secondarySourceTrackId: input.secondarySourceTrackId,
      stemIds: input.stemIds,
      stemLicenses,
      renderedStemIndexes: input.watermark.stemIndexes,
      policyVersion: input.policyVersion,
      scheme: input.watermark.scheme,
      schemeVersion: input.watermark.schemeVersion,
      strength: input.watermark.strength,
      keyId: input.watermark.keyId,
    },
  });
}
