import { ForbiddenException } from "@nestjs/common";
import {
  ManagementGrantStatus,
  ManagementScope,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "../../db/prisma";

/** Actions understood by the shared artist and release management checks. */
export type ManagementAction =
  | "profile_edit"
  | "profile_owner"
  | "catalog_read"
  | "catalog_metadata"
  | "catalog_media"
  | "catalog_owner";

type ManagementAccessDb = PrismaClient | Prisma.TransactionClient;

const CATALOG_SCOPES_BY_ACTION: Partial<Record<ManagementAction, ManagementScope[]>> = {
  // Any catalog edit requires viewing the target release first.
  catalog_read: [
    ManagementScope.CATALOG_READ,
    ManagementScope.CATALOG_METADATA,
    ManagementScope.CATALOG_MEDIA,
  ],
  catalog_metadata: [ManagementScope.CATALOG_METADATA],
  catalog_media: [ManagementScope.CATALOG_MEDIA],
};

const isProfileAction = (action: ManagementAction): boolean =>
  action === "profile_edit" || action === "profile_owner";

const isCatalogAction = (action: ManagementAction): boolean =>
  action === "catalog_owner" || Object.prototype.hasOwnProperty.call(CATALOG_SCOPES_BY_ACTION, action);

function sameUserId(left?: string | null, right?: string | null): boolean {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

async function hasActiveGrant(
  db: ManagementAccessDb,
  where: { artistId: string; releaseId: null } | { artistId: null; releaseId: string },
  userId: string,
  scopes: ManagementScope[],
): Promise<boolean> {
  const grant = await db.managementGrant.findFirst({
    where: {
      ...where,
      granteeUserId: { equals: userId, mode: "insensitive" },
      status: ManagementGrantStatus.active,
      scopes: { hasSome: scopes },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  return grant !== null;
}

/**
 * Checks authority over an artist profile.
 *
 * The explicit management owner takes precedence over the legacy `userId`.
 * An approved claim on a claimed public profile grants profile editing only.
 * Artist grants are profile-only; catalog authority is checked against a
 * specific release with `hasReleaseManagementAccess`.
 */
export async function hasArtistManagementAccess(
  userId: string,
  artistId: string,
  action: ManagementAction,
  db: ManagementAccessDb = prisma,
): Promise<boolean> {
  if (!isProfileAction(action)) return false;

  const artist = await db.artist.findUnique({
    where: { id: artistId },
    select: {
      id: true,
      userId: true,
      managementOwnerUserId: true,
      profileType: true,
      claimStatus: true,
    },
  });
  if (!artist) return false;

  const ownerUserId = artist.managementOwnerUserId ?? artist.userId;
  if (sameUserId(ownerUserId, userId)) return true;
  if (action === "profile_owner") return false;

  const profileGrant = await hasActiveGrant(
    db,
    { artistId, releaseId: null },
    userId,
    [ManagementScope.PROFILE_EDIT],
  );
  if (profileGrant) return true;

  if (artist.profileType !== "public_artist" || artist.claimStatus !== "claimed") {
    return false;
  }

  const approvedClaim = await db.artistClaimRequest.findFirst({
    where: {
      artistId,
      claimantUserId: { equals: userId, mode: "insensitive" },
      status: "approved",
    },
    select: { id: true },
  });
  return approvedClaim !== null;
}

/**
 * Checks authority over one release. The release owner override takes
 * precedence; otherwise ownership falls back to the legacy artist `userId`.
 * Catalog grants are exact-release grants and never flow through credits or
 * the parent artist.
 */
export async function hasReleaseManagementAccess(
  userId: string,
  releaseId: string,
  action: ManagementAction,
  db: ManagementAccessDb = prisma,
): Promise<boolean> {
  if (!isCatalogAction(action)) return false;

  const release = await db.release.findUnique({
    where: { id: releaseId },
    select: {
      id: true,
      managementOwnerUserId: true,
      artist: { select: { userId: true } },
    },
  });
  if (!release) return false;

  const ownerUserId = release.managementOwnerUserId ?? release.artist.userId;
  if (sameUserId(ownerUserId, userId)) return true;
  if (action === "catalog_owner") return false;

  const scopes = CATALOG_SCOPES_BY_ACTION[action];
  if (!scopes) return false;

  return hasActiveGrant(
    db,
    { artistId: null, releaseId },
    userId,
    scopes,
  );
}

/** Require profile-level authority, throwing a standard HTTP 403 on denial. */
export async function requireArtistManagementAccess(
  userId: string,
  artistId: string,
  action: ManagementAction,
  db: ManagementAccessDb = prisma,
): Promise<void> {
  if (!(await hasArtistManagementAccess(userId, artistId, action, db))) {
    throw new ForbiddenException("You do not have access to this artist profile");
  }
}

/** Require release-level authority, throwing a standard HTTP 403 on denial. */
export async function requireReleaseManagementAccess(
  userId: string,
  releaseId: string,
  action: ManagementAction,
  db: ManagementAccessDb = prisma,
): Promise<void> {
  if (!(await hasReleaseManagementAccess(userId, releaseId, action, db))) {
    throw new ForbiddenException("You do not have access to this release");
  }
}
