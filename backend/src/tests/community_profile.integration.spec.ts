import { prisma } from "../db/prisma";
import { CommunityService } from "../modules/community/community.service";

const TEST_PREFIX = `community_profile_${Date.now()}_`;
const userId = `${TEST_PREFIX}listener`;
const walletAddress = "0x" + "1".repeat(40);
const campaignId = `${TEST_PREFIX}campaign`;
const privateBadgeOnlyCampaignId = `${TEST_PREFIX}private_badge_only_campaign`;
const artistId = `${TEST_PREFIX}artist`;
const releaseId = `${TEST_PREFIX}release`;
const trackId = `${TEST_PREFIX}track`;
const dropId = `${TEST_PREFIX}drop`;
// One over the OWNED_MOMENTS_SHOWCASE_CAP so the cap test is meaningful.
const OWNED_MOMENT_COUNT = 13;
const PAYMENT_REF_SECRET = `${TEST_PREFIX}pay_ref_secret`;

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

    // Punchline ownership chain for the owned-moments showcase (#1477).
    // The uploader account label ("Uploader Label") must NEVER win over the
    // credited artist ("Nova") on the public showcase.
    await prisma.artist.create({
      data: { id: artistId, displayName: "Uploader Label" },
    });
    await prisma.release.create({
      data: { id: releaseId, artistId, title: "Neon Nights", primaryArtist: "Nova" },
    });
    await prisma.track.create({
      data: { id: trackId, releaseId, title: "Golden Hour", artist: "Nova", position: 1 },
    });
    await prisma.punchlineDrop.create({
      data: {
        id: dropId,
        trackId,
        artistId,
        status: "published",
        title: "Golden Hour Drop",
        publishedAt: new Date(),
      },
    });
    for (let i = 0; i < OWNED_MOMENT_COUNT; i++) {
      const momentId = `${TEST_PREFIX}moment_${i}`;
      await prisma.punchlineMoment.create({
        data: {
          id: momentId,
          dropId,
          title: `Moment ${i}`,
          lyricText: `lyric line ${i}`,
          startMs: 0,
          endMs: 8000,
          editionSize: 50,
          priceCents: 0,
        },
      });
      await prisma.punchlineCollectible.create({
        data: {
          id: `${TEST_PREFIX}collectible_${i}`,
          momentId,
          collectorUserId: userId,
          editionNumber: i + 1,
          status: "owned",
          // Payment provenance + wallet that must never surface publicly.
          paymentRail: "paid_x402",
          pricePaidCents: 199,
          paymentRef: `${PAYMENT_REF_SECRET}_${i}`,
          collectorWallet: walletAddress,
          acquiredAt: new Date(Date.UTC(2026, 4, 1 + i)),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.punchlineCollectible.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.punchlineMoment.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.punchlineDrop.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
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

  it("hides opted-in campaign support after refund lifecycle starts", async () => {
    await prisma.showPledge.updateMany({
      where: { campaignId, walletAddress: { equals: walletAddress, mode: "insensitive" } },
      data: { status: "refund_available", refundAvailableAt: new Date() },
    });
    await prisma.showCampaign.update({
      where: { id: campaignId },
      data: { status: "refund_available", refundAvailableAt: new Date() },
    });

    const profile = await service.getPublicProfile(userId);

    expect(profile.showcase.campaignSupportVisible).toBe(true);
    expect(profile.showcase.campaignSupport).toEqual([]);
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

  it("shows opted-in owned moments (credited artist, capped, no payment or wallet)", async () => {
    await prisma.communityVisibilitySettings.update({
      where: { userId },
      data: { showOwnedItems: true },
    });

    const profile = await service.getPublicProfile(userId);

    expect(profile.showcase.ownedItemsVisible).toBe(true);
    expect(profile.redactions).not.toContain("owned_items_hidden");

    const moments = profile.showcase.ownedMoments;
    expect(moments).toBeDefined();
    // Cap respected: 13 seeded, at most 12 surfaced.
    expect(moments).toHaveLength(12);
    // Newest-first: Moment 12 (latest acquiredAt) leads; oldest Moment 0 dropped.
    expect(moments![0].moment.title).toBe("Moment 12");
    expect(moments!.some((m) => m.moment.title === "Moment 0")).toBe(false);

    const lead = moments![0];
    expect(lead).toMatchObject({
      editionNumber: 13,
      editionSize: 50,
      moment: expect.objectContaining({
        priceCents: 0,
        collectedCount: 1,
        rightsLabel: "NON_COMMERCIAL_COLLECTIBLE",
      }),
      drop: expect.objectContaining({
        id: dropId,
        trackId,
        releaseId,
        trackTitle: "Golden Hour",
        // Credited artist, NOT the uploader account label.
        artistName: "Nova",
      }),
    });

    // Fail-closed: no payment provenance or wallet anywhere in the payload.
    const serialized = JSON.stringify(profile);
    expect(serialized).not.toContain(PAYMENT_REF_SECRET);
    expect(serialized).not.toContain("paid_x402");
    expect(serialized).not.toContain("paymentRail");
    expect(serialized).not.toContain("paymentRef");
    expect(serialized).not.toContain("pricePaidCents");
    expect(serialized).not.toContain(walletAddress);
    expect(serialized).not.toContain("Uploader Label");
  });

  it("hides owned moments when the listener opts out (field absent, redaction intact)", async () => {
    await prisma.communityVisibilitySettings.update({
      where: { userId },
      data: { showOwnedItems: false },
    });

    const profile = await service.getPublicProfile(userId);

    expect(profile.showcase.ownedItemsVisible).toBe(false);
    expect(profile.showcase.ownedMoments).toBeUndefined();
    expect(profile.redactions).toContain("owned_items_hidden");
  });

  it("returns 404 for a non-public profile even with owned items enabled", async () => {
    await prisma.communityVisibilitySettings.update({
      where: { userId },
      data: { showOwnedItems: true },
    });
    await prisma.communityProfile.update({
      where: { userId },
      data: { profileVisibility: "private" },
    });

    await expect(service.getPublicProfile(userId)).rejects.toThrow(/not public/i);
  });
});
