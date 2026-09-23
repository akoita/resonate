import {
  ManagementGrantStatus,
  ManagementResourceType,
  ManagementScope,
  ManagementTransferStatus,
} from "@prisma/client";
import { prisma } from "../db/prisma";
import { ManagementService } from "../modules/management/management.service";

const P = `management_pending_invitations_${Date.now()}_`;
const USER = {
  owner: `${P}owner`,
  recipient: `${P}recipient`,
  otherRecipient: `${P}other_recipient`,
};
const ARTIST_ID = `${P}artist`;
const RELEASE_IDS = [`${P}release_a`, `${P}release_b`, `${P}release_c`];
const GRANT_IDS = [
  "artist_pending",
  "release_pending",
  "expired_pending",
  "accepted",
  "declined",
  "revoked",
  "other_recipient",
  "malformed_both",
  "malformed_neither",
].map((suffix) => `${P}grant_${suffix}`);
const TRANSFER_IDS = [
  "artist_pending",
  "releases_pending",
  "expired_pending",
  "accepted",
  "declined",
  "cancelled",
  "other_recipient",
].map((suffix) => `${P}transfer_${suffix}`);

const service = new ManagementService();

describe("pending management invitations integration", () => {
  const future = new Date(Date.now() + 60 * 60 * 1000);
  const past = new Date(Date.now() - 60 * 1000);

  beforeAll(async () => {
    await prisma.user.createMany({
      data: Object.values(USER).map((id) => ({ id, email: `${id}@test.resonate` })),
    });
    await prisma.artist.create({
      data: { id: ARTIST_ID, displayName: "Pending invite artist", userId: USER.owner },
    });
    await prisma.release.createMany({
      data: RELEASE_IDS.map((id, index) => ({
        id,
        artistId: ARTIST_ID,
        title: `Pending invite release ${index + 1}`,
      })),
    });

    const grantFixtures: Array<{
      suffix: string;
      artistId?: string;
      releaseId?: string;
      scopes: ManagementScope[];
      expiresAt: Date | null;
      status: ManagementGrantStatus;
      granteeUserId?: string;
    }> = [
      {
        suffix: "artist_pending",
        artistId: ARTIST_ID,
        scopes: [ManagementScope.PROFILE_EDIT],
        expiresAt: null,
        status: ManagementGrantStatus.pending,
      },
      {
        suffix: "release_pending",
        releaseId: RELEASE_IDS[0],
        scopes: [ManagementScope.CATALOG_READ, ManagementScope.TRACK_AUDIO],
        expiresAt: future,
        status: ManagementGrantStatus.pending,
      },
      {
        suffix: "expired_pending",
        releaseId: RELEASE_IDS[1],
        scopes: [ManagementScope.CATALOG_READ],
        expiresAt: past,
        status: ManagementGrantStatus.pending,
      },
      {
        suffix: "accepted",
        releaseId: RELEASE_IDS[1],
        scopes: [ManagementScope.CATALOG_READ],
        expiresAt: future,
        status: ManagementGrantStatus.active,
      },
      {
        suffix: "declined",
        artistId: ARTIST_ID,
        scopes: [ManagementScope.PROFILE_EDIT],
        expiresAt: future,
        status: ManagementGrantStatus.declined,
      },
      {
        suffix: "revoked",
        releaseId: RELEASE_IDS[2],
        scopes: [ManagementScope.CATALOG_READ],
        expiresAt: future,
        status: ManagementGrantStatus.revoked,
      },
      {
        suffix: "other_recipient",
        releaseId: RELEASE_IDS[2],
        scopes: [ManagementScope.CATALOG_READ],
        expiresAt: future,
        status: ManagementGrantStatus.pending,
        granteeUserId: USER.otherRecipient,
      },
      {
        suffix: "malformed_both",
        artistId: ARTIST_ID,
        releaseId: RELEASE_IDS[0],
        scopes: [ManagementScope.PROFILE_EDIT],
        expiresAt: future,
        status: ManagementGrantStatus.pending,
      },
      {
        suffix: "malformed_neither",
        scopes: [ManagementScope.PROFILE_EDIT],
        expiresAt: future,
        status: ManagementGrantStatus.pending,
      },
    ];
    for (const fixture of grantFixtures) {
      await prisma.managementGrant.create({
        data: {
          id: `${P}grant_${fixture.suffix}`,
          inviterUserId: USER.owner,
          granteeUserId: fixture.granteeUserId ?? USER.recipient,
          artistId: fixture.artistId ?? null,
          releaseId: fixture.releaseId ?? null,
          scopes: fixture.scopes,
          expiresAt: fixture.expiresAt,
          status: fixture.status,
        },
      });
    }

    const transferFixtures = [
      {
        suffix: "artist_pending",
        recipientUserId: USER.recipient,
        resourceType: ManagementResourceType.artist_profile,
        resourceIds: [ARTIST_ID],
        status: ManagementTransferStatus.pending,
        expiresAt: null,
      },
      {
        suffix: "releases_pending",
        recipientUserId: USER.recipient,
        resourceType: ManagementResourceType.release,
        resourceIds: RELEASE_IDS.slice(0, 2),
        status: ManagementTransferStatus.pending,
        expiresAt: future,
      },
      {
        suffix: "expired_pending",
        recipientUserId: USER.recipient,
        resourceType: ManagementResourceType.release,
        resourceIds: [RELEASE_IDS[2]],
        status: ManagementTransferStatus.pending,
        expiresAt: past,
      },
      {
        suffix: "accepted",
        recipientUserId: USER.recipient,
        resourceType: ManagementResourceType.artist_profile,
        resourceIds: [ARTIST_ID],
        status: ManagementTransferStatus.accepted,
        expiresAt: future,
      },
      {
        suffix: "declined",
        recipientUserId: USER.recipient,
        resourceType: ManagementResourceType.release,
        resourceIds: [RELEASE_IDS[0]],
        status: ManagementTransferStatus.declined,
        expiresAt: future,
      },
      {
        suffix: "cancelled",
        recipientUserId: USER.recipient,
        resourceType: ManagementResourceType.release,
        resourceIds: [RELEASE_IDS[1]],
        status: ManagementTransferStatus.cancelled,
        expiresAt: future,
      },
      {
        suffix: "other_recipient",
        recipientUserId: USER.otherRecipient,
        resourceType: ManagementResourceType.artist_profile,
        resourceIds: [ARTIST_ID],
        status: ManagementTransferStatus.pending,
        expiresAt: future,
      },
    ];
    for (const fixture of transferFixtures) {
      await prisma.managementTransfer.create({
        data: {
          id: `${P}transfer_${fixture.suffix}`,
          proposerUserId: USER.owner,
          recipientUserId: fixture.recipientUserId,
          resourceType: fixture.resourceType,
          resourceIds: fixture.resourceIds,
          status: fixture.status,
          expiresAt: fixture.expiresAt,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.managementTransfer.deleteMany({ where: { id: { in: TRANSFER_IDS } } });
    await prisma.managementGrant.deleteMany({ where: { id: { in: GRANT_IDS } } });
    await prisma.release.deleteMany({ where: { id: { in: RELEASE_IDS } } });
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(USER) } } });
  });

  it("returns only this recipient's pending unexpired invitations and safe resource DTOs", async () => {
    const result = await service.getPendingInvitations(USER.recipient);
    result.grants.sort((left, right) => left.id.localeCompare(right.id));
    result.transfers.sort((left, right) => left.id.localeCompare(right.id));

    expect(Object.keys(result).sort()).toEqual(["grants", "transfers"]);
    expect(result.grants).toEqual([
      {
        id: `${P}grant_artist_pending`,
        artistId: ARTIST_ID,
        releaseId: null,
        resourceName: "Pending invite artist",
        scopes: [ManagementScope.PROFILE_EDIT],
        expiresAt: null,
      },
      {
        id: `${P}grant_release_pending`,
        artistId: null,
        releaseId: RELEASE_IDS[0],
        resourceName: "Pending invite release 1",
        scopes: [ManagementScope.CATALOG_READ, ManagementScope.TRACK_AUDIO],
        expiresAt: future,
      },
    ]);
    expect(result.transfers).toEqual([
      {
        id: `${P}transfer_artist_pending`,
        resourceType: ManagementResourceType.artist_profile,
        resources: [{ id: ARTIST_ID, name: "Pending invite artist" }],
        expiresAt: null,
      },
      {
        id: `${P}transfer_releases_pending`,
        resourceType: ManagementResourceType.release,
        resources: [
          { id: RELEASE_IDS[0], name: "Pending invite release 1" },
          { id: RELEASE_IDS[1], name: "Pending invite release 2" },
        ],
        expiresAt: future,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(USER.owner);
    expect(JSON.stringify(result)).not.toContain(`${USER.owner}@test.resonate`);
    expect(JSON.stringify(result)).not.toContain("proposer");
  });
});
