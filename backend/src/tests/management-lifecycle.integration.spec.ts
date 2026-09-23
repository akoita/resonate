import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ManagementGrantStatus, ManagementScope, ManagementTransferStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { ManagementService } from "../modules/management/management.service";

const TEST_PREFIX = `management_${Date.now()}_${Math.random().toString(36).slice(2)}_`;
const USERS = {
  owner: `${TEST_PREFIX}owner`,
  recipient: `${TEST_PREFIX}recipient`,
  manager: `${TEST_PREFIX}manager`,
  outsider: `${TEST_PREFIX}outsider`,
  otherOwner: `${TEST_PREFIX}other_owner`,
  closed: `${TEST_PREFIX}closed`,
};
const USER_IDS = Object.values(USERS);
const USER_EMAILS = Object.fromEntries(
  USER_IDS.map((id) => [id, `${id}@test.resonate`]),
) as Record<string, string>;

const service = new ManagementService();
let sequence = 0;
let artistIds: string[] = [];
let releaseIds: string[] = [];

beforeAll(async () => {
  for (const id of USER_IDS) {
    await prisma.user.create({ data: { id, email: USER_EMAILS[id] } });
  }
});

beforeEach(() => {
  artistIds = [];
  releaseIds = [];
});

afterEach(async () => {
  await prisma.managementTransfer.deleteMany({
    where: { OR: [{ proposerUserId: { in: USER_IDS } }, { recipientUserId: { in: USER_IDS } }] },
  });
  await prisma.managementGrant.deleteMany({
    where: {
      OR: [
        { inviterUserId: { in: USER_IDS } },
        { granteeUserId: { in: USER_IDS } },
        ...(artistIds.length ? [{ artistId: { in: artistIds } }] : []),
        ...(releaseIds.length ? [{ releaseId: { in: releaseIds } }] : []),
      ],
    },
  });
  if (releaseIds.length) await prisma.release.deleteMany({ where: { id: { in: releaseIds } } });
  if (artistIds.length) {
    await prisma.artistClaimRequest.deleteMany({ where: { artistId: { in: artistIds } } });
    await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  }
  await prisma.user.updateMany({ where: { id: { in: USER_IDS } }, data: { closedAt: null, erasedAt: null } });
});

afterAll(async () => {
  await prisma.managementTransfer.deleteMany({
    where: { OR: [{ proposerUserId: { in: USER_IDS } }, { recipientUserId: { in: USER_IDS } }] },
  });
  await prisma.managementGrant.deleteMany({
    where: { OR: [{ inviterUserId: { in: USER_IDS } }, { granteeUserId: { in: USER_IDS } }] },
  });
  await prisma.artistClaimRequest.deleteMany({ where: { claimantUserId: { in: USER_IDS } } });
  await prisma.release.deleteMany({ where: { artist: { userId: USERS.owner } } });
  await prisma.artist.deleteMany({ where: { userId: { in: USER_IDS } } });
  await prisma.user.deleteMany({ where: { id: { in: USER_IDS } } });
  await prisma.$disconnect();
});

async function createFixture(releaseCount = 2, options: { publicArtist?: boolean } = {}) {
  const key = ++sequence;
  const artistId = `${TEST_PREFIX}artist_${key}`;
  artistIds.push(artistId);
  const artist = await prisma.artist.create({
    data: {
      id: artistId,
      userId: USERS.owner,
      displayName: `Management Test Artist ${key}`,
      profileType: options.publicArtist ? "public_artist" : "manager",
      claimStatus: "claimed",
    },
  });

  const releases = [];
  for (let index = 0; index < releaseCount; index += 1) {
    const id = `${TEST_PREFIX}release_${key}_${index}`;
    releaseIds.push(id);
    releases.push(await prisma.release.create({
      data: { id, artistId, title: `Management Test Release ${key}-${index}` },
    }));
  }
  return { artist, releases };
}

async function createRelease(artistId: string, suffix: string) {
  const id = `${TEST_PREFIX}release_${suffix}`;
  releaseIds.push(id);
  return prisma.release.create({ data: { id, artistId, title: `Management Test Release ${suffix}` } });
}

describe("ManagementService lifecycle integration", () => {
  it("rejects oversized crafted recipient emails early and accepts a normal address", async () => {
    const craftedAddress = `user@${".".repeat(10_000)} `;
    await expect(service.createTransfer("missing-user", { recipientEmail: craftedAddress }))
      .rejects.toBeInstanceOf(BadRequestException);

    const { artist } = await createFixture(0, { publicArtist: true });
    const grant = await service.createGrant(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.manager],
      artistId: artist.id,
      scopes: [ManagementScope.PROFILE_EDIT],
    });

    expect(grant.granteeUserId).toBe(USERS.manager);
  });

  it("keeps profile invites pending until the recipient accepts and lets the owner revoke access", async () => {
    const { artist } = await createFixture(0, { publicArtist: true });
    const invite = await service.createGrant(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.manager],
      artistId: artist.id,
      scopes: [ManagementScope.PROFILE_EDIT],
    });

    expect(invite.status).toBe(ManagementGrantStatus.pending);
    const inbox = await service.getMe(USERS.manager);
    expect(inbox.pendingGrants).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: invite.id, resourceName: artist.displayName }),
    ]));
    await expect(service.acceptGrant(USERS.outsider, invite.id)).rejects.toBeInstanceOf(ForbiddenException);

    const accepted = await service.acceptGrant(USERS.manager, invite.id);
    expect(accepted.status).toBe(ManagementGrantStatus.active);
    expect(accepted.acceptedAt).toBeInstanceOf(Date);
    expect(await service.getArtistAccess(USERS.manager, artist.id)).toMatchObject({
      currentUserAccess: { isOwner: false, scopes: [ManagementScope.PROFILE_EDIT] },
      grants: [],
    });
    await expect(service.getArtistAccess(USERS.outsider, artist.id)).rejects.toBeInstanceOf(ForbiddenException);

    const ownerView = await service.getArtistAccess(USERS.owner, artist.id);
    expect(ownerView.grants).toEqual([
      expect.objectContaining({ granteeEmail: USER_EMAILS[USERS.manager], status: ManagementGrantStatus.active }),
    ]);
    expect(JSON.stringify(ownerView)).not.toContain("private claim evidence");

    const revoked = await service.revokeGrant(USERS.owner, invite.id);
    expect(revoked.status).toBe(ManagementGrantStatus.revoked);
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    await expect(service.getArtistAccess(USERS.manager, artist.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("keeps profile and exact-release scopes separate and exposes approved claims as edit-only", async () => {
    const { artist, releases } = await createFixture(2, { publicArtist: true });
    await prisma.artistClaimRequest.create({
      data: {
        artistId: artist.id,
        claimantUserId: USERS.manager,
        evidence: "private claim evidence",
        status: "approved",
        reviewedAt: new Date(),
      },
    });
    await expect(service.createGrant(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.manager],
      artistId: artist.id,
      scopes: [ManagementScope.CATALOG_READ],
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createGrant(USERS.outsider, {
      recipientEmail: "unregistered@test.resonate",
      artistId: artist.id,
      scopes: [ManagementScope.PROFILE_EDIT],
    })).rejects.toBeInstanceOf(ForbiddenException);

    const releaseGrant = await service.createGrant(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.recipient],
      releaseId: releases[0].id,
      scopes: [ManagementScope.CATALOG_MEDIA],
    });
    await service.acceptGrant(USERS.recipient, releaseGrant.id);

    const ownerView = await service.getMe(USERS.manager);
    expect(ownerView.managedArtists).toEqual([
      expect.objectContaining({
        id: artist.id,
        source: "approved_claim",
        grantId: null,
        scopes: [ManagementScope.PROFILE_EDIT],
      }),
    ]);
    expect(JSON.stringify(ownerView)).not.toContain("private claim evidence");
    await expect(service.getReleaseAccess(USERS.manager, releases[0].id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await service.getArtistAccess(USERS.manager, artist.id)).toMatchObject({
      currentUserAccess: { isOwner: false, scopes: [ManagementScope.PROFILE_EDIT] },
    });
    expect(await service.getReleaseAccess(USERS.recipient, releases[0].id)).toMatchObject({
      currentUserAccess: { isOwner: false, scopes: [ManagementScope.CATALOG_MEDIA] },
    });
    await expect(service.getReleaseAccess(USERS.recipient, releases[1].id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("transfers only selected releases and changes the effective owner without rewriting legacy attribution", async () => {
    const { artist, releases } = await createFixture(2);
    const activeGrant = await service.createGrant(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.manager],
      releaseId: releases[0].id,
      scopes: [ManagementScope.CATALOG_READ],
    });
    await service.acceptGrant(USERS.manager, activeGrant.id);
    const pendingGrant = await service.createGrant(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.outsider],
      releaseId: releases[0].id,
      scopes: [ManagementScope.CATALOG_READ],
    });
    const transfer = await service.createTransfer(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.recipient],
      releaseIds: [releases[0].id],
    });
    expect(transfer.resourceIds).toEqual([releases[0].id]);
    expect((await service.getMe(USERS.owner)).outgoingTransfers).toEqual([
      expect.objectContaining({
        recipientEmail: USER_EMAILS[USERS.recipient],
        resources: [{ id: releases[0].id, name: releases[0].title }],
      }),
    ]);
    expect((await service.getMe(USERS.recipient)).pendingTransfers).toEqual([
      expect.objectContaining({ resources: [{ id: releases[0].id, name: releases[0].title }] }),
    ]);

    await service.acceptTransfer(USERS.recipient, transfer.id);
    expect((await prisma.managementGrant.findUniqueOrThrow({ where: { id: activeGrant.id } })).status)
      .toBe(ManagementGrantStatus.revoked);
    expect((await prisma.managementGrant.findUniqueOrThrow({ where: { id: pendingGrant.id } })).status)
      .toBe(ManagementGrantStatus.revoked);
    await expect(service.getReleaseAccess(USERS.manager, releases[0].id))
      .rejects.toBeInstanceOf(ForbiddenException);
    const [transferred, untouched] = await Promise.all([
      prisma.release.findUniqueOrThrow({ where: { id: releases[0].id } }),
      prisma.release.findUniqueOrThrow({ where: { id: releases[1].id } }),
    ]);
    expect(transferred.managementOwnerUserId).toBe(USERS.recipient);
    expect(transferred.artistId).toBe(artist.id);
    expect(untouched.managementOwnerUserId).toBeNull();
    expect(await service.getReleaseAccess(USERS.recipient, releases[0].id)).toMatchObject({
      currentUserAccess: { isOwner: true },
    });
    await expect(service.getReleaseAccess(USERS.owner, releases[0].id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await service.getReleaseAccess(USERS.owner, releases[1].id)).toMatchObject({
      currentUserAccess: { isOwner: true },
    });
    expect(await service.getArtistAccess(USERS.owner, artist.id)).toMatchObject({
      currentUserAccess: { isOwner: true },
    });
    await expect(service.createGrant(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.manager],
      releaseId: releases[0].id,
      scopes: [ManagementScope.CATALOG_READ],
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("snapshots whole-catalog transfers and leaves later releases with the legacy owner", async () => {
    const { artist, releases } = await createFixture(2);
    const transfer = await service.createTransfer(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.recipient],
      allManagedReleases: true,
    });
    expect(new Set(transfer.resourceIds)).toEqual(new Set(releases.map((release) => release.id)));
    const laterRelease = await createRelease(artist.id, "added_after_snapshot");

    await service.acceptTransfer(USERS.recipient, transfer.id);
    for (const release of releases) {
      expect((await prisma.release.findUniqueOrThrow({ where: { id: release.id } })).managementOwnerUserId)
        .toBe(USERS.recipient);
      await expect(service.getReleaseAccess(USERS.owner, release.id)).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect((await prisma.release.findUniqueOrThrow({ where: { id: laterRelease.id } })).managementOwnerUserId).toBeNull();
    expect(await service.getReleaseAccess(USERS.owner, laterRelease.id)).toMatchObject({
      currentUserAccess: { isOwner: true },
    });
    await expect(service.getArtistAccess(USERS.recipient, artist.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects overlapping pending transfers and applies no partial ownership changes after a conflict", async () => {
    const { releases } = await createFixture(2);
    const transfer = await service.createTransfer(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.recipient],
      releaseIds: releases.map((release) => release.id),
    });
    await expect(service.createTransfer(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.manager],
      releaseIds: [releases[0].id],
    })).rejects.toBeInstanceOf(ConflictException);

    await prisma.release.update({
      where: { id: releases[1].id },
      data: { managementOwnerUserId: USERS.otherOwner },
    });
    await expect(service.acceptTransfer(USERS.recipient, transfer.id)).rejects.toBeInstanceOf(ConflictException);
    expect((await prisma.release.findUniqueOrThrow({ where: { id: releases[0].id } })).managementOwnerUserId).toBeNull();
    expect((await prisma.release.findUniqueOrThrow({ where: { id: releases[1].id } })).managementOwnerUserId)
      .toBe(USERS.otherOwner);
    expect((await prisma.managementTransfer.findUniqueOrThrow({ where: { id: transfer.id } })).status)
      .toBe(ManagementTransferStatus.pending);
  });

  it("revokes grants on transfer, rechecks inviters, and supports declining or cancelling transfers", async () => {
    const { artist, releases } = await createFixture(1);
    const staleGrant = await service.createGrant(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.manager],
      artistId: artist.id,
      scopes: [ManagementScope.PROFILE_EDIT],
    });
    const profileTransfer = await service.createTransfer(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.otherOwner],
      artistId: artist.id,
    });
    await service.acceptTransfer(USERS.otherOwner, profileTransfer.id);
    await expect(service.acceptGrant(USERS.manager, staleGrant.id)).rejects.toBeInstanceOf(ConflictException);
    expect((await prisma.managementGrant.findUniqueOrThrow({ where: { id: staleGrant.id } })).status)
      .toBe(ManagementGrantStatus.revoked);

    const reassignedGrant = await service.createGrant(USERS.otherOwner, {
      recipientEmail: USER_EMAILS[USERS.outsider],
      artistId: artist.id,
      scopes: [ManagementScope.PROFILE_EDIT],
    });
    await prisma.artist.update({
      where: { id: artist.id },
      data: { managementOwnerUserId: USERS.recipient },
    });
    await expect(service.acceptGrant(USERS.outsider, reassignedGrant.id))
      .rejects.toBeInstanceOf(ConflictException);
    expect((await prisma.managementGrant.findUniqueOrThrow({ where: { id: reassignedGrant.id } })).status)
      .toBe(ManagementGrantStatus.pending);

    const declined = await service.createTransfer(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.recipient],
      releaseIds: [releases[0].id],
    });
    await expect(service.declineTransfer(USERS.outsider, declined.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await service.declineTransfer(USERS.recipient, declined.id)).status).toBe(ManagementTransferStatus.declined);

    const cancelled = await service.createTransfer(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.recipient],
      releaseIds: [releases[0].id],
    });
    await expect(service.cancelTransfer(USERS.outsider, cancelled.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await service.cancelTransfer(USERS.owner, cancelled.id)).status).toBe(ManagementTransferStatus.cancelled);
  });

  it("requires a registered open recipient and future expiry", async () => {
    const { artist } = await createFixture(0);
    await prisma.user.update({ where: { id: USERS.closed }, data: { closedAt: new Date() } });
    await expect(service.createGrant(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.closed],
      artistId: artist.id,
      scopes: [ManagementScope.PROFILE_EDIT],
    })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.createGrant(USERS.owner, {
      recipientEmail: "unregistered@test.resonate",
      artistId: artist.id,
      scopes: [ManagementScope.PROFILE_EDIT],
    })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.createGrant(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.manager],
      artistId: artist.id,
      scopes: [ManagementScope.PROFILE_EDIT],
      expiresAt: new Date(Date.now() - 1).toISOString(),
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("matches owner and grantee IDs case-insensitively and requires open inviters and transfer proposers", async () => {
    const { artist, releases } = await createFixture(1);
    const invite = await service.createGrant(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.manager],
      artistId: artist.id,
      scopes: [ManagementScope.PROFILE_EDIT],
    });

    const ownerView = await service.getMe(USERS.owner.toUpperCase());
    expect(ownerView.ownedArtists).toEqual(expect.arrayContaining([expect.objectContaining({ id: artist.id })]));
    expect((await service.getMe(USERS.manager.toUpperCase())).pendingGrants)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: invite.id })]));

    await prisma.user.update({ where: { id: USERS.owner }, data: { closedAt: new Date() } });
    await expect(service.getMe(USERS.owner)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.createGrant(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.recipient],
      artistId: artist.id,
      scopes: [ManagementScope.PROFILE_EDIT],
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.acceptGrant(USERS.manager, invite.id)).rejects.toBeInstanceOf(ForbiddenException);
    await prisma.user.update({ where: { id: USERS.owner }, data: { closedAt: null } });
    await service.acceptGrant(USERS.manager, invite.id);
    expect((await service.getMe(USERS.manager.toUpperCase())).managedArtists)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: artist.id, grantId: invite.id })]));

    await expect(service.createGrant(USERS.owner.toUpperCase(), {
      recipientEmail: USER_EMAILS[USERS.owner],
      artistId: artist.id,
      scopes: [ManagementScope.PROFILE_EDIT],
    })).rejects.toBeInstanceOf(BadRequestException);

    const transfer = await service.createTransfer(USERS.owner, {
      recipientEmail: USER_EMAILS[USERS.recipient],
      releaseIds: [releases[0].id],
    });
    await prisma.user.update({ where: { id: USERS.owner }, data: { closedAt: new Date() } });
    await expect(service.acceptTransfer(USERS.recipient, transfer.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
