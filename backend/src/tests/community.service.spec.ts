import {
  normalizeCommunityProfileVisibility,
  publicProfileDto,
} from "../modules/community/community.service";

const date = new Date("2026-05-31T00:00:00.000Z");

describe("CommunityService privacy helpers", () => {
  it("normalizes supported profile visibility values", () => {
    expect(normalizeCommunityProfileVisibility(" Public ")).toBe("public");
    expect(normalizeCommunityProfileVisibility("followers")).toBe("followers");
    expect(normalizeCommunityProfileVisibility(undefined)).toBeUndefined();
  });

  it("rejects unsupported profile visibility values", () => {
    expect(() => normalizeCommunityProfileVisibility("everyone")).toThrow("profileVisibility");
  });

  it("redacts hidden public showcase sections by default", () => {
    const dto = publicProfileDto({
      profile: {
        id: "profile-1",
        userId: "user-1",
        displayName: "Ada",
        bio: "Collector and curator",
        avatarUrl: null,
        profileVisibility: "public",
        createdAt: date,
        updatedAt: date,
      },
      visibility: null,
      wallet: { address: "0xabc" },
    });

    expect(dto.showcase).toMatchObject({
      tasteBadgesVisible: false,
      ownedItemsVisible: false,
      walletAddress: null,
    });
    expect(dto.redactions).toEqual(expect.arrayContaining([
      "wallet_address_hidden",
      "owned_items_hidden",
      "taste_badges_hidden",
    ]));
  });

  it("shows wallet address only when explicitly enabled", () => {
    const dto = publicProfileDto({
      profile: {
        id: "profile-1",
        userId: "user-1",
        displayName: "Ada",
        bio: null,
        avatarUrl: null,
        profileVisibility: "public",
        createdAt: date,
        updatedAt: date,
      },
      visibility: {
        showTasteBadges: true,
        showOwnedItems: true,
        showCampaignSupport: false,
        showShowAttendance: false,
        showPlaylists: false,
        showWalletAddress: true,
        allowTasteMatching: false,
        allowCityScenes: false,
      },
      wallet: { address: "0xabc" },
    });

    expect(dto.showcase.walletAddress).toBe("0xabc");
    expect(dto.redactions).not.toContain("wallet_address_hidden");
  });
});
