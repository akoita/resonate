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
});
