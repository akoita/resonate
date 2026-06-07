import { describe, expect, it } from "vitest";
import type { CommunityArtistRoom, CommunityDiscordBridge } from "../../lib/api";
import {
  discordBridgeActionLabel,
  discordBridgeSummary,
  isJoinedRoom,
  roomAccessCopy,
  sortArtistCommunityRooms,
} from "./ArtistCommunityTab";

function room(overrides: Partial<CommunityArtistRoom>): CommunityArtistRoom {
  return {
    id: "room-1",
    roomType: "artist_public",
    ownerType: "artist",
    ownerId: "artist-1",
    artistId: "artist-1",
    title: "Public Room",
    description: null,
    status: "active",
    membership: null,
    access: { joinable: true, reason: "open" },
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
    ...overrides,
  };
}

function bridge(overrides: Partial<CommunityDiscordBridge>): CommunityDiscordBridge {
  return {
    id: "bridge-1",
    artistId: "artist-1",
    provider: "discord",
    serverName: null,
    channelName: null,
    inviteUrl: null,
    publicLinkEnabled: false,
    status: "disconnected",
    lastTestedAt: null,
    lastMirroredAt: null,
    lastRoleSyncAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    roleMappings: [],
    recentAttempts: [],
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    privacy: {
      webhookUrlReturned: false,
      memberDetailsReturned: false,
    },
    ...overrides,
  };
}

describe("ArtistCommunityTab helpers", () => {
  it("keeps public artist rooms before holder rooms", () => {
    const sorted = sortArtistCommunityRooms([
      room({ id: "holder", roomType: "artist_holder", title: "Holder Room" }),
      room({ id: "public", roomType: "artist_public", title: "Public Room" }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(["public", "holder"]);
  });

  it("describes joined rooms as readable and writable", () => {
    const activeRoom = room({
      membership: {
        role: "member",
        status: "active",
        joinedAt: "2026-05-31T00:00:00.000Z",
        endedAt: null,
      },
    });

    expect(isJoinedRoom(activeRoom)).toBe(true);
    expect(roomAccessCopy(activeRoom, true)).toMatchObject({
      label: "Joined",
      disabled: false,
    });
  });

  it("keeps holder rooms locked with safe copy when access is denied", () => {
    const holderRoom = room({
      roomType: "artist_holder",
      title: "Holder Room",
      access: { joinable: false, reason: "holder_required", reasons: ["holder_required"] },
    });

    expect(roomAccessCopy(holderRoom, true)).toMatchObject({
      label: "Holder access required",
      disabled: true,
    });
    expect(roomAccessCopy(holderRoom, true).reason).toContain("holdings stay private");
  });

  it("lets authenticated eligible listeners join holder rooms", () => {
    const holderRoom = room({
      roomType: "artist_holder",
      title: "Holder Room",
      access: { joinable: true, reason: "eligible", reasons: ["stem_nft_holder"] },
    });

    expect(roomAccessCopy(holderRoom, true)).toMatchObject({
      label: "Join holder room",
      disabled: false,
    });
    expect(roomAccessCopy(holderRoom, true).reason).toContain("holder proof is checked privately");
    expect(roomAccessCopy(holderRoom, false).reason).toContain("holder proof");
  });

  it("describes Discord bridge disconnected, connected, and failed states", () => {
    expect(discordBridgeSummary(null)).toContain("Connect an official Discord webhook");
    expect(discordBridgeActionLabel(null)).toBe("Connect Discord");

    const connected = bridge({
      status: "connected",
      serverName: "Resonate Server",
      channelName: "announcements",
    });
    expect(discordBridgeSummary(connected)).toBe("Connected to Resonate Server / announcements.");
    expect(discordBridgeActionLabel(connected)).toBe("Update Discord");

    const failed = bridge({
      status: "failed",
      lastFailureReason: "discord_http_500",
    });
    expect(discordBridgeSummary(failed)).toContain("discord_http_500");
    expect(discordBridgeActionLabel(failed)).toBe("Update Discord");
  });
});
