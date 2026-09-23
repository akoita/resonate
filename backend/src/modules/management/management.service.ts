import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ManagementGrantStatus,
  ManagementResourceType,
  ManagementScope,
  ManagementTransferStatus,
  ManagementTransferRecoveryStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  hasArtistManagementAccess,
  hasReleaseManagementAccess,
} from "./management-access";

const PROFILE_SCOPES = [ManagementScope.PROFILE_EDIT] as const;
const CATALOG_SCOPES = [
  ManagementScope.CATALOG_READ,
  ManagementScope.CATALOG_METADATA,
  ManagementScope.CATALOG_MEDIA,
  ManagementScope.TRACK_METADATA,
  ManagementScope.TRACK_AUDIO,
] as const;
const OWNER_CATALOG_SCOPES = [...CATALOG_SCOPES];
const MAX_RECIPIENT_EMAIL_LENGTH = 254;
// Recovery approvals may lock and update a multi-release transfer snapshot in batches.
const RECOVERY_TRANSACTION_TIMEOUT_MS = 15_000;

function isValidRecipientEmail(email: string): boolean {
  let atIndex = -1;
  let hasDomainDot = false;

  for (let index = 0; index < email.length; index += 1) {
    const character = email[index];
    if (/\s/.test(character)) return false;

    if (character === "@") {
      if (atIndex !== -1) return false;
      atIndex = index;
    } else if (
      character === "." &&
      atIndex >= 0 &&
      index > atIndex + 1 &&
      index < email.length - 1
    ) {
      hasDomainDot = true;
    }
  }

  return atIndex > 0 && atIndex < email.length - 1 && hasDomainDot;
}

export interface CreateManagementGrantInput {
  recipientEmail?: unknown;
  artistId?: unknown;
  releaseId?: unknown;
  scopes?: unknown;
  expiresAt?: unknown;
}

export interface UpdateManagementGrantInput {
  scopes?: unknown;
  expiresAt?: unknown;
}

export interface CreateManagementTransferInput {
  recipientEmail?: unknown;
  artistId?: unknown;
  releaseIds?: unknown;
  allManagedReleases?: unknown;
  expiresAt?: unknown;
}

type TransferResource = {
  resourceType: ManagementResourceType;
  resourceIds: string[];
};

type ManagementTransaction = Prisma.TransactionClient;
type RecoveryTransfer = {
  id: string;
  proposerUserId: string;
  recipientUserId: string;
  resourceType: ManagementResourceType;
  resourceIds: string[];
  status: ManagementTransferStatus;
  acceptedAt: Date | null;
};
type RecoverySnapshot = { resourceType: ManagementResourceType; resourceIds: string[] };

@Injectable()
export class ManagementService {
  async getMe(userId: string) {
    await this.assertOpenUser(prisma, userId);
    const now = new Date();
    const [ownedArtists, ownedReleases, artistGrants, releaseGrants, approvedClaims, pendingGrants,
      pendingTransfers, outgoingTransfers] = await Promise.all([
      prisma.artist.findMany({
        where: this.artistOwnedWhere(userId),
        select: { id: true, displayName: true },
        orderBy: { displayName: "asc" },
      }),
      prisma.release.findMany({
        where: this.releaseOwnedWhere(userId),
        select: { id: true, title: true, artistId: true },
        orderBy: { title: "asc" },
      }),
      prisma.managementGrant.findMany({
        where: {
          granteeUserId: equalsUserId(userId),
          artistId: { not: null },
          status: ManagementGrantStatus.active,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          scopes: { has: ManagementScope.PROFILE_EDIT },
        },
        include: { artist: { select: { id: true, displayName: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.managementGrant.findMany({
        where: {
          granteeUserId: equalsUserId(userId),
          releaseId: { not: null },
          status: ManagementGrantStatus.active,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          scopes: { hasSome: [...CATALOG_SCOPES] },
        },
        include: { release: { select: { id: true, title: true, artistId: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.artistClaimRequest.findMany({
        where: {
          claimantUserId: equalsUserId(userId),
          status: "approved",
          artist: { is: { profileType: "public_artist", claimStatus: "claimed" } },
        },
        include: { artist: { select: { id: true, displayName: true } } },
        orderBy: { reviewedAt: "desc" },
      }),
      prisma.managementGrant.findMany({
        where: {
          granteeUserId: equalsUserId(userId),
          status: ManagementGrantStatus.pending,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        include: {
          artist: { select: { displayName: true } },
          release: { select: { title: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.managementTransfer.findMany({
        where: {
          recipientUserId: equalsUserId(userId),
          status: ManagementTransferStatus.pending,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: {
          id: true,
          resourceType: true,
          resourceIds: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.managementTransfer.findMany({
        where: {
          proposerUserId: equalsUserId(userId),
          status: ManagementTransferStatus.pending,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        include: { recipient: { select: { email: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const ownedArtistIds = new Set(ownedArtists.map((artist) => artist.id));
    const transferRows = [...pendingTransfers, ...outgoingTransfers];
    const transferArtistIds = [...new Set(transferRows
      .filter((transfer) => transfer.resourceType === ManagementResourceType.artist_profile)
      .flatMap((transfer) => transfer.resourceIds))];
    const transferReleaseIds = [...new Set(transferRows
      .filter((transfer) => transfer.resourceType === ManagementResourceType.release)
      .flatMap((transfer) => transfer.resourceIds))];
    const [transferArtists, transferReleases] = await Promise.all([
      prisma.artist.findMany({ where: { id: { in: transferArtistIds } }, select: { id: true, displayName: true } }),
      prisma.release.findMany({ where: { id: { in: transferReleaseIds } }, select: { id: true, title: true } }),
    ]);
    const transferArtistNames = new Map(transferArtists.map((artist) => [artist.id, artist.displayName]));
    const transferReleaseNames = new Map(transferReleases.map((release) => [release.id, release.title]));
    const transferResources = (transfer: { resourceType: ManagementResourceType; resourceIds: string[] }) =>
      transfer.resourceIds.map((id) => ({
        id,
        name: transfer.resourceType === ManagementResourceType.artist_profile
          ? transferArtistNames.get(id) ?? "Deleted profile"
          : transferReleaseNames.get(id) ?? "Deleted release",
      }));
    const managedArtistMap = new Map<string, {
      id: string;
      name: string;
      grantId: string | null;
      scopes: ManagementScope[];
      source?: "approved_claim";
    }>();
    for (const grant of artistGrants) {
      if (!grant.artist || ownedArtistIds.has(grant.artist.id)) continue;
      managedArtistMap.set(grant.artist.id, {
        id: grant.artist.id,
        name: grant.artist.displayName,
        grantId: grant.id,
        scopes: grant.scopes,
      });
    }
    for (const claim of approvedClaims) {
      if (ownedArtistIds.has(claim.artist.id) || managedArtistMap.has(claim.artist.id)) continue;
      managedArtistMap.set(claim.artist.id, {
        id: claim.artist.id,
        name: claim.artist.displayName,
        grantId: null,
        scopes: [...PROFILE_SCOPES],
        source: "approved_claim",
      });
    }

    const ownedReleaseIds = new Set(ownedReleases.map((release) => release.id));
    const managedReleaseMap = new Map<string, {
      id: string;
      title: string;
      artistId: string;
      grantId: string;
      scopes: ManagementScope[];
    }>();
    for (const grant of releaseGrants) {
      if (!grant.release || ownedReleaseIds.has(grant.release.id)) continue;
      managedReleaseMap.set(grant.release.id, {
        id: grant.release.id,
        title: grant.release.title,
        artistId: grant.release.artistId,
        grantId: grant.id,
        scopes: grant.scopes,
      });
    }

    return {
      ownedArtists: ownedArtists.map(({ id, displayName }) => ({ id, name: displayName })),
      managedArtists: [...managedArtistMap.values()],
      ownedReleases,
      managedReleases: [...managedReleaseMap.values()],
      pendingGrants: pendingGrants
        .filter((grant) => Boolean(grant.artistId) !== Boolean(grant.releaseId))
        .map((grant) => ({
          id: grant.id,
          artistId: grant.artistId,
          releaseId: grant.releaseId,
          scopes: grant.scopes,
          expiresAt: grant.expiresAt,
          resourceName: grant.artist?.displayName ?? grant.release?.title ?? null,
        })),
      pendingTransfers: pendingTransfers.map(({ id, resourceType, resourceIds, expiresAt }) => ({
        id,
        resourceType,
        resourceIds,
        resources: transferResources({ resourceType, resourceIds }),
        status: ManagementTransferStatus.pending,
        expiresAt,
      })),
      outgoingTransfers: outgoingTransfers.map((transfer) => ({
        id: transfer.id,
        resourceType: transfer.resourceType,
        resourceIds: transfer.resourceIds,
        resources: transferResources(transfer),
        status: transfer.status,
        expiresAt: transfer.expiresAt,
        recipientEmail: transfer.recipient.email,
      })),
    };
  }

  async getPendingInvitations(userId: string) {
    await this.assertOpenUser(prisma, userId);
    const now = new Date();
    const [grants, transfers] = await Promise.all([
      prisma.managementGrant.findMany({
        where: {
          granteeUserId: equalsUserId(userId),
          status: ManagementGrantStatus.pending,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          // A grant invitation has exactly one target resource. Malformed
          // rows are excluded before their target details are loaded.
          AND: {
            OR: [
              { artistId: { not: null }, releaseId: null },
              { artistId: null, releaseId: { not: null } },
            ],
          },
        },
        select: {
          id: true,
          artistId: true,
          releaseId: true,
          scopes: true,
          expiresAt: true,
          artist: { select: { displayName: true } },
          release: { select: { title: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.managementTransfer.findMany({
        where: {
          recipientUserId: equalsUserId(userId),
          status: ManagementTransferStatus.pending,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: {
          id: true,
          resourceType: true,
          resourceIds: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const artistIds = [...new Set(transfers
      .filter((transfer) => transfer.resourceType === ManagementResourceType.artist_profile)
      .flatMap((transfer) => transfer.resourceIds))];
    const releaseIds = [...new Set(transfers
      .filter((transfer) => transfer.resourceType === ManagementResourceType.release)
      .flatMap((transfer) => transfer.resourceIds))];
    const [artists, releases] = await Promise.all([
      artistIds.length
        ? prisma.artist.findMany({ where: { id: { in: artistIds } }, select: { id: true, displayName: true } })
        : Promise.resolve([]),
      releaseIds.length
        ? prisma.release.findMany({ where: { id: { in: releaseIds } }, select: { id: true, title: true } })
        : Promise.resolve([]),
    ]);
    const artistNames = new Map(artists.map((artist) => [artist.id, artist.displayName]));
    const releaseNames = new Map(releases.map((release) => [release.id, release.title]));

    return {
      grants: grants
        .filter((grant) => Boolean(grant.artistId) !== Boolean(grant.releaseId))
        .map((grant) => ({
          id: grant.id,
          artistId: grant.artistId,
          releaseId: grant.releaseId,
          resourceName: grant.artist?.displayName ?? grant.release?.title ?? null,
          scopes: grant.scopes,
          expiresAt: grant.expiresAt,
        }))
        .filter((grant) => grant.resourceName !== null),
      transfers: transfers.map((transfer) => ({
        id: transfer.id,
        resourceType: transfer.resourceType,
        resources: transfer.resourceIds.map((id) => ({
          id,
          name: transfer.resourceType === ManagementResourceType.artist_profile
            ? artistNames.get(id) ?? "Deleted profile"
            : releaseNames.get(id) ?? "Deleted release",
        })),
        expiresAt: transfer.expiresAt,
      })),
    };
  }

  async getArtistAccess(userId: string, artistId: string) {
    await this.assertOpenUser(prisma, userId);
    const artist = await prisma.artist.findUnique({ where: { id: artistId }, select: { id: true } });
    if (!artist) throw new NotFoundException("Artist profile not found");

    const isOwner = await hasArtistManagementAccess(userId, artistId, "profile_owner");
    const canEdit = await hasArtistManagementAccess(userId, artistId, "profile_edit");
    if (!canEdit) throw new ForbiddenException("You do not have access to this artist profile");

    const now = new Date();
    const [activeGrants, approvedClaim, grants] = await Promise.all([
      prisma.managementGrant.findMany({
        where: {
          artistId,
          granteeUserId: equalsUserId(userId),
          status: ManagementGrantStatus.active,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { scopes: true },
      }),
      prisma.artistClaimRequest.findFirst({
        where: {
          artistId,
          claimantUserId: equalsUserId(userId),
          status: "approved",
          artist: { is: { profileType: "public_artist", claimStatus: "claimed" } },
        },
        select: { id: true },
      }),
      isOwner
        ? prisma.managementGrant.findMany({
            where: { artistId },
            include: { grantee: { select: { email: true } } },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
    ]);

    const scopes = isOwner
      ? [...PROFILE_SCOPES]
      : uniqueScopes([
          ...activeGrants.flatMap((grant) => grant.scopes),
          ...(approvedClaim ? PROFILE_SCOPES : []),
        ]);
    return {
      resourceType: ManagementResourceType.artist_profile,
      resourceId: artistId,
      currentUserAccess: { isOwner, scopes },
      grants: isOwner ? grants.map((grant) => this.ownerGrantDto(grant)) : [],
    };
  }

  async getReleaseAccess(userId: string, releaseId: string) {
    await this.assertOpenUser(prisma, userId);
    const release = await prisma.release.findUnique({ where: { id: releaseId }, select: { id: true } });
    if (!release) throw new NotFoundException("Release not found");

    const isOwner = await hasReleaseManagementAccess(userId, releaseId, "catalog_owner");
    const canRead = await hasReleaseManagementAccess(userId, releaseId, "catalog_read");
    const canEditMetadata = await hasReleaseManagementAccess(userId, releaseId, "catalog_metadata");
    const canEditMedia = await hasReleaseManagementAccess(userId, releaseId, "catalog_media");
    if (!isOwner && !canRead && !canEditMetadata && !canEditMedia) {
      throw new ForbiddenException("You do not have access to this release");
    }

    const now = new Date();
    const [activeGrants, grants] = await Promise.all([
      prisma.managementGrant.findMany({
        where: {
          releaseId,
          granteeUserId: equalsUserId(userId),
          status: ManagementGrantStatus.active,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { scopes: true },
      }),
      isOwner
        ? prisma.managementGrant.findMany({
            where: { releaseId },
            include: { grantee: { select: { email: true } } },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
    ]);

    return {
      resourceType: ManagementResourceType.release,
      resourceId: releaseId,
      currentUserAccess: {
        isOwner,
        scopes: isOwner ? OWNER_CATALOG_SCOPES : uniqueScopes(activeGrants.flatMap((grant) => grant.scopes)),
      },
      grants: isOwner ? grants.map((grant) => this.ownerGrantDto(grant)) : [],
    };
  }

  async createGrant(userId: string, input: CreateManagementGrantInput) {
    const recipientEmail = this.readRecipientEmail(input.recipientEmail);
    await this.assertOpenUser(prisma, userId);
    const resource = this.readGrantResource(input);
    const ownsResource = resource.resourceType === ManagementResourceType.artist_profile
      ? await hasArtistManagementAccess(userId, resource.id, "profile_owner")
      : await hasReleaseManagementAccess(userId, resource.id, "catalog_owner");
    if (!ownsResource) throw new ForbiddenException("Only the current management owner can invite a manager");
    const recipient = await this.findOpenRecipient(recipientEmail, userId);
    const scopes = this.readGrantScopes(input.scopes, resource.resourceType);
    const expiresAt = parseFutureExpiry(input.expiresAt);

    if (resource.resourceType === ManagementResourceType.artist_profile) {
      return prisma.$transaction(async (tx) => {
        await this.lockArtist(tx, resource.id);
        const artist = await tx.artist.findUnique({ where: { id: resource.id }, select: { id: true } });
        if (!artist) throw new NotFoundException("Artist profile not found");
        if (!(await hasArtistManagementAccess(userId, resource.id, "profile_owner", tx))) {
          throw new ForbiddenException("Only the current profile owner can invite a manager");
        }
        await this.assertOpenUser(tx, recipient.id);
        await this.ensureNoPendingGrant(tx, resource, recipient.id);
        return tx.managementGrant.create({
          data: {
            artistId: resource.id,
            granteeUserId: recipient.id,
            inviterUserId: userId,
            scopes,
            status: ManagementGrantStatus.pending,
            expiresAt,
          },
        });
      });
    }

    return prisma.$transaction(async (tx) => {
      await this.lockRelease(tx, resource.id);
      const release = await tx.release.findUnique({ where: { id: resource.id }, select: { id: true } });
      if (!release) throw new NotFoundException("Release not found");
      if (!(await hasReleaseManagementAccess(userId, resource.id, "catalog_owner", tx))) {
        throw new ForbiddenException("Only the current release owner can invite a manager");
      }
      await this.assertOpenUser(tx, recipient.id);
      await this.ensureNoPendingGrant(tx, resource, recipient.id);
      return tx.managementGrant.create({
        data: {
          releaseId: resource.id,
          granteeUserId: recipient.id,
          inviterUserId: userId,
          scopes,
          status: ManagementGrantStatus.pending,
          expiresAt,
        },
      });
    });
  }

  async updateGrant(userId: string, grantId: string, input: UpdateManagementGrantInput) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new BadRequestException("Grant update body must be an object");
    }
    return prisma.$transaction(async (tx) => {
      const initial = await tx.managementGrant.findUnique({ where: { id: grantId } });
      if (!initial) throw new NotFoundException("Management grant not found");

      const initialHasArtist = Boolean(initial.artistId);
      const initialHasRelease = Boolean(initial.releaseId);
      if (initialHasArtist === initialHasRelease) {
        throw new ConflictException("The grant no longer references exactly one managed resource");
      }
      if (initial.artistId) await this.lockArtist(tx, initial.artistId);
      else await this.lockRelease(tx, initial.releaseId!);

      await tx.$queryRaw`SELECT "id" FROM "ManagementGrant" WHERE "id" = ${grantId} FOR UPDATE`;
      const grant = await tx.managementGrant.findUnique({ where: { id: grantId } });
      if (!grant) throw new NotFoundException("Management grant not found");
      if (grant.artistId !== initial.artistId || grant.releaseId !== initial.releaseId) {
        throw new ConflictException("The grant's managed resource changed during the update");
      }

      await this.assertOpenUser(tx, userId);
      const isCurrentOwner = grant.artistId
        ? await hasArtistManagementAccess(userId, grant.artistId, "profile_owner", tx)
        : grant.releaseId
          ? await hasReleaseManagementAccess(userId, grant.releaseId, "catalog_owner", tx)
          : false;
      if (!isCurrentOwner) {
        throw new ForbiddenException("Only the current owner can update a management grant");
      }
      if (grant.status !== ManagementGrantStatus.active) {
        throw new ConflictException("Only active grants can be narrowed");
      }

      const resourceType = grant.artistId
        ? ManagementResourceType.artist_profile
        : ManagementResourceType.release;
      const scopes = input.scopes === undefined
        ? grant.scopes
        : this.readGrantScopes(input.scopes, resourceType);
      if (scopes.some((scope) => !grant.scopes.includes(scope))) {
        throw new BadRequestException("Grant scopes can only be narrowed");
      }

      const expiresAt = input.expiresAt === undefined
        ? grant.expiresAt
        : parseFutureIsoExpiry(input.expiresAt);
      const changedAt = new Date();
      if (expiresAt && expiresAt.getTime() <= changedAt.getTime()) {
        throw new BadRequestException("expiresAt must be in the future");
      }
      if (
        input.expiresAt !== undefined &&
        grant.expiresAt &&
        expiresAt!.getTime() > grant.expiresAt.getTime()
      ) {
        throw new BadRequestException("expiresAt can only be shortened");
      }

      const scopesChanged = scopes.length !== grant.scopes.length ||
        grant.scopes.some((scope) => !scopes.includes(scope));
      const expiryChanged = (expiresAt?.getTime() ?? null) !== (grant.expiresAt?.getTime() ?? null);
      if (!scopesChanged && !expiryChanged) {
        throw new BadRequestException("The grant update must narrow scopes or shorten expiry");
      }

      await tx.managementGrant.update({
        where: { id: grant.id },
        data: { status: ManagementGrantStatus.revoked, revokedAt: changedAt },
      });
      // A pending invitation for the same manager could otherwise restore
      // broader access after this narrowing when the recipient accepts it.
      await tx.managementGrant.updateMany({
        where: {
          ...(grant.artistId ? { artistId: grant.artistId } : { releaseId: grant.releaseId }),
          granteeUserId: equalsUserId(grant.granteeUserId),
          status: ManagementGrantStatus.pending,
        },
        data: { status: ManagementGrantStatus.revoked, revokedAt: changedAt },
      });
      return tx.managementGrant.create({
        data: {
          artistId: grant.artistId,
          releaseId: grant.releaseId,
          granteeUserId: grant.granteeUserId,
          inviterUserId: userId,
          scopes,
          status: ManagementGrantStatus.active,
          expiresAt,
          acceptedAt: grant.acceptedAt,
        },
      });
    });
  }

  async acceptGrant(userId: string, grantId: string) {
    return prisma.$transaction(async (tx) => {
      const initial = await tx.managementGrant.findUnique({ where: { id: grantId } });
      if (!initial) throw new NotFoundException("Management grant not found");
      if (initial.artistId) await this.lockArtist(tx, initial.artistId);
      else if (initial.releaseId) await this.lockRelease(tx, initial.releaseId);
      else throw new ConflictException("The grant no longer references a managed resource");

      await tx.$queryRaw`SELECT "id" FROM "ManagementGrant" WHERE "id" = ${grantId} FOR UPDATE`;
      const grant = await tx.managementGrant.findUnique({ where: { id: grantId } });
      this.assertPendingGrant(grant, userId);
      await this.assertOpenUser(tx, userId);
      await this.assertOpenUser(tx, grant.inviterUserId);

      if (grant.artistId) {
        if (!(await hasArtistManagementAccess(grant.inviterUserId, grant.artistId, "profile_owner", tx))) {
          throw new ConflictException("The inviter no longer owns this artist profile");
        }
        await tx.managementGrant.updateMany({
          where: {
            artistId: grant.artistId,
            granteeUserId: equalsUserId(userId),
            status: ManagementGrantStatus.active,
          },
          data: { status: ManagementGrantStatus.revoked, revokedAt: new Date() },
        });
      } else if (grant.releaseId) {
        if (!(await hasReleaseManagementAccess(grant.inviterUserId, grant.releaseId, "catalog_owner", tx))) {
          throw new ConflictException("The inviter no longer owns this release");
        }
        await tx.managementGrant.updateMany({
          where: {
            releaseId: grant.releaseId,
            granteeUserId: equalsUserId(userId),
            status: ManagementGrantStatus.active,
          },
          data: { status: ManagementGrantStatus.revoked, revokedAt: new Date() },
        });
      } else {
        throw new ConflictException("The grant no longer references a managed resource");
      }

      return tx.managementGrant.update({
        where: { id: grantId },
        data: { status: ManagementGrantStatus.active, acceptedAt: new Date() },
      });
    });
  }

  async declineGrant(userId: string, grantId: string) {
    return prisma.$transaction(async (tx) => {
      await this.assertOpenUser(tx, userId);
      await tx.$queryRaw`SELECT "id" FROM "ManagementGrant" WHERE "id" = ${grantId} FOR UPDATE`;
      const grant = await tx.managementGrant.findUnique({ where: { id: grantId } });
      this.assertPendingGrant(grant, userId);
      return tx.managementGrant.update({
        where: { id: grantId },
        data: { status: ManagementGrantStatus.declined },
      });
    });
  }

  async revokeGrant(userId: string, grantId: string) {
    return prisma.$transaction(async (tx) => {
      await this.assertOpenUser(tx, userId);
      const initial = await tx.managementGrant.findUnique({ where: { id: grantId } });
      if (!initial) throw new NotFoundException("Management grant not found");
      if (initial.artistId) await this.lockArtist(tx, initial.artistId);
      else if (initial.releaseId) await this.lockRelease(tx, initial.releaseId);

      await tx.$queryRaw`SELECT "id" FROM "ManagementGrant" WHERE "id" = ${grantId} FOR UPDATE`;
      const grant = await tx.managementGrant.findUnique({ where: { id: grantId } });
      if (!grant) throw new NotFoundException("Management grant not found");
      if (grant.status !== ManagementGrantStatus.pending && grant.status !== ManagementGrantStatus.active) {
        throw new ConflictException("Only pending or active grants can be revoked");
      }

      const isGrantee = sameUserId(grant.granteeUserId, userId);
      const isCurrentOwner = grant.artistId
        ? await hasArtistManagementAccess(userId, grant.artistId, "profile_owner", tx)
        : grant.releaseId
          ? await hasReleaseManagementAccess(userId, grant.releaseId, "catalog_owner", tx)
          : false;
      if (!isGrantee && !isCurrentOwner) {
        throw new ForbiddenException("Only the current owner or invited manager can revoke this grant");
      }

      return tx.managementGrant.update({
        where: { id: grantId },
        data: { status: ManagementGrantStatus.revoked, revokedAt: new Date() },
      });
    });
  }

  async createTransfer(userId: string, input: CreateManagementTransferInput) {
    const recipientEmail = this.readRecipientEmail(input.recipientEmail);
    await this.assertOpenUser(prisma, userId);
    const resource = await this.readTransferResource(userId, input);
    const recipient = await this.findOpenRecipient(recipientEmail, userId);
    const expiresAt = parseFutureExpiry(input.expiresAt);

    return prisma.$transaction(async (tx) => {
      await this.lockTransferResources(tx, resource);
      await this.assertTransferProposerStillOwns(tx, { ...resource, proposerUserId: userId });
      await this.assertOpenUser(tx, recipient.id);
      const conflicts = await tx.managementTransfer.findMany({
        where: {
          resourceType: resource.resourceType,
          resourceIds: { hasSome: resource.resourceIds },
          status: ManagementTransferStatus.pending,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { id: true },
      });
      if (conflicts.length) throw new ConflictException("A pending transfer already includes one of these resources");

      return tx.managementTransfer.create({
        data: {
          proposerUserId: userId,
          recipientUserId: recipient.id,
          resourceType: resource.resourceType,
          resourceIds: resource.resourceIds,
          status: ManagementTransferStatus.pending,
          expiresAt,
        },
      });
    });
  }

  async acceptTransfer(userId: string, transferId: string) {
    return prisma.$transaction(async (tx) => {
      // Observe the immutable resource snapshot before locking. Resource rows are
      // the shared serialization point for accepting and recovering transfers.
      const observedTransfer = await tx.managementTransfer.findUnique({ where: { id: transferId } });
      this.assertPendingTransfer(observedTransfer, userId);
      await this.assertOpenUser(tx, userId);
      await this.assertOpenUser(tx, observedTransfer.proposerUserId);

      const ids = [...new Set(observedTransfer.resourceIds)].sort();
      if (ids.length !== observedTransfer.resourceIds.length || ids.length === 0) {
        throw new ConflictException("The transfer resource snapshot is invalid");
      }
      if (
        observedTransfer.resourceType !== ManagementResourceType.artist_profile &&
        observedTransfer.resourceType !== ManagementResourceType.release
      ) {
        throw new ConflictException("The transfer resource type is invalid");
      }
      await this.lockTransferResources(tx, {
        resourceType: observedTransfer.resourceType,
        resourceIds: ids,
      });

      await tx.$queryRaw`SELECT "id" FROM "ManagementTransfer" WHERE "id" = ${transferId} FOR UPDATE`;
      const transfer = await tx.managementTransfer.findUnique({ where: { id: transferId } });
      this.assertPendingTransfer(transfer, userId);
      if (
        transfer.proposerUserId !== observedTransfer.proposerUserId ||
        transfer.recipientUserId !== observedTransfer.recipientUserId ||
        transfer.resourceType !== observedTransfer.resourceType ||
        !sameStringList(transfer.resourceIds, observedTransfer.resourceIds)
      ) {
        throw new ConflictException("The transfer changed while it was being accepted");
      }
      await this.assertOpenUser(tx, userId);
      await this.assertOpenUser(tx, transfer.proposerUserId);

      if (transfer.resourceType === ManagementResourceType.artist_profile) {
        const artists = await tx.artist.findMany({ where: { id: { in: ids } } });
        if (artists.length !== ids.length) throw new ConflictException("A transferred artist profile no longer exists");
        for (const artist of artists) {
          if (!(await hasArtistManagementAccess(transfer.proposerUserId, artist.id, "profile_owner", tx))) {
            throw new ConflictException("The proposer no longer owns every transferred artist profile");
          }
        }
        await tx.artist.updateMany({ where: { id: { in: ids } }, data: { managementOwnerUserId: userId } });
        await tx.managementGrant.updateMany({
          where: {
            artistId: { in: ids },
            status: { in: [ManagementGrantStatus.pending, ManagementGrantStatus.active] },
          },
          data: { status: ManagementGrantStatus.revoked, revokedAt: new Date() },
        });
      } else if (transfer.resourceType === ManagementResourceType.release) {
        const releases = await tx.release.findMany({
          where: { id: { in: ids } },
          include: { artist: { select: { userId: true } } },
        });
        if (releases.length !== ids.length) throw new ConflictException("A transferred release no longer exists");
        for (const release of releases) {
          if (!(await hasReleaseManagementAccess(transfer.proposerUserId, release.id, "catalog_owner", tx))) {
            throw new ConflictException("The proposer no longer owns every transferred release");
          }
        }
        await tx.release.updateMany({ where: { id: { in: ids } }, data: { managementOwnerUserId: userId } });
        await tx.managementGrant.updateMany({
          where: {
            releaseId: { in: ids },
            status: { in: [ManagementGrantStatus.pending, ManagementGrantStatus.active] },
          },
          data: { status: ManagementGrantStatus.revoked, revokedAt: new Date() },
        });
      } else {
        throw new ConflictException("The transfer resource type is invalid");
      }

      const accepted = await tx.managementTransfer.updateMany({
        where: { id: transferId, recipientUserId: equalsUserId(userId), status: ManagementTransferStatus.pending },
        data: { status: ManagementTransferStatus.accepted, acceptedAt: new Date() },
      });
      if (accepted.count !== 1) throw new ConflictException("The transfer is no longer pending");
      return tx.managementTransfer.findUniqueOrThrow({ where: { id: transferId } });
    });
  }

  async declineTransfer(userId: string, transferId: string) {
    return prisma.$transaction(async (tx) => {
      await this.assertOpenUser(tx, userId);
      await tx.$queryRaw`SELECT "id" FROM "ManagementTransfer" WHERE "id" = ${transferId} FOR UPDATE`;
      const transfer = await tx.managementTransfer.findUnique({ where: { id: transferId } });
      this.assertPendingTransfer(transfer, userId);
      return tx.managementTransfer.update({
        where: { id: transferId },
        data: { status: ManagementTransferStatus.declined },
      });
    });
  }

  async cancelTransfer(userId: string, transferId: string) {
    return prisma.$transaction(async (tx) => {
      await this.assertOpenUser(tx, userId);
      const observedTransfer = await tx.managementTransfer.findUnique({ where: { id: transferId } });
      if (!observedTransfer) throw new NotFoundException("Management transfer not found");
      if (!sameUserId(observedTransfer.proposerUserId, userId)) {
        throw new ForbiddenException("Only the transfer proposer can cancel it");
      }
      if (observedTransfer.status !== ManagementTransferStatus.pending) {
        throw new ConflictException("Only pending transfers can be cancelled");
      }

      const ids = [...new Set(observedTransfer.resourceIds)].sort();
      if (ids.length === 0 || ids.length !== observedTransfer.resourceIds.length) {
        throw new ConflictException("The transfer resource snapshot is invalid");
      }
      if (
        observedTransfer.resourceType !== ManagementResourceType.artist_profile &&
        observedTransfer.resourceType !== ManagementResourceType.release
      ) {
        throw new ConflictException("The transfer resource type is invalid");
      }
      await this.lockTransferResources(tx, {
        resourceType: observedTransfer.resourceType,
        resourceIds: ids,
      });
      await tx.$queryRaw`SELECT "id" FROM "ManagementTransfer" WHERE "id" = ${transferId} FOR UPDATE`;
      const transfer = await tx.managementTransfer.findUnique({ where: { id: transferId } });
      if (!transfer) throw new NotFoundException("Management transfer not found");
      if (!sameUserId(transfer.proposerUserId, userId)) {
        throw new ForbiddenException("Only the transfer proposer can cancel it");
      }
      if (transfer.status !== ManagementTransferStatus.pending) {
        throw new ConflictException("Only pending transfers can be cancelled");
      }
      if (
        transfer.proposerUserId !== observedTransfer.proposerUserId ||
        transfer.recipientUserId !== observedTransfer.recipientUserId ||
        transfer.resourceType !== observedTransfer.resourceType ||
        !sameStringList(transfer.resourceIds, observedTransfer.resourceIds)
      ) {
        throw new ConflictException("The transfer changed while it was being cancelled");
      }
      await this.assertOpenUser(tx, userId);
      await this.assertTransferProposerStillOwns(tx, transfer);
      const cancelled = await tx.managementTransfer.updateMany({
        where: { id: transferId, proposerUserId: equalsUserId(userId), status: ManagementTransferStatus.pending },
        data: { status: ManagementTransferStatus.cancelled, cancelledAt: new Date() },
      });
      if (cancelled.count !== 1) throw new ConflictException("The transfer is no longer pending");
      return tx.managementTransfer.findUniqueOrThrow({ where: { id: transferId } });
    });
  }

  async createTransferRecoveryRequest(userId: string, transferId: string, evidenceValue: unknown) {
    const evidence = readRecoveryEvidence(evidenceValue);
    await this.assertOpenUser(prisma, userId);

    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ManagementTransfer" WHERE "id" = ${transferId} FOR UPDATE`;
        const transfer = await tx.managementTransfer.findUnique({ where: { id: transferId } });
        if (!transfer) throw new NotFoundException("Management transfer not found");
        if (!sameUserId(transfer.proposerUserId, userId)) {
          throw new ForbiddenException("Only the original transfer proposer can request recovery");
        }
        await this.assertOpenUser(tx, transfer.proposerUserId);
        if (transfer.status !== ManagementTransferStatus.accepted || !transfer.acceptedAt) {
          throw new ConflictException("Only accepted transfers can be recovered");
        }
        await this.assertRecoverableTransfer(tx, transfer, {
          resourceType: transfer.resourceType,
          resourceIds: transfer.resourceIds,
        });

        const existing = await tx.managementTransferRecoveryRequest.findFirst({
          where: {
            transferId,
            status: { in: [ManagementTransferRecoveryStatus.pending, ManagementTransferRecoveryStatus.approved] },
          },
          select: { id: true },
        });
        if (existing) throw new ConflictException("A recovery request already exists for this transfer");

        const request = await tx.managementTransferRecoveryRequest.create({
          data: {
            transferId,
            requesterUserId: transfer.proposerUserId,
            evidence,
            resourceType: transfer.resourceType,
            resourceIds: [...transfer.resourceIds],
          },
          select: { id: true, transferId: true, status: true, createdAt: true },
        });
        return request;
      }, { timeout: RECOVERY_TRANSACTION_TIMEOUT_MS });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("A recovery request already exists for this transfer");
      }
      throw error;
    }
  }

  async getMyTransferRecoveries(userId: string) {
    await this.assertOpenUser(prisma, userId);
    const transfers = await prisma.managementTransfer.findMany({
      where: {
        proposerUserId: equalsUserId(userId),
        status: ManagementTransferStatus.accepted,
      },
      select: {
        id: true,
        resourceType: true,
        resourceIds: true,
        proposerUserId: true,
        recipientUserId: true,
        acceptedAt: true,
        createdAt: true,
        recoveryRequests: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, reviewedAt: true },
        },
      },
      orderBy: [{ acceptedAt: "desc" }, { createdAt: "desc" }],
    });
    const artistIds = [...new Set(transfers
      .filter((transfer) => transfer.resourceType === ManagementResourceType.artist_profile)
      .flatMap((transfer) => transfer.resourceIds))];
    const releaseIds = [...new Set(transfers
      .filter((transfer) => transfer.resourceType === ManagementResourceType.release)
      .flatMap((transfer) => transfer.resourceIds))];

    const [artists, releases, acceptedArtistTransfers, acceptedReleaseTransfers] = await Promise.all([
      artistIds.length
        ? prisma.artist.findMany({
          where: { id: { in: artistIds } },
          select: { id: true, displayName: true, managementOwnerUserId: true },
        })
        : Promise.resolve([]),
      releaseIds.length
        ? prisma.release.findMany({
          where: { id: { in: releaseIds } },
          select: { id: true, title: true, managementOwnerUserId: true },
        })
        : Promise.resolve([]),
      artistIds.length
        ? prisma.managementTransfer.findMany({
          where: {
            resourceType: ManagementResourceType.artist_profile,
            status: ManagementTransferStatus.accepted,
            resourceIds: { hasSome: artistIds },
          },
          select: { id: true, resourceIds: true, acceptedAt: true },
        })
        : Promise.resolve([]),
      releaseIds.length
        ? prisma.managementTransfer.findMany({
          where: {
            resourceType: ManagementResourceType.release,
            status: ManagementTransferStatus.accepted,
            resourceIds: { hasSome: releaseIds },
          },
          select: { id: true, resourceIds: true, acceptedAt: true },
        })
        : Promise.resolve([]),
    ]);
    const artistById = new Map(artists.map((artist) => [artist.id, artist]));
    const releaseById = new Map(releases.map((release) => [release.id, release]));

    return {
      transfers: transfers.map((transfer) => {
        const ids = transfer.resourceIds;
        const snapshotIsValid = ids.length > 0 && new Set(ids).size === ids.length && !!transfer.acceptedAt;
        const ownersMatch = snapshotIsValid && ids.every((id) => {
          const ownerId = transfer.resourceType === ManagementResourceType.artist_profile
            ? artistById.get(id)?.managementOwnerUserId
            : releaseById.get(id)?.managementOwnerUserId;
          return sameUserId(ownerId, transfer.recipientUserId);
        });
        const laterAcceptedTransfers = transfer.resourceType === ManagementResourceType.artist_profile
          ? acceptedArtistTransfers
          : acceptedReleaseTransfers;
        const noLaterTransfer = snapshotIsValid && !laterAcceptedTransfers.some((candidate) =>
          candidate.id !== transfer.id &&
          candidate.acceptedAt !== null &&
          candidate.acceptedAt >= transfer.acceptedAt! &&
          candidate.resourceIds.some((id) => ids.includes(id)),
        );
        const names = transfer.resourceType === ManagementResourceType.artist_profile
          ? ids.map((id) => ({ id, name: artistById.get(id)?.displayName ?? "Deleted profile" }))
          : ids.map((id) => ({ id, name: releaseById.get(id)?.title ?? "Deleted release" }));
        const recovery = transfer.recoveryRequests[0];
        return {
          id: transfer.id,
          resourceType: transfer.resourceType,
          resourceIds: ids,
          resources: names,
          acceptedAt: transfer.acceptedAt,
          eligible: !!ownersMatch && !!noLaterTransfer,
          recovery: recovery
            ? { id: recovery.id, status: recovery.status, reviewedAt: recovery.reviewedAt }
            : null,
        };
      }),
    };
  }

  async getPendingTransferRecoveries(operatorUserId: string, role: string) {
    this.assertRecoveryOperator(role);
    await this.assertOpenUser(prisma, operatorUserId);
    const requests = await prisma.managementTransferRecoveryRequest.findMany({
      where: { status: ManagementTransferRecoveryStatus.pending },
      select: {
        id: true,
        transferId: true,
        evidence: true,
        resourceType: true,
        resourceIds: true,
        createdAt: true,
        requester: { select: { email: true } },
        transfer: { select: { recipient: { select: { email: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });
    const artistIds = [...new Set(requests
      .filter((request) => request.resourceType === ManagementResourceType.artist_profile)
      .flatMap((request) => request.resourceIds))];
    const releaseIds = [...new Set(requests
      .filter((request) => request.resourceType === ManagementResourceType.release)
      .flatMap((request) => request.resourceIds))];
    const [artists, releases] = await Promise.all([
      artistIds.length
        ? prisma.artist.findMany({ where: { id: { in: artistIds } }, select: { id: true, displayName: true } })
        : Promise.resolve([]),
      releaseIds.length
        ? prisma.release.findMany({ where: { id: { in: releaseIds } }, select: { id: true, title: true } })
        : Promise.resolve([]),
    ]);
    const artistNames = new Map(artists.map((artist) => [artist.id, artist.displayName]));
    const releaseNames = new Map(releases.map((release) => [release.id, release.title]));

    return {
      requests: requests.map((request) => ({
        id: request.id,
        transferId: request.transferId,
        resourceType: request.resourceType,
        resources: request.resourceIds.map((id) => ({
          id,
          name: request.resourceType === ManagementResourceType.artist_profile
            ? artistNames.get(id) ?? "Deleted profile"
            : releaseNames.get(id) ?? "Deleted release",
        })),
        requesterEmail: request.requester.email,
        recipientEmail: request.transfer.recipient.email,
        evidence: request.evidence,
        createdAt: request.createdAt,
      })),
    };
  }

  async reviewTransferRecoveryRequest(
    reviewerUserId: string,
    role: string,
    requestId: string,
    decisionValue: unknown,
    reviewNoteValue: unknown,
  ) {
    this.assertRecoveryOperator(role);
    await this.assertOpenUser(prisma, reviewerUserId);
    if (decisionValue !== "approve" && decisionValue !== "reject") {
      throw new BadRequestException("decision must be approve or reject");
    }
    const decision = decisionValue;
    const reviewNote = readReviewNote(reviewNoteValue);

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ManagementTransferRecoveryRequest" WHERE "id" = ${requestId} FOR UPDATE`;
      const request = await tx.managementTransferRecoveryRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new NotFoundException("Transfer recovery request not found");
      if (request.status !== ManagementTransferRecoveryStatus.pending) {
        throw new ConflictException("Only pending recovery requests can be reviewed");
      }

      await tx.$queryRaw`SELECT "id" FROM "ManagementTransfer" WHERE "id" = ${request.transferId} FOR UPDATE`;
      const transfer = await tx.managementTransfer.findUnique({ where: { id: request.transferId } });
      if (!transfer) throw new NotFoundException("Management transfer not found");
      if (
        sameUserId(reviewerUserId, request.requesterUserId) ||
        sameUserId(reviewerUserId, transfer.proposerUserId) ||
        sameUserId(reviewerUserId, transfer.recipientUserId)
      ) {
        throw new ForbiddenException("A transfer participant cannot review its recovery request");
      }

      if (decision === "reject") {
        return tx.managementTransferRecoveryRequest.update({
          where: { id: requestId },
          data: {
            status: ManagementTransferRecoveryStatus.rejected,
            reviewerUserId,
            reviewNote,
            reviewedAt: new Date(),
          },
          select: { id: true, transferId: true, status: true, reviewerUserId: true, reviewNote: true, reviewedAt: true },
        });
      }

      if (!sameUserId(request.requesterUserId, transfer.proposerUserId)) {
        throw new ConflictException("The recovery requester is not the original transfer proposer");
      }
      await this.assertOpenUser(tx, request.requesterUserId);
      const ids = await this.assertRecoverableTransfer(tx, transfer, {
        resourceType: request.resourceType,
        resourceIds: request.resourceIds,
      });

      if (request.resourceType === ManagementResourceType.artist_profile) {
        const ownership = await tx.artist.updateMany({
          where: { id: { in: ids }, managementOwnerUserId: transfer.recipientUserId },
          data: { managementOwnerUserId: request.requesterUserId },
        });
        if (ownership.count !== ids.length) throw new ConflictException("The transferred profile ownership changed during review");
        await tx.managementGrant.updateMany({
          where: {
            artistId: { in: ids },
            status: { in: [ManagementGrantStatus.pending, ManagementGrantStatus.active] },
          },
          data: { status: ManagementGrantStatus.revoked, revokedAt: new Date() },
        });
        await tx.managementTransfer.updateMany({
          where: {
            id: { not: transfer.id },
            resourceType: ManagementResourceType.artist_profile,
            resourceIds: { hasSome: ids },
            status: ManagementTransferStatus.pending,
          },
          data: { status: ManagementTransferStatus.cancelled, cancelledAt: new Date() },
        });
      } else {
        const ownership = await tx.release.updateMany({
          where: { id: { in: ids }, managementOwnerUserId: transfer.recipientUserId },
          data: { managementOwnerUserId: request.requesterUserId },
        });
        if (ownership.count !== ids.length) throw new ConflictException("The transferred release ownership changed during review");
        await tx.managementGrant.updateMany({
          where: {
            releaseId: { in: ids },
            status: { in: [ManagementGrantStatus.pending, ManagementGrantStatus.active] },
          },
          data: { status: ManagementGrantStatus.revoked, revokedAt: new Date() },
        });
        await tx.managementTransfer.updateMany({
          where: {
            id: { not: transfer.id },
            resourceType: ManagementResourceType.release,
            resourceIds: { hasSome: ids },
            status: ManagementTransferStatus.pending,
          },
          data: { status: ManagementTransferStatus.cancelled, cancelledAt: new Date() },
        });
      }

      return tx.managementTransferRecoveryRequest.update({
        where: { id: requestId },
        data: {
          status: ManagementTransferRecoveryStatus.approved,
          reviewerUserId,
          reviewNote,
          reviewedAt: new Date(),
        },
        select: { id: true, transferId: true, status: true, reviewerUserId: true, reviewNote: true, reviewedAt: true },
      });
    }, { timeout: RECOVERY_TRANSACTION_TIMEOUT_MS });
  }

  private assertRecoveryOperator(role: string) {
    if (role !== "operator" && role !== "admin") {
      throw new ForbiddenException("Only operators and admins can review transfer recovery requests");
    }
  }

  private async assertRecoverableTransfer(
    tx: ManagementTransaction,
    transfer: RecoveryTransfer,
    snapshot: RecoverySnapshot,
  ): Promise<string[]> {
    if (transfer.status !== ManagementTransferStatus.accepted || !transfer.acceptedAt) {
      throw new ConflictException("The original transfer is no longer accepted");
    }
    if (snapshot.resourceType !== transfer.resourceType || !sameStringList(snapshot.resourceIds, transfer.resourceIds)) {
      throw new ConflictException("The transfer resource snapshot changed after the request was submitted");
    }
    const ids = snapshot.resourceIds;
    if (ids.length === 0 || new Set(ids).size !== ids.length) {
      throw new ConflictException("The transfer resource snapshot is invalid");
    }

    if (snapshot.resourceType === ManagementResourceType.artist_profile) {
      await this.lockArtists(tx, [...ids].sort());
      const artists = await tx.artist.findMany({
        where: { id: { in: ids } },
        select: { id: true, managementOwnerUserId: true },
      });
      if (artists.length !== ids.length || artists.some((artist) => !sameUserId(artist.managementOwnerUserId, transfer.recipientUserId))) {
        throw new ConflictException("The original recipient no longer directly manages every transferred profile");
      }
    } else if (snapshot.resourceType === ManagementResourceType.release) {
      await this.lockReleases(tx, [...ids].sort());
      const releases = await tx.release.findMany({
        where: { id: { in: ids } },
        select: { id: true, managementOwnerUserId: true },
      });
      if (releases.length !== ids.length || releases.some((release) => !sameUserId(release.managementOwnerUserId, transfer.recipientUserId))) {
        throw new ConflictException("The original recipient no longer directly manages every transferred release");
      }
    } else {
      throw new ConflictException("The transfer resource type is invalid");
    }

    const laterTransfers = await tx.managementTransfer.findMany({
      where: {
        resourceType: snapshot.resourceType,
        status: ManagementTransferStatus.accepted,
        id: { not: transfer.id },
        resourceIds: { hasSome: ids },
        acceptedAt: { gte: transfer.acceptedAt },
      },
      select: { id: true },
    });
    if (laterTransfers.length) {
      throw new ConflictException("A later accepted transfer touches one or more recovered resources");
    }
    return ids;
  }

  private async readTransferResource(userId: string, input: CreateManagementTransferInput): Promise<TransferResource> {
    const artistId = optionalId(input.artistId, "artistId");
    const releaseIdsInput = input.releaseIds;
    const allManagedReleases = input.allManagedReleases === true;
    const hasReleaseIds = releaseIdsInput !== undefined && releaseIdsInput !== null;
    const choices = Number(artistId !== null) + Number(hasReleaseIds) + Number(allManagedReleases);
    if (choices !== 1) {
      throw new BadRequestException("Provide exactly one of artistId, releaseIds, or allManagedReleases: true");
    }

    if (artistId) {
      const artist = await prisma.artist.findUnique({ where: { id: artistId }, select: { id: true } });
      if (!artist) throw new NotFoundException("Artist profile not found");
      if (!(await hasArtistManagementAccess(userId, artistId, "profile_owner"))) {
        throw new ForbiddenException("Only the current profile owner can transfer this profile");
      }
      return { resourceType: ManagementResourceType.artist_profile, resourceIds: [artistId] };
    }

    let releaseIds: string[];
    if (allManagedReleases) {
      const releases = await prisma.release.findMany({
        where: this.releaseOwnedWhere(userId),
        select: { id: true },
      });
      releaseIds = releases.map((release) => release.id).sort();
      if (releaseIds.length === 0) throw new BadRequestException("You do not currently own any releases to transfer");
    } else {
      releaseIds = readIdList(releaseIdsInput, "releaseIds");
    }

    const releases = await prisma.release.findMany({
      where: { id: { in: releaseIds } },
      select: { id: true },
    });
    if (releases.length !== releaseIds.length) throw new NotFoundException("One or more releases were not found");
    for (const release of releases) {
      if (!(await hasReleaseManagementAccess(userId, release.id, "catalog_owner"))) {
        throw new ForbiddenException("Only the current owner can transfer every selected release");
      }
    }
    return { resourceType: ManagementResourceType.release, resourceIds: [...releaseIds].sort() };
  }

  private readGrantResource(input: CreateManagementGrantInput): { resourceType: ManagementResourceType; id: string } {
    const artistId = optionalId(input.artistId, "artistId");
    const releaseId = optionalId(input.releaseId, "releaseId");
    if (Number(artistId !== null) + Number(releaseId !== null) !== 1) {
      throw new BadRequestException("Provide exactly one of artistId or releaseId");
    }
    return artistId
      ? { resourceType: ManagementResourceType.artist_profile, id: artistId }
      : { resourceType: ManagementResourceType.release, id: releaseId! };
  }

  private readGrantScopes(value: unknown, resourceType: ManagementResourceType): ManagementScope[] {
    if (!Array.isArray(value) || value.length === 0 || value.some((scope) => typeof scope !== "string")) {
      throw new BadRequestException("scopes must be a non-empty array of supported management scopes");
    }
    const scopes = [...new Set(value as string[])];
    const allowed = resourceType === ManagementResourceType.artist_profile ? PROFILE_SCOPES : CATALOG_SCOPES;
    if (scopes.some((scope) => !(allowed as readonly string[]).includes(scope))) {
      throw new BadRequestException(
        resourceType === ManagementResourceType.artist_profile
          ? "Artist profile grants support only PROFILE_EDIT"
          : "Release grants support only CATALOG_READ, CATALOG_METADATA, CATALOG_MEDIA, TRACK_METADATA, and TRACK_AUDIO",
      );
    }
    return scopes as ManagementScope[];
  }

  private readRecipientEmail(emailValue: unknown): string {
    if (typeof emailValue !== "string") throw new BadRequestException("recipientEmail is required");
    if (emailValue.length > MAX_RECIPIENT_EMAIL_LENGTH) {
      throw new BadRequestException("recipientEmail must be a valid email address");
    }
    const email = emailValue.trim().toLowerCase();
    if (email.length > MAX_RECIPIENT_EMAIL_LENGTH || !isValidRecipientEmail(email)) {
      throw new BadRequestException("recipientEmail must be a valid email address");
    }
    return email;
  }

  private async findOpenRecipient(email: string, inviterUserId: string) {
    const recipient = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, closedAt: null, erasedAt: null },
      select: { id: true, email: true },
    });
    if (!recipient) throw new NotFoundException("Recipient account not found or closed");
    if (sameUserId(recipient.id, inviterUserId)) throw new BadRequestException("You cannot invite yourself");
    return recipient;
  }

  private async ensureNoPendingGrant(
    tx: ManagementTransaction,
    resource: { resourceType: ManagementResourceType; id: string },
    granteeUserId: string,
  ) {
    const resourceWhere = resource.resourceType === ManagementResourceType.artist_profile
      ? { artistId: resource.id }
      : { releaseId: resource.id };
    const existing = await tx.managementGrant.findFirst({
      where: {
        ...resourceWhere,
        granteeUserId,
        status: ManagementGrantStatus.pending,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException("An invite for this resource and recipient is already pending");
  }

  private assertPendingGrant(
    grant: Awaited<ReturnType<typeof prisma.managementGrant.findUnique>>,
    userId: string,
  ): asserts grant is NonNullable<typeof grant> {
    if (!grant) throw new NotFoundException("Management grant not found");
    if (!sameUserId(grant.granteeUserId, userId)) throw new ForbiddenException("Only the invited manager can accept or decline this grant");
    if (grant.status !== ManagementGrantStatus.pending) throw new ConflictException("Only pending grants can be accepted or declined");
    if (grant.expiresAt && grant.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException("This management invite has expired");
    }
  }

  private assertPendingTransfer(
    transfer: Awaited<ReturnType<typeof prisma.managementTransfer.findUnique>>,
    userId: string,
  ): asserts transfer is NonNullable<typeof transfer> {
    if (!transfer) throw new NotFoundException("Management transfer not found");
    if (!sameUserId(transfer.recipientUserId, userId)) throw new ForbiddenException("Only the transfer recipient can accept or decline it");
    if (transfer.status !== ManagementTransferStatus.pending) throw new ConflictException("Only pending transfers can be accepted or declined");
    if (transfer.expiresAt && transfer.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException("This management transfer has expired");
    }
  }

  private ownerGrantDto(grant: {
    id: string;
    granteeUserId: string;
    scopes: ManagementScope[];
    status: ManagementGrantStatus;
    expiresAt: Date | null;
    acceptedAt: Date | null;
    revokedAt: Date | null;
    grantee: { email: string };
  }) {
    return {
      id: grant.id,
      granteeUserId: grant.granteeUserId,
      granteeEmail: grant.grantee.email,
      scopes: grant.scopes,
      status: grant.status,
      expiresAt: grant.expiresAt,
      acceptedAt: grant.acceptedAt,
      revokedAt: grant.revokedAt,
    };
  }

  private artistOwnedWhere(userId: string): Prisma.ArtistWhereInput {
    return {
      OR: [
        { managementOwnerUserId: equalsUserId(userId) },
        { managementOwnerUserId: null, userId: equalsUserId(userId) },
      ],
    };
  }

  private releaseOwnedWhere(userId: string): Prisma.ReleaseWhereInput {
    return {
      OR: [
        { managementOwnerUserId: equalsUserId(userId) },
        { managementOwnerUserId: null, artist: { is: { userId: equalsUserId(userId) } } },
      ],
    };
  }

  private async lockArtist(tx: ManagementTransaction, artistId: string) {
    await this.lockArtists(tx, [artistId]);
  }

  private async lockArtists(tx: ManagementTransaction, ids: string[]) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Artist"
      WHERE "id" IN (${Prisma.join(ids)})
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  private async lockRelease(tx: ManagementTransaction, releaseId: string) {
    await this.lockReleases(tx, [releaseId]);
  }

  private async lockReleases(tx: ManagementTransaction, ids: string[]) {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Release"
      WHERE "id" IN (${Prisma.join(ids)})
      ORDER BY "id"
      FOR UPDATE
    `);
  }

  private async lockTransferResources(tx: ManagementTransaction, transfer: TransferResource) {
    if (transfer.resourceType === ManagementResourceType.artist_profile) {
      await this.lockArtists(tx, transfer.resourceIds);
    } else {
      await this.lockReleases(tx, transfer.resourceIds);
    }
  }

  private async assertTransferProposerStillOwns(tx: ManagementTransaction, transfer: TransferResource & { proposerUserId: string }) {
    for (const id of transfer.resourceIds) {
      const owns = transfer.resourceType === ManagementResourceType.artist_profile
        ? await hasArtistManagementAccess(transfer.proposerUserId, id, "profile_owner", tx)
        : await hasReleaseManagementAccess(transfer.proposerUserId, id, "catalog_owner", tx);
      if (!owns) throw new ConflictException("The proposer no longer owns every resource in this transfer");
    }
  }

  private async assertOpenUser(tx: ManagementTransaction | typeof prisma, userId: string) {
    const user = await tx.user.findFirst({
      where: { id: equalsUserId(userId), closedAt: null, erasedAt: null },
      select: { id: true },
    });
    if (!user) throw new ForbiddenException("An open account is required for management access");
  }
}

function equalsUserId(userId: string) {
  return { equals: userId, mode: "insensitive" as const };
}

function sameUserId(left: string | null | undefined, right: string | null | undefined): boolean {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

function optionalId(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

function readIdList(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new BadRequestException(`${fieldName} must be a non-empty array of resource IDs`);
  }
  const ids = value.map((item) => (item as string).trim());
  if (new Set(ids).size !== ids.length) throw new BadRequestException(`${fieldName} cannot contain duplicate IDs`);
  return ids;
}

function readRecoveryEvidence(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("evidence is required");
  const evidence = value.trim();
  if (evidence.length < 20 || evidence.length > 4000) {
    throw new BadRequestException("evidence must be between 20 and 4000 characters");
  }
  return evidence;
}

function readReviewNote(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("note is required");
  const note = value.trim();
  if (note.length === 0 || note.length > 4000) {
    throw new BadRequestException("note must be between 1 and 4000 characters");
  }
  return note;
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseFutureExpiry(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) throw new BadRequestException("expiresAt must be a valid timestamp");
  if (date.getTime() <= Date.now()) throw new BadRequestException("expiresAt must be in the future");
  return date;
}

function parseFutureIsoExpiry(value: unknown): Date {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    throw new BadRequestException("expiresAt must be a future ISO timestamp");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new BadRequestException("expiresAt must be a future ISO timestamp");
  }
  if (date.getTime() <= Date.now()) throw new BadRequestException("expiresAt must be in the future");
  return date;
}

function uniqueScopes(scopes: ManagementScope[]): ManagementScope[] {
  const priority = new Map<ManagementScope, number>([
    [ManagementScope.PROFILE_EDIT, 0],
    [ManagementScope.CATALOG_READ, 1],
    [ManagementScope.CATALOG_METADATA, 2],
    [ManagementScope.CATALOG_MEDIA, 3],
    [ManagementScope.TRACK_METADATA, 4],
    [ManagementScope.TRACK_AUDIO, 5],
  ]);
  return [...new Set(scopes)].sort((a, b) => (priority.get(a) ?? 99) - (priority.get(b) ?? 99));
}
