import { describe, expect, it } from "vitest";
import type { ShowCampaignCommunityRoom } from "../../lib/shows";
import {
  campaignCommunityAction,
  canPostCampaignUpdate,
  isCampaignCommunityAvailable,
  isCampaignSupporterRoomJoined,
  isCityDemandAvailable,
  isCityDemandRoomJoined,
} from "./CampaignCommunityPanel";

function room(overrides: Partial<ShowCampaignCommunityRoom>): ShowCampaignCommunityRoom {
  return {
    id: "room-1",
    roomType: "show_campaign_supporter",
    ownerType: "show_campaign",
    ownerId: "campaign-1",
    artistId: "artist-1",
    title: "Supporter Room",
    description: "Private supporter room.",
    status: "active",
    membership: null,
    access: { joinable: false, reason: "campaign_support_required" },
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("CampaignCommunityPanel helpers", () => {
  it("detects active supporter room membership", () => {
    expect(isCampaignSupporterRoomJoined(room({
      membership: {
        role: "supporter",
        status: "active",
        joinedAt: "2026-05-31T00:00:00.000Z",
        endedAt: null,
      },
    }))).toBe(true);
  });

  it("detects active city demand membership", () => {
    expect(isCityDemandRoomJoined(room({
      roomType: "show_city_demand",
      membership: {
        role: "city_member",
        status: "active",
        joinedAt: "2026-05-31T00:00:00.000Z",
        endedAt: null,
      },
    }))).toBe(true);
  });

  it("keeps supporter rooms locked until campaign support is confirmed", () => {
    expect(campaignCommunityAction(room({}))).toMatchObject({
      label: "Support required",
      disabled: true,
    });
  });

  it("lets eligible campaign supporters join", () => {
    expect(campaignCommunityAction(room({
      access: { joinable: true, reason: "eligible", reasons: ["private_campaign_support"] },
    }))).toMatchObject({
      label: "Join supporter room",
      disabled: false,
    });
  });

  it("authorizes campaign update posting from the backend ownership flag", () => {
    // #2128: a campaign artist owner signs in with the listener role.
    expect(canPostCampaignUpdate("listener", true)).toBe(true);
    expect(canPostCampaignUpdate("listener", false)).toBe(false);
    expect(canPostCampaignUpdate("operator", false)).toBe(false);
  });

  it("falls back to admin/operator roles only when the flag is absent", () => {
    expect(canPostCampaignUpdate("operator")).toBe(true);
    expect(canPostCampaignUpdate("admin", null)).toBe(true);
    expect(canPostCampaignUpdate("artist")).toBe(false);
    expect(canPostCampaignUpdate("listener")).toBe(false);
    expect(canPostCampaignUpdate(null)).toBe(false);
  });

  it("exposes city demand for active campaign and signal lifecycles", () => {
    expect(isCityDemandAvailable({
      campaignLevel: "signal",
      rawStatus: "draft",
    })).toBe(true);
    expect(isCampaignCommunityAvailable({
      campaignLevel: "active_escrow_campaign",
      rawStatus: "active",
    })).toBe(true);
    expect(isCampaignCommunityAvailable({
      campaignLevel: "active_escrow_campaign",
      rawStatus: "draft",
    })).toBe(false);
    expect(isCampaignCommunityAvailable({
      campaignLevel: "provisional_campaign",
      rawStatus: "draft",
    })).toBe(false);
    expect(isCampaignCommunityAvailable({
      campaignLevel: "active_escrow_campaign",
      rawStatus: "cancelled",
    })).toBe(false);
    expect(isCampaignCommunityAvailable({
      campaignLevel: "signal",
      rawStatus: "draft",
    })).toBe(true);
  });
});
