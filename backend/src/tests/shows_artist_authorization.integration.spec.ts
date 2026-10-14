/**
 * #2128: artist-side Shows routes authorize by artist-profile ownership in the
 * service, not by a JWT role. No `artist` JWT role is ever issued (#1388), so a
 * real artist signs in as `listener`. These tests pin the service-side checks
 * that the HTTP layer now relies on, with real Postgres.
 */
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { ShowsService } from "../modules/shows/shows.service";

const TEST_PREFIX = `shows_artist_authz_${Date.now()}_`;
const ownerUserId = `${TEST_PREFIX}owner_user`;
const ownerArtistId = `${TEST_PREFIX}owner_artist`;
const otherOwnerUserId = `${TEST_PREFIX}other_owner_user`;
const otherOwnerArtistId = `${TEST_PREFIX}other_owner_artist`;
const strangerUserId = `${TEST_PREFIX}stranger_user`;
const releaseId = `${TEST_PREFIX}release`;
const ownerDisplayName = `${TEST_PREFIX}Owner Artist`;
const ownerWallet = "0x" + "3".repeat(40);

const service = new ShowsService();
const owner = { userId: ownerUserId, role: "listener" };
const otherOwner = { userId: otherOwnerUserId, role: "listener" };
const stranger = { userId: strangerUserId, role: "listener" };

function futureIso(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function draftInput(overrides: Record<string, unknown> = {}) {
  return {
    artistId: ownerArtistId,
    artistDisplayName: ownerDisplayName,
    city: "Lyon",
    country: "FR",
    deadline: futureIso(30),
    goalAmountUnits: "2500000",
    ...overrides,
  };
}

describe("Shows artist-side authorization without an artist JWT role (integration)", () => {
  jest.setTimeout(60_000);

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerUserId, email: `${ownerUserId}@test.resonate` },
        { id: otherOwnerUserId, email: `${otherOwnerUserId}@test.resonate` },
        { id: strangerUserId, email: `${strangerUserId}@test.resonate` },
      ],
    });
    await prisma.artist.createMany({
      data: [
        { id: ownerArtistId, userId: ownerUserId, displayName: ownerDisplayName, payoutAddress: ownerWallet },
        {
          id: otherOwnerArtistId,
          userId: otherOwnerUserId,
          displayName: `${TEST_PREFIX}Other Owner Artist`,
          payoutAddress: "0x" + "4".repeat(40),
        },
      ],
    });
    // #1498: self-serve campaign creation runs the payout-eligibility gate when
    // binding the owner's payout wallet as beneficiary; satisfy it so these
    // tests exercise authorization, not the gate.
    await prisma.curatorReputation.create({
      data: {
        walletAddress: ownerUserId.toLowerCase(),
        humanVerificationStatus: "human_verified",
        verifiedHuman: true,
        humanVerifiedAt: new Date(),
      },
    });
    await prisma.release.create({
      data: {
        id: releaseId,
        artistId: ownerArtistId,
        title: `${TEST_PREFIX}Ready Release`,
        status: "ready",
        primaryArtist: ownerDisplayName,
        rightsRoute: "STANDARD_ESCROW",
      },
    });
  });

  afterAll(async () => {
    await prisma.showCampaignEvent.deleteMany({ where: { campaign: { artistDisplayName: { startsWith: TEST_PREFIX } } } }).catch(() => {});
    await prisma.showCampaignTier.deleteMany({ where: { campaign: { artistDisplayName: { startsWith: TEST_PREFIX } } } }).catch(() => {});
    await prisma.showCampaign.deleteMany({ where: { artistDisplayName: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: releaseId } }).catch(() => {});
    await prisma.curatorReputation.deleteMany({ where: { walletAddress: ownerUserId.toLowerCase() } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: { in: [ownerArtistId, otherOwnerArtistId] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, otherOwnerUserId, strangerUserId] } } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("lets a listener-role artist owner create, update, and manage their own draft", async () => {
    const draft = await service.createDraftCampaign(owner, draftInput());
    expect(draft).toMatchObject({ artistId: ownerArtistId, status: "draft", beneficiaryAddress: ownerWallet });

    const updated = await service.updateDraftCampaign(owner, draft.id, draftInput({ city: "Marseille" }));
    expect(updated).toMatchObject({ id: draft.id, city: "Marseille" });

    await expect(service.getManagedCampaign(owner, draft.id)).resolves.toMatchObject({ id: draft.id });
    await expect(service.requestAuthority(owner, draft.id, {})).resolves.toMatchObject({
      id: draft.id,
      artistAuthorityStatus: "artist_acknowledged",
    });
  });

  it("refuses draft creation to a listener without an artist profile", async () => {
    await expect(service.createDraftCampaign(stranger, draftInput()))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.createDraftCampaign(stranger, draftInput({ artistId: undefined })))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses draft creation for another artist's profile", async () => {
    await expect(service.createDraftCampaign(otherOwner, draftInput()))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses every campaign mutation and the managed read to non-owners", async () => {
    const draft = await service.createDraftCampaign(owner, draftInput({ city: "Nantes" }));

    for (const actor of [stranger, otherOwner]) {
      await expect(service.updateDraftCampaign(actor, draft.id, draftInput({ city: "Nice" })))
        .rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.getManagedCampaign(actor, draft.id)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.requestAuthority(actor, draft.id, {})).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.activateCampaign(actor, draft.id, {})).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.cancelCampaign(actor, draft.id, {})).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.reorderCampaignVisuals(actor, draft.id, { visualIds: [] }))
        .rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.deleteCampaignVisual(actor, draft.id, "hero")).rejects.toBeInstanceOf(ForbiddenException);
    }

    const stored = await prisma.showCampaign.findUniqueOrThrow({ where: { id: draft.id } });
    expect(stored).toMatchObject({ city: "Nantes", status: "draft", artistAuthorityStatus: "none" });
  });

  it("keeps authority approval operator-only, even for the listener-role owner", async () => {
    const draft = await service.createDraftCampaign(owner, draftInput({ city: "Lille" }));

    await expect(service.approveAuthority(owner, draft.id, { authorityStatus: "artist_authorized" }))
      .rejects.toBeInstanceOf(ForbiddenException);
    // A self-serve draft cannot pre-authorize itself either (#946).
    await expect(service.createDraftCampaign(owner, draftInput({ artistAuthorityStatus: "artist_authorized" })))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.requestAuthority(owner, draft.id, { requestedAuthorityStatus: "artist_authorized" }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
