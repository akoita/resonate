import { ForbiddenException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { CommunityEligibilityService } from "../modules/community/community_eligibility.service";
import { CommunityRoomsService } from "../modules/community/community_rooms.service";

const TEST_PREFIX = `community_rooms_${Date.now()}_`;
const artistUserId = `${TEST_PREFIX}artist_user`;
const listenerUserId = `${TEST_PREFIX}listener`;
const holderUserId = `${TEST_PREFIX}holder`;
const otherUserId = `${TEST_PREFIX}other`;
const artistId = `${TEST_PREFIX}artist`;
const releaseId = `${TEST_PREFIX}release`;
const trackId = `${TEST_PREFIX}track`;
const stemId = `${TEST_PREFIX}stem`;
const campaignId = `${TEST_PREFIX}campaign`;
const campaignSlug = `${TEST_PREFIX}campaign-slug`;
const holderWallet = "0x" + "1".repeat(40);
const artistWallet = "0x" + "2".repeat(40);
const listenerWallet = "0x" + "6".repeat(40);

const eventBus = { publish: jest.fn() };
const eligibility = new CommunityEligibilityService(eventBus as any);
const service = new CommunityRoomsService(eligibility, eventBus as any);

describe("CommunityRoomsService integration", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: artistUserId, email: `${artistUserId}@test.resonate` },
        { id: listenerUserId, email: `${listenerUserId}@test.resonate` },
        { id: holderUserId, email: `${holderUserId}@test.resonate` },
        { id: otherUserId, email: `${otherUserId}@test.resonate` },
      ],
    });
    await prisma.wallet.create({
      data: { userId: holderUserId, address: holderWallet, chainId: 84532 },
    });
    await prisma.wallet.create({
      data: { userId: listenerUserId, address: listenerWallet, chainId: 84532 },
    });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId: artistUserId,
        displayName: "Community Room Artist",
        payoutAddress: artistWallet,
      },
    });
    await prisma.release.create({
      data: { id: releaseId, artistId, title: "Community Room Release", status: "published" },
    });
    await prisma.track.create({
      data: { id: trackId, releaseId, title: "Community Room Track" },
    });
    await prisma.stem.create({
      data: { id: stemId, trackId, type: "vocals", uri: `ipfs://${TEST_PREFIX}stem` },
    });
    const listing = await prisma.stemListing.create({
      data: {
        listingId: 99901n,
        stemId,
        tokenId: 99901n,
        chainId: 84532,
        contractAddress: "0x" + "3".repeat(40),
        sellerAddress: artistWallet,
        pricePerUnit: "1000000",
        amount: 1n,
        paymentToken: "0x0000000000000000000000000000000000000000",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        transactionHash: "0x" + "4".repeat(64),
        blockNumber: 99901n,
        listedAt: new Date(),
      },
    });
    await prisma.stemPurchase.create({
      data: {
        listingId: listing.id,
        buyerAddress: holderWallet,
        amount: 1n,
        totalPaid: "1000000",
        royaltyPaid: "50000",
        protocolFeePaid: "10000",
        sellerReceived: "940000",
        transactionHash: "0x" + "5".repeat(64),
        blockNumber: 99902n,
        purchasedAt: new Date(),
      },
    });
    await prisma.showCampaign.create({
      data: {
        id: campaignId,
        slug: campaignSlug,
        artistId,
        artistDisplayName: "Community Room Artist",
        title: "Community Room Artist in Paris",
        city: "Paris",
        country: "FR",
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        goalAmountUnits: "1000000",
        chainId: 84532,
        campaignLevel: "active_escrow_campaign",
        status: "active",
        artistAuthorityStatus: "artist_authorized",
      },
    });
    await prisma.showPledge.create({
      data: {
        campaignId,
        userId: listenerUserId,
        walletAddress: listenerWallet,
        amountUnits: "250000",
        chainId: 84532,
        status: "confirmed",
        confirmationStatus: "confirmed",
      },
    });
  });

  afterAll(async () => {
    await prisma.communityModerationReport.deleteMany({ where: { room: { ownerId: campaignId } } });
    await prisma.communityMessage.deleteMany({ where: { room: { ownerId: campaignId } } });
    await prisma.communityMembership.deleteMany({ where: { room: { ownerId: campaignId } } });
    await prisma.communityRoom.deleteMany({ where: { ownerId: campaignId } });
    await prisma.communityModerationReport.deleteMany({ where: { room: { ownerId: artistId } } });
    await prisma.communityMessage.deleteMany({ where: { room: { ownerId: artistId } } });
    await prisma.communityMembership.deleteMany({ where: { room: { ownerId: artistId } } });
    await prisma.communityRoom.deleteMany({ where: { ownerId: artistId } });
    await prisma.showPledge.deleteMany({ where: { campaignId } });
    await prisma.showCampaign.deleteMany({ where: { id: campaignId } });
    await prisma.stemPurchase.deleteMany({ where: { buyerAddress: { equals: holderWallet, mode: "insensitive" } } });
    await prisma.stemListing.deleteMany({ where: { stemId } });
    await prisma.stem.deleteMany({ where: { id: stemId } });
    await prisma.track.deleteMany({ where: { id: trackId } });
    await prisma.release.deleteMany({ where: { id: releaseId } });
    await prisma.artist.deleteMany({ where: { id: artistId } });
    await prisma.wallet.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  beforeEach(() => eventBus.publish.mockClear());

  it("enables artist public and holder rooms", async () => {
    const result = await service.enableArtistCommunity(artistUserId, artistId);

    expect(result.rooms).toEqual(expect.arrayContaining([
      expect.objectContaining({ roomType: "artist_public", status: "active" }),
      expect.objectContaining({ roomType: "artist_holder", access: expect.objectContaining({ reason: "holder_required" }) }),
    ]));
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.artist_tab_enabled",
      artistId,
    }));
  });

  it("allows public joins but gates holder rooms through private eligibility", async () => {
    const rooms = await service.enableArtistCommunity(artistUserId, artistId);
    const publicRoom = rooms.rooms.find((room) => room.roomType === "artist_public")!;
    const holderRoom = rooms.rooms.find((room) => room.roomType === "artist_holder")!;

    await expect(service.joinRoom(listenerUserId, publicRoom.id)).resolves.toMatchObject({
      membership: { status: "active", role: "member" },
    });
    await expect(service.joinRoom(listenerUserId, holderRoom.id)).rejects.toThrow(ForbiddenException);
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.room_access_denied",
      roomId: holderRoom.id,
      roomType: "artist_holder",
      artistId,
    }));
    await expect(service.joinRoom(holderUserId, holderRoom.id)).resolves.toMatchObject({
      membership: { status: "active", role: "holder" },
    });
  });

  it("supports announcements, messages, reports, deletion, and member moderation", async () => {
    const rooms = await service.enableArtistCommunity(artistUserId, artistId);
    const publicRoom = rooms.rooms.find((room) => room.roomType === "artist_public")!;
    await service.joinRoom(listenerUserId, publicRoom.id);

    const announcement = await service.createMessage(artistUserId, publicRoom.id, {
      body: "Welcome to the room",
      messageType: "announcement",
    });
    const message = await service.createMessage(listenerUserId, publicRoom.id, {
      body: "Happy to be here",
    });
    const report = await service.reportMessage(listenerUserId, announcement.message.id, { reason: "needs review" });
    const deleted = await service.deleteMessage(artistUserId, message.message.id);
    const moderated = await service.moderateMember(artistUserId, publicRoom.id, listenerUserId, { action: "ban" });
    const paused = await service.updateRoomStatus(artistUserId, publicRoom.id, { status: "paused" });

    expect(announcement.message).toMatchObject({ messageType: "announcement", status: "visible" });
    expect(report.report).toMatchObject({ status: "open", reason: "needs review" });
    expect(deleted.message).toMatchObject({ status: "deleted_by_moderator", body: null });
    expect(moderated.membership).toMatchObject({ status: "banned" });
    expect(paused.room).toMatchObject({ status: "paused" });
  });

  it("creates campaign supporter rooms and gates them by confirmed pledge support", async () => {
    const locked = await service.getShowCampaignCommunity(otherUserId, campaignSlug);
    const lockedRoom = locked.rooms[0];
    expect(lockedRoom).toMatchObject({
      roomType: "show_campaign_supporter",
      ownerType: "show_campaign",
      ownerId: campaignId,
      access: expect.objectContaining({
        joinable: false,
        reason: "campaign_support_required",
      }),
    });

    await expect(service.joinShowCampaignCommunity(otherUserId, campaignId)).rejects.toThrow(ForbiddenException);
    await expect(service.joinShowCampaignCommunity(listenerUserId, campaignId)).resolves.toMatchObject({
      membership: { status: "active", role: "supporter" },
      room: { roomType: "show_campaign_supporter" },
    });

    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.campaign_room_joined",
      campaignId,
      roomType: "show_campaign_supporter",
    }));
  });

  it("lets campaign artists post campaign updates to supporter rooms", async () => {
    const joined = await service.joinShowCampaignCommunity(listenerUserId, campaignId);
    const update = await service.createShowCampaignUpdate(
      { userId: artistUserId, role: "artist" },
      campaignId,
      { body: "Booking outreach has started." },
    );
    const messages = await service.listMessages(listenerUserId, joined.room.id);

    expect(update.message).toMatchObject({
      messageType: "campaign_update",
      body: "Booking outreach has started.",
    });
    expect(messages.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageType: "campaign_update" }),
    ]));
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.message_created",
      messageType: "campaign_update",
      campaignId,
    }));
  });
});
