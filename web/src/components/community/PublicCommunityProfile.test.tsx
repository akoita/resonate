import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicCommunityProfileResponse } from "../../lib/api";
import { PublicCommunityProfile, publicCommunityShowcaseItems } from "./PublicCommunityProfile";

const profile: PublicCommunityProfileResponse = {
  schemaVersion: "community-public-profile/v1",
  profile: {
    userId: "listener-1",
    displayName: "Ada Listener",
    bio: "Collector and curator",
    avatarUrl: null,
    profileVisibility: "public",
  },
  showcase: {
    tasteBadgesVisible: false,
    ownedItemsVisible: false,
    campaignSupportVisible: false,
    showAttendanceVisible: false,
    playlistsVisible: false,
    walletAddress: null,
  },
  redactions: [
    "wallet_address_hidden",
    "owned_items_hidden",
    "taste_badges_hidden",
  ],
};

describe("PublicCommunityProfile", () => {
  it("renders a private/unavailable state when no public profile is returned", () => {
    const html = renderToStaticMarkup(
      <PublicCommunityProfile profile={null} requestedUserId="listener-1" />,
    );

    expect(html).toContain("Profile unavailable");
    expect(html).toContain("has not made a public community profile visible");
  });

  it("keeps wallet and showcase sections hidden by default", () => {
    const items = publicCommunityShowcaseItems(profile);
    const html = renderToStaticMarkup(
      <PublicCommunityProfile profile={profile} requestedUserId="listener-1" />,
    );

    expect(items.find((item) => item.key === "wallet")).toMatchObject({
      status: "hidden",
      value: "Hidden by listener",
    });
    expect(html).toContain("Ada Listener");
    expect(html).toContain("Collector and curator");
    expect(html).toContain("Private");
    expect(html).toContain("Hidden by listener");
  });

  it("shows the wallet address only when the public response includes it", () => {
    const visibleProfile = {
      ...profile,
      showcase: {
        ...profile.showcase,
        walletAddress: "0xabc123",
        ownedItemsVisible: true,
      },
    };
    const items = publicCommunityShowcaseItems(visibleProfile);
    const html = renderToStaticMarkup(
      <PublicCommunityProfile profile={visibleProfile} requestedUserId="listener-1" />,
    );

    expect(items.find((item) => item.key === "wallet")).toMatchObject({
      status: "visible",
      value: "0xabc123",
    });
    expect(html).toContain("0xabc123");
    expect(html).toContain("Ready for future showcase cards");
  });
});
