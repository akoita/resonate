import { BadRequestException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { CommunityDiscordBridgeService } from "../modules/community/community_discord_bridge.service";
import { CommunityEligibilityService } from "../modules/community/community_eligibility.service";
import { CommunityModerationAssistService } from "../modules/community/community_moderation_assist.service";
import { CommunityRoomsService } from "../modules/community/community_rooms.service";

const TEST_PREFIX = `discord_bridge_${Date.now()}_`;
const artistUserId = `${TEST_PREFIX}artist_user`;
const listenerUserId = `${TEST_PREFIX}listener`;
const artistId = `${TEST_PREFIX}artist`;
const releaseId = `${TEST_PREFIX}release`;
const trackId = `${TEST_PREFIX}track`;
const roomWebhook = `https://discord.com/api/webhooks/${TEST_PREFIX}room/token`;
const connectWebhook = `https://discord.com/api/webhooks/${TEST_PREFIX}connect/token`;

const eventBus = { publish: jest.fn() };
const service = new CommunityDiscordBridgeService(eventBus as any);
const eligibility = new CommunityEligibilityService(eventBus as any);
const rooms = new CommunityRoomsService(
  eligibility,
  eventBus as any,
  new CommunityModerationAssistService(),
  service,
);

describe("CommunityDiscordBridgeService integration", () => {
  const originalFetch = global.fetch;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: artistUserId, email: `${artistUserId}@test.resonate` },
        { id: listenerUserId, email: `${listenerUserId}@test.resonate` },
      ],
    });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId: artistUserId,
        displayName: "Discord Bridge Artist",
        payoutAddress: "0x" + "d".repeat(40),
      },
    });
    await prisma.release.create({
      data: { id: releaseId, artistId, title: "Discord Bridge Release", status: "published" },
    });
    await prisma.track.create({
      data: { id: trackId, releaseId, title: "Discord Bridge Track" },
    });
  });

  beforeEach(() => {
    eventBus.publish.mockClear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: jest.fn().mockResolvedValue(""),
    }) as any;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await prisma.communityDiscordSyncAttempt.deleteMany({ where: { bridge: { artistId } } }).catch(() => {});
    await prisma.communityDiscordRoleMapping.deleteMany({ where: { bridge: { artistId } } }).catch(() => {});
    await prisma.communityDiscordBridge.deleteMany({ where: { artistId } }).catch(() => {});
    await prisma.communityMessage.deleteMany({ where: { room: { artistId } } }).catch(() => {});
    await prisma.communityMembership.deleteMany({ where: { room: { artistId } } }).catch(() => {});
    await prisma.communityRoom.deleteMany({ where: { artistId } }).catch(() => {});
    await prisma.communityRole.deleteMany({ where: { userId: listenerUserId } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: trackId } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: artistId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [artistUserId, listenerUserId] } } }).catch(() => {});
  });

  it("connects a bridge without returning the webhook secret and exposes only enabled public links", async () => {
    await expect(
      service.connectArtistBridge(artistUserId, artistId, {
        webhookUrl: "https://example.com/not-discord",
      }),
    ).rejects.toThrow(BadRequestException);

    const connected = await service.connectArtistBridge(artistUserId, artistId, {
      webhookUrl: connectWebhook,
      inviteUrl: "https://discord.gg/resonate",
      serverName: "Resonate Server",
      channelName: "announcements",
      publicLinkEnabled: true,
      announcementMirrorEnabled: true,
    });

    expect(JSON.stringify(connected)).not.toContain(connectWebhook);
    expect(connected.bridge?.webhookUrlMasked).toContain("/api/webhooks/");
    expect(connected.bridge?.privacy.webhookUrlReturned).toBe(false);

    const updatedSettings = await service.connectArtistBridge(artistUserId, artistId, {
      inviteUrl: "https://discord.gg/resonate-updated",
      serverName: "Resonate Updated",
      publicLinkEnabled: true,
      announcementMirrorEnabled: false,
    });
    expect(JSON.stringify(updatedSettings)).not.toContain(connectWebhook);
    expect(updatedSettings.bridge?.webhookUrlMasked).toBe(connected.bridge?.webhookUrlMasked);
    expect(updatedSettings.bridge?.announcementMirrorEnabled).toBe(false);

    const publicBridge = await service.getPublicArtistBridge(artistId);
    expect(publicBridge.discord).toEqual({
      serverName: "Resonate Updated",
      inviteUrl: "https://discord.gg/resonate-updated",
    });
  });

  it("mirrors artist announcements and records failed attempts as retryable state", async () => {
    await service.connectArtistBridge(artistUserId, artistId, {
      webhookUrl: roomWebhook,
      inviteUrl: "https://discord.gg/resonate",
      serverName: "Resonate Server",
      publicLinkEnabled: true,
      announcementMirrorEnabled: true,
    });
    const enabled = await rooms.enableArtistCommunity(artistUserId, artistId);
    const publicRoom = enabled.rooms.find((room) => room.roomType === "artist_public");
    expect(publicRoom).toBeDefined();

    await rooms.createMessage(artistUserId, publicRoom!.id, {
      body: "Hello Discord from Resonate",
      messageType: "announcement",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      roomWebhook,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Hello Discord from Resonate"),
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "community.discord_announcement_mirrored",
      artistId,
    }));

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue("discord unavailable"),
    });
    await rooms.createMessage(artistUserId, publicRoom!.id, {
      body: "This one fails",
      messageType: "announcement",
    });

    const bridge = await service.getArtistBridge(artistUserId, artistId);
    expect(bridge.bridge?.status).toBe("failed");
    const failed = bridge.bridge?.recentAttempts.find((attempt) => attempt.status === "failed");
    expect(failed?.errorReason).toContain("discord_http_500");

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 204,
      text: jest.fn().mockResolvedValue(""),
    });
    const retried = await service.retryAttempt(artistUserId, artistId, failed!.id);
    expect(retried.ok).toBe(true);
    expect(retried.attempt.retryOfId).toBe(failed!.id);
  });

  it("syncs role mappings from server-side community roles without member details", async () => {
    await service.connectArtistBridge(artistUserId, artistId, {
      webhookUrl: connectWebhook,
      roleSyncEnabled: true,
    });
    await service.upsertRoleMapping(artistUserId, artistId, {
      resonateRole: "supporter",
      scopeType: "artist",
      scopeId: artistId,
      discordRoleId: "discord-role-supporter",
      label: "Supporter",
    });
    await prisma.communityRole.upsert({
      where: {
        CommunityRole_identity: {
          userId: listenerUserId,
          roleType: "supporter",
          scopeType: "artist",
          scopeId: artistId,
        },
      },
      create: {
        userId: listenerUserId,
        roleType: "supporter",
        scopeType: "artist",
        scopeId: artistId,
        sourceType: "test",
        sourceId: artistId,
      },
      update: { revokedAt: null },
    });

    const result = await service.syncRoles(artistUserId, artistId);

    expect(result.status).toBe("dry_run");
    expect(result.privacy).toEqual({
      memberDetailsExposed: false,
      source: "server_side_roles",
    });
    expect(result.mappings[0]).toMatchObject({
      eligibleCount: 1,
      status: "dry_run",
      reason: "discord_account_linking_required",
    });
  });
});
