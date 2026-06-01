import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CommunityRoom, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { CommunityEligibilityService } from "./community_eligibility.service";

const ROOM_STATUSES = ["active", "paused", "archived"] as const;
const MESSAGE_TYPES = ["message", "announcement", "campaign_update"] as const;
const MODERATION_ACTIONS = ["remove", "ban"] as const;
const SHOW_CAMPAIGN_ROOM_STATUSES = ["active", "funded", "booking_confirmed", "deposit_released"] as const;
const SHOW_CITY_DEMAND_SIGNAL_STATUSES = ["draft", "active", "funded", "booking_confirmed", "deposit_released"] as const;
const SHOW_CITY_DEMAND_CAMPAIGN_STATUSES = ["active", "funded", "booking_confirmed", "deposit_released"] as const;

type RoomStatus = (typeof ROOM_STATUSES)[number];
type MessageType = (typeof MESSAGE_TYPES)[number];
type ModerationAction = (typeof MODERATION_ACTIONS)[number];
type Actor = { userId: string; role?: string | null };

@Injectable()
export class CommunityRoomsService {
  constructor(
    private readonly eligibility: CommunityEligibilityService,
    private readonly eventBus: EventBus,
  ) {}

  async enableArtistCommunity(userId: string, artistId: string) {
    const artist = await this.requireArtistOperator(userId, artistId);
    const [publicRoom, holderRoom] = await prisma.$transaction([
      prisma.communityRoom.upsert({
        where: { CommunityRoom_identity: { roomType: "artist_public", ownerType: "artist", ownerId: artistId } },
        update: { status: "active" },
        create: {
          roomType: "artist_public",
          ownerType: "artist",
          ownerId: artistId,
          artistId,
          title: `${artist.displayName} Community`,
          description: "Public artist community room.",
          status: "active",
        },
      }),
      prisma.communityRoom.upsert({
        where: { CommunityRoom_identity: { roomType: "artist_holder", ownerType: "artist", ownerId: artistId } },
        update: { status: "active" },
        create: {
          roomType: "artist_holder",
          ownerType: "artist",
          ownerId: artistId,
          artistId,
          title: `${artist.displayName} Holder Room`,
          description: "Private room for eligible holders and supporters.",
          accessPolicyJson: {
            type: "any_of",
            policies: [
              { type: "ownership", assetType: "stem_nft", artistId },
              { type: "role", roleType: "holder", scopeType: "artist", scopeId: artistId },
            ],
          },
          status: "active",
        },
      }),
    ]);

    this.publish("community.artist_tab_enabled", userId, { artistId });
    return {
      schemaVersion: "community-artist-rooms/v1",
      artist: artistDto(artist),
      rooms: [roomDto(publicRoom), roomDto(holderRoom)],
    };
  }

  async listArtistRooms(artistId: string, userId?: string) {
    const artist = await prisma.artist.findUnique({ where: { id: artistId } });
    if (!artist) throw new NotFoundException("Artist not found");
    const rooms = await prisma.communityRoom.findMany({
      where: { ownerType: "artist", ownerId: artistId, status: { not: "archived" } },
      orderBy: [{ roomType: "asc" }, { createdAt: "asc" }],
    });
    const memberships = userId
      ? await prisma.communityMembership.findMany({
          where: { userId, roomId: { in: rooms.map((room) => room.id) } },
        })
      : [];
    const membershipsByRoom = new Map(memberships.map((membership) => [membership.roomId, membership]));

    return {
      schemaVersion: "community-artist-rooms/v1",
      artist: artistDto(artist),
      rooms: await Promise.all(
        rooms.map(async (room) => {
          const membership = membershipsByRoom.get(room.id);
          const access = userId ? await this.describeRoomAccess(userId, room) : publicRoomAccessDto(room);
          return roomDto(room, membership, access);
        }),
      ),
    };
  }

  async getShowCampaignCommunity(userId: string, campaignIdOrSlug: string) {
    await this.ensureUser(userId);
    const campaign = await this.findShowCampaign(campaignIdOrSlug);
    const rooms: RoomRecord[] = [];

    if (isShowCampaignCityDemandAvailable(campaign)) {
      rooms.push(await this.ensureShowCampaignCityDemandRoomForCampaign(campaign));
    }
    if (isShowCampaignSupporterRoomAvailable(campaign)) {
      rooms.push((await this.ensureShowCampaignSupporterRoomForCampaign(campaign)).room);
    }
    if (rooms.length === 0) {
      throw new BadRequestException("This campaign does not currently expose community rooms");
    }

    const memberships = await prisma.communityMembership.findMany({
      where: { userId, roomId: { in: rooms.map((room) => room.id) } },
    });
    const membershipsByRoom = new Map(memberships.map((membership) => [membership.roomId, membership]));

    return {
      schemaVersion: "show-campaign-community/v1",
      campaign: campaignDto(campaign),
      rooms: await Promise.all(
        rooms.map(async (room) => roomDto(room, membershipsByRoom.get(room.id), await this.describeRoomAccess(userId, room))),
      ),
    };
  }

  async joinShowCampaignCommunity(userId: string, campaignIdOrSlug: string) {
    const { room } = await this.ensureShowCampaignSupporterRoom(campaignIdOrSlug);
    const result = await this.joinRoom(userId, room.id);
    await this.eligibility.syncCampaignSupporterBadges(userId, room.ownerId);
    return result;
  }

  async joinShowCampaignCityDemand(userId: string, campaignIdOrSlug: string) {
    const { campaign, room } = await this.ensureShowCampaignCityDemandRoom(campaignIdOrSlug);
    const result = await this.joinRoomMembership(userId, room.id);
    if (result.joinedNow) {
      this.publish("community.show_city_interest_joined", userId, {
        campaignId: campaign.id,
        campaignSlug: campaign.slug,
        campaignStatus: campaign.status,
        roomId: room.id,
        roomType: room.roomType,
        artistId: campaign.artistId,
        city: campaign.city,
        country: campaign.country,
      });
    }
    return result.response;
  }

  async createShowCampaignUpdate(actor: Actor, campaignIdOrSlug: string, input: { body?: unknown }) {
    const { campaign, room } = await this.ensureShowCampaignSupporterRoom(campaignIdOrSlug);
    await this.requireCampaignOperator(actor, campaign);
    const body = normalizeBody(input.body);
    const message = await prisma.communityMessage.create({
      data: { roomId: room.id, authorId: actor.userId, body, messageType: "campaign_update" },
    });
    this.publish("community.message_created", actor.userId, {
      roomId: room.id,
      messageId: message.id,
      messageType: "campaign_update",
      campaignId: campaign.id,
      campaignSlug: campaign.slug,
      campaignStatus: campaign.status,
      city: campaign.city,
      country: campaign.country,
    });
    return {
      schemaVersion: "community-message/v1",
      message: messageDto(message),
      campaign: campaignDto(campaign),
    };
  }

  async joinRoom(userId: string, roomId: string) {
    const result = await this.joinRoomMembership(userId, roomId);
    return result.response;
  }

  private async joinRoomMembership(userId: string, roomId: string) {
    await this.ensureUser(userId);
    const room = await this.getRoom(roomId);
    try {
      await this.assertRoomJoinable(userId, room);
    } catch (error) {
      if (error instanceof ForbiddenException) {
        this.publish("community.room_access_denied", userId, {
          roomId,
          roomType: room.roomType,
          artistId: room.artistId,
          ...campaignSourceRef(room),
          reason: accessDeniedReason(error),
        });
      }
      throw error;
    }
    const existingMembership = await prisma.communityMembership.findUnique({
      where: { CommunityMembership_identity: { roomId, userId } },
    });
    const joinedNow = existingMembership?.status !== "active";
    const membership = await prisma.communityMembership.upsert({
      where: { CommunityMembership_identity: { roomId, userId } },
      update: {
        status: "active",
        endedAt: null,
        role: roomMembershipRole(room),
        sourceType: roomMembershipSource(room),
      },
      create: {
        roomId,
        userId,
        role: roomMembershipRole(room),
        sourceType: roomMembershipSource(room),
      },
    });

    if (joinedNow) {
      this.publish("community.room_joined", userId, {
        roomId,
        roomType: room.roomType,
        artistId: room.artistId,
        ...campaignSourceRef(room),
      });
      if (room.ownerType === "show_campaign" && room.roomType === "show_campaign_supporter") {
        this.publish("community.campaign_room_joined", userId, {
          roomId,
          roomType: room.roomType,
          ...(await this.showCampaignAnalyticsRef(room)),
        });
      }
    }
    const response = {
      schemaVersion: "community-membership/v1",
      room: roomDto(room, membership),
      membership: membershipDto(membership),
    };
    return { response, joinedNow, room, membership };
  }

  async leaveRoom(userId: string, roomId: string) {
    const membership = await prisma.communityMembership.findUnique({
      where: { CommunityMembership_identity: { roomId, userId } },
      include: { room: true },
    });
    if (!membership || membership.status !== "active") {
      throw new NotFoundException("Active community membership not found");
    }
    const updated = await prisma.communityMembership.update({
      where: { id: membership.id },
      data: { status: "left", endedAt: new Date() },
    });

    this.publish("community.room_left", userId, {
      roomId,
      roomType: membership.room.roomType,
      artistId: membership.room.artistId,
      ...campaignSourceRef(membership.room),
    });
    return { schemaVersion: "community-membership/v1", membership: membershipDto(updated) };
  }

  async listMessages(userId: string, roomId: string) {
    const room = await this.getRoom(roomId);
    await this.assertCanReadRoom(userId, room);
    const messages = await prisma.communityMessage.findMany({
      where: { roomId, status: "visible" },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    await this.publishCampaignUpdateViewed(userId, room, messages);
    return {
      schemaVersion: "community-messages/v1",
      room: roomDto(room),
      messages: messages.map(messageDto),
    };
  }

  async createMessage(userId: string, roomId: string, input: { body?: unknown; messageType?: unknown }) {
    const room = await this.getRoom(roomId);
    const messageType = normalizeMessageType(input.messageType);
    const body = normalizeBody(input.body);
    if (messageType === "announcement" || messageType === "campaign_update") {
      await this.requireRoomOperator(userId, room);
    } else {
      await this.assertCanWriteRoom(userId, room);
    }

    const message = await prisma.communityMessage.create({
      data: { roomId, authorId: userId, body, messageType },
    });
    this.publish("community.message_created", userId, {
      roomId,
      messageId: message.id,
      messageType,
      ...(await this.messageAnalyticsRef(room)),
    });
    return { schemaVersion: "community-message/v1", message: messageDto(message) };
  }

  async reportMessage(userId: string, messageId: string, input: { reason?: unknown }) {
    await this.ensureUser(userId);
    const reason = normalizeReason(input.reason);
    const message = await prisma.communityMessage.findUnique({ where: { id: messageId }, include: { room: true } });
    if (!message || message.status !== "visible") throw new NotFoundException("Community message not found");
    await this.assertCanReadRoom(userId, message.room);

    const report = await prisma.communityModerationReport.create({
      data: { roomId: message.roomId, messageId, reporterUserId: userId, reason },
    });
    this.publish("community.message_reported", userId, {
      roomId: message.roomId,
      messageId,
      reportId: report.id,
      ...campaignSourceRef(message.room),
    });
    return { schemaVersion: "community-moderation-report/v1", report: reportDto(report) };
  }

  async deleteMessage(userId: string, messageId: string) {
    const message = await prisma.communityMessage.findUnique({ where: { id: messageId }, include: { room: true } });
    if (!message || message.status !== "visible") throw new NotFoundException("Community message not found");
    if (message.authorId !== userId) {
      await this.requireRoomOperator(userId, message.room);
    }
    const updated = await prisma.communityMessage.update({
      where: { id: messageId },
      data: { status: message.authorId === userId ? "deleted_by_author" : "deleted_by_moderator", deletedAt: new Date() },
    });
    this.publish("community.message_deleted", userId, {
      roomId: message.roomId,
      messageId,
      ...campaignSourceRef(message.room),
    });
    return { schemaVersion: "community-message/v1", message: messageDto(updated) };
  }

  async moderateMember(operatorUserId: string, roomId: string, targetUserId: string, input: { action?: unknown }) {
    const room = await this.getRoom(roomId);
    await this.requireRoomOperator(operatorUserId, room);
    const action = normalizeModerationAction(input.action);
    const membership = await prisma.communityMembership.findUnique({
      where: { CommunityMembership_identity: { roomId, userId: targetUserId } },
    });
    if (!membership) throw new NotFoundException("Community membership not found");
    const updated = await prisma.communityMembership.update({
      where: { id: membership.id },
      data: {
        status: action === "ban" ? "banned" : "removed",
        endedAt: new Date(),
      },
    });
    this.publish("community.member_moderated", operatorUserId, { roomId, targetUserId, action });
    return { schemaVersion: "community-membership/v1", membership: membershipDto(updated) };
  }

  async updateRoomStatus(operatorUserId: string, roomId: string, input: { status?: unknown }) {
    const room = await this.getRoom(roomId);
    await this.requireRoomOperator(operatorUserId, room);
    const status = normalizeRoomStatus(input.status);
    const updated = await prisma.communityRoom.update({ where: { id: roomId }, data: { status } });
    this.publish("community.room_status_updated", operatorUserId, { roomId, status });
    return { schemaVersion: "community-room/v1", room: roomDto(updated) };
  }

  private async assertRoomJoinable(userId: string, room: RoomRecord) {
    if (room.status !== "active") throw new ForbiddenException("This community room is not active");
    const existing = await prisma.communityMembership.findUnique({
      where: { CommunityMembership_identity: { roomId: room.id, userId } },
    });
    if (existing?.status === "banned") {
      throw new ForbiddenException("You cannot join this community room");
    }
    if (room.accessPolicyJson) {
      const result = await this.eligibility.evaluateAccessPolicy(userId, room.accessPolicyJson ?? { type: "manual" });
      if (!result.eligible) {
        throw new ForbiddenException(roomAccessDeniedMessage(room));
      }
    }
  }

  private async assertCanReadRoom(userId: string, room: RoomRecord) {
    if (await this.isRoomOperator(userId, room)) return;
    const membership = await prisma.communityMembership.findUnique({
      where: { CommunityMembership_identity: { roomId: room.id, userId } },
    });
    if (membership?.status !== "active") throw new ForbiddenException("Join this community room to read messages");
  }

  private async assertCanWriteRoom(userId: string, room: RoomRecord) {
    await this.assertCanReadRoom(userId, room);
    if (room.status !== "active") throw new ForbiddenException("This community room is not active");
  }

  private async requireRoomOperator(userId: string, room: RoomRecord) {
    if (!(await this.isRoomOperator(userId, room))) {
      throw new ForbiddenException("Artist community moderation is restricted to the artist owner or operators");
    }
  }

  private async isRoomOperator(userId: string, room: RoomRecord) {
    if (!room.artistId) return userId === "operator" || userId === "admin";
    const artist = await prisma.artist.findUnique({ where: { id: room.artistId } });
    return Boolean(artist && canOperateArtist(userId, artist));
  }

  private async requireCampaignOperator(actor: Actor, campaign: { artistId: string | null }) {
    if (actor.role === "admin" || actor.role === "operator" || actor.userId === "admin" || actor.userId === "operator") {
      return;
    }
    if (!campaign.artistId) {
      throw new ForbiddenException("Campaign updates require the campaign artist or an operator");
    }
    await this.requireArtistOperator(actor.userId, campaign.artistId);
  }

  private async requireArtistOperator(userId: string, artistId: string) {
    const artist = await prisma.artist.findUnique({ where: { id: artistId } });
    if (!artist) throw new NotFoundException("Artist not found");
    if (!canOperateArtist(userId, artist)) {
      throw new ForbiddenException("Artist community management is restricted to the artist owner or operators");
    }
    return artist;
  }

  private async describeRoomAccess(userId: string, room: RoomRecord) {
    if (!room.accessPolicyJson) return publicRoomAccessDto(room);
    const result = await this.eligibility.evaluateAccessPolicy(userId, room.accessPolicyJson);
    return {
      joinable: result.eligible,
      reason: result.eligible ? "eligible" : gatedRoomReason(room),
      reasons: result.eligible ? result.reasons : [gatedRoomReason(room)],
    };
  }

  private async getRoom(roomId: string) {
    const room = await prisma.communityRoom.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Community room not found");
    return room;
  }

  private async showCampaignAnalyticsRef(room: { ownerType: string; ownerId: string; artistId: string | null }) {
    if (room.ownerType !== "show_campaign") return {};
    const campaign = await prisma.showCampaign.findUnique({
      where: { id: room.ownerId },
      select: {
        id: true,
        slug: true,
        status: true,
        artistId: true,
        city: true,
        country: true,
      },
    });
    if (!campaign) return { campaignId: room.ownerId, artistId: room.artistId };
    return {
      campaignId: campaign.id,
      campaignSlug: campaign.slug,
      campaignStatus: campaign.status,
      artistId: campaign.artistId,
      city: campaign.city,
      country: campaign.country,
    };
  }

  private async messageAnalyticsRef(room: RoomRecord) {
    if (room.ownerType === "show_campaign") {
      return this.showCampaignAnalyticsRef(room);
    }
    return campaignSourceRef(room);
  }

  private async publishCampaignUpdateViewed(
    userId: string,
    room: RoomRecord,
    messages: Array<{ id: string; messageType: string; createdAt: Date }>,
  ) {
    if (room.ownerType !== "show_campaign" || room.roomType !== "show_campaign_supporter") {
      return;
    }
    const campaignUpdates = messages.filter((message) => message.messageType === "campaign_update");
    if (campaignUpdates.length === 0) {
      return;
    }
    const latestUpdate = campaignUpdates[campaignUpdates.length - 1];
    const membership = await prisma.communityMembership.findUnique({
      where: { CommunityMembership_identity: { roomId: room.id, userId } },
      select: {
        id: true,
        status: true,
        lastViewedCampaignUpdateAt: true,
      },
    });
    if (
      membership?.status !== "active"
      || (
        membership.lastViewedCampaignUpdateAt
        && membership.lastViewedCampaignUpdateAt.getTime() >= latestUpdate.createdAt.getTime()
      )
    ) {
      return;
    }
    await prisma.communityMembership.update({
      where: { id: membership.id },
      data: {
        lastViewedCampaignUpdateId: latestUpdate.id,
        lastViewedCampaignUpdateAt: latestUpdate.createdAt,
      },
    });
    this.publish("community.campaign_update_viewed", userId, {
      roomId: room.id,
      roomType: room.roomType,
      latestMessageId: latestUpdate.id,
      visibleUpdateCount: campaignUpdates.length,
      ...(await this.showCampaignAnalyticsRef(room)),
    });
  }

  private async ensureUser(userId: string) {
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, email: `${userId}@wallet.local` },
    });
  }

  private async ensureShowCampaignSupporterRoom(campaignIdOrSlug: string) {
    const campaign = await this.findShowCampaign(campaignIdOrSlug);
    return this.ensureShowCampaignSupporterRoomForCampaign(campaign);
  }

  private async ensureShowCampaignSupporterRoomForCampaign(campaign: ShowCampaignRecord) {
    if (!isShowCampaignSupporterRoomAvailable(campaign)) {
      throw new BadRequestException("Only active, funded, or booking-confirmed escrow campaigns can open supporter rooms");
    }

    const room = await prisma.communityRoom.upsert({
      where: {
        CommunityRoom_identity: {
          roomType: "show_campaign_supporter",
          ownerType: "show_campaign",
          ownerId: campaign.id,
        },
      },
      update: {
        artistId: campaign.artistId,
        title: `${campaign.title} Supporter Room`,
        description: "Private supporter room for confirmed campaign backers.",
        accessPolicyJson: campaignSupportPolicy(campaign.id),
      },
      create: {
        roomType: "show_campaign_supporter",
        ownerType: "show_campaign",
        ownerId: campaign.id,
        artistId: campaign.artistId,
        title: `${campaign.title} Supporter Room`,
        description: "Private supporter room for confirmed campaign backers.",
        accessPolicyJson: campaignSupportPolicy(campaign.id),
        status: "active",
      },
    });

    return { campaign, room };
  }

  private async ensureShowCampaignCityDemandRoom(campaignIdOrSlug: string) {
    const campaign = await this.findShowCampaign(campaignIdOrSlug);
    const room = await this.ensureShowCampaignCityDemandRoomForCampaign(campaign);
    return { campaign, room };
  }

  private async ensureShowCampaignCityDemandRoomForCampaign(campaign: ShowCampaignRecord) {
    if (!isShowCampaignCityDemandAvailable(campaign)) {
      throw new BadRequestException("This campaign cannot currently accept city demand interest");
    }

    return prisma.communityRoom.upsert({
      where: {
        CommunityRoom_identity: {
          roomType: "show_city_demand",
          ownerType: "show_campaign",
          ownerId: campaign.id,
        },
      },
      update: {
        artistId: campaign.artistId,
        title: `${campaign.city} Demand Group`,
        description: `Open demand signal for ${campaign.title} in ${campaign.city}, ${campaign.country}.`,
        accessPolicyJson: Prisma.DbNull,
      },
      create: {
        roomType: "show_city_demand",
        ownerType: "show_campaign",
        ownerId: campaign.id,
        artistId: campaign.artistId,
        title: `${campaign.city} Demand Group`,
        description: `Open demand signal for ${campaign.title} in ${campaign.city}, ${campaign.country}.`,
        status: "active",
      },
    });
  }

  private async findShowCampaign(campaignIdOrSlug: string) {
    const campaign = await prisma.showCampaign.findFirst({
      where: {
        OR: [
          { id: campaignIdOrSlug },
          { slug: campaignIdOrSlug },
        ],
      },
    });
    if (!campaign) throw new NotFoundException("Show campaign not found");
    return campaign;
  }

  private publish(eventName: string, userId: string, payload: Record<string, unknown>) {
    this.eventBus.publish({
      eventName,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      userId,
      ...payload,
    } as never);
  }
}

type RoomRecord = CommunityRoom;
type ShowCampaignRecord = {
  id: string;
  slug: string;
  title: string;
  artistId: string | null;
  artistDisplayName: string;
  city: string;
  country: string;
  status: string;
  campaignLevel: string;
};

function campaignSupportPolicy(campaignId: string): Prisma.InputJsonObject {
  return { type: "campaign_support", campaignId, minStatus: "confirmed" };
}

function isShowCampaignSupporterRoomAvailable(campaign: { campaignLevel: string; status: string }) {
  return campaign.campaignLevel === "active_escrow_campaign"
    && SHOW_CAMPAIGN_ROOM_STATUSES.includes(campaign.status as (typeof SHOW_CAMPAIGN_ROOM_STATUSES)[number]);
}

function isShowCampaignCityDemandAvailable(campaign: { campaignLevel: string; status: string }) {
  if (campaign.campaignLevel === "signal") {
    return SHOW_CITY_DEMAND_SIGNAL_STATUSES.includes(campaign.status as (typeof SHOW_CITY_DEMAND_SIGNAL_STATUSES)[number]);
  }
  return ["provisional_campaign", "active_escrow_campaign"].includes(campaign.campaignLevel)
    && SHOW_CITY_DEMAND_CAMPAIGN_STATUSES.includes(campaign.status as (typeof SHOW_CITY_DEMAND_CAMPAIGN_STATUSES)[number]);
}

function canOperateArtist(userId: string, artist: { userId: string | null }) {
  return artist.userId === userId || userId === "operator" || userId === "admin";
}

function artistDto(artist: { id: string; displayName: string; imageUrl?: string | null }) {
  return {
    id: artist.id,
    displayName: artist.displayName,
    imageUrl: artist.imageUrl ?? null,
  };
}

function campaignDto(campaign: {
  id: string;
  slug: string;
  title: string;
  artistId: string | null;
  artistDisplayName: string;
  city: string;
  country: string;
  status: string;
  campaignLevel: string;
}) {
  return {
    id: campaign.id,
    slug: campaign.slug,
    title: campaign.title,
    artistId: campaign.artistId,
    artistDisplayName: campaign.artistDisplayName,
    city: campaign.city,
    country: campaign.country,
    status: campaign.status,
    campaignLevel: campaign.campaignLevel,
  };
}

function roomDto(
  room: { id: string; roomType: string; ownerType: string; ownerId: string; artistId: string | null; title: string; description: string | null; status: string; createdAt: Date; updatedAt: Date },
  membership?: { role: string; status: string; joinedAt: Date; endedAt: Date | null } | null,
  access?: Record<string, unknown>,
) {
  return {
    id: room.id,
    roomType: room.roomType,
    ownerType: room.ownerType,
    ownerId: room.ownerId,
    artistId: room.artistId,
    title: room.title,
    description: room.description,
    status: room.status,
    membership: membership ? membershipDto(membership) : null,
    access: access ?? publicRoomAccessDto(room),
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  };
}

function publicRoomAccessDto(room: { roomType: string; status: string }) {
  return {
    joinable: room.status === "active" && !isGatedRoomType(room.roomType),
    reason: isGatedRoomType(room.roomType) ? gatedRoomReason(room) : "open",
  };
}

function isGatedRoomType(roomType: string) {
  return roomType === "artist_holder" || roomType === "show_campaign_supporter";
}

function gatedRoomReason(room: { roomType: string }) {
  if (room.roomType === "show_campaign_supporter") return "campaign_support_required";
  if (room.roomType === "artist_holder") return "holder_required";
  return "open";
}

function roomAccessDeniedMessage(room: { roomType: string }) {
  if (room.roomType === "show_campaign_supporter") {
    return "Confirmed campaign support is required for this room";
  }
  if (room.roomType === "artist_holder") {
    return "Holder access is locked for this listener";
  }
  return "Community room access denied";
}

function roomMembershipRole(room: { roomType: string }) {
  if (room.roomType === "artist_holder") return "holder";
  if (room.roomType === "show_campaign_supporter") return "supporter";
  if (room.roomType === "show_city_demand") return "city_member";
  return "member";
}

function roomMembershipSource(room: { roomType: string }) {
  if (room.roomType === "artist_holder") return "eligibility";
  if (room.roomType === "show_campaign_supporter") return "campaign_support";
  if (room.roomType === "show_city_demand") return "city_interest";
  return "manual";
}

function campaignSourceRef(room: { ownerType: string; ownerId: string }) {
  return room.ownerType === "show_campaign" ? { campaignId: room.ownerId } : {};
}

function membershipDto(membership: { role: string; status: string; joinedAt: Date; endedAt: Date | null }) {
  return {
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt.toISOString(),
    endedAt: membership.endedAt?.toISOString() ?? null,
  };
}

function messageDto(message: { id: string; roomId: string; authorId: string; body: string; messageType: string; status: string; createdAt: Date; updatedAt: Date; deletedAt: Date | null }) {
  return {
    id: message.id,
    roomId: message.roomId,
    authorId: message.authorId,
    body: message.status === "visible" ? message.body : null,
    messageType: message.messageType,
    status: message.status,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    deletedAt: message.deletedAt?.toISOString() ?? null,
  };
}

function reportDto(report: { id: string; roomId: string; messageId: string | null; reporterUserId: string; reason: string; status: string; createdAt: Date; resolvedAt: Date | null }) {
  return {
    id: report.id,
    roomId: report.roomId,
    messageId: report.messageId,
    reporterUserId: report.reporterUserId,
    reason: report.reason,
    status: report.status,
    createdAt: report.createdAt.toISOString(),
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
  };
}

function normalizeMessageType(input: unknown): MessageType {
  if (input === undefined) return "message";
  if (typeof input !== "string") throw new BadRequestException("messageType must be a string");
  const normalized = input.trim().toLowerCase();
  if (!MESSAGE_TYPES.includes(normalized as MessageType)) {
    throw new BadRequestException("messageType must be message, announcement, or campaign_update");
  }
  return normalized as MessageType;
}

function normalizeBody(input: unknown) {
  if (typeof input !== "string") throw new BadRequestException("body must be a string");
  const body = input.trim();
  if (!body || body.length > 2000) throw new BadRequestException("body must be 1-2000 characters");
  return body;
}

function normalizeReason(input: unknown) {
  if (typeof input !== "string") throw new BadRequestException("reason must be a string");
  const reason = input.trim();
  if (!reason || reason.length > 200) throw new BadRequestException("reason must be 1-200 characters");
  return reason;
}

function normalizeModerationAction(input: unknown): ModerationAction {
  if (typeof input !== "string") throw new BadRequestException("action must be a string");
  const normalized = input.trim().toLowerCase();
  if (!MODERATION_ACTIONS.includes(normalized as ModerationAction)) {
    throw new BadRequestException("action must be remove or ban");
  }
  return normalized as ModerationAction;
}

function normalizeRoomStatus(input: unknown): RoomStatus {
  if (typeof input !== "string") throw new BadRequestException("status must be a string");
  const normalized = input.trim().toLowerCase();
  if (!ROOM_STATUSES.includes(normalized as RoomStatus)) {
    throw new BadRequestException("status must be active, paused, or archived");
  }
  return normalized as RoomStatus;
}

function accessDeniedReason(error: ForbiddenException) {
  const response = error.getResponse();
  if (typeof response === "string") return response;
  if (response && typeof response === "object" && "message" in response) {
    const message = (response as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join(", ");
    if (typeof message === "string") return message;
  }
  return "Community room access denied";
}
