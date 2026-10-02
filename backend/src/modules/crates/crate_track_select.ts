import type { Prisma } from "@prisma/client";

/**
 * The one Prisma `select` for "everything the crate pipeline reads about a
 * track" (#1962). Building a crate, rebuilding a stored crate, swapping a line
 * and evaluating a newly playable track against watching crates (#1967) all read
 * it, so the shape of {@link import("./crate_candidates").CrateTrackRow} lives
 * in one place. `now` decides which listings are still live.
 */
export function crateTrackSelect(now: Date) {
  return {
    id: true,
    releaseId: true,
    title: true,
    artist: true,
    aiDisclosureLevel: true,
    contentStatus: true,
    rightsRoute: true,
    release: {
      select: {
        title: true,
        status: true,
        rightsRoute: true,
        withdrawnAt: true,
        withdrawalReason: true,
        genre: true,
        moods: true,
        artistId: true,
        primaryArtist: true,
        artist: { select: { displayName: true } },
      },
    },
    stems: {
      where: { isCurrent: true },
      select: {
        id: true,
        type: true,
        isCurrent: true,
        audioFeatures: true,
        pricing: {
          select: {
            basePlayPriceUsd: true,
            remixLicenseUsd: true,
            commercialLicenseUsd: true,
          },
        },
        listings: {
          where: { status: "active", expiresAt: { gt: now } },
          select: { licenseType: true, status: true, expiresAt: true },
        },
      },
    },
  } satisfies Prisma.TrackSelect;
}

