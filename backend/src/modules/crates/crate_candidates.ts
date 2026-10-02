import { measuredTrackFeatures } from "../agents/measured_track_features";
import { resolveCreditedArtistName } from "../shared/artist_attribution";
import type { CrateCandidateFacts, CrateLicenseType } from "./crate.types";

/**
 * Maps a loaded catalog track row to the {@link CrateCandidateFacts} the crate
 * filters and ordering read (#1962, docs/rfc/taste-engine.md §5.2).
 *
 * Pure: the caller loads the row (and the verified-human artist ids); nothing
 * here reads a database. Listings and prices become facts for the DJ's explicit
 * filters only; they are never a ranking input (ADR-TE-2 rule 6), and a tier
 * with no StemPricing is simply absent (never 0, never guessed).
 */

export type CrateStemRow = {
  /** Stem id; the crate DTO needs it for previews and quality ratings. */
  id?: string;
  type: string;
  isCurrent: boolean;
  /** Raw `Stem.audioFeatures` JSON; only the current `original` stem's is read. */
  audioFeatures: unknown;
  pricing: {
    basePlayPriceUsd: number;
    remixLicenseUsd: number;
    commercialLicenseUsd: number;
  } | null;
  listings: Array<{
    licenseType: string;
    status: string;
    expiresAt: Date;
  }>;
};

/** A catalog track with everything the crate pipeline reads about it. */
export type CrateTrackRow = {
  id: string;
  /** The release the track is on; the crate watch list links to it. */
  releaseId?: string;
  title: string;
  /** `Track.artist` scalar override. */
  artist: string | null;
  aiDisclosureLevel: string | null;
  contentStatus: string;
  rightsRoute: string | null;
  release: {
    title: string;
    status: string;
    rightsRoute: string | null;
    withdrawnAt: Date | null;
    withdrawalReason: string | null;
    genre: string | null;
    moods: string[];
    artistId: string;
    primaryArtist: string | null;
    artist: { displayName: string } | null;
  };
  stems: CrateStemRow[];
};

/** Stem types that are not a usable stem for a DJ: the full mix and the master. */
const NON_STEM_TYPES = new Set(["original", "master"]);

function finitePrice(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Facts for one track. `now` decides which listings are still live; a listing
 * counts only when it is `active` and has not expired.
 */
export function candidateFactsFromRow(
  row: CrateTrackRow,
  verifiedHumanArtistIds: ReadonlySet<string>,
  now: Date = new Date(),
): CrateCandidateFacts {
  const currentStems = row.stems.filter((stem) => stem.isCurrent);

  // Measured features come from the current original stem only.
  const original = currentStems.find((stem) => stem.type.toLowerCase() === "original");
  const measured = measuredTrackFeatures(original?.audioFeatures);

  const stemTypes = [
    ...new Set(
      currentStems
        .map((stem) => stem.type.toLowerCase())
        .filter((type) => !NON_STEM_TYPES.has(type)),
    ),
  ].sort();

  const listed = new Set<string>();
  for (const stem of currentStems) {
    for (const listing of stem.listings) {
      if (listing.status === "active" && listing.expiresAt.getTime() > now.getTime()) {
        listed.add(listing.licenseType.toLowerCase());
      }
    }
  }

  // Cheapest StemPricing per tier across the current non-original stems.
  const indicativePriceUsd: Partial<Record<CrateLicenseType, number>> = {};
  const consider = (tier: CrateLicenseType, price: number | null) => {
    if (price === null) return;
    const existing = indicativePriceUsd[tier];
    if (existing === undefined || price < existing) indicativePriceUsd[tier] = price;
  };
  for (const stem of currentStems) {
    if (stem.type.toLowerCase() === "original" || !stem.pricing) continue;
    consider("personal", finitePrice(stem.pricing.basePlayPriceUsd));
    consider("remix", finitePrice(stem.pricing.remixLicenseUsd));
    consider("commercial", finitePrice(stem.pricing.commercialLicenseUsd));
  }

  return {
    trackId: row.id,
    artistId: row.release.artistId,
    genre: row.release.genre,
    moods: [...row.release.moods],
    aiDisclosureLevel: row.aiDisclosureLevel,
    tempoBpm: measured.tempoBpm,
    camelot: measured.camelot,
    energy: measured.energy,
    stemTypes,
    listedLicenseTypes: [...listed].sort(),
    indicativePriceUsd,
    verifiedHuman: verifiedHumanArtistIds.has(row.release.artistId),
  };
}

/** The credited artist (#1492), not the uploader account label. */
export function creditedArtistName(row: CrateTrackRow): string | null {
  return resolveCreditedArtistName({
    trackArtist: row.artist,
    primaryArtist: row.release.primaryArtist,
    accountDisplayName: row.release.artist?.displayName ?? null,
  });
}
