import { BadRequestException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { ShowsService } from "../modules/shows/shows.service";

const TEST_PREFIX = `show_source_release_${Date.now()}_`;
const OPERATOR_ID = `${TEST_PREFIX}operator`;
const ARTIST_A_ID = `${TEST_PREFIX}artist_a`;
const ARTIST_B_ID = `${TEST_PREFIX}artist_b`;
const OWNER_ID = `${TEST_PREFIX}owner`;
const GOOD_RELEASE_ID = `${TEST_PREFIX}good_release`;
const COLLAB_RELEASE_ID = `${TEST_PREFIX}collab_release`;
const AMBIGUOUS_RELEASE_ID = `${TEST_PREFIX}ambiguous_release`;
const FOREIGN_RELEASE_ID = `${TEST_PREFIX}foreign_release`;
const WITHDRAWN_RELEASE_ID = `${TEST_PREFIX}withdrawn_release`;
const PRIVATE_RELEASE_ID = `${TEST_PREFIX}private_release`;

const service = new ShowsService();
const operator = { userId: OPERATOR_ID, role: "operator" as const };
const futureDeadline = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

function campaignInput(artistId = ARTIST_A_ID, artistDisplayName = `${TEST_PREFIX}Artist A`, sourceReleaseId?: unknown) {
  return {
    artistId,
    artistDisplayName,
    title: `${TEST_PREFIX}Draft ${Math.random().toString(36).slice(2)}`,
    city: "Paris",
    country: "FR",
    deadline: futureDeadline(),
    goalAmountUnits: "2500000",
    ...(sourceReleaseId === undefined ? {} : { sourceReleaseId }),
  };
}

describe("ShowsService source release association (integration)", () => {
  jest.setTimeout(60_000);

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: OPERATOR_ID, email: `${OPERATOR_ID}@test.resonate` },
        { id: OWNER_ID, email: `${OWNER_ID}@test.resonate` },
      ],
    });
    await prisma.artist.createMany({
      data: [
        { id: ARTIST_A_ID, displayName: `${TEST_PREFIX}Artist A`, profileType: "public_artist", claimStatus: "unclaimed" },
        { id: ARTIST_B_ID, displayName: `${TEST_PREFIX}Artist B`, profileType: "public_artist", claimStatus: "unclaimed" },
        { id: OWNER_ID, userId: OWNER_ID, displayName: `${TEST_PREFIX}Release Owner` },
      ],
    });
    await prisma.release.createMany({
      data: [
        { id: GOOD_RELEASE_ID, artistId: ARTIST_A_ID, title: "Artist A release", status: "ready", primaryArtist: `${TEST_PREFIX}Artist A` },
        { id: COLLAB_RELEASE_ID, artistId: OWNER_ID, title: "Collaboration", status: "published", primaryArtist: "Owner and collaborators" },
        { id: AMBIGUOUS_RELEASE_ID, artistId: OWNER_ID, title: "Ambiguous credit", status: "ready", primaryArtist: "Unrelated primary artist" },
        { id: FOREIGN_RELEASE_ID, artistId: ARTIST_B_ID, title: "Artist B release", status: "ready", primaryArtist: `${TEST_PREFIX}Artist B` },
        { id: WITHDRAWN_RELEASE_ID, artistId: ARTIST_A_ID, title: "Withdrawn release", status: "ready", primaryArtist: `${TEST_PREFIX}Artist A`, withdrawnAt: new Date() },
        { id: PRIVATE_RELEASE_ID, artistId: ARTIST_A_ID, title: "Processing release", status: "processing", primaryArtist: `${TEST_PREFIX}Artist A` },
      ],
    });
    await prisma.releaseArtistCredit.createMany({
      data: [
        {
          releaseId: COLLAB_RELEASE_ID,
          artistId: ARTIST_A_ID,
          role: "main",
          displayName: `${TEST_PREFIX}Artist A`,
          identityStatus: "selected",
          sortOrder: 0,
        },
        {
          releaseId: COLLAB_RELEASE_ID,
          artistId: ARTIST_B_ID,
          role: "primary",
          displayName: `${TEST_PREFIX}Artist B`,
          identityStatus: "reviewed",
          sortOrder: 1,
        },
        {
          releaseId: AMBIGUOUS_RELEASE_ID,
          artistId: ARTIST_A_ID,
          role: "main",
          displayName: `${TEST_PREFIX}Artist A`,
          identityStatus: "ambiguous",
          sortOrder: 0,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.showCampaignEvent.deleteMany({ where: { campaign: { artistDisplayName: { startsWith: TEST_PREFIX } } } }).catch(() => {});
    await prisma.showCampaignTier.deleteMany({ where: { campaign: { artistDisplayName: { startsWith: TEST_PREFIX } } } }).catch(() => {});
    await prisma.showCampaign.deleteMany({ where: { artistDisplayName: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { in: [GOOD_RELEASE_ID, COLLAB_RELEASE_ID, AMBIGUOUS_RELEASE_ID, FOREIGN_RELEASE_ID, WITHDRAWN_RELEASE_ID, PRIVATE_RELEASE_ID] } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: { in: [ARTIST_A_ID, ARTIST_B_ID, OWNER_ID] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [OPERATOR_ID, OWNER_ID] } } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("accepts a canonical collaborator and returns the association in public and managed reads", async () => {
    const draft = await service.createDraftCampaign(operator, campaignInput(ARTIST_B_ID, `${TEST_PREFIX}Artist B`, COLLAB_RELEASE_ID));

    expect(draft.sourceReleaseId).toBe(COLLAB_RELEASE_ID);
    expect(await service.getCampaign(draft.slug)).toMatchObject({ sourceReleaseId: COLLAB_RELEASE_ID });
    expect(await service.getManagedCampaign(operator, draft.id)).toMatchObject({ sourceReleaseId: COLLAB_RELEASE_ID });
  });

  it("preserves an omitted association on update and clears it only for explicit null", async () => {
    const draft = await service.createDraftCampaign(operator, campaignInput(ARTIST_A_ID, `${TEST_PREFIX}Artist A`, GOOD_RELEASE_ID));
    const omitted = await service.updateDraftCampaign(operator, draft.id, campaignInput(ARTIST_A_ID, `${TEST_PREFIX}Artist A`));
    expect(omitted.sourceReleaseId).toBe(GOOD_RELEASE_ID);

    const cleared = await service.updateDraftCampaign(operator, draft.id, campaignInput(ARTIST_A_ID, `${TEST_PREFIX}Artist A`, null));
    expect(cleared.sourceReleaseId).toBeNull();
  });

  it("rejects source releases that are missing, foreign, ambiguous, withdrawn, or not public", async () => {
    for (const sourceReleaseId of [
      `${TEST_PREFIX}missing`,
      FOREIGN_RELEASE_ID,
      AMBIGUOUS_RELEASE_ID,
      WITHDRAWN_RELEASE_ID,
      PRIVATE_RELEASE_ID,
    ]) {
      await expect(service.createDraftCampaign(operator, campaignInput(ARTIST_A_ID, `${TEST_PREFIX}Artist A`, sourceReleaseId)))
        .rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it("rejects malformed values and an omitted-source update after changing artists", async () => {
    for (const malformed of ["", "   ", 7, {}, []]) {
      await expect(service.createDraftCampaign(operator, campaignInput(ARTIST_A_ID, `${TEST_PREFIX}Artist A`, malformed)))
        .rejects.toBeInstanceOf(BadRequestException);
    }

    const draft = await service.createDraftCampaign(operator, campaignInput(ARTIST_A_ID, `${TEST_PREFIX}Artist A`, GOOD_RELEASE_ID));
    await expect(service.updateDraftCampaign(
      operator,
      draft.id,
      campaignInput(ARTIST_B_ID, `${TEST_PREFIX}Artist B`),
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it("keeps the existing draft-only edit guard and clears the FK on release deletion", async () => {
    const draft = await service.createDraftCampaign(operator, campaignInput(ARTIST_A_ID, `${TEST_PREFIX}Artist A`, GOOD_RELEASE_ID));
    await prisma.showCampaign.update({ where: { id: draft.id }, data: { status: "active" } });
    await expect(service.updateDraftCampaign(operator, draft.id, campaignInput(ARTIST_A_ID, `${TEST_PREFIX}Artist A`)))
      .rejects.toThrow("Only draft campaigns can be edited");

    await prisma.release.delete({ where: { id: GOOD_RELEASE_ID } });
    const stored = await prisma.showCampaign.findUniqueOrThrow({ where: { id: draft.id } });
    expect(stored.sourceReleaseId).toBeNull();
  });
});
