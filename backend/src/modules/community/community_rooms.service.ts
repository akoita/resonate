import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CommunityCohort, CommunityCohortMembership, CommunityRoom, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { PUBLIC_RELEASE_ROUTES } from "../catalog/catalog-public.constants";
import { EventBus } from "../shared/event_bus";
import {
  ACTIVE_CAMPAIGN_SUPPORT_CAMPAIGN_STATUSES,
  CommunityEligibilityService,
} from "./community_eligibility.service";

const ROOM_STATUSES = ["active", "paused", "archived"] as const;
const MESSAGE_TYPES = ["message", "announcement", "campaign_update"] as const;
const MODERATION_ACTIONS = ["remove", "ban"] as const;
const MODERATION_QUEUE_STATUSES = ["open", "resolved", "dismissed"] as const;
const MODERATION_RESOLUTION_ACTIONS = [
  "no_action",
  "delete_message",
  "remove_member",
  "ban_member",
  "pause_room",
  "archive_room",
] as const;
const PUBLIC_RELEASE_STATUSES = ["ready", "published"] as const;
const RELEASE_ARTIST_COMMUNITY_ROLES = ["main", "primary"] as const;
const SHOW_CITY_DEMAND_SIGNAL_STATUSES = ["draft", "active", "funded", "booking_confirmed", "deposit_released"] as const;
const SHOW_CITY_DEMAND_CAMPAIGN_STATUSES = ["active", "funded", "booking_confirmed", "deposit_released"] as const;
const VISIBLE_COHORT_STATUSES = ["suggested", "active"] as const;
const COHORT_ROOM_MEMBERSHIP_STATUS = "joined";
const SOCIAL_TASTE_COHORT_TYPES = ["taste", "artist_affinity", "collector", "campaign"] as const;
const MODERATION_ASSIST_SAFETY_PATTERN =
  /\b(threat(?:en(?:ed|ing|s)?)?|harm(?:ed|ful|ing|s)?|abus(?:e|ed|ive|ing)|harass(?:ed|es|ing|ment)?|hat(?:e|eful)|violence|violent|unsafe|safety)\b/;
const MODERATION_ASSIST_PRIVACY_PATTERN =
  /\b(private|privacy|doxx?(?:ed|es|ing)?|emails?|wallets?|addresses?|personal)\b/;
const MODERATION_ASSIST_SPAM_PATTERN =
  /\b(spam(?:med|ming|my)?|scam(?:med|mer|ming|s)?|phish(?:ed|ing)?|fraud|bots?)\b/;

type RoomStatus = (typeof ROOM_STATUSES)[number];
type MessageType = (typeof MESSAGE_TYPES)[number];
type ModerationAction = (typeof MODERATION_ACTIONS)[number];
type ModerationQueueStatus = (typeof MODERATION_QUEUE_STATUSES)[number];
type ModerationResolutionAction = (typeof MODERATION_RESOLUTION_ACTIONS)[number];
type Actor = { userId: string; role?: string | null };

@Injectable()
export class CommunityRoomsService {
  constructor(
    private readonly eligibility: CommunityEligibilityService,
    private readonly eventBus: EventBus,
  ) {}

  async enableArtistCommunity(userId: string, artistId: string) {
    const artist = await this.requireArtistOperator(userId, artistId);
    const [publicRoom, holderRoom] = await this.ensureDefaultArtistCommunityRooms(artist, { activate: true });

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
    let rooms = await prisma.communityRoom.findMany({
      where: { ownerType: "artist", ownerId: artistId, status: { not: "archived" } },
      orderBy: [{ roomType: "asc" }, { createdAt: "asc" }],
    });

    if (await this.shouldProvisionArtistCommunityRooms(artist, rooms)) {
      await this.ensureDefaultArtistCommunityRooms(artist);
      rooms = await prisma.communityRoom.findMany({
        where: { ownerType: "artist", ownerId: artistId, status: { not: "archived" } },
        orderBy: [{ roomType: "asc" }, { createdAt: "asc" }],
      });
    }

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
          const membership = userId
            ? await this.reconcileMembershipAccess(userId, room, membershipsByRoom.get(room.id))
            : null;
          const access = userId ? await this.describeRoomAccess(userId, room) : publicRoomAccessDto(room);
          return roomDto(room, membership, access);
        }),
      ),
    };
  }

  private async shouldProvisionArtistCommunityRooms(
    artist: { id: string; displayName: string; profileType?: string | null },
    rooms: Array<{ roomType: string }>,
  ) {
    if (artist.profileType !== "public_artist") {
      return false;
    }

    const roomTypes = new Set(rooms.map((room) => room.roomType));
    if (roomTypes.has("artist_public") && roomTypes.has("artist_holder")) {
      return false;
    }

    const release = await prisma.release.findFirst({
      where: {
        status: { in: [...PUBLIC_RELEASE_STATUSES] },
        OR: [
          { rightsRoute: null },
          { rightsRoute: { in: PUBLIC_RELEASE_ROUTES } },
        ],
        AND: [
          {
            artistCredits: {
              some: {
                artistId: artist.id,
                role: { in: [...RELEASE_ARTIST_COMMUNITY_ROLES] },
              },
            },
          },
        ],
      },
      select: { id: true },
    });

    return Boolean(release);
  }

  private async ensureDefaultArtistCommunityRooms(
    artist: { id: string; displayName: string },
    options?: { activate?: boolean },
  ) {
    return prisma.$transaction([
      prisma.communityRoom.upsert({
        where: { CommunityRoom_identity: { roomType: "artist_public", ownerType: "artist", ownerId: artist.id } },
        update: {
          artistId: artist.id,
          title: `${artist.displayName} Community`,
          description: "Public artist community room.",
          ...(options?.activate ? { status: "active" } : {}),
        },
        create: {
          roomType: "artist_public",
          ownerType: "artist",
          ownerId: artist.id,
          artistId: artist.id,
          title: `${artist.displayName} Community`,
          description: "Public artist community room.",
          status: "active",
        },
      }),
      prisma.communityRoom.upsert({
        where: { CommunityRoom_identity: { roomType: "artist_holder", ownerType: "artist", ownerId: artist.id } },
        update: {
          artistId: artist.id,
          title: `${artist.displayName} Holder Room`,
          description: "Private room for eligible holders and supporters.",
          accessPolicyJson: artistHolderPolicy(artist.id),
          ...(options?.activate ? { status: "active" } : {}),
        },
        create: {
          roomType: "artist_holder",
          ownerType: "artist",
          ownerId: artist.id,
          artistId: artist.id,
          title: `${artist.displayName} Holder Room`,
          description: "Private room for eligible holders and supporters.",
          accessPolicyJson: artistHolderPolicy(artist.id),
          status: "active",
        },
      }),
    ]);
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
        rooms.map(async (room) => {
          const membership = await this.reconcileMembershipAccess(userId, room, membershipsByRoom.get(room.id));
          return roomDto(room, membership, await this.describeRoomAccess(userId, room));
        }),
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

  async getCohortRoom(userId: string, cohortId: string) {
    const cohort = await this.requireCohortRoomAccess(userId, cohortId);
    const room = await this.ensureCohortRoomForCohort(cohort);
    const membership = await prisma.communityMembership.findUnique({
      where: { CommunityMembership_identity: { roomId: room.id, userId } },
    });

    return {
      schemaVersion: "community-cohort-room/v1",
      cohort: cohortRoomCohortDto(cohort),
      room: roomDto(room, membership, await this.describeRoomAccess(userId, room)),
      emptyState: {
        title: "Cohort room is ready",
        description: "Start with a track, stem, show, or scene signal that belongs in this privacy-safe cohort.",
      },
      privacy: cohortRoomPrivacyDto(),
    };
  }

  async joinCohortRoom(userId: string, cohortId: string) {
    const cohort = await this.requireCohortRoomAccess(userId, cohortId);
    const room = await this.ensureCohortRoomForCohort(cohort);
    const result = await this.joinRoomMembership(userId, room.id);

    return {
      schemaVersion: "community-cohort-room-membership/v1",
      cohort: cohortRoomCohortDto(cohort),
      room: roomDto(room, result.membership, await this.describeRoomAccess(userId, room)),
      membership: result.response.membership,
      privacy: cohortRoomPrivacyDto(),
    };
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
      messages: messages.map((message) => messageDto(message, {
        viewerUserId: userId,
        redactOtherAuthors: isCohortRoom(room),
      })),
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
    return {
      schemaVersion: "community-message/v1",
      message: messageDto(message, { viewerUserId: userId, redactOtherAuthors: isCohortRoom(room) }),
    };
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

  async getModerationQueue(input: { status?: unknown; limit?: unknown } = {}) {
    const status = normalizeModerationQueueStatus(input.status);
    const limit = normalizeModerationQueueLimit(input.limit);
    const reports = await prisma.communityModerationReport.findMany({
      where: { status },
      include: { room: true, message: true },
      orderBy: [{ createdAt: "asc" }],
      take: limit,
    });
    const [openReports, pausedRooms, archivedRooms] = await Promise.all([
      prisma.communityModerationReport.count({ where: { status: "open" } }),
      prisma.communityRoom.count({ where: { status: "paused" } }),
      prisma.communityRoom.count({ where: { status: "archived" } }),
    ]);
    const hydratedReports = await Promise.all(reports.map((report) => this.moderationReportDto(report)));

    return {
      schemaVersion: "community-moderation-queue/v1",
      generatedAt: new Date().toISOString(),
      filters: { status, limit },
      summary: {
        returnedReports: hydratedReports.length,
        openReports,
        pausedRooms,
        archivedRooms,
      },
      reports: hydratedReports,
      actions: [...MODERATION_RESOLUTION_ACTIONS],
      privacy: communityModerationPrivacyDto(),
    };
  }

  async resolveModerationReport(actor: Actor, reportId: string, input: { action?: unknown; note?: unknown } = {}) {
    const action = normalizeModerationResolutionAction(input.action);
    const note = normalizeModerationNote(input.note);
    const { report, updated } = await prisma.$transaction(async (tx) => {
      const claim = await tx.communityModerationReport.updateMany({
        where: { id: reportId, status: "open" },
        data: { status: "resolving" },
      });
      if (claim.count === 0) {
        const existing = await tx.communityModerationReport.findUnique({
          where: { id: reportId },
          select: { id: true },
        });
        if (!existing) throw new NotFoundException("Community moderation report not found");
        throw new BadRequestException("Only open moderation reports can be resolved");
      }

      const report = await tx.communityModerationReport.findUnique({
        where: { id: reportId },
        include: { room: true, message: true },
      });
      if (!report) throw new NotFoundException("Community moderation report not found");

      if (action === "delete_message") {
        await this.applyAdminMessageDeletion(tx, report);
      } else if (action === "remove_member" || action === "ban_member") {
        await this.applyAdminMemberModeration(tx, report, action);
      } else if (action === "pause_room" || action === "archive_room") {
        await tx.communityRoom.update({
          where: { id: report.roomId },
          data: { status: action === "pause_room" ? "paused" : "archived" },
        });
      }

      const updated = await tx.communityModerationReport.update({
        where: { id: reportId },
        data: {
          status: action === "no_action" ? "dismissed" : "resolved",
          resolvedAt: new Date(),
        },
        include: { room: true, message: true },
      });
      return { report, updated };
    });
    this.publish("community.moderation_action_taken", actor.userId, {
      reportId,
      roomId: report.roomId,
      messageId: report.messageId,
      action,
      outcome: updated.status,
      hasOperatorNote: Boolean(note),
    });

    return {
      schemaVersion: "community-moderation-resolution/v1",
      report: await this.moderationReportDto(updated),
      action: {
        type: action,
        status: updated.status,
        noteStored: false,
      },
      privacy: communityModerationPrivacyDto(),
    };
  }

  private async applyAdminMessageDeletion(tx: Prisma.TransactionClient, report: ModerationReportWithContext) {
    if (!report.messageId || !report.message) {
      throw new BadRequestException("This report does not have a message to delete");
    }
    if (report.message.status !== "visible") return;
    await tx.communityMessage.update({
      where: { id: report.messageId },
      data: { status: "deleted_by_moderator", deletedAt: new Date() },
    });
  }

  private async applyAdminMemberModeration(
    tx: Prisma.TransactionClient,
    report: ModerationReportWithContext,
    action: "remove_member" | "ban_member",
  ) {
    const targetUserId = report.message?.authorId;
    if (!targetUserId) {
      throw new BadRequestException("This report does not have a message author to moderate");
    }
    const membership = await tx.communityMembership.findUnique({
      where: { CommunityMembership_identity: { roomId: report.roomId, userId: targetUserId } },
    });
    if (!membership) {
      throw new BadRequestException("The reported message author is not a room member");
    }
    await tx.communityMembership.update({
      where: { id: membership.id },
      data: {
        status: action === "ban_member" ? "banned" : "removed",
        endedAt: new Date(),
      },
    });
  }

  private async moderationReportDto(report: ModerationReportWithContext) {
    const [roomOpenReports, messageReportCount, roomMembershipCounts] = await Promise.all([
      prisma.communityModerationReport.count({ where: { roomId: report.roomId, status: "open" } }),
      report.messageId
        ? prisma.communityModerationReport.count({ where: { messageId: report.messageId } })
        : Promise.resolve(0),
      prisma.communityMembership.groupBy({
        by: ["status"],
        where: { roomId: report.roomId },
        _count: { _all: true },
      }),
    ]);
    const room = moderationRoomDto(report.room);
    const message = report.message ? moderationMessageDto(report.message) : null;
    const context = {
      roomOpenReports,
      messageReportCount,
      roomMembershipsByStatus: Object.fromEntries(
        roomMembershipCounts.map((row) => [row.status, row._count._all]),
      ),
    };

    return {
      id: report.id,
      status: report.status,
      reason: previewText(report.reason, 200),
      reporterUserId: report.reporterUserId,
      createdAt: report.createdAt.toISOString(),
      resolvedAt: report.resolvedAt?.toISOString() ?? null,
      room,
      message,
      context,
      assist: moderationAssistDto({
        reason: previewText(report.reason, 200),
        room,
        message,
        context,
      }),
    };
  }

  private async assertRoomJoinable(userId: string, room: RoomRecord) {
    if (room.status !== "active") throw new ForbiddenException("This community room is not active");
    const existing = await prisma.communityMembership.findUnique({
      where: { CommunityMembership_identity: { roomId: room.id, userId } },
    });
    if (existing?.status === "banned") {
      throw new ForbiddenException("You cannot join this community room");
    }
    if (isCohortRoom(room)) {
      await this.assertCohortRoomAccess(userId, room);
      return;
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
    await this.assertMembershipStillEligible(userId, room, membership);
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
    if (isCohortRoom(room)) {
      const access = await this.checkCohortRoomAccess(userId, room.ownerId);
      return {
        joinable: room.status === "active" && access.allowed,
        reason: access.allowed ? "cohort_joined" : access.reason,
        reasons: [access.allowed ? "cohort_joined" : access.reason],
      };
    }
    if (!room.accessPolicyJson) return publicRoomAccessDto(room);
    const result = await this.eligibility.evaluateAccessPolicy(userId, room.accessPolicyJson);
    return {
      joinable: result.eligible,
      reason: result.eligible ? "eligible" : gatedRoomReason(room),
      reasons: result.eligible ? result.reasons : [gatedRoomReason(room)],
    };
  }

  private async reconcileMembershipAccess(
    userId: string,
    room: RoomRecord,
    membership?: { id?: string; role: string; status: string; joinedAt: Date; endedAt: Date | null } | null,
  ) {
    if (!membership || membership.status !== "active" || !shouldReconcileMembershipAccess(room)) {
      return membership ?? null;
    }
    if (isCohortRoom(room)) {
      const access = await this.checkCohortRoomAccess(userId, room.ownerId);
      if (access.allowed) return membership;

      return prisma.communityMembership.update({
        where: membership.id
          ? { id: membership.id }
          : { CommunityMembership_identity: { roomId: room.id, userId } },
        data: {
          status: "removed",
          endedAt: new Date(),
        },
      });
    }
    const result = await this.eligibility.evaluateAccessPolicy(userId, room.accessPolicyJson ?? { type: "manual" });
    if (result.eligible) return membership;

    const endedAt = new Date();
    const updated = await prisma.communityMembership.update({
      where: membership.id
        ? { id: membership.id }
        : { CommunityMembership_identity: { roomId: room.id, userId } },
      data: {
        status: "removed",
        endedAt,
      },
    });
    return updated;
  }

  private async assertMembershipStillEligible(
    userId: string,
    room: RoomRecord,
    membership: { id: string; role: string; status: string; joinedAt: Date; endedAt: Date | null },
  ) {
    if (!shouldReconcileMembershipAccess(room)) return;
    const updated = await this.reconcileMembershipAccess(userId, room, membership);
    if (updated?.status !== "active") {
      throw new ForbiddenException(roomAccessDeniedMessage(room));
    }
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
      throw new BadRequestException("Only support-valid escrow campaigns can open supporter rooms");
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

  private async ensureCohortRoomForCohort(cohort: CommunityCohort) {
    return prisma.communityRoom.upsert({
      where: {
        CommunityRoom_identity: {
          roomType: "cohort",
          ownerType: "cohort",
          ownerId: cohort.id,
        },
      },
      update: {
        title: `${cohort.title} Room`,
        description: "Private room for joined members of this privacy-safe listener cohort.",
        accessPolicyJson: cohortRoomPolicy(cohort.id, cohort.cohortType),
      },
      create: {
        roomType: "cohort",
        ownerType: "cohort",
        ownerId: cohort.id,
        title: `${cohort.title} Room`,
        description: "Private room for joined members of this privacy-safe listener cohort.",
        accessPolicyJson: cohortRoomPolicy(cohort.id, cohort.cohortType),
        status: "active",
      },
    });
  }

  private async requireCohortRoomAccess(userId: string, cohortId: string) {
    await this.ensureUser(userId);
    const access = await this.checkCohortRoomAccess(userId, cohortId, { includeCohort: true });
    if (access.allowed && access.cohort) return access.cohort;
    if (access.reason === "cohort_not_found") throw new NotFoundException("Community cohort not found");
    if (access.reason === "cohort_matching_disabled") {
      throw new ForbiddenException("Community cohort matching is disabled for this listener");
    }
    throw new NotFoundException("Community cohort room not found");
  }

  private async assertCohortRoomAccess(userId: string, room: RoomRecord) {
    const access = await this.checkCohortRoomAccess(userId, room.ownerId);
    if (access.allowed) return;
    if (access.reason === "cohort_matching_disabled") {
      throw new ForbiddenException("Community cohort matching is disabled for this listener");
    }
    throw new ForbiddenException(cohortRoomDeniedMessage(access.reason));
  }

  private async checkCohortRoomAccess(
    userId: string,
    cohortId: string,
    options: { includeCohort?: boolean } = {},
  ): Promise<{
    allowed: boolean;
    reason: string;
    cohort?: CommunityCohort;
    membership?: CommunityCohortMembership;
  }> {
    const cohort = await prisma.communityCohort.findUnique({
      where: { id: cohortId },
      include: {
        memberships: {
          where: { userId },
          take: 1,
        },
      },
    });
    if (!cohort) return { allowed: false, reason: "cohort_not_found" };
    if (!isCohortVisibleForRoom(cohort)) {
      return { allowed: false, reason: "cohort_room_unavailable", cohort: options.includeCohort ? cohort : undefined };
    }
    const visibility = await prisma.communityVisibilitySettings.findUnique({ where: { userId } });
    if (!hasCohortConsentForRoom(cohort.cohortType, visibility)) {
      return { allowed: false, reason: "cohort_matching_disabled", cohort: options.includeCohort ? cohort : undefined };
    }
    const membership = cohort.memberships[0];
    if (!membership || membership.status !== COHORT_ROOM_MEMBERSHIP_STATUS) {
      return {
        allowed: false,
        reason: "cohort_join_required",
        cohort: options.includeCohort ? cohort : undefined,
        membership,
      };
    }
    return { allowed: true, reason: "cohort_joined", cohort, membership };
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
type ModerationReportWithContext = {
  id: string;
  roomId: string;
  messageId: string | null;
  reporterUserId: string;
  reason: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  room: RoomRecord;
  message: {
    id: string;
    roomId: string;
    authorId: string;
    body: string;
    messageType: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  } | null;
};
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

function artistHolderPolicy(artistId: string): Prisma.InputJsonObject {
  return {
    type: "any_of",
    policies: [
      { type: "ownership", assetType: "stem_nft", artistId },
      { type: "role", roleType: "holder", scopeType: "artist", scopeId: artistId },
    ],
  };
}

function isShowCampaignSupporterRoomAvailable(campaign: { campaignLevel: string; status: string }) {
  return campaign.campaignLevel === "active_escrow_campaign"
    && ACTIVE_CAMPAIGN_SUPPORT_CAMPAIGN_STATUSES.includes(
      campaign.status as (typeof ACTIVE_CAMPAIGN_SUPPORT_CAMPAIGN_STATUSES)[number],
    );
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
  return roomType === "artist_holder" || roomType === "show_campaign_supporter" || roomType === "cohort";
}

function shouldReconcileMembershipAccess(room: { roomType: string; ownerType?: string; accessPolicyJson?: Prisma.JsonValue | null }) {
  return (
    (room.roomType === "show_campaign_supporter" && Boolean(room.accessPolicyJson))
    || (room.roomType === "artist_holder" && Boolean(room.accessPolicyJson))
    || isCohortRoom(room)
  );
}

function gatedRoomReason(room: { roomType: string }) {
  if (room.roomType === "show_campaign_supporter") return "campaign_support_required";
  if (room.roomType === "artist_holder") return "holder_required";
  if (room.roomType === "cohort") return "cohort_join_required";
  return "open";
}

function roomAccessDeniedMessage(room: { roomType: string }) {
  if (room.roomType === "show_campaign_supporter") {
    return "Confirmed campaign support is required for this room";
  }
  if (room.roomType === "artist_holder") {
    return "Holder access is locked for this listener";
  }
  if (room.roomType === "cohort") {
    return "Join this cohort before opening the room";
  }
  return "Community room access denied";
}

function roomMembershipRole(room: { roomType: string }) {
  if (room.roomType === "artist_holder") return "holder";
  if (room.roomType === "show_campaign_supporter") return "supporter";
  if (room.roomType === "show_city_demand") return "city_member";
  if (room.roomType === "cohort") return "cohort_member";
  return "member";
}

function roomMembershipSource(room: { roomType: string }) {
  if (room.roomType === "artist_holder") return "eligibility";
  if (room.roomType === "show_campaign_supporter") return "campaign_support";
  if (room.roomType === "show_city_demand") return "city_interest";
  if (room.roomType === "cohort") return "cohort_membership";
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

function messageDto(
  message: { id: string; roomId: string; authorId: string; body: string; messageType: string; status: string; createdAt: Date; updatedAt: Date; deletedAt: Date | null },
  options: { viewerUserId?: string; redactOtherAuthors?: boolean } = {},
) {
  const isOwnMessage = options.viewerUserId === message.authorId;
  const shouldRedactAuthor = options.redactOtherAuthors && !isOwnMessage;
  return {
    id: message.id,
    roomId: message.roomId,
    authorId: shouldRedactAuthor ? null : message.authorId,
    authorLabel: shouldRedactAuthor ? "Cohort member" : isOwnMessage ? "You" : null,
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

function moderationRoomDto(room: {
  id: string;
  roomType: string;
  ownerType: string;
  ownerId: string;
  artistId: string | null;
  title: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: room.id,
    roomType: room.roomType,
    ownerType: room.ownerType,
    ownerId: room.ownerId,
    artistId: room.artistId,
    title: room.title,
    status: room.status,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  };
}

function moderationMessageDto(message: {
  id: string;
  roomId: string;
  authorId: string;
  body: string;
  messageType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}) {
  return {
    id: message.id,
    roomId: message.roomId,
    authorUserId: message.authorId,
    bodyPreview: message.status === "visible" ? previewText(message.body, 240) : null,
    messageType: message.messageType,
    status: message.status,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    deletedAt: message.deletedAt?.toISOString() ?? null,
  };
}

function moderationAssistDto(input: {
  reason: string;
  room: ReturnType<typeof moderationRoomDto>;
  message: ReturnType<typeof moderationMessageDto> | null;
  context: {
    roomOpenReports: number;
    messageReportCount: number;
    roomMembershipsByStatus: Record<string, number>;
  };
}) {
  const signals = collectModerationAssistSignals(input);
  const severity = moderationAssistSeverity(signals);
  const likelihood = moderationAssistLikelihood(signals);
  return {
    summary: moderationAssistSummary(input, signals),
    severity,
    likelihood,
    reasonCodes: signals.reasonCodes,
    reviewFocus: moderationAssistReviewFocus(input, signals),
    source: "bounded_moderation_context",
    advisory: {
      noAutoEnforcement: true,
      copy: "Advisory only. A human admin must choose and confirm any moderation action.",
    },
  };
}

function collectModerationAssistSignals(input: {
  reason: string;
  room: ReturnType<typeof moderationRoomDto>;
  message: ReturnType<typeof moderationMessageDto> | null;
  context: {
    roomOpenReports: number;
    messageReportCount: number;
    roomMembershipsByStatus: Record<string, number>;
  };
}) {
  const reasonCodes = new Set<string>();
  const text = `${input.reason} ${input.message?.bodyPreview ?? ""}`.toLowerCase();
  const messageReportCount = input.context.messageReportCount;
  const roomOpenReports = input.context.roomOpenReports;

  if (!input.message) reasonCodes.add("message_unavailable");
  if (input.message?.status && input.message.status !== "visible") reasonCodes.add("message_not_visible");
  if (messageReportCount >= 2) reasonCodes.add("repeated_message_reports");
  if (roomOpenReports >= 3) reasonCodes.add("room_report_cluster");
  if (input.room.status !== "active") reasonCodes.add("room_status_review");
  if (MODERATION_ASSIST_SAFETY_PATTERN.test(text)) reasonCodes.add("safety_language_signal");
  if (MODERATION_ASSIST_PRIVACY_PATTERN.test(text)) reasonCodes.add("privacy_language_signal");
  if (MODERATION_ASSIST_SPAM_PATTERN.test(text)) reasonCodes.add("spam_language_signal");
  if (reasonCodes.size === 0) reasonCodes.add("single_report_review");

  return {
    reasonCodes: [...reasonCodes],
    messageReportCount,
    roomOpenReports,
  };
}

function moderationAssistSeverity(signals: {
  reasonCodes: string[];
  messageReportCount: number;
  roomOpenReports: number;
}) {
  if (
    signals.reasonCodes.includes("privacy_language_signal") ||
    signals.reasonCodes.includes("safety_language_signal") ||
    signals.messageReportCount >= 3 ||
    signals.roomOpenReports >= 5
  ) {
    return "high";
  }
  if (
    signals.reasonCodes.includes("spam_language_signal") ||
    signals.reasonCodes.includes("room_status_review") ||
    signals.messageReportCount >= 2 ||
    signals.roomOpenReports >= 3
  ) {
    return "medium";
  }
  return "low";
}

function moderationAssistLikelihood(signals: {
  reasonCodes: string[];
  messageReportCount: number;
  roomOpenReports: number;
}) {
  if (signals.messageReportCount >= 3 || signals.roomOpenReports >= 5) return "high";
  if (
    signals.messageReportCount >= 2 ||
    signals.roomOpenReports >= 3 ||
    signals.reasonCodes.some((code) => code.endsWith("_language_signal"))
  ) {
    return "medium";
  }
  return "low";
}

function moderationAssistSummary(
  input: {
    reason: string;
    room: ReturnType<typeof moderationRoomDto>;
    message: ReturnType<typeof moderationMessageDto> | null;
    context: {
      roomOpenReports: number;
      messageReportCount: number;
      roomMembershipsByStatus: Record<string, number>;
    };
  },
  signals: { reasonCodes: string[]; messageReportCount: number; roomOpenReports: number },
) {
  if (!input.message) {
    return "Report needs human review because the original message is unavailable in the moderation preview.";
  }
  if (signals.reasonCodes.includes("privacy_language_signal")) {
    return "Report mentions possible privacy exposure. Review the preview before choosing any action.";
  }
  if (signals.reasonCodes.includes("safety_language_signal")) {
    return "Report mentions possible safety or harassment concerns. Review message context before acting.";
  }
  if (signals.reasonCodes.includes("spam_language_signal")) {
    return "Report may involve spam or scam-like behavior. Check whether the message should be removed.";
  }
  if (signals.messageReportCount > 1) {
    return `${signals.messageReportCount} reports reference this message. Compare the preview with the report reason.`;
  }
  return "Single reported community message. Review the preview and room context before deciding.";
}

function moderationAssistReviewFocus(
  input: {
    reason: string;
    room: ReturnType<typeof moderationRoomDto>;
    message: ReturnType<typeof moderationMessageDto> | null;
    context: {
      roomOpenReports: number;
      messageReportCount: number;
      roomMembershipsByStatus: Record<string, number>;
    };
  },
  signals: { reasonCodes: string[]; messageReportCount: number; roomOpenReports: number },
) {
  const focus = new Set<string>();
  if (!input.message || input.message.status !== "visible") focus.add("Confirm whether a message action is still applicable.");
  if (signals.reasonCodes.includes("privacy_language_signal")) focus.add("Check for personal data exposure in the preview.");
  if (signals.reasonCodes.includes("safety_language_signal")) focus.add("Assess harassment, threat, or safety policy concerns.");
  if (signals.reasonCodes.includes("spam_language_signal")) focus.add("Check for spam, scam, or phishing patterns.");
  if (signals.messageReportCount > 1) focus.add("Weigh repeated reports against the visible message preview.");
  if (signals.roomOpenReports > 1) focus.add("Review whether this is part of a broader room-level issue.");
  if (input.room.status !== "active") focus.add("Confirm room status before applying a room action.");
  if (focus.size === 0) focus.add("Compare the report reason with the message preview.");
  focus.add("Apply no action unless the human review confirms it.");
  return [...focus].slice(0, 4);
}

function communityModerationPrivacyDto() {
  return {
    operatorOnly: true,
    noWalletAddresses: true,
    noUserEmails: true,
    noAccessPolicyPayloads: true,
    messageBodiesArePreviewed: true,
    actionNotesStored: false,
  };
}

function cohortRoomPolicy(cohortId: string, cohortType: string): Prisma.InputJsonObject {
  return {
    type: "cohort_membership",
    cohortId,
    cohortType,
    requiredMembershipStatus: COHORT_ROOM_MEMBERSHIP_STATUS,
  };
}

function cohortRoomCohortDto(cohort: CommunityCohort) {
  return {
    id: cohort.id,
    cohortType: cohort.cohortType,
    reasonCode: safeCohortReasonCode(cohort.reasonCode),
    title: cohort.title,
    safeExplanation: safeCohortExplanation(cohort.safeExplanation),
    status: cohort.status,
    memberCountLabel: bucketedCohortMemberCountLabel(cohort.visibleMemberCount),
    expiresAt: cohort.expiresAt?.toISOString() ?? null,
  };
}

function cohortRoomPrivacyDto() {
  return {
    onChain: false,
    otherListenerIdentities: "redacted",
    memberList: "not_exposed",
    walletAddresses: "redacted",
    rawListeningHistory: "redacted",
    accessDerivedServerSide: true,
    moderation: "community_moderation_queue",
  };
}

function isCohortRoom(room: { roomType: string; ownerType?: string }) {
  return room.roomType === "cohort" && room.ownerType === "cohort";
}

function isCohortVisibleForRoom(cohort: { status: string; expiresAt: Date | null; minimumSize: number; visibleMemberCount: number }) {
  return VISIBLE_COHORT_STATUSES.includes(cohort.status as (typeof VISIBLE_COHORT_STATUSES)[number])
    && (!cohort.expiresAt || cohort.expiresAt.getTime() > Date.now())
    && cohort.minimumSize > 0
    && cohort.visibleMemberCount >= cohort.minimumSize;
}

function hasCohortConsentForRoom(
  cohortType: string,
  visibility: { allowTasteMatching?: boolean | null; allowCityScenes?: boolean | null } | null,
) {
  if (cohortType === "city_scene") return visibility?.allowCityScenes === true;
  if (SOCIAL_TASTE_COHORT_TYPES.includes(cohortType as (typeof SOCIAL_TASTE_COHORT_TYPES)[number])) {
    return visibility?.allowTasteMatching === true;
  }
  return false;
}

function cohortRoomDeniedMessage(reason: string) {
  if (reason === "cohort_join_required") return "Join this cohort before opening the room";
  if (reason === "cohort_room_unavailable") return "This cohort is not currently open for chat";
  return "Community cohort room access denied";
}

function safeCohortReasonCode(reasonCode: string) {
  return /^[a-z_]+:[a-z0-9_-]+$/i.test(reasonCode) ? reasonCode : "cohort:shared_signal";
}

function safeCohortExplanation(explanation: string) {
  const unsafePatterns = [
    /0x[a-f0-9]{40}/i,
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
    /\b(user(id)?|wallet|address|transaction|txhash|private)\b/i,
  ];
  if (unsafePatterns.some((pattern) => pattern.test(explanation))) {
    return "This room is based on shared, privacy-safe community signals.";
  }
  return explanation;
}

function bucketedCohortMemberCountLabel(count: number) {
  if (count >= 100) return "100+ listeners";
  if (count >= 50) return "50+ listeners";
  if (count >= 25) return "25+ listeners";
  if (count >= 10) return "10+ listeners";
  return "5+ listeners";
}

function previewText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
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

function normalizeModerationQueueStatus(input: unknown): ModerationQueueStatus {
  if (input === undefined || input === null || input === "") return "open";
  if (typeof input !== "string") throw new BadRequestException("status must be a string");
  const normalized = input.trim().toLowerCase();
  if (!MODERATION_QUEUE_STATUSES.includes(normalized as ModerationQueueStatus)) {
    throw new BadRequestException("status must be open, resolved, or dismissed");
  }
  return normalized as ModerationQueueStatus;
}

function normalizeModerationQueueLimit(input: unknown) {
  if (input === undefined || input === null || input === "") return 50;
  const numeric = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(numeric)) throw new BadRequestException("limit must be a number");
  return Math.min(100, Math.max(1, Math.floor(numeric)));
}

function normalizeModerationResolutionAction(input: unknown): ModerationResolutionAction {
  if (typeof input !== "string") throw new BadRequestException("action must be a string");
  const normalized = input.trim().toLowerCase();
  if (!MODERATION_RESOLUTION_ACTIONS.includes(normalized as ModerationResolutionAction)) {
    throw new BadRequestException("action must be a supported moderation resolution action");
  }
  return normalized as ModerationResolutionAction;
}

function normalizeModerationNote(input: unknown) {
  if (input === undefined || input === null || input === "") return null;
  if (typeof input !== "string") throw new BadRequestException("note must be a string");
  const note = input.trim();
  if (note.length > 500) throw new BadRequestException("note must be 500 characters or fewer");
  return note || null;
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
