import { prisma } from "../db/prisma";
import { CommunityService } from "../modules/community/community.service";

/**
 * #1106 — opt-in public supporter and collector badges, against real Postgres.
 * Covers: hidden by default, per-type opt-in/opt-out, privacy redaction (no
 * wallet, spend, pledge, refund, holdings, campaign/room ids), lifecycle
 * invalidation, revocation, expiry, and moderation override.
 */
const TEST_PREFIX = `community_public_badges_${Date.now()}_`;
const userId = `${TEST_PREFIX}listener`;
const walletAddress = "0x" + "7".repeat(40);
const sellerAddress = "0x" + "8".repeat(40);
const supportArtistId = `${TEST_PREFIX}support_artist`;
const collectArtistId = `${TEST_PREFIX}collect_artist`;
const stemArtistId = `${TEST_PREFIX}stem_artist`;
const manualArtistId = `${TEST_PREFIX}manual_artist`;
const campaignId = `${TEST_PREFIX}campaign`;
const refundedCampaignId = `${TEST_PREFIX}refunded_campaign`;
const PLEDGE_AMOUNT = "987654321";
const TOKEN_ID = 77106n;

const eventBus = { publish: jest.fn() };
const service = new CommunityService(eventBus as any);

async function setConsent(data: { showSupporterBadges?: boolean; showCollectorBadges?: boolean }) {
  await prisma.communityVisibilitySettings.update({ where: { userId }, data });
}

describe("Public supporter and collector badges (#1106)", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: userId, email: `${userId}@test.resonate` },
        { id: `${TEST_PREFIX}artist_owner`, email: `${TEST_PREFIX}artist_owner@test.resonate` },
      ],
    });
    await prisma.wallet.create({ data: { userId, address: walletAddress, chainId: 84532 } });
    await prisma.communityProfile.create({
      data: { userId, displayName: "Badge Listener", profileVisibility: "public" },
    });
    await prisma.communityVisibilitySettings.create({ data: { userId } });

    await prisma.artist.createMany({
      data: [
        { id: supportArtistId, displayName: "Support Artist" },
        { id: collectArtistId, displayName: "Uploader Label" },
        { id: stemArtistId, displayName: "Stem Account" },
        { id: manualArtistId, displayName: "Manual Artist" },
      ],
    });

    // Supporter proof: confirmed pledge on an active campaign + derived badge.
    await prisma.showCampaign.createMany({
      data: [
        {
          id: campaignId,
          slug: `${TEST_PREFIX}campaign`,
          artistId: supportArtistId,
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
          id: refundedCampaignId,
          slug: `${TEST_PREFIX}refunded`,
          artistDisplayName: "Refunded Artist",
          title: "Refunded Artist in Lyon",
          city: "Lyon",
          country: "FR",
          deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          goalAmountUnits: "1000000",
          chainId: 84532,
          status: "refund_available",
        },
      ],
    });
    await prisma.showPledge.createMany({
      data: [
        {
          campaignId,
          userId,
          walletAddress,
          amountUnits: PLEDGE_AMOUNT,
          chainId: 84532,
          status: "confirmed",
          confirmationStatus: "confirmed",
          confirmedAt: new Date("2026-06-01T10:00:00.000Z"),
        },
        {
          campaignId: refundedCampaignId,
          userId,
          walletAddress,
          amountUnits: PLEDGE_AMOUNT,
          chainId: 84532,
          status: "confirmed",
          confirmationStatus: "confirmed",
          confirmedAt: new Date("2026-06-01T10:00:00.000Z"),
        },
      ],
    });
    await prisma.communityBadge.createMany({
      data: [
        { userId, badgeType: "supporter", sourceType: "show_campaign", sourceId: campaignId },
        // Stale badge whose campaign entered refund lifecycle: must not display.
        { userId, badgeType: "supporter", sourceType: "show_campaign", sourceId: refundedCampaignId },
        // Manual artist grant for the collector type.
        { userId, badgeType: "collector", sourceType: "artist", sourceId: manualArtistId },
      ],
    });

    // Collector proof 1: owned Punchline collectible (credited artist "Nova").
    await prisma.release.createMany({
      data: [
        { id: `${TEST_PREFIX}release`, artistId: collectArtistId, title: "Neon", primaryArtist: "Nova" },
        { id: `${TEST_PREFIX}stem_release`, artistId: stemArtistId, title: "Stems", primaryArtist: "Stem Credited" },
      ],
    });
    await prisma.track.createMany({
      data: [
        { id: `${TEST_PREFIX}track`, releaseId: `${TEST_PREFIX}release`, title: "Golden", artist: "Nova", position: 1 },
        { id: `${TEST_PREFIX}stem_track`, releaseId: `${TEST_PREFIX}stem_release`, title: "Bass", position: 1 },
      ],
    });
    await prisma.punchlineDrop.create({
      data: {
        id: `${TEST_PREFIX}drop`,
        trackId: `${TEST_PREFIX}track`,
        artistId: collectArtistId,
        status: "published",
        publishedAt: new Date(),
      },
    });
    await prisma.punchlineMoment.create({
      data: {
        id: `${TEST_PREFIX}moment`,
        dropId: `${TEST_PREFIX}drop`,
        title: "Moment",
        lyricText: "lyric",
        startMs: 0,
        endMs: 8000,
        editionSize: 50,
        priceCents: 0,
      },
    });
    await prisma.punchlineCollectible.create({
      data: {
        id: `${TEST_PREFIX}collectible`,
        momentId: `${TEST_PREFIX}moment`,
        collectorUserId: userId,
        editionNumber: 7,
        status: "owned",
        paymentRail: "paid_x402",
        pricePaidCents: 4321,
        collectorWallet: walletAddress,
        acquiredAt: new Date(),
      },
    });

    // Collector proof 2: indexed stem NFT purchase.
    await prisma.stem.create({
      data: { id: `${TEST_PREFIX}stem`, trackId: `${TEST_PREFIX}stem_track`, type: "bass", uri: "gs://test/bass.wav" },
    });
    const listing = await prisma.stemListing.create({
      data: {
        listingId: TOKEN_ID,
        stemId: `${TEST_PREFIX}stem`,
        tokenId: TOKEN_ID,
        chainId: 84532,
        contractAddress: "0x" + "c".repeat(40),
        sellerAddress,
        pricePerUnit: "1000000",
        amount: 1n,
        paymentToken: "0x0000000000000000000000000000000000000000",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        transactionHash: `0x${"a".repeat(60)}1106`,
        blockNumber: TOKEN_ID,
        listedAt: new Date(),
      },
    });
    await prisma.stemPurchase.create({
      data: {
        listingId: listing.id,
        buyerAddress: walletAddress,
        amount: 1n,
        totalPaid: "1000000",
        royaltyPaid: "50000",
        protocolFeePaid: "10000",
        sellerReceived: "940000",
        transactionHash: `0x${"b".repeat(60)}1106`,
        blockNumber: TOKEN_ID + 1n,
        purchasedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.communityMembership.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.communityRoom.deleteMany({ where: { ownerId: { startsWith: TEST_PREFIX } } });
    await prisma.stemPurchase.deleteMany({ where: { buyerAddress: walletAddress } });
    await prisma.stemListing.deleteMany({ where: { stemId: { startsWith: TEST_PREFIX } } });
    await prisma.stem.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.punchlineCollectible.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.punchlineMoment.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.punchlineDrop.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.communityBadge.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.showPledge.deleteMany({ where: { campaignId: { startsWith: TEST_PREFIX } } });
    await prisma.showCampaign.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.communityVisibilitySettings.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.communityProfile.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.wallet.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  it("hides supporter and collector badges by default even when proofs exist", async () => {
    const profile = await service.getPublicProfile(userId);

    expect(profile.showcase.supporterBadgesVisible).toBe(false);
    expect(profile.showcase.collectorBadgesVisible).toBe(false);
    expect(profile.showcase).not.toHaveProperty("supporterBadges");
    expect(profile.showcase).not.toHaveProperty("collectorBadges");
    expect(profile.redactions).toEqual(
      expect.arrayContaining(["supporter_badges_hidden", "collector_badges_hidden"]),
    );
  });

  it("shows supporter badges only under the supporter opt-in, without spend, pledge, refund, or room data", async () => {
    await setConsent({ showSupporterBadges: true, showCollectorBadges: false });
    const profile = await service.getPublicProfile(userId);

    expect(profile.showcase.supporterBadges).toEqual([
      expect.objectContaining({
        credentialType: "artist_supporter",
        displayLabel: "Supporter of Support Artist",
        artistId: supportArtistId,
        tier: "supporter",
        status: "active",
        proofMethod: "campaign_support",
      }),
    ]);
    // Opt-in is per badge type.
    expect(profile.showcase).not.toHaveProperty("collectorBadges");
    const serialized = JSON.stringify(profile.showcase.supporterBadges);
    expect(serialized).not.toContain(PLEDGE_AMOUNT);
    expect(serialized).not.toContain(campaignId);
    expect(serialized).not.toContain(refundedCampaignId);
    expect(serialized.toLowerCase()).not.toContain(walletAddress.toLowerCase());
    expect(serialized).not.toMatch(/refund|amount|pledge|room/i);
    expect(profile.showcase.supporterBadges?.[0].credentialId).toMatch(/^cred_[0-9a-f]{24}$/);
  });

  it("shows collector badges per artist without holdings, token ids, editions, or wallet", async () => {
    await setConsent({ showSupporterBadges: false, showCollectorBadges: true });
    const profile = await service.getPublicProfile(userId);

    const badges = profile.showcase.collectorBadges ?? [];
    expect(badges.map((badge) => badge.displayLabel).sort()).toEqual([
      "Collector of Manual Artist",
      "Collector of Nova",
      "Collector of Stem Credited",
    ]);
    expect(badges.find((badge) => badge.artistId === manualArtistId)?.proofMethod).toBe("manual_grant");
    expect(badges.find((badge) => badge.artistId === stemArtistId)?.proofMethod).toBe("indexed_ownership");
    // The uploader account label never wins over the credited artist.
    expect(JSON.stringify(badges)).not.toContain("Uploader Label");
    const serialized = JSON.stringify(badges);
    expect(serialized).not.toContain(TOKEN_ID.toString());
    expect(serialized).not.toContain("4321");
    expect(serialized.toLowerCase()).not.toContain(walletAddress.toLowerCase());
    expect(serialized).not.toMatch(/edition|tokenId|amount|price|holding/i);
    expect(profile.showcase).not.toHaveProperty("supporterBadges");
  });

  it("drops a collector badge once indexed ownership is resold", async () => {
    const listing = await prisma.stemListing.findFirstOrThrow({ where: { stemId: `${TEST_PREFIX}stem` } });
    const resale = await prisma.stemListing.create({
      data: {
        listingId: TOKEN_ID + 10n,
        stemId: `${TEST_PREFIX}stem`,
        tokenId: listing.tokenId,
        chainId: listing.chainId,
        contractAddress: listing.contractAddress,
        sellerAddress: walletAddress,
        pricePerUnit: "1000000",
        amount: 1n,
        paymentToken: listing.paymentToken,
        expiresAt: listing.expiresAt,
        transactionHash: `0x${"c".repeat(60)}1106`,
        blockNumber: TOKEN_ID + 10n,
        listedAt: new Date(),
      },
    });
    await prisma.stemPurchase.create({
      data: {
        listingId: resale.id,
        buyerAddress: sellerAddress,
        amount: 1n,
        totalPaid: "1000000",
        royaltyPaid: "0",
        protocolFeePaid: "0",
        sellerReceived: "1000000",
        transactionHash: `0x${"d".repeat(60)}1106`,
        blockNumber: TOKEN_ID + 11n,
        purchasedAt: new Date(),
      },
    });

    const profile = await service.getPublicProfile(userId);
    expect(profile.showcase.collectorBadges?.map((badge) => badge.artistId)).not.toContain(stemArtistId);

    await prisma.stemPurchase.deleteMany({ where: { listingId: resale.id } });
    await prisma.stemListing.delete({ where: { id: resale.id } });
  });

  it("drops badges that are revoked or expired", async () => {
    await prisma.communityBadge.updateMany({
      where: { userId, badgeType: "collector", sourceId: manualArtistId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    let profile = await service.getPublicProfile(userId);
    expect(profile.showcase.collectorBadges?.map((badge) => badge.artistId)).not.toContain(manualArtistId);

    const futureExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.communityBadge.updateMany({
      where: { userId, badgeType: "collector", sourceId: manualArtistId },
      data: { expiresAt: futureExpiry },
    });
    profile = await service.getPublicProfile(userId);
    expect(profile.showcase.collectorBadges?.find((badge) => badge.artistId === manualArtistId)?.expiresAt)
      .toBe(futureExpiry.toISOString());

    await prisma.communityBadge.updateMany({
      where: { userId, badgeType: "collector", sourceId: manualArtistId },
      data: { revokedAt: new Date() },
    });
    profile = await service.getPublicProfile(userId);
    expect(profile.showcase.collectorBadges?.map((badge) => badge.artistId)).not.toContain(manualArtistId);
  });

  it("hides supporter badges when the campaign leaves the active lifecycle", async () => {
    await setConsent({ showSupporterBadges: true });
    await prisma.showCampaign.update({ where: { id: campaignId }, data: { status: "refund_available" } });
    const profile = await service.getPublicProfile(userId);
    expect(profile.showcase.supporterBadges).toEqual([]);
    await prisma.showCampaign.update({ where: { id: campaignId }, data: { status: "active" } });
  });

  it("lets a moderation ban in an artist room override both badge types for that artist", async () => {
    await setConsent({ showSupporterBadges: true, showCollectorBadges: true });
    const room = await prisma.communityRoom.create({
      data: {
        roomType: "artist_public",
        ownerType: "artist",
        ownerId: supportArtistId,
        artistId: supportArtistId,
        title: "Support Artist room",
      },
    });
    await prisma.communityMembership.create({
      data: { roomId: room.id, userId, status: "banned", endedAt: new Date() },
    });
    const collectRoom = await prisma.communityRoom.create({
      data: {
        roomType: "artist_holder",
        ownerType: "artist",
        ownerId: collectArtistId,
        artistId: collectArtistId,
        title: "Collect Artist holders",
      },
    });
    await prisma.communityMembership.create({
      data: { roomId: collectRoom.id, userId, status: "removed", endedAt: new Date() },
    });

    const profile = await service.getPublicProfile(userId);
    expect(profile.showcase.supporterBadges).toEqual([]);
    expect(profile.showcase.collectorBadges?.map((badge) => badge.artistId)).not.toContain(collectArtistId);
    expect(profile.showcase.collectorBadges?.map((badge) => badge.artistId)).toContain(stemArtistId);
  });

  it("removes all badges from the public response when the listener opts out", async () => {
    const updated = await service.updateMyProfile(userId, {
      visibility: { showSupporterBadges: false, showCollectorBadges: false },
    });
    expect(updated.visibility).toMatchObject({ showSupporterBadges: false, showCollectorBadges: false });

    const profile = await service.getPublicProfile(userId);
    expect(profile.showcase).not.toHaveProperty("supporterBadges");
    expect(profile.showcase).not.toHaveProperty("collectorBadges");
    expect(profile.redactions).toEqual(
      expect.arrayContaining(["supporter_badges_hidden", "collector_badges_hidden"]),
    );
  });
});
