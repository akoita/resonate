import { resolve } from "path";
import { prisma } from "../db/prisma";
import {
  applyShowCampaignFixtures,
  expectedTierCount,
  expectedVisualCount,
  SHOW_CAMPAIGN_FIXTURES,
} from "../fixtures/show_campaigns";
import { StorageProvider, type StorageResult } from "../modules/storage/storage_provider";

const TEST_PREFIX = `show_fixtures_${Date.now()}_`;

class FixtureStorageProvider extends StorageProvider {
  async upload(_data: Buffer, filename: string, _mimeType: string): Promise<StorageResult> {
    return { uri: `fixture://${filename}`, provider: "local" };
  }

  async download(): Promise<Buffer | null> {
    return null;
  }

  async delete(): Promise<void> {}
}

describe("sample show campaign fixture creation", () => {
  const assetDirectory = resolve(process.cwd(), "fixtures", "show-campaigns", "assets");
  const storage = new FixtureStorageProvider();

  beforeAll(async () => {
    await prisma.showCampaign.create({
      data: {
        id: `${TEST_PREFIX}campaign`,
        slug: `${TEST_PREFIX}campaign`,
        artistDisplayName: "Unrelated Artist",
        title: "Unrelated campaign",
        city: "Test City",
        country: "ZZ",
        deadline: new Date(Date.now() + 86_400_000),
        goalAmountUnits: "1000000",
        chainId: 31337,
      },
    });
  });

  afterAll(async () => {
    await prisma.showCampaign.deleteMany({
      where: { id: { in: SHOW_CAMPAIGN_FIXTURES.map((fixture) => fixture.campaign.id) } },
    });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.communityRoom.deleteMany({ where: { artistId: { in: SHOW_CAMPAIGN_FIXTURES.map((fixture) => fixture.artist.id) } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({
      where: { id: { in: SHOW_CAMPAIGN_FIXTURES.map((fixture) => fixture.artist.id) } },
    });
    await prisma.showCampaign.deleteMany({ where: { id: `${TEST_PREFIX}campaign` } });
  });

  it("is repeatable and leaves unrelated campaigns untouched", async () => {
    const now = new Date("2026-06-21T12:00:00.000Z");
    const options = { assetDirectory, chainId: 31337, now };

    await applyShowCampaignFixtures(prisma, storage, options);
    await applyShowCampaignFixtures(prisma, storage, options);

    const fixtureIds = SHOW_CAMPAIGN_FIXTURES.map((fixture) => fixture.campaign.id);
    const campaigns = await prisma.showCampaign.findMany({
      where: { id: { in: fixtureIds } },
      include: { tiers: true, visuals: true, artist: true },
    });

    expect(campaigns).toHaveLength(SHOW_CAMPAIGN_FIXTURES.length);
    expect(campaigns.reduce((count, campaign) => count + campaign.tiers.length, 0)).toBe(expectedTierCount());
    expect(campaigns.reduce((count, campaign) => count + campaign.visuals.length, 0)).toBe(expectedVisualCount());
    expect(campaigns.every((campaign) => campaign.visuals.some((visual) => visual.role === "gallery"))).toBe(true);
    expect(campaigns.every((campaign) => campaign.artist?.profileType === "fixture")).toBe(true);
    expect(campaigns.every((campaign) => (campaign.metadata as { fictionalCampaign?: boolean }).fictionalCampaign)).toBe(true);
    expect(await prisma.showCampaign.count({ where: { id: `${TEST_PREFIX}campaign` } })).toBe(1);
  });

  it("links a sample campaign to the real catalog artist and never overwrites that profile", async () => {
    const fixture = SHOW_CAMPAIGN_FIXTURES.find((entry) => entry.artist.id === "sample-artist-tiken-jah-fakoly")!;
    const realArtistId = `${TEST_PREFIX}real-artist`;
    await prisma.artist.create({
      data: { id: realArtistId, displayName: fixture.artist.displayName, profileType: "artist", summary: "Real bio" },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: realArtistId,
        title: "Coup de Geule",
        status: "published",
        primaryArtist: fixture.artist.displayName,
        artistCredits: {
          create: { artistId: realArtistId, role: "main", displayName: fixture.artist.displayName.toUpperCase(), identityStatus: "selected" },
        },
      },
    });

    const options = { assetDirectory, chainId: 31337, now: new Date("2026-06-21T12:00:00.000Z") };
    await applyShowCampaignFixtures(prisma, storage, options);
    await applyShowCampaignFixtures(prisma, storage, options);

    const campaign = await prisma.showCampaign.findUniqueOrThrow({ where: { id: fixture.campaign.id } });
    expect(campaign.artistId).toBe(realArtistId);
    const realArtist = await prisma.artist.findUniqueOrThrow({ where: { id: realArtistId } });
    expect(realArtist).toMatchObject({ summary: "Real bio", imageUrl: null, profileType: "artist" });
    // The stand-in created by the previous test's seed is gone.
    expect(await prisma.artist.count({ where: { id: fixture.artist.id } })).toBe(0);

    // Artists the catalog does not have keep their fixture stand-in.
    const other = await prisma.showCampaign.findUniqueOrThrow({
      where: { id: SHOW_CAMPAIGN_FIXTURES.find((entry) => entry !== fixture)!.campaign.id },
      include: { artist: true },
    });
    expect(other.artist?.profileType).toBe("fixture");
  });

  it("links a name-only catalog artist to its catalog page, never to the uploader, and keeps the sample bio", async () => {
    const fixture = SHOW_CAMPAIGN_FIXTURES.find((entry) => entry.artist.id === "sample-artist-aya-nakamura")!;
    const uploaderId = `${TEST_PREFIX}uploader`;
    await prisma.artist.create({ data: { id: uploaderId, displayName: "Some Uploader", profileType: "artist" } });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}name-only-release`,
        artistId: uploaderId,
        title: "NAKAMURA",
        status: "published",
        primaryArtist: fixture.artist.displayName,
        // A credit that names the artist but points at the uploader's profile.
        artistCredits: {
          create: { artistId: uploaderId, role: "main", displayName: fixture.artist.displayName, identityStatus: "inferred" },
        },
      },
    });

    await applyShowCampaignFixtures(prisma, storage, { assetDirectory, chainId: 31337, now: new Date("2026-06-21T12:00:00.000Z") });

    const campaign = await prisma.showCampaign.findUniqueOrThrow({ where: { id: fixture.campaign.id } });
    expect(campaign.artistId).toBeNull();
    expect(campaign.artistDisplayName).toBe(fixture.artist.displayName);
    expect(await prisma.artist.count({ where: { id: fixture.artist.id } })).toBe(0);
    const uploader = await prisma.artist.findUniqueOrThrow({ where: { id: uploaderId } });
    expect(uploader).toMatchObject({ displayName: "Some Uploader", summary: null, imageUrl: null });
    const presentation = (campaign.metadata as { artistPresentation?: { summary?: string } }).artistPresentation;
    expect(presentation?.summary).toBe(fixture.artist.summary);
  });

  it("removes a visited stand-in whose auto-created rooms are untouched, and keeps one with real room activity", async () => {
    const [visited, active] = ["sample-artist-sennarin", "sample-artist-felicia-farerre"].map(
      (id) => SHOW_CAMPAIGN_FIXTURES.find((entry) => entry.artist.id === id)!,
    );
    const options = { assetDirectory, chainId: 31337, now: new Date("2026-06-21T12:00:00.000Z") };
    // Seed while the catalog lacks both artists, so both stand-ins exist.
    await applyShowCampaignFixtures(prisma, storage, options);

    const room = (artistId: string, roomType: string) => prisma.communityRoom.create({
      data: { roomType, ownerType: "artist", ownerId: artistId, artistId, title: `${roomType} room` },
    });
    // Opening a Community tab auto-creates these two rooms.
    await room(visited.artist.id, "artist_public");
    await room(visited.artist.id, "artist_holder");
    const activeRoom = await room(active.artist.id, "artist_public");
    const author = await prisma.user.create({ data: { id: `${TEST_PREFIX}author`, email: `${TEST_PREFIX}author@example.test` } });
    await prisma.communityMessage.create({ data: { roomId: activeRoom.id, authorId: author.id, body: "hello" } });

    // Both artists now exist in the catalog by name only.
    const uploaderId = `${TEST_PREFIX}uploader-2`;
    await prisma.artist.create({ data: { id: uploaderId, displayName: "Another Uploader", profileType: "artist" } });
    for (const fixture of [visited, active]) {
      await prisma.release.create({
        data: {
          id: `${TEST_PREFIX}release-${fixture.artist.id}`,
          artistId: uploaderId,
          title: `${fixture.artist.displayName} single`,
          status: "published",
          primaryArtist: fixture.artist.displayName,
        },
      });
    }

    await applyShowCampaignFixtures(prisma, storage, options);

    expect(await prisma.artist.count({ where: { id: visited.artist.id } })).toBe(0);
    expect(await prisma.communityRoom.count({ where: { artistId: visited.artist.id } })).toBe(0);
    // Real activity is never deleted: the stand-in and its room stay.
    expect(await prisma.artist.count({ where: { id: active.artist.id } })).toBe(1);
    expect(await prisma.communityMessage.count({ where: { roomId: activeRoom.id } })).toBe(1);
    // Either way the campaigns point at the catalog, not at a stand-in.
    const campaigns = await prisma.showCampaign.findMany({
      where: { id: { in: [visited.campaign.id, active.campaign.id] } },
      select: { artistId: true },
    });
    expect(campaigns.every((campaign) => campaign.artistId === null)).toBe(true);
  });

  it("re-points the campaign's own rooms so a re-linked stand-in can be removed", async () => {
    const fixture = SHOW_CAMPAIGN_FIXTURES.find((entry) => entry.artist.id === "sample-artist-leona-lewis")!;
    const options = { assetDirectory, chainId: 31337, now: new Date("2026-06-21T12:00:00.000Z") };
    await applyShowCampaignFixtures(prisma, storage, options);
    // A campaign supporter room created while the campaign pointed at the stand-in.
    await prisma.communityRoom.create({
      data: {
        roomType: "show_campaign_supporter",
        ownerType: "show_campaign",
        ownerId: fixture.campaign.id,
        artistId: fixture.artist.id,
        title: "Supporters",
      },
    });

    const uploaderId = `${TEST_PREFIX}uploader-3`;
    await prisma.artist.create({ data: { id: uploaderId, displayName: "Third Uploader", profileType: "artist" } });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release-leona`,
        artistId: uploaderId,
        title: "Leona single",
        status: "published",
        primaryArtist: fixture.artist.displayName,
      },
    });

    await applyShowCampaignFixtures(prisma, storage, options);

    expect(await prisma.artist.count({ where: { id: fixture.artist.id } })).toBe(0);
    const room = await prisma.communityRoom.findFirstOrThrow({
      where: { ownerType: "show_campaign", ownerId: fixture.campaign.id },
    });
    expect(room.artistId).toBeNull();
    await prisma.communityRoom.deleteMany({ where: { ownerType: "show_campaign", ownerId: fixture.campaign.id } });
  });
});
