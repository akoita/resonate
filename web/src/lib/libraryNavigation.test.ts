import { describe, expect, it } from "vitest";
import {
  isCatalogReleaseFullySaved,
  libraryArtistNameForCatalogCredit,
  libraryArtistNameForProfile,
  releaseActionNoun,
} from "./libraryNavigation";

describe("Library/catalog navigation (#1820)", () => {
  const tracks = [
    {
      artist: "Credited Name",
      creditedArtistId: "profile-1",
      catalogTrackId: "track-1",
      releaseId: "release-1",
    },
    {
      artist: "Credited Name",
      creditedArtistId: "profile-1",
      catalogTrackId: "track-2",
      releaseId: "release-1",
    },
  ];

  it("finds a private Library grouping from a stable public profile id", () => {
    expect(libraryArtistNameForProfile("profile-1", tracks)).toBe("Credited Name");
    expect(libraryArtistNameForProfile("uploader-profile", tracks)).toBeNull();
  });

  it("matches a name only for the explicitly name-based catalog-credit route", () => {
    expect(libraryArtistNameForCatalogCredit("credited name", tracks)).toBe("Credited Name");
    expect(libraryArtistNameForCatalogCredit("Different Artist", tracks)).toBeNull();
  });

  it("opens a release in My Library only after every catalog track is saved", () => {
    expect(isCatalogReleaseFullySaved("release-1", ["track-1", "track-2"], tracks)).toBe(true);
    expect(isCatalogReleaseFullySaved("release-1", ["track-1", "track-2", "track-3"], tracks)).toBe(false);
    expect(isCatalogReleaseFullySaved("release-1", [], tracks)).toBe(false);
  });

  it("uses the actual release type in playback actions", () => {
    expect(releaseActionNoun("single")).toBe("single");
    expect(releaseActionNoun("ALBUM")).toBe("album");
    expect(releaseActionNoun("ep")).toBe("release");
  });
});
