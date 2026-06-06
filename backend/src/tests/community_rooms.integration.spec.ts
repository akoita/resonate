import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { CommunityEligibilityService } from "../modules/community/community_eligibility.service";
import { CommunityRoomsService } from "../modules/community/community_rooms.service";

const TEST_PREFIX = `community_rooms_${Date.now()}_`;
const artistUserId = `${TEST_PREFIX}artist_user`;
const listenerUserId = `${TEST_PREFIX}listener`;
const holderUserId = `${TEST_PREFIX}holder`;
const otherUserId = `${TEST_PREFIX}other`;
const artistId = `${TEST_PREFIX}artist`;
const publicArtistId = `${TEST_PREFIX}public_artist`;
const releaseId = `${TEST_PREFIX}release`;
const publicReleaseId = `${TEST_PREFIX}public_release`;
const trackId = `${TEST_PREFIX}track`;
const stemId = `${TEST_PREFIX}stem`;
const campaignId = `${TEST_PREFIX}campaign`;
const campaignSlug = `${TEST_PREFIX}campaign-slug`;
const signalCampaignId = `${TEST_PREFIX}signal_campaign`;
const signalCampaignSlug = `${TEST_PREFIX}signal-campaign-slug`;
const draftEscrowCampaignId = `${TEST_PREFIX}draft_escrow_campaign`;
const draftEscrowCampaignSlug = `${TEST_PREFIX}draft-escrow-campaign-slug`;
const cancelledCampaignId = `${TEST_PREFIX}cancelled_campaign`;
const cancelledCampaignSlug = `${TEST_PREFIX}cancelled-campaign-slug`;
const releasedCampaignId = `${TEST_PREFIX}released_campaign`;
const releasedCampaignSlug = `${TEST_PREFIX}released-campaign-slug`;
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
    await prisma.artist.create({
      data: {
        id: publicArtistId,
        displayName: "Release Credit Artist",
        profileType: "public_artist",
        claimStatus: "unclaimed",
      },
    });
    await prisma.release.create({
      data: {
        id: publicReleaseId,
        artistId,
        title: "Release Credit Artist Single",
        status: "published",
        primaryArtist: "Release Credit Artist",
        artistCredits: {
          create: {
            artistId: publicArtistId,
            role: "main",
            displayName: "Release Credit Artist",
            sortOrder: 0,
          },
        },
      },
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
    await prisma.showCampaign.create({
      data: {
        id: cancelledCampaignId,
        slug: cancelledCampaignSlug,
        artistId,
        artistDisplayName: "Community Room Artist",
        title: "Cancelled Community Room Artist in Paris",
        city: "Paris",
        country: "FR",
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        goalAmountUnits: "1000000",
        chainId: 84532,
        campaignLevel: "active_escrow_campaign",
        status: "cancelled",
        artistAuthorityStatus: "artist_authorized",
      },
    });
    await prisma.showCampaign.create({
      data: {
        id: releasedCampaignId,
        slug: releasedCampaignSlug,
        artistId,
        artistDisplayName: "Community Room Artist",
        title: "Released Community Room Artist in Paris",
        city: "Paris",
        country: "FR",
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        goalAmountUnits: "1000000",
        chainId: 84532,
        campaignLevel: "active_escrow_campaign",
        status: "released",
        artistAuthorityStatus: "artist_authorized",
        releasedAt: new Date(),
      },
    });
    await prisma.showCampaign.create({
      data: {
        id: signalCampaignId,
        slug: signalCampaignSlug,
        artistId,
        artistDisplayName: "Community Room Artist",
        title: "Community Room Artist fan signal in Lyon",
        city: "Lyon",
        country: "FR",
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        goalAmountUnits: "0",
        chainId: 84532,
        campaignLevel: "signal",
        status: "draft",
        artistAuthorityStatus: "none",
      },
    });
    await prisma.showCampaign.create({
      data: {
        id: draftEscrowCampaignId,
        slug: draftEscrowCampaignSlug,
        artistId,
        artistDisplayName: "Community Room Artist",
        title: "Draft escrow campaign in Paris",
        city: "Paris",
        country: "FR",
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        goalAmountUnits: "1000000",
        chainId: 84532,
        campaignLevel: "active_escrow_campaign",
        status: "draft",
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
    await prisma.showPledge.create({
      data: {
        campaignId: releasedCampaignId,
        userId: listenerUserId,
        walletAddress: listenerWallet,
        amountUnits: "250000",
        chainId: 84532,
        status: "released",
        confirmationStatus: "confirmed",
        releasedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    const campaignOwnerIds = [
      campaignId,
      signalCampaignId,
      draftEscrowCampaignId,
      cancelledCampaignId,
      releasedCampaignId,
    ];
    await prisma.communityModerationReport.deleteMany({ where: { room: { ownerId: { in: campaignOwnerIds } } } });
    await prisma.communityMessage.deleteMany({ where: { room: { ownerId: { in: campaignOwnerIds } } } });
    await prisma.communityMembership.deleteMany({ where: { room: { ownerId: { in: campaignOwnerIds } } } });
    await prisma.communityRoom.deleteMany({ where: { ownerId: { in: campaignOwnerIds } } });
    await prisma.communityModerationReport.deleteMany({ where: { room: { ownerId: { in: [artistId, publicArtistId] } } } });
    await prisma.communityMessage.deleteMany({ where: { room: { ownerId: { in: [artistId, publicArtistId] } } } });
    await prisma.communityMembership.deleteMany({ where: { room: { ownerId: { in: [artistId, publicArtistId] } } } });
    await prisma.communityRoom.deleteMany({ where: { ownerId: { in: [artistId, publicArtistId] } } });
    await prisma.showPledge.deleteMany({ where: { campaignId: { in: campaignOwnerIds } } });
    await prisma.showCampaign.deleteMany({ where: { id: { in: campaignOwnerIds } } });
    await prisma.stemPurchase.deleteMany({ where: { buyerAddress: { equals: holderWallet, mode: "insensitive" } } });
    await prisma.stemListing.deleteMany({ where: { stemId } });
    await prisma.stem.deleteMany({ where: { id: stemId } });
    await prisma.track.deleteMany({ where: { id: trackId } });
    await prisma.release.deleteMany({ where: { id: { in: [releaseId, publicReleaseId] } } });
    await prisma.artist.deleteMany({ where: { id: { in: [artistId, publicArtistId] } } });
    await prisma.wallet.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  beforeEach(() => eventBus.publish.mockClear());

  it("does not auto-open rooms for manager-owned release profiles", async () => {
    const result = await service.listArtistRooms(artistId, listenerUserId);

    expect(result.artist).toMatchObject({
      id: artistId,
      displayName: "Community Room Artist",
    });
    expect(result.rooms).toEqual([]);
    expect(eventBus.publish).not.toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.artist_tab_enabled",
      artistId,
    }));
  });

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

  it("auto-opens rooms for public release artists with official catalog releases", async () => {
    const result = await service.listArtistRooms(publicArtistId, listenerUserId);

    expect(result.artist).toMatchObject({
      id: publicArtistId,
      displayName: "Release Credit Artist",
    });
    expect(result.rooms).toEqual(expect.arrayContaining([
      expect.objectContaining({
        roomType: "artist_public",
        ownerType: "artist",
        ownerId: publicArtistId,
        artistId: publicArtistId,
        access: expect.objectContaining({ joinable: true, reason: "open" }),
      }),
      expect.objectContaining({
        roomType: "artist_holder",
        ownerType: "artist",
        ownerId: publicArtistId,
        artistId: publicArtistId,
        access: expect.objectContaining({ reason: "holder_required" }),
      }),
    ]));
    expect(eventBus.publish).not.toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.artist_tab_enabled",
      artistId: publicArtistId,
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

  it("lets admins triage moderation reports with bounded context and resolve member actions", async () => {
    const room = await prisma.communityRoom.create({
      data: {
        roomType: "artist_public",
        ownerType: "artist",
        ownerId: `${artistId}_governance`,
        artistId,
        title: "Governance Review Room",
        description: "Room for moderation queue tests.",
      },
    });
    await prisma.communityMembership.createMany({
      data: [
        { roomId: room.id, userId: listenerUserId, role: "member" },
        { roomId: room.id, userId: otherUserId, role: "member" },
      ],
    });
    const message = await service.createMessage(listenerUserId, room.id, {
      body: "This reported message should appear as a preview only.",
    });
    const report = await service.reportMessage(otherUserId, message.message.id, {
      reason: "harassment and doxxing review",
    });

    const queue = await service.getModerationQueue({ status: "open", limit: 100 });
    const queuedReport = queue.reports.find((item) => item.id === report.report.id);

    expect(queuedReport).toMatchObject({
      status: "open",
      reason: "harassment and doxxing review",
      room: {
        id: room.id,
        title: "Governance Review Room",
        status: "active",
      },
      message: {
        id: message.message.id,
        authorUserId: listenerUserId,
        status: "visible",
      },
      context: {
        messageReportCount: 1,
        roomMembershipsByStatus: { active: 2 },
      },
      assist: {
        severity: "high",
        likelihood: "medium",
        reasonCodes: expect.arrayContaining(["privacy_language_signal", "safety_language_signal"]),
        source: "bounded_moderation_context",
        advisory: {
          noAutoEnforcement: true,
        },
      },
    });
    expect(queuedReport?.assist.summary).toContain("privacy");
    expect(queuedReport?.assist.reviewFocus).toEqual(expect.arrayContaining([
      "Check for personal data exposure in the preview.",
      "Apply no action unless the human review confirms it.",
    ]));
    expect(JSON.stringify(queuedReport)).not.toContain("@test.resonate");
    expect(JSON.stringify(queuedReport)).not.toContain(holderWallet);
    expect(JSON.stringify(queue.privacy)).toContain("noWalletAddresses");
    await expect(prisma.communityModerationReport.findUniqueOrThrow({ where: { id: report.report.id } }))
      .resolves.toMatchObject({ status: "open" });
    await expect(prisma.communityMessage.findUniqueOrThrow({ where: { id: message.message.id } }))
      .resolves.toMatchObject({ status: "visible" });
    await expect(prisma.communityRoom.findUniqueOrThrow({ where: { id: room.id } }))
      .resolves.toMatchObject({ status: "active" });

    const resolved = await service.resolveModerationReport(
      { userId: "admin", role: "admin" },
      report.report.id,
      { action: "ban_member", note: "Repeated abuse." },
    );

    expect(resolved).toMatchObject({
      schemaVersion: "community-moderation-resolution/v1",
      action: { type: "ban_member", status: "resolved", noteStored: false },
      privacy: { noWalletAddresses: true, noUserEmails: true },
    });
    await expect(
      prisma.communityMembership.findUniqueOrThrow({
        where: { CommunityMembership_identity: { roomId: room.id, userId: listenerUserId } },
      }),
    ).resolves.toMatchObject({ status: "banned" });
    await expect(prisma.communityModerationReport.findUniqueOrThrow({ where: { id: report.report.id } }))
      .resolves.toMatchObject({ status: "resolved" });
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.moderation_action_taken",
      reportId: report.report.id,
      action: "ban_member",
      outcome: "resolved",
      hasOperatorNote: true,
    }));
    await expect(
      service.resolveModerationReport(
        { userId: "admin-2", role: "admin" },
        report.report.id,
        { action: "no_action" },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("creates campaign supporter rooms and gates them by confirmed pledge support", async () => {
    const locked = await service.getShowCampaignCommunity(otherUserId, campaignSlug);
    const lockedRoom = locked.rooms.find((room) => room.roomType === "show_campaign_supporter");
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
      campaignSlug,
      campaignStatus: "active",
      roomType: "show_campaign_supporter",
      city: "Paris",
      country: "FR",
    }));
  });

  it("lets any authenticated fan join campaign city demand without pledge support", async () => {
    const community = await service.getShowCampaignCommunity(otherUserId, campaignSlug);
    const cityRoom = community.rooms.find((room) => room.roomType === "show_city_demand");

    expect(cityRoom).toMatchObject({
      roomType: "show_city_demand",
      access: expect.objectContaining({
        joinable: true,
        reason: "open",
      }),
    });

    await expect(service.joinShowCampaignCityDemand(otherUserId, campaignSlug)).resolves.toMatchObject({
      membership: { status: "active", role: "city_member" },
      room: { roomType: "show_city_demand" },
    });
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.show_city_interest_joined",
      campaignId,
      campaignSlug,
      campaignStatus: "active",
      city: "Paris",
      country: "FR",
    }));
  });

  it("does not duplicate city demand analytics for already joined fans", async () => {
    await expect(service.joinShowCampaignCityDemand(holderUserId, campaignSlug)).resolves.toMatchObject({
      membership: { status: "active", role: "city_member" },
      room: { roomType: "show_city_demand" },
    });
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.show_city_interest_joined",
      campaignId,
    }));

    eventBus.publish.mockClear();
    await expect(service.joinShowCampaignCityDemand(holderUserId, campaignSlug)).resolves.toMatchObject({
      membership: { status: "active", role: "city_member" },
      room: { roomType: "show_city_demand" },
    });

    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it("opens city demand groups for fan signal campaigns", async () => {
    const community = await service.getShowCampaignCommunity(otherUserId, signalCampaignSlug);

    expect(community.rooms).toEqual([
      expect.objectContaining({
        roomType: "show_city_demand",
        ownerId: signalCampaignId,
        access: expect.objectContaining({ joinable: true }),
      }),
    ]);
  });

  it("does not open city demand groups for draft escrow campaigns", async () => {
    await expect(service.getShowCampaignCommunity(otherUserId, draftEscrowCampaignSlug)).rejects.toThrow(BadRequestException);
    await expect(service.joinShowCampaignCityDemand(otherUserId, draftEscrowCampaignSlug)).rejects.toThrow(BadRequestException);
  });

  it("does not open supporter rooms for inactive campaign lifecycles", async () => {
    await expect(service.joinShowCampaignCommunity(listenerUserId, cancelledCampaignSlug)).rejects.toThrow(BadRequestException);
  });

  it("keeps released campaign supporter rooms visible and joinable for released support", async () => {
    const community = await service.getShowCampaignCommunity(listenerUserId, releasedCampaignSlug);
    const supporterRoom = community.rooms.find((room) => room.roomType === "show_campaign_supporter");

    expect(supporterRoom).toMatchObject({
      roomType: "show_campaign_supporter",
      ownerId: releasedCampaignId,
      access: expect.objectContaining({
        joinable: true,
        reason: "eligible",
      }),
    });
    await expect(service.joinShowCampaignCommunity(listenerUserId, releasedCampaignId)).resolves.toMatchObject({
      membership: { status: "active", role: "supporter" },
      room: { roomType: "show_campaign_supporter", ownerId: releasedCampaignId },
    });
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
      campaignSlug,
      campaignStatus: "active",
      city: "Paris",
      country: "FR",
    }));
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.campaign_update_viewed",
      campaignId,
      campaignSlug,
      campaignStatus: "active",
      roomId: joined.room.id,
      roomType: "show_campaign_supporter",
      latestMessageId: update.message.id,
      visibleUpdateCount: 1,
      city: "Paris",
      country: "FR",
    }));

    eventBus.publish.mockClear();
    await service.listMessages(listenerUserId, joined.room.id);
    expect(eventBus.publish).not.toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.campaign_update_viewed",
    }));

    const laterUpdate = await service.createShowCampaignUpdate(
      { userId: artistUserId, role: "artist" },
      campaignId,
      { body: "Booking hold is confirmed." },
    );
    eventBus.publish.mockClear();
    await service.listMessages(listenerUserId, joined.room.id);
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.campaign_update_viewed",
      latestMessageId: laterUpdate.message.id,
      visibleUpdateCount: 2,
    }));

    await service.deleteMessage(artistUserId, laterUpdate.message.id);
    eventBus.publish.mockClear();
    await service.listMessages(listenerUserId, joined.room.id);
    expect(eventBus.publish).not.toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.campaign_update_viewed",
    }));
  });

  it("revokes stale supporter-room reads when campaign support enters refund lifecycle", async () => {
    const joined = await service.joinShowCampaignCommunity(listenerUserId, campaignId);

    await prisma.showPledge.updateMany({
      where: { campaignId, userId: listenerUserId },
      data: { status: "refund_available", refundAvailableAt: new Date() },
    });
    await prisma.showCampaign.update({
      where: { id: campaignId },
      data: { status: "refund_available", refundAvailableAt: new Date() },
    });

    await expect(service.listMessages(listenerUserId, joined.room.id)).rejects.toThrow(ForbiddenException);

    const membership = await prisma.communityMembership.findUnique({
      where: {
        CommunityMembership_identity: {
          roomId: joined.room.id,
          userId: listenerUserId,
        },
      },
    });
    expect(membership).toMatchObject({
      status: "removed",
      role: "supporter",
    });
    expect(membership?.endedAt).toBeInstanceOf(Date);
  });
});
