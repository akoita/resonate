import { ManagementGrantStatus, ManagementScope } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  hasArtistManagementAccess,
  hasReleaseManagementAccess,
  requireArtistManagementAccess,
  requireReleaseManagementAccess,
} from "../modules/management/management-access";

const TEST_PREFIX = `management_access_${Date.now()}_`;
const OWNER = `${TEST_PREFIX}owner`;
const DELEGATE = `${TEST_PREFIX}delegate`;
const PROFILE_EDITOR = `${TEST_PREFIX}profile_editor`;
const CLAIMANT = `${TEST_PREFIX}claimant`;
const SUCCESSOR = `${TEST_PREFIX}successor`;
const TRANSFER_OWNER = `${TEST_PREFIX}transfer_owner`;
const OTHER_OWNER = `${TEST_PREFIX}other_owner`;
const USER_IDS = [OWNER, DELEGATE, PROFILE_EDITOR, CLAIMANT, SUCCESSOR, TRANSFER_OWNER, OTHER_OWNER];

const IDS = {
  legacyArtist: `${TEST_PREFIX}legacy_artist`,
  legacyRelease: `${TEST_PREFIX}legacy_release`,
  grantArtist: `${TEST_PREFIX}grant_artist`,
  grantRelease: `${TEST_PREFIX}grant_release`,
  grantReleaseOther: `${TEST_PREFIX}grant_release_other`,
  trackMetadataRelease: `${TEST_PREFIX}track_metadata_release`,
  mediaRelease: `${TEST_PREFIX}media_release`,
  profileGrantArtist: `${TEST_PREFIX}profile_grant_artist`,
  profileGrantRelease: `${TEST_PREFIX}profile_grant_release`,
  claimArtist: `${TEST_PREFIX}claim_artist`,
  claimRelease: `${TEST_PREFIX}claim_release`,
  transferArtist: `${TEST_PREFIX}transfer_artist`,
  transferRelease: `${TEST_PREFIX}transfer_release`,
  unrelatedArtist: `${TEST_PREFIX}unrelated_artist`,
  unrelatedRelease: `${TEST_PREFIX}unrelated_release`,
  pendingRelease: `${TEST_PREFIX}pending_release`,
  expiredRelease: `${TEST_PREFIX}expired_release`,
  revokedRelease: `${TEST_PREFIX}revoked_release`,
};

async function createArtist(
  id: string,
  options: { userId?: string; profileType?: string; claimStatus?: string } = {},
) {
  return prisma.artist.create({
    data: {
      id,
      displayName: id,
      profileType: options.profileType ?? "manager",
      claimStatus: options.claimStatus ?? "claimed",
      ...(options.userId ? { userId: options.userId } : {}),
    },
  });
}

async function createRelease(id: string, artistId: string) {
  return prisma.release.create({
    data: { id, artistId, title: id },
  });
}

async function createGrant(input: {
  id: string;
  granteeUserId: string;
  artistId?: string;
  releaseId?: string;
  scopes: ManagementScope[];
  status?: ManagementGrantStatus;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
}) {
  return prisma.managementGrant.create({
    data: {
      id: input.id,
      granteeUserId: input.granteeUserId,
      inviterUserId: OWNER,
      artistId: input.artistId,
      releaseId: input.releaseId,
      scopes: input.scopes,
      status: input.status ?? ManagementGrantStatus.active,
      expiresAt: input.expiresAt ?? null,
      revokedAt: input.revokedAt ?? null,
      ...(input.status === ManagementGrantStatus.active ? { acceptedAt: new Date() } : {}),
    },
  });
}

beforeAll(async () => {
  await prisma.user.createMany({
    data: USER_IDS.map((id) => ({ id, email: `${id}@test.resonate` })),
  });

  await createArtist(IDS.legacyArtist, { userId: OWNER });
  await createRelease(IDS.legacyRelease, IDS.legacyArtist);

  await createArtist(IDS.grantArtist);
  await createRelease(IDS.grantRelease, IDS.grantArtist);
  await createRelease(IDS.grantReleaseOther, IDS.grantArtist);
  await createRelease(IDS.trackMetadataRelease, IDS.grantArtist);
  await createRelease(IDS.mediaRelease, IDS.grantArtist);
  await createRelease(IDS.pendingRelease, IDS.grantArtist);
  await createRelease(IDS.expiredRelease, IDS.grantArtist);
  await createRelease(IDS.revokedRelease, IDS.grantArtist);

  await createArtist(IDS.profileGrantArtist);
  await createRelease(IDS.profileGrantRelease, IDS.profileGrantArtist);

  await createArtist(IDS.claimArtist, { profileType: "public_artist", claimStatus: "claimed" });
  await createRelease(IDS.claimRelease, IDS.claimArtist);
  await prisma.artistClaimRequest.create({
    data: {
      id: `${TEST_PREFIX}approved_claim`,
      artistId: IDS.claimArtist,
      claimantUserId: CLAIMANT,
      evidence: "Integration fixture for profile access.",
      status: "approved",
    },
  });

  await createArtist(IDS.transferArtist, { userId: TRANSFER_OWNER });
  await createRelease(IDS.transferRelease, IDS.transferArtist);

  await createArtist(IDS.unrelatedArtist, { userId: OTHER_OWNER });
  await createRelease(IDS.unrelatedRelease, IDS.unrelatedArtist);

  await createGrant({
    id: `${TEST_PREFIX}release_metadata`,
    granteeUserId: DELEGATE,
    releaseId: IDS.grantRelease,
    scopes: [ManagementScope.CATALOG_METADATA],
  });
  await createGrant({
    id: `${TEST_PREFIX}release_read`,
    granteeUserId: DELEGATE,
    releaseId: IDS.grantReleaseOther,
    scopes: [ManagementScope.CATALOG_READ],
  });
  await createGrant({
    id: `${TEST_PREFIX}release_track_metadata`,
    granteeUserId: DELEGATE,
    releaseId: IDS.trackMetadataRelease,
    scopes: [ManagementScope.TRACK_METADATA],
  });
  await createGrant({
    id: `${TEST_PREFIX}release_media`,
    granteeUserId: DELEGATE,
    releaseId: IDS.mediaRelease,
    scopes: [ManagementScope.CATALOG_MEDIA],
  });
  await createGrant({
    id: `${TEST_PREFIX}artist_profile_edit`,
    granteeUserId: PROFILE_EDITOR,
    artistId: IDS.profileGrantArtist,
    scopes: [ManagementScope.PROFILE_EDIT],
  });
  await createGrant({
    id: `${TEST_PREFIX}pending_read`,
    granteeUserId: DELEGATE,
    releaseId: IDS.pendingRelease,
    scopes: [ManagementScope.CATALOG_READ],
    status: ManagementGrantStatus.pending,
  });
  await createGrant({
    id: `${TEST_PREFIX}expired_read`,
    granteeUserId: DELEGATE,
    releaseId: IDS.expiredRelease,
    scopes: [ManagementScope.CATALOG_READ],
    expiresAt: new Date(Date.now() - 60_000),
  });
  await createGrant({
    id: `${TEST_PREFIX}revoked_media`,
    granteeUserId: DELEGATE,
    releaseId: IDS.revokedRelease,
    scopes: [ManagementScope.CATALOG_MEDIA],
    status: ManagementGrantStatus.revoked,
    revokedAt: new Date(),
  });
});

afterAll(async () => {
  await prisma.managementGrant.deleteMany({
    where: {
      OR: [
        { artistId: { startsWith: TEST_PREFIX } },
        { releaseId: { startsWith: TEST_PREFIX } },
      ],
    },
  });
  await prisma.artistClaimRequest.deleteMany({ where: { artistId: { startsWith: TEST_PREFIX } } });
  await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
});

describe("management access resolver (integration)", () => {
  it("recognizes legacy profile and release owners, including a transaction client", async () => {
    await expect(
      hasArtistManagementAccess(OWNER, IDS.legacyArtist, "profile_owner"),
    ).resolves.toBe(true);
    await expect(
      hasArtistManagementAccess(OWNER, IDS.legacyArtist, "profile_edit"),
    ).resolves.toBe(true);
    await expect(
      hasReleaseManagementAccess(OWNER, IDS.legacyRelease, "catalog_owner"),
    ).resolves.toBe(true);
    await expect(
      hasReleaseManagementAccess(OWNER, IDS.legacyRelease, "catalog_media"),
    ).resolves.toBe(true);
    await expect(
      hasArtistManagementAccess(OWNER.toUpperCase(), IDS.legacyArtist, "profile_owner"),
    ).resolves.toBe(true);

    await prisma.$transaction(async (tx) => {
      await expect(
        requireArtistManagementAccess(OWNER, IDS.legacyArtist, "profile_owner", tx),
      ).resolves.toBeUndefined();
      await expect(
        requireReleaseManagementAccess(OWNER, IDS.legacyRelease, "catalog_owner", tx),
      ).resolves.toBeUndefined();
    });
  });

  it("grants only the explicit scope on the exact release", async () => {
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.grantRelease, "catalog_metadata"),
    ).resolves.toBe(true);
    await expect(
      hasReleaseManagementAccess(DELEGATE.toUpperCase(), IDS.grantRelease, "catalog_metadata"),
    ).resolves.toBe(true);
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.grantRelease, "catalog_read"),
    ).resolves.toBe(true);
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.grantRelease, "catalog_media"),
    ).resolves.toBe(false);
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.grantRelease, "catalog_owner"),
    ).resolves.toBe(false);
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.grantReleaseOther, "catalog_read"),
    ).resolves.toBe(true);
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.grantReleaseOther, "catalog_metadata"),
    ).resolves.toBe(false);
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.mediaRelease, "catalog_read"),
    ).resolves.toBe(true);
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.mediaRelease, "catalog_metadata"),
    ).resolves.toBe(false);
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.mediaRelease, "catalog_media"),
    ).resolves.toBe(true);
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.trackMetadataRelease, "track_metadata"),
    ).resolves.toBe(true);
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.trackMetadataRelease, "catalog_read"),
    ).resolves.toBe(true);
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.trackMetadataRelease, "catalog_metadata"),
    ).resolves.toBe(false);
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.trackMetadataRelease, "catalog_media"),
    ).resolves.toBe(false);
    await expect(
      hasArtistManagementAccess(DELEGATE, IDS.grantArtist, "profile_edit"),
    ).resolves.toBe(false);
  });

  it("limits an artist-scoped profile grant to that profile", async () => {
    await expect(
      hasArtistManagementAccess(PROFILE_EDITOR, IDS.profileGrantArtist, "profile_edit"),
    ).resolves.toBe(true);
    await expect(
      hasArtistManagementAccess(PROFILE_EDITOR, IDS.profileGrantArtist, "profile_owner"),
    ).resolves.toBe(false);
    await expect(
      hasArtistManagementAccess(PROFILE_EDITOR, IDS.unrelatedArtist, "profile_edit"),
    ).resolves.toBe(false);
    await expect(
      hasReleaseManagementAccess(PROFILE_EDITOR, IDS.profileGrantRelease, "catalog_read"),
    ).resolves.toBe(false);
  });

  it("denies pending, expired, and revoked grants", async () => {
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.pendingRelease, "catalog_read"),
    ).resolves.toBe(false);
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.expiredRelease, "catalog_read"),
    ).resolves.toBe(false);
    await expect(
      hasReleaseManagementAccess(DELEGATE, IDS.revokedRelease, "catalog_media"),
    ).resolves.toBe(false);
  });

  it("honors an approved claim for profile editing only", async () => {
    await expect(
      hasArtistManagementAccess(CLAIMANT, IDS.claimArtist, "profile_edit"),
    ).resolves.toBe(true);
    await expect(
      hasArtistManagementAccess(CLAIMANT.toUpperCase(), IDS.claimArtist, "profile_edit"),
    ).resolves.toBe(true);
    await expect(
      hasArtistManagementAccess(CLAIMANT, IDS.claimArtist, "profile_owner"),
    ).resolves.toBe(false);
    await expect(
      hasReleaseManagementAccess(CLAIMANT, IDS.claimRelease, "catalog_read"),
    ).resolves.toBe(false);
    await expect(
      hasArtistManagementAccess(CLAIMANT, IDS.unrelatedArtist, "profile_edit"),
    ).resolves.toBe(false);
  });

  it("applies owner overrides and removes former-owner access transactionally", async () => {
    await expect(
      hasArtistManagementAccess(OWNER, IDS.transferArtist, "profile_owner"),
    ).resolves.toBe(false);
    await expect(
      hasArtistManagementAccess(TRANSFER_OWNER, IDS.transferArtist, "profile_owner"),
    ).resolves.toBe(true);
    await expect(
      hasReleaseManagementAccess(TRANSFER_OWNER, IDS.transferRelease, "catalog_owner"),
    ).resolves.toBe(true);

    await prisma.$transaction(async (tx) => {
      await tx.artist.update({
        where: { id: IDS.transferArtist },
        data: { managementOwnerUserId: SUCCESSOR },
      });
      await expect(
        hasArtistManagementAccess(TRANSFER_OWNER, IDS.transferArtist, "profile_owner", tx),
      ).resolves.toBe(false);
      await expect(
        hasArtistManagementAccess(SUCCESSOR, IDS.transferArtist, "profile_owner", tx),
      ).resolves.toBe(true);

      // A profile-owner override does not transfer a release that still uses
      // the legacy Release.artist.userId fallback.
      await expect(
        hasReleaseManagementAccess(TRANSFER_OWNER, IDS.transferRelease, "catalog_owner", tx),
      ).resolves.toBe(true);
      await expect(
        hasReleaseManagementAccess(SUCCESSOR, IDS.transferRelease, "catalog_owner", tx),
      ).resolves.toBe(false);

      await tx.release.update({
        where: { id: IDS.transferRelease },
        data: { managementOwnerUserId: SUCCESSOR },
      });
      await expect(
        hasReleaseManagementAccess(TRANSFER_OWNER, IDS.transferRelease, "catalog_owner", tx),
      ).resolves.toBe(false);
      await expect(
        hasReleaseManagementAccess(SUCCESSOR, IDS.transferRelease, "catalog_owner", tx),
      ).resolves.toBe(true);
    });

    await expect(
      hasArtistManagementAccess(TRANSFER_OWNER, IDS.transferArtist, "profile_edit"),
    ).resolves.toBe(false);
    await expect(
      hasReleaseManagementAccess(TRANSFER_OWNER, IDS.transferRelease, "catalog_metadata"),
    ).resolves.toBe(false);
    await expect(
      hasArtistManagementAccess(SUCCESSOR, IDS.transferArtist, "profile_edit"),
    ).resolves.toBe(true);
    await expect(
      hasReleaseManagementAccess(SUCCESSOR, IDS.transferRelease, "catalog_metadata"),
    ).resolves.toBe(true);
  });
});
