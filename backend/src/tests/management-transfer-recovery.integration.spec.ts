import {
  ManagementGrantStatus,
  ManagementResourceType,
  ManagementScope,
  ManagementTransferRecoveryStatus,
  ManagementTransferStatus,
} from "@prisma/client";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { ManagementService } from "../modules/management/management.service";

const TEST_PREFIX = `management_recovery_${Date.now()}_${Math.random().toString(36).slice(2)}_`;
const USERS = {
  proposer: `${TEST_PREFIX}proposer`,
  recipient: `${TEST_PREFIX}recipient`,
  nextRecipient: `${TEST_PREFIX}next_recipient`,
  outsider: `${TEST_PREFIX}outsider`,
  operator: `${TEST_PREFIX}operator`,
  secondOperator: `${TEST_PREFIX}operator_2`,
};
const USER_IDS = Object.values(USERS);
const USER_EMAILS = Object.fromEntries(USER_IDS.map((id) => [id, `${id}@test.resonate`])) as Record<string, string>;
const service = new ManagementService();
let sequence = 0;
let artistIds: string[] = [];
let releaseIds: string[] = [];

beforeAll(async () => {
  await prisma.user.createMany({
    data: USER_IDS.map((id) => ({ id, email: USER_EMAILS[id] })),
  });
});

beforeEach(() => {
  artistIds = [];
  releaseIds = [];
});

afterEach(async () => {
  await prisma.managementTransferRecoveryRequest.deleteMany({
    where: {
      OR: [
        { requesterUserId: { in: USER_IDS } },
        { transfer: { is: { proposerUserId: { in: USER_IDS } } } },
      ],
    },
  });
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
  if (artistIds.length) await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
});

afterAll(async () => {
  await prisma.managementTransferRecoveryRequest.deleteMany({ where: { requesterUserId: { in: USER_IDS } } });
  await prisma.managementTransfer.deleteMany({
    where: { OR: [{ proposerUserId: { in: USER_IDS } }, { recipientUserId: { in: USER_IDS } }] },
  });
  await prisma.managementGrant.deleteMany({ where: { OR: [{ inviterUserId: { in: USER_IDS } }, { granteeUserId: { in: USER_IDS } }] } });
  await prisma.artistClaimRequest.deleteMany({ where: { artistId: { startsWith: TEST_PREFIX } } });
  await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { in: USER_IDS } } });
  await prisma.$disconnect();
});

async function createProfileWithRelease() {
  const key = ++sequence;
  const artistId = `${TEST_PREFIX}artist_${key}`;
  artistIds.push(artistId);
  const artist = await prisma.artist.create({
    data: {
      id: artistId,
      managementOwnerUserId: USERS.proposer,
      displayName: `Recovery profile ${key}`,
      profileType: "manager",
      claimStatus: "claimed",
    },
  });
  const releaseId = `${TEST_PREFIX}release_${key}`;
  releaseIds.push(releaseId);
  const release = await prisma.release.create({
    data: { id: releaseId, artistId, title: `Recovery release ${key}`, managementOwnerUserId: USERS.proposer },
  });
  return { artist, release };
}

async function acceptedTransfer(resource: { artistId?: string; releaseId?: string }, recipient = USERS.recipient) {
  const transfer = await service.createTransfer(USERS.proposer, {
    ...(resource.artistId ? { artistId: resource.artistId } : { releaseIds: [resource.releaseId!] }),
    recipientEmail: USER_EMAILS[recipient],
  });
  await service.acceptTransfer(recipient, transfer.id);
  return transfer;
}

async function requestRecovery(transferId: string) {
  return service.createTransferRecoveryRequest(
    USERS.proposer,
    transferId,
    "I did not authorize this transfer and am requesting review.",
  );
}

describe("Management transfer recovery integration", () => {
  it("recovers an artist profile and revokes grants and pending transfers while preserving the accepted transfer", async () => {
    const { artist } = await createProfileWithRelease();
    const transfer = await acceptedTransfer({ artistId: artist.id });
    const recovery = await requestRecovery(transfer.id);
    const pendingGrantId = `${TEST_PREFIX}profile_pending_${sequence}`;
    const activeGrantId = `${TEST_PREFIX}profile_active_${sequence}`;
    await prisma.managementGrant.createMany({
      data: [
        {
          id: pendingGrantId,
          artistId: artist.id,
          granteeUserId: USERS.outsider,
          inviterUserId: USERS.recipient,
          scopes: [ManagementScope.PROFILE_EDIT],
          status: ManagementGrantStatus.pending,
        },
        {
          id: activeGrantId,
          artistId: artist.id,
          granteeUserId: USERS.outsider,
          inviterUserId: USERS.recipient,
          scopes: [ManagementScope.PROFILE_EDIT],
          status: ManagementGrantStatus.active,
          acceptedAt: new Date(),
        },
      ],
    });
    const pendingTransfer = await service.createTransfer(USERS.recipient, {
      artistId: artist.id,
      recipientEmail: USER_EMAILS[USERS.nextRecipient],
    });

    const [mine, pending] = await Promise.all([
      service.getMyTransferRecoveries(USERS.proposer),
      service.getPendingTransferRecoveries(USERS.operator, "operator"),
    ]);
    expect(mine.transfers).toEqual([
      expect.objectContaining({
        id: transfer.id,
        resourceType: ManagementResourceType.artist_profile,
        resourceIds: [artist.id],
        eligible: true,
        recovery: { id: recovery.id, status: ManagementTransferRecoveryStatus.pending, reviewedAt: null },
      }),
    ]);
    expect(JSON.stringify(mine)).not.toContain("I did not authorize");
    expect(pending.requests).toEqual([
      expect.objectContaining({
        id: recovery.id,
        transferId: transfer.id,
        resources: [{ id: artist.id, name: artist.displayName }],
        requesterEmail: USER_EMAILS[USERS.proposer],
        recipientEmail: USER_EMAILS[USERS.recipient],
        evidence: "I did not authorize this transfer and am requesting review.",
      }),
    ]);

    const decision = await service.reviewTransferRecoveryRequest(
      USERS.operator,
      "operator",
      recovery.id,
      "approve",
      "Verified with the account holder.",
    );

    expect(decision.status).toBe(ManagementTransferRecoveryStatus.approved);
    expect(await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })).toMatchObject({
      userId: null,
      managementOwnerUserId: USERS.proposer,
    });
    expect((await prisma.managementTransfer.findUniqueOrThrow({ where: { id: transfer.id } })).status)
      .toBe(ManagementTransferStatus.accepted);
    expect((await prisma.managementTransfer.findUniqueOrThrow({ where: { id: pendingTransfer.id } })).status)
      .toBe(ManagementTransferStatus.cancelled);
    const grants = await prisma.managementGrant.findMany({ where: { id: { in: [pendingGrantId, activeGrantId] } } });
    expect(grants).toHaveLength(2);
    expect(grants.every((grant) => grant.status === ManagementGrantStatus.revoked && grant.revokedAt !== null)).toBe(true);
  });

  it("recovers a release without changing artist ownership and permits a new request after rejection", async () => {
    const { artist, release } = await createProfileWithRelease();
    const transfer = await acceptedTransfer({ releaseId: release.id });
    const rejectedRequest = await requestRecovery(transfer.id);
    const rejected = await service.reviewTransferRecoveryRequest(
      USERS.operator,
      "operator",
      rejectedRequest.id,
      "reject",
      "The submitted evidence is insufficient.",
    );
    expect(rejected.status).toBe(ManagementTransferRecoveryStatus.rejected);
    expect((await prisma.release.findUniqueOrThrow({ where: { id: release.id } })).managementOwnerUserId)
      .toBe(USERS.recipient);
    await expect(requestRecovery(transfer.id)).resolves.toMatchObject({ status: ManagementTransferRecoveryStatus.pending });

    const currentRequest = await prisma.managementTransferRecoveryRequest.findFirstOrThrow({
      where: { transferId: transfer.id, status: ManagementTransferRecoveryStatus.pending },
    });
    const decision = await service.reviewTransferRecoveryRequest(
      USERS.secondOperator,
      "admin",
      currentRequest.id,
      "approve",
      "The original rights holder has been verified.",
    );
    expect(decision.status).toBe(ManagementTransferRecoveryStatus.approved);
    expect(await prisma.release.findUniqueOrThrow({ where: { id: release.id } })).toMatchObject({
      artistId: artist.id,
      managementOwnerUserId: USERS.proposer,
    });
  });

  it("rejects non-operators and prevents the proposer or recipient from reviewing", async () => {
    const { artist } = await createProfileWithRelease();
    const transfer = await acceptedTransfer({ artistId: artist.id });
    const recovery = await requestRecovery(transfer.id);

    await expect(service.getPendingTransferRecoveries(USERS.outsider, "listener"))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.reviewTransferRecoveryRequest(USERS.outsider, "listener", recovery.id, "reject", "Valid review note."))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.reviewTransferRecoveryRequest(USERS.proposer, "operator", recovery.id, "reject", "Valid review note."))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.reviewTransferRecoveryRequest(USERS.recipient, "admin", recovery.id, "reject", "Valid review note."))
      .rejects.toBeInstanceOf(ForbiddenException);

    expect((await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })).managementOwnerUserId)
      .toBe(USERS.recipient);
    expect((await prisma.managementTransferRecoveryRequest.findUniqueOrThrow({ where: { id: recovery.id } })).status)
      .toBe(ManagementTransferRecoveryStatus.pending);
  });

  it("rejects stale submission and approval when ownership or the transfer snapshot changed", async () => {
    const staleOwnership = await createProfileWithRelease();
    const firstTransfer = await acceptedTransfer({ releaseId: staleOwnership.release.id });
    await prisma.release.update({
      where: { id: staleOwnership.release.id },
      data: { managementOwnerUserId: USERS.nextRecipient },
    });
    await expect(requestRecovery(firstTransfer.id)).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.managementTransferRecoveryRequest.findMany({ where: { transferId: firstTransfer.id } })).toHaveLength(0);

    const changedSnapshot = await createProfileWithRelease();
    const secondReleaseId = `${TEST_PREFIX}release_extra_${++sequence}`;
    releaseIds.push(secondReleaseId);
    await prisma.release.create({
      data: { id: secondReleaseId, artistId: changedSnapshot.artist.id, title: "Snapshot replacement" },
    });
    const secondTransfer = await acceptedTransfer({ releaseId: changedSnapshot.release.id });
    const recovery = await requestRecovery(secondTransfer.id);
    await prisma.managementTransfer.update({
      where: { id: secondTransfer.id },
      data: { resourceIds: [secondReleaseId] },
    });

    await expect(service.reviewTransferRecoveryRequest(
      USERS.operator,
      "operator",
      recovery.id,
      "approve",
      "Reviewed after a resource mismatch.",
    )).rejects.toBeInstanceOf(ConflictException);
    expect((await prisma.release.findUniqueOrThrow({ where: { id: changedSnapshot.release.id } })).managementOwnerUserId)
      .toBe(USERS.recipient);
    expect((await prisma.managementTransferRecoveryRequest.findUniqueOrThrow({ where: { id: recovery.id } })).status)
      .toBe(ManagementTransferRecoveryStatus.pending);
  });

  it("blocks a recovery after a later accepted transfer touches the resource", async () => {
    const { artist } = await createProfileWithRelease();
    const original = await acceptedTransfer({ artistId: artist.id });
    const recovery = await requestRecovery(original.id);

    const transferAway = await service.createTransfer(USERS.recipient, {
      artistId: artist.id,
      recipientEmail: USER_EMAILS[USERS.nextRecipient],
    });
    await service.acceptTransfer(USERS.nextRecipient, transferAway.id);
    const transferBack = await service.createTransfer(USERS.nextRecipient, {
      artistId: artist.id,
      recipientEmail: USER_EMAILS[USERS.recipient],
    });
    await service.acceptTransfer(USERS.recipient, transferBack.id);

    await expect(service.reviewTransferRecoveryRequest(
      USERS.operator,
      "operator",
      recovery.id,
      "approve",
      "Reviewed after transfer history changed.",
    )).rejects.toBeInstanceOf(ConflictException);
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })).managementOwnerUserId)
      .toBe(USERS.recipient);
    expect((await prisma.managementTransferRecoveryRequest.findUniqueOrThrow({ where: { id: recovery.id } })).status)
      .toBe(ManagementTransferRecoveryStatus.pending);
  });

  it("serializes duplicate requests and reviews", async () => {
    const { artist } = await createProfileWithRelease();
    const transfer = await acceptedTransfer({ artistId: artist.id });
    const requests = await Promise.allSettled([requestRecovery(transfer.id), requestRecovery(transfer.id)]);
    expect(requests.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(requests.filter((result) => result.status === "rejected")).toHaveLength(1);
    const recovery = await prisma.managementTransferRecoveryRequest.findFirstOrThrow({ where: { transferId: transfer.id } });

    const reviews = await Promise.allSettled([
      service.reviewTransferRecoveryRequest(USERS.operator, "operator", recovery.id, "approve", "First operator review."),
      service.reviewTransferRecoveryRequest(USERS.secondOperator, "admin", recovery.id, "reject", "Second operator review."),
    ]);
    expect(reviews.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(reviews.filter((result) => result.status === "rejected")).toHaveLength(1);
    const stored = await prisma.managementTransferRecoveryRequest.findUniqueOrThrow({ where: { id: recovery.id } });
    expect([ManagementTransferRecoveryStatus.approved, ManagementTransferRecoveryStatus.rejected]).toContain(stored.status);
  });
});
