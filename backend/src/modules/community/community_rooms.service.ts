import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CommunityRoom, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";
import { CommunityEligibilityService } from "./community_eligibility.service";

const ARTIST_ROOM_TYPES = ["artist_public", "artist_holder"] as const;
const ROOM_STATUSES = ["active", "paused", "archived"] as const;
const MESSAGE_TYPES = ["message", "announcement"] as const;
const MODERATION_ACTIONS = ["remove", "ban"] as const;

type ArtistRoomType = (typeof ARTIST_ROOM_TYPES)[number];
type RoomStatus = (typeof ROOM_STATUSES)[number];
type MessageType = (typeof MESSAGE_TYPES)[number];
type ModerationAction = (typeof MODERATION_ACTIONS)[number];

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

  async joinRoom(userId: string, roomId: string) {
    await this.ensureUser(userId);
    const room = await this.getRoom(roomId);
    await this.assertRoomJoinable(userId, room);
    const membership = await prisma.communityMembership.upsert({
      where: { CommunityMembership_identity: { roomId, userId } },
      update: {
        status: "active",
        endedAt: null,
        role: room.roomType === "artist_holder" ? "holder" : "member",
        sourceType: room.roomType === "artist_holder" ? "eligibility" : "manual",
      },
      create: {
        roomId,
        userId,
        role: room.roomType === "artist_holder" ? "holder" : "member",
        sourceType: room.roomType === "artist_holder" ? "eligibility" : "manual",
      },
    });

    this.publish("community.room_joined", userId, { roomId, roomType: room.roomType, artistId: room.artistId });
    return {
      schemaVersion: "community-membership/v1",
      room: roomDto(room, membership),
      membership: membershipDto(membership),
    };
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

    this.publish("community.room_left", userId, { roomId, roomType: membership.room.roomType, artistId: membership.room.artistId });
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
    if (messageType === "announcement") {
      await this.requireRoomOperator(userId, room);
    } else {
      await this.assertCanWriteRoom(userId, room);
    }

    const message = await prisma.communityMessage.create({
      data: { roomId, authorId: userId, body, messageType },
    });
    this.publish("community.message_created", userId, { roomId, messageId: message.id, messageType });
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
    this.publish("community.message_reported", userId, { roomId: message.roomId, messageId, reportId: report.id });
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
    this.publish("community.message_deleted", userId, { roomId: message.roomId, messageId });
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
    if (room.roomType === "artist_holder") {
      const result = await this.eligibility.evaluateAccessPolicy(userId, room.accessPolicyJson ?? { type: "manual" });
      if (!result.eligible) {
        throw new ForbiddenException("Holder access is locked for this listener");
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
    if (!room.artistId) return false;
    const artist = await prisma.artist.findUnique({ where: { id: room.artistId } });
    return Boolean(artist && canOperateArtist(userId, artist));
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
    if (room.roomType !== "artist_holder") return publicRoomAccessDto(room);
    if (!room.accessPolicyJson) return { joinable: true, reason: "open" };
    const result = await this.eligibility.evaluateAccessPolicy(userId, room.accessPolicyJson);
    return {
      joinable: result.eligible,
      reason: result.eligible ? "eligible" : "holder_required",
      reasons: result.eligible ? result.reasons : ["holder_required"],
    };
  }

  private async getRoom(roomId: string) {
    const room = await prisma.communityRoom.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Community room not found");
    return room;
  }

  private async ensureUser(userId: string) {
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, email: `${userId}@wallet.local` },
    });
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
    joinable: room.status === "active",
    reason: room.roomType === "artist_holder" ? "holder_required" : "open",
  };
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
    throw new BadRequestException("messageType must be message or announcement");
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
