import { prisma } from "../db/prisma";
import { CommunityService } from "../modules/community/community.service";

const TEST_PREFIX = `community_profile_${Date.now()}_`;
const userId = `${TEST_PREFIX}listener`;
const walletAddress = "0x" + "1".repeat(40);
const campaignId = `${TEST_PREFIX}campaign`;
const privateBadgeOnlyCampaignId = `${TEST_PREFIX}private_badge_only_campaign`;

const eventBus = { publish: jest.fn() };
const service = new CommunityService(eventBus as any);

describe("CommunityService public profile integration", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `${userId}@test.resonate` },
    });
    await prisma.wallet.create({
      data: {
        userId,
        address: walletAddress,
        chainId: 84532,
      },
    });
    await prisma.communityProfile.create({
      data: {
        userId,
        displayName: "Campaign Supporter",
        profileVisibility: "public",
      },
    });
    await prisma.communityVisibilitySettings.create({
      data: {
        userId,
        showCampaignSupport: true,
      },
    });
    await prisma.showCampaign.createMany({
      data: [
        {
          id: campaignId,
          slug: `${TEST_PREFIX}campaign`,
          artistDisplayName: "Support Artist",
          title: "Support Artist in Paris",
          city: "Paris",
          country: "FR",
          deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          goalAmountUnits: "1000000",
          chainId: 84532,
          status: "active",
        },
        {
          id: privateBadgeOnlyCampaignId,
          slug: `${TEST_PREFIX}badge-only`,
          artistDisplayName: "Hidden Artist",
          title: "Hidden Artist in Lyon",
          city: "Lyon",
          country: "FR",
          deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          goalAmountUnits: "1000000",
          chainId: 84532,
          status: "active",
        },
      ],
    });
    await prisma.showPledge.create({
      data: {
        campaignId,
        walletAddress: walletAddress.toUpperCase(),
        amountUnits: "250000",
        chainId: 84532,
        status: "confirmed",
        confirmationStatus: "confirmed",
        confirmedAt: new Date("2026-05-31T10:00:00.000Z"),
      },
    });
    await prisma.communityBadge.create({
      data: {
        userId,
        badgeType: "supporter",
        sourceType: "show_campaign",
        sourceId: privateBadgeOnlyCampaignId,
        visibility: "private",
      },
    });
  });

  afterAll(async () => {
    await prisma.communityBadge.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.showPledge.deleteMany({
      where: {
        OR: [
          { campaignId: { startsWith: TEST_PREFIX } },
          { walletAddress: { equals: walletAddress, mode: "insensitive" } },
        ],
      },
    });
    await prisma.showCampaign.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.communityVisibilitySettings.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.communityProfile.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.wallet.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  it("shows opted-in campaign support from trusted pledges without badge sync", async () => {
    const profile = await service.getPublicProfile(userId);

    expect(profile.showcase.campaignSupportVisible).toBe(true);
    expect(profile.showcase.campaignSupport).toEqual([
      expect.objectContaining({
        campaignId,
        campaignTitle: "Support Artist in Paris",
        artistDisplayName: "Support Artist",
        city: "Paris",
        country: "FR",
      }),
    ]);
    expect(profile.showcase.campaignSupport).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ campaignId: privateBadgeOnlyCampaignId }),
      ]),
    );
  });

  it("hides campaign support when the listener opts out", async () => {
    await prisma.communityVisibilitySettings.update({
      where: { userId },
      data: { showCampaignSupport: false },
    });

    const profile = await service.getPublicProfile(userId);

    expect(profile.showcase.campaignSupportVisible).toBe(false);
    expect(profile.showcase.campaignSupport).toEqual([]);
    expect(profile.redactions).toContain("campaign_support_hidden");
  });
});
