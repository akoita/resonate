/**
 * Shows "I would come" counts in artist analytics (#2686), against real Postgres.
 */
import { prisma } from "../db/prisma";
import { PrismaArtistShowInterestSource } from "../modules/analytics/analytics_show_interest";
import { ShowsService } from "../modules/shows/shows.service";
import { ShowInterestService } from "../modules/shows/show-interest.service";

const TEST_PREFIX = `anshowint_${Date.now()}_`;
const artistUser = `${TEST_PREFIX}artist`;
const artistId = `${TEST_PREFIX}artistprofile`;
const otherArtistId = `${TEST_PREFIX}otherprofile`;
const fans = Array.from({ length: 6 }, (_, n) => `${TEST_PREFIX}fan${n}`);
const DAY = 24 * 60 * 60 * 1000;

describe("artist analytics show interest (#2686)", () => {
  const source = new PrismaArtistShowInterestSource();
  const interest = new ShowInterestService(new ShowsService());
  const campaignIds: string[] = [];
  const previousMinimum = process.env.DISCOVERY_MIN_AUDIENCE;

  async function seedCampaign(owner: string, mode: "interest" | "pledge", n: number) {
    const campaign = await prisma.showCampaign.create({
      data: {
        slug: `${TEST_PREFIX}c${n}`,
        artistId: owner,
        artistDisplayName: "Interest Artist",
        title: `Show ${n}`,
        city: "Lyon",
        country: "FR",
        deadline: new Date(Date.now() + 30 * DAY),
        goalAmountUnits: "1000000",
        chainId: 31337,
        status: "draft",
        campaignLevel: "active_escrow_campaign",
        mode,
      },
    });
    campaignIds.push(campaign.id);
    return campaign;
  }

  beforeAll(async () => {
    process.env.DISCOVERY_MIN_AUDIENCE = "3";
    for (const id of [artistUser, ...fans]) {
      await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    }
    await prisma.artist.create({ data: { id: artistId, userId: artistUser, displayName: `${TEST_PREFIX}A` } });
    await prisma.artist.create({ data: { id: otherArtistId, displayName: `${TEST_PREFIX}B` } });
  });

  afterAll(async () => {
    if (previousMinimum === undefined) delete process.env.DISCOVERY_MIN_AUDIENCE;
    else process.env.DISCOVERY_MIN_AUDIENCE = previousMinimum;
    await prisma.showInterest.deleteMany({ where: { campaignId: { in: campaignIds } } });
    await prisma.showCampaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.artist.deleteMany({ where: { id: { in: [artistId, otherArtistId] } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  it("says none when the artist has no interest campaign", async () => {
    await seedCampaign(artistId, "pledge", 1);
    await expect(source.getArtistShowInterest(artistId)).resolves.toEqual(
      expect.objectContaining({ status: "none", campaigns: [] }),
    );
  });

  it("matches the campaign page summary and never names a city below the minimum group", async () => {
    const campaign = await seedCampaign(artistId, "interest", 2);
    await seedCampaign(otherArtistId, "interest", 3);
    const cities = ["Lyon", "lyon", "LYON", "Paris", "Paris", null];
    for (const [index, city] of cities.entries()) {
      await interest.declare({ userId: fans[index] }, campaign.id, {
        ...(city ? { city } : {}),
        notifyWhenOpen: index === 0,
      });
    }

    const result = await source.getArtistShowInterest(artistId);
    expect(result.status).toBe("ready");
    expect(result.minimumGroup).toBe(3);
    expect(result.campaigns.map((c) => c.campaignId)).toEqual([campaign.id]);
    const [entry] = result.campaigns;
    expect(entry.interest).toEqual(
      expect.objectContaining({ total: 6, cities: [{ city: "Lyon", count: 3 }], otherCount: 3, notifyCount: 1 }),
    );
    expect(JSON.stringify(entry)).not.toContain("Paris");

    const pageSummary = await interest.summary({ userId: artistUser }, campaign.id);
    expect(entry.interest).toEqual(pageSummary);
  });
});
