import { describe, expect, it } from "vitest";
import {
  buildCatalogArtistCandidates,
  campaignDisplayInitial,
  campaignDisplayTitle,
  campaignRouteCode,
} from "./shows";
import type { Release } from "./api";

describe("Shows campaign presentation", () => {
  it("uses the campaign title as the public display identity", () => {
    const campaign = {
      title: "Sennarin in Paris",
      artistName: "green",
      city: "Paris",
    };

    expect(campaignDisplayTitle(campaign)).toBe("Sennarin in Paris");
    expect(campaignDisplayInitial(campaign)).toBe("S");
    expect(campaignRouteCode(campaign)).toBe("SEN-PAR");
  });

  it("falls back to the platform artist name when a legacy campaign has no title", () => {
    const campaign = {
      title: "",
      artistName: "green",
      city: "Paris",
    };

    expect(campaignDisplayTitle(campaign)).toBe("green in Paris");
    expect(campaignDisplayInitial(campaign)).toBe("G");
  });

  it("builds campaign artist choices from declared catalog credits, not uploaders", () => {
    const releases = [
      {
        id: "release-1",
        artistId: "profile-green",
        title: "Dignified",
        status: "ready",
        type: "single",
        primaryArtist: "SennaRin",
        explicit: false,
        createdAt: "2026-05-01T00:00:00.000Z",
        artist: { id: "profile-green", displayName: "green", userId: "user-green" },
      },
      {
        id: "release-2",
        artistId: "profile-green",
        title: "Second Credit",
        status: "published",
        type: "single",
        primaryArtist: "SennaRin",
        explicit: false,
        createdAt: "2026-05-02T00:00:00.000Z",
        artist: { id: "profile-green", displayName: "green", userId: "user-green" },
      },
      {
        id: "release-3",
        artistId: "profile-bouba",
        title: "She Doesn't Mind",
        status: "ready",
        type: "single",
        primaryArtist: "bouba",
        explicit: false,
        createdAt: "2026-05-03T00:00:00.000Z",
        artist: { id: "profile-bouba", displayName: "bouba", userId: "user-bouba" },
      },
    ] satisfies Release[];

    const candidates = buildCatalogArtistCandidates(releases);

    expect(candidates.map((candidate) => candidate.name)).toEqual(["bouba", "SennaRin"]);
    expect(candidates.find((candidate) => candidate.name === "SennaRin")).toMatchObject({
      artistId: null,
      optionId: "credit:sennarin",
      releaseCount: 2,
      latestReleaseTitle: "Dignified",
    });
    expect(candidates.find((candidate) => candidate.name === "bouba")).toMatchObject({
      artistId: "profile-bouba",
      optionId: "profile:profile-bouba",
      releaseCount: 1,
    });
  });

  it("prefers first-class release artist credits for campaign artist choices", () => {
    const releases = [
      {
        id: "release-credits",
        artistId: "manager-green",
        title: "Dignified",
        status: "ready",
        type: "single",
        primaryArtist: "legacy uploader fallback",
        explicit: false,
        createdAt: "2026-05-01T00:00:00.000Z",
        artist: { id: "manager-green", displayName: "green", userId: "user-green" },
        artistCredits: [
          {
            id: "credit-sennarin",
            releaseId: "release-credits",
            artistId: "public-sennarin",
            role: "main",
            displayName: "SennaRin",
            sortOrder: 0,
            artist: { id: "public-sennarin", displayName: "SennaRin" },
          },
          {
            id: "credit-collab",
            releaseId: "release-credits",
            artistId: "public-collab",
            role: "main",
            displayName: "Collab Artist",
            sortOrder: 1,
          },
          {
            id: "credit-feature",
            releaseId: "release-credits",
            artistId: "public-feature",
            role: "featured",
            displayName: "Featured Guest",
            sortOrder: 2,
          },
        ],
      },
    ] satisfies Release[];

    const candidates = buildCatalogArtistCandidates(releases);

    expect(candidates.map((candidate) => candidate.name)).toEqual(["Collab Artist", "SennaRin"]);
    expect(candidates.find((candidate) => candidate.name === "SennaRin")).toMatchObject({
      artistId: "public-sennarin",
      optionId: "profile:public-sennarin",
      releaseCount: 1,
    });
  });
});
