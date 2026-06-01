import { prisma } from "../db/prisma";
import { CommunityEligibilityService } from "../modules/community/community_eligibility.service";

const TEST_PREFIX = `community_eligibility_${Date.now()}_`;
const userId = `${TEST_PREFIX}listener`;
const artistUserId = `${TEST_PREFIX}artist_user`;
const artistId = `${TEST_PREFIX}artist`;
const releaseId = `${TEST_PREFIX}release`;
const trackId = `${TEST_PREFIX}track`;
const stemId = `${TEST_PREFIX}stem`;
const walletAddress = "0x" + "a".repeat(40);
const artistWalletAddress = "0x" + "b".repeat(40);

const eventBus = { publish: jest.fn() };
const service = new CommunityEligibilityService(eventBus as any);

describe("CommunityEligibilityService integration", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: userId, email: `${userId}@test.resonate` },
        { id: artistUserId, email: `${artistUserId}@test.resonate` },
      ],
    });
    await prisma.wallet.create({
      data: {
        userId,
        address: walletAddress,
        chainId: 84532,
      },
    });
    await prisma.communityVisibilitySettings.create({
      data: {
        userId,
        showWalletAddress: false,
        showOwnedItems: false,
      },
    });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId: artistUserId,
        displayName: "Community Artist",
        payoutAddress: artistWalletAddress,
      },
    });
    await prisma.release.create({
      data: {
        id: releaseId,
        artistId,
        title: "Community Release",
        status: "published",
      },
    });
    await prisma.track.create({
      data: {
        id: trackId,
        releaseId,
        title: "Community Track",
      },
    });
    await prisma.stem.create({
      data: {
        id: stemId,
        trackId,
        type: "vocals",
        uri: `ipfs://${TEST_PREFIX}stem`,
      },
    });
    const listing = await prisma.stemListing.create({
      data: {
        listingId: 99801n,
        stemId,
        tokenId: 99801n,
        chainId: 84532,
        contractAddress: "0x" + "c".repeat(40),
        sellerAddress: artistWalletAddress,
        pricePerUnit: "1000000",
        amount: 1n,
        paymentToken: "0x0000000000000000000000000000000000000000",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        transactionHash: "0x" + "d".repeat(64),
        blockNumber: 99801n,
        listedAt: new Date(),
      },
    });
    await prisma.stemPurchase.create({
      data: {
        listingId: listing.id,
        buyerAddress: walletAddress.toUpperCase(),
        amount: 1n,
        totalPaid: "1000000",
        royaltyPaid: "50000",
        protocolFeePaid: "10000",
        sellerReceived: "940000",
        transactionHash: "0x" + "e".repeat(64),
        blockNumber: 99802n,
        purchasedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.communityBenefitRedemption.deleteMany({
      where: { userId: { startsWith: TEST_PREFIX } },
    });
    await prisma.communityBenefitRule.deleteMany({
      where: { OR: [{ artistId }, { title: { startsWith: TEST_PREFIX } }] },
    });
    await prisma.communityRole.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.communityBadge.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.showPledge.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.showCampaignTier.deleteMany({ where: { campaignId: { startsWith: TEST_PREFIX } } });
    await prisma.showCampaign.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.stemPurchase.deleteMany({ where: { buyerAddress: { equals: walletAddress, mode: "insensitive" } } });
    await prisma.stemListing.deleteMany({ where: { stemId } });
    await prisma.stem.deleteMany({ where: { id: stemId } });
    await prisma.track.deleteMany({ where: { id: trackId } });
    await prisma.release.deleteMany({ where: { id: releaseId } });
    await prisma.artist.deleteMany({ where: { id: artistId } });
    await prisma.communityVisibilitySettings.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.communityProfile.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.wallet.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  beforeEach(() => eventBus.publish.mockClear());

  it("unlocks benefits from private stem ownership without exposing wallet or ownership display", async () => {
    const rule = await prisma.communityBenefitRule.create({
      data: {
        artistId,
        title: `${TEST_PREFIX}holder room`,
        benefitType: "room_access",
        status: "active",
        eligibilityPolicy: {
          type: "ownership",
          assetType: "stem_nft",
          artistId,
        },
        redemptionPolicy: { settlementType: "none" },
      },
    });

    const response = await service.listMyBenefits(userId);
    const benefit = response.benefits.find((item) => item.id === rule.id);

    expect(response.privacy).toMatchObject({
      proofDetails: "private",
      walletAddressVisible: false,
      ownershipDisplayVisible: false,
    });
    expect(benefit).toMatchObject({
      eligible: true,
      redeemable: true,
      reasons: expect.arrayContaining(["private_ownership"]),
      privacy: { proofDetails: "private" },
    });
  });

  it("keeps redemption idempotent for single-use benefits", async () => {
    const rule = await prisma.communityBenefitRule.create({
      data: {
        artistId,
        title: `${TEST_PREFIX}discount`,
        benefitType: "discount",
        status: "active",
        eligibilityPolicy: { type: "manual" },
        redemptionPolicy: { singleUse: true, settlementType: "none" },
      },
    });

    const first = await service.redeemBenefit(userId, rule.id);
    const second = await service.redeemBenefit(userId, rule.id);
    const count = await prisma.communityBenefitRedemption.count({
      where: { benefitRuleId: rule.id, userId },
    });

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(count).toBe(1);
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it("derives private supporter badges and roles from confirmed campaign pledges", async () => {
    const campaign = await prisma.showCampaign.create({
      data: {
        id: `${TEST_PREFIX}supporter_campaign`,
        slug: `${TEST_PREFIX}supporter-campaign`,
        artistId,
        artistDisplayName: "Community Artist",
        title: "Community Artist in Berlin",
        city: "Berlin",
        country: "DE",
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        goalAmountUnits: "1000000",
        chainId: 84532,
        status: "active",
      },
    });
    await prisma.showPledge.create({
      data: {
        campaignId: campaign.id,
        userId,
        walletAddress,
        amountUnits: "250000",
        chainId: 84532,
        status: "confirmed",
        confirmationStatus: "confirmed",
        transactionHash: "0x" + "8".repeat(64),
      },
    });

    const response = await service.listMyBadges(userId);
    const badge = response.badges.find((item) => item.sourceId === campaign.id);
    const role = await prisma.communityRole.findUnique({
      where: {
        CommunityRole_identity: {
          userId,
          roleType: "supporter",
          scopeType: "show_campaign",
          scopeId: campaign.id,
        },
      },
    });

    expect(badge).toMatchObject({
      badgeType: "supporter",
      sourceType: "show_campaign",
      visibility: "private",
    });
    expect(role).toMatchObject({
      roleType: "supporter",
      sourceType: "campaign_pledge",
      visibility: "private",
      revokedAt: null,
    });
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.badge_granted",
      badgeType: "supporter",
      sourceType: "show_campaign",
      campaignId: campaign.id,
      visibility: "private",
    }));
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.role_granted",
      roleType: "supporter",
      scopeType: "show_campaign",
      campaignId: campaign.id,
      visibility: "private",
    }));

    eventBus.publish.mockClear();
    await service.listMyBadges(userId);
    expect(eventBus.publish).not.toHaveBeenCalled();

    await prisma.showPledge.updateMany({
      where: { campaignId: campaign.id, userId },
      data: { status: "refund_available", refundAvailableAt: new Date() },
    });
    await prisma.showCampaign.update({
      where: { id: campaign.id },
      data: { status: "refund_available", refundAvailableAt: new Date() },
    });

    const revokedResponse = await service.listMyBadges(userId);
    const revokedRole = await prisma.communityRole.findUnique({
      where: {
        CommunityRole_identity: {
          userId,
          roleType: "supporter",
          scopeType: "show_campaign",
          scopeId: campaign.id,
        },
      },
    });

    expect(revokedResponse.badges).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceId: campaign.id })]),
    );
    expect(revokedRole?.revokedAt).toBeInstanceOf(Date);
  });

  it("keeps released campaign support eligible after funds are released", async () => {
    const campaign = await prisma.showCampaign.create({
      data: {
        id: `${TEST_PREFIX}released_supporter_campaign`,
        slug: `${TEST_PREFIX}released-supporter-campaign`,
        artistId,
        artistDisplayName: "Community Artist",
        title: "Released Community Artist in Berlin",
        city: "Berlin",
        country: "DE",
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        goalAmountUnits: "1000000",
        chainId: 84532,
        status: "released",
        releasedAt: new Date(),
      },
    });
    await prisma.showPledge.create({
      data: {
        campaignId: campaign.id,
        userId,
        walletAddress,
        amountUnits: "250000",
        chainId: 84532,
        status: "released",
        confirmationStatus: "confirmed",
        transactionHash: "0x" + "7".repeat(64),
        releasedAt: new Date(),
      },
    });

    const response = await service.listMyBadges(userId);
    const benefit = await service.evaluateAccessPolicy(userId, {
      type: "campaign_support",
      campaignId: campaign.id,
      minStatus: "confirmed",
    });

    expect(response.badges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          badgeType: "supporter",
          sourceId: campaign.id,
        }),
      ]),
    );
    expect(benefit).toMatchObject({
      eligible: true,
      reasons: expect.arrayContaining(["private_campaign_support"]),
    });
  });

  it("uses badges, roles, and campaign support as trusted eligibility facts", async () => {
    const campaign = await prisma.showCampaign.create({
      data: {
        id: `${TEST_PREFIX}campaign`,
        slug: `${TEST_PREFIX}campaign`,
        artistId,
        artistDisplayName: "Community Artist",
        title: "Community Show",
        city: "Paris",
        country: "FR",
        deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        goalAmountUnits: "1000000",
        chainId: 84532,
        status: "active",
      },
    });
    await prisma.showPledge.create({
      data: {
        campaignId: campaign.id,
        userId,
        walletAddress,
        amountUnits: "250000",
        chainId: 84532,
        status: "confirmed",
        confirmationStatus: "confirmed",
        transactionHash: "0x" + "f".repeat(64),
      },
    });
    await prisma.communityBadge.create({
      data: {
        userId,
        badgeType: "collector",
        sourceType: "artist",
        sourceId: artistId,
      },
    });
    await prisma.communityRole.create({
      data: {
        userId,
        roleType: "holder",
        scopeType: "artist",
        scopeId: artistId,
        sourceType: "ownership",
        sourceId: stemId,
      },
    });
    await prisma.communityBenefitRule.createMany({
      data: [
        {
          artistId,
          title: `${TEST_PREFIX}badge benefit`,
          benefitType: "drop_priority",
          status: "active",
          eligibilityPolicy: { type: "badge", badgeType: "collector", sourceType: "artist", sourceId: artistId },
        },
        {
          artistId,
          title: `${TEST_PREFIX}role benefit`,
          benefitType: "early_access",
          status: "active",
          eligibilityPolicy: { type: "role", roleType: "holder", scopeType: "artist", scopeId: artistId },
        },
        {
          artistId,
          title: `${TEST_PREFIX}campaign benefit`,
          benefitType: "ticket_priority",
          status: "active",
          eligibilityPolicy: { type: "campaign_support", campaignId: campaign.id, minStatus: "confirmed" },
        },
      ],
    });

    const response = await service.listMyBenefits(userId);

    expect(response.benefits.filter((item) => item.title.startsWith(`${TEST_PREFIX}`) && item.eligible)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: `${TEST_PREFIX}badge benefit`, reasons: expect.arrayContaining(["badge"]) }),
        expect.objectContaining({ title: `${TEST_PREFIX}role benefit`, reasons: expect.arrayContaining(["role"]) }),
        expect.objectContaining({
          title: `${TEST_PREFIX}campaign benefit`,
          reasons: expect.arrayContaining(["private_campaign_support"]),
        }),
      ]),
    );
  });

  it("does not grant ownership benefits from client-shaped policy data without indexed purchases", async () => {
    await prisma.communityBenefitRule.create({
      data: {
        artistId,
        title: `${TEST_PREFIX}missing ownership`,
        benefitType: "remix_eligibility",
        status: "active",
        eligibilityPolicy: {
          type: "ownership",
          assetType: "stem_nft",
          tokenId: "123456789",
          chainId: 84532,
        },
      },
    });

    const response = await service.listMyBenefits(userId);
    const benefit = response.benefits.find((item) => item.title === `${TEST_PREFIX}missing ownership`);

    expect(benefit).toMatchObject({
      eligible: false,
      redeemable: false,
      reasons: expect.arrayContaining(["ownership_missing"]),
    });
  });
});
