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
    campaignSupport: [],
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

  it("renders the owned-moments showcase with edition, artist, and release link", () => {
    const visibleProfile: PublicCommunityProfileResponse = {
      ...profile,
      showcase: {
        ...profile.showcase,
        ownedItemsVisible: true,
        ownedMoments: [
          {
            collectibleId: "collectible-1",
            editionNumber: 3,
            editionSize: 50,
            acquiredAt: "2026-05-31T00:00:00.000Z",
            moment: {
              id: "moment-1",
              title: "Golden hour",
              lyricText: "we ride till the sun comes up",
              artworkUrl: null,
              startMs: 1000,
              endMs: 9000,
              clipAssetUri: null,
              rightsLabel: "NON_COMMERCIAL_COLLECTIBLE",
              priceCents: 0,
              collectedCount: 12,
              momentKind: "crescendo",
              sourceStemType: "full",
            },
            drop: {
              id: "drop-1",
              title: "Golden Hour Drop",
              trackId: "track-1",
              trackTitle: "Golden Hour",
              releaseId: "release-1",
              artistName: "Nova",
            },
          },
        ],
      },
    };
    const items = publicCommunityShowcaseItems(visibleProfile);
    const html = renderToStaticMarkup(
      <PublicCommunityProfile profile={visibleProfile} requestedUserId="listener-1" />,
    );

    expect(items.find((item) => item.key === "owned-items")).toMatchObject({
      status: "visible",
      value: "1 owned moment on show",
    });
    expect(html).toContain("Moments showcase");
    expect(html).toContain("Golden hour");
    // #2522: the card names the moment by its kind, not always "Punchline".
    expect(html).toContain("Crescendo");
    expect(html).toContain("Edition #3 of 50");
    expect(html).toContain("Nova — Golden Hour");
    expect(html).toContain("Collected May 31, 2026");
    expect(html).toContain("/release/release-1?focus=moments");
    // Public showcase must never leak payment provenance or a wallet.
    expect(html).not.toContain("paymentRail");
    expect(html).not.toContain("pricePaidCents");
  });

  it("keeps the placeholder wording when owned items are visible but empty", () => {
    const emptyVisible: PublicCommunityProfileResponse = {
      ...profile,
      showcase: { ...profile.showcase, ownedItemsVisible: true, ownedMoments: [] },
    };
    const items = publicCommunityShowcaseItems(emptyVisible);
    const html = renderToStaticMarkup(
      <PublicCommunityProfile profile={emptyVisible} requestedUserId="listener-1" />,
    );

    expect(items.find((item) => item.key === "owned-items")).toMatchObject({
      status: "visible",
      value: "Ready for future showcase cards",
    });
    expect(html).not.toContain("Moments showcase");
  });

  it("renders opt-in campaign support badges without pledge or wallet details", () => {
    const visibleProfile: PublicCommunityProfileResponse = {
      ...profile,
      showcase: {
        ...profile.showcase,
        campaignSupportVisible: true,
        campaignSupport: [{
          campaignId: "campaign-1",
          campaignSlug: "artist-paris",
          campaignTitle: "Artist in Paris",
          artistDisplayName: "Artist",
          city: "Paris",
          country: "FR",
          grantedAt: "2026-05-31T00:00:00.000Z",
        }],
      },
    };
    const items = publicCommunityShowcaseItems(visibleProfile);
    const html = renderToStaticMarkup(
      <PublicCommunityProfile profile={visibleProfile} requestedUserId="listener-1" />,
    );

    expect(items.find((item) => item.key === "campaign-support")).toMatchObject({
      status: "visible",
      value: "1 public campaign supporter badge",
    });
    expect(html).toContain("Artist in Paris");
    expect(html).toContain("Paris, FR");
    expect(html).not.toContain("250000");
    expect(html).not.toContain("0xabc123");
  });

  it("renders opted-in supporter and collector badges and hides the hidden type (#1106)", () => {
    const badgeProfile: PublicCommunityProfileResponse = {
      ...profile,
      showcase: {
        ...profile.showcase,
        supporterBadgesVisible: false,
        collectorBadgesVisible: true,
        collectorBadges: [
          {
            schemaVersion: "public-community-credential/v1",
            credentialId: "cred_abc",
            credentialType: "artist_collector",
            displayLabel: "Collector of Nova",
            artistId: "artist-1",
            artistDisplayName: "Nova",
            tier: "collector",
            status: "active",
            visibility: "public_profile",
            issuedAt: null,
            expiresAt: null,
            proofMethod: "indexed_ownership",
          },
        ],
      },
    };
    const items = publicCommunityShowcaseItems(badgeProfile);
    const html = renderToStaticMarkup(
      <PublicCommunityProfile profile={badgeProfile} requestedUserId="listener-1" />,
    );

    expect(items.find((item) => item.key === "collector-badges")).toMatchObject({
      status: "visible",
      value: "1 public collector badge",
    });
    expect(items.find((item) => item.key === "supporter-badges")).toMatchObject({
      status: "hidden",
      value: "Hidden by listener",
    });
    expect(html).toContain("Collector of Nova");
    expect(html).not.toContain("Supporter of");
  });
});
