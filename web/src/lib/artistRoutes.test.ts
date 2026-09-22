import { describe, expect, it } from "vitest";
import {
  artistCreditHref,
  artistProfileHref,
  catalogArtistHref,
  libraryAlbumHref,
  libraryAlbumsHref,
  libraryArtistCatalogHref,
  libraryArtistHref,
  libraryArtistsHref,
  legacyArtistAliasDestination,
  legacyArtistAliasSearchName,
  playerArtistHref,
  publicReleaseHref,
  sharedLibraryReleaseId,
  releaseArtistProfileHref,
} from "./artistRoutes";

describe("canonical artist and album destinations (#1820)", () => {
  it("encodes public profile, catalog-credit, and local-library identities", () => {
    expect(artistProfileHref("profile/a")).toBe("/artist/profile%2Fa");
    expect(catalogArtistHref("A/B & C")).toBe("/catalog/artists/A%2FB%20%26%20C");
    expect(libraryArtistHref("A/B & C")).toBe("/library/artists/A%2FB%20%26%20C");
  });

  it("cross-links Library groupings only from unambiguous catalog identity", () => {
    expect(sharedLibraryReleaseId([{ releaseId: "release-1" }, { releaseId: "release-1" }])).toBe("release-1");
    expect(sharedLibraryReleaseId([{ releaseId: "release-1" }, { releaseId: null }])).toBeNull();
    expect(libraryArtistCatalogHref("Aya Lune", [
      { creditedArtistId: "artist-1" },
      { creditedArtistId: "artist-1" },
    ])).toBe("/artist/artist-1");
    expect(libraryArtistCatalogHref("Aya Lune", [
      { creditedArtistId: "artist-1" },
      { creditedArtistId: null },
    ])).toBe("/catalog/artists/Aya%20Lune");
  });

  it("keeps public releases and local albums in their own namespaces", () => {
    expect(publicReleaseHref("release/a")).toBe("/release/release%2Fa");
    expect(libraryAlbumHref("Same Name", "Artist A")).toBe(
      "/library?tab=albums&album=Same+Name&albumArtist=Artist+A",
    );
    expect(libraryAlbumHref("Same Name", "Artist B")).not.toBe(
      libraryAlbumHref("Same Name", "Artist A"),
    );
    expect(libraryAlbumHref("Same Name", "Artist A", "release/a")).toBe(
      "/library?tab=albums&album=Same+Name&albumArtist=Artist+A&release=release%2Fa",
    );
    expect(libraryArtistsHref()).toBe("/library?tab=artists");
    expect(libraryAlbumsHref()).toBe("/library?tab=albums");
  });

  it("keeps player links in the source identity namespace", () => {
    expect(playerArtistHref({ artist: "Aya Lune", releaseId: "release-1" })).toBe(
      "/catalog/artists/Aya%20Lune",
    );
    expect(playerArtistHref({ artist: "Aya Lune" })).toBe(
      "/library/artists/Aya%20Lune",
    );
    expect(playerArtistHref({ artist: null })).toBeNull();
  });

  it("resolves a legacy alias only from matching catalog evidence", () => {
    expect(legacyArtistAliasSearchName("sample-artist-aya-lune")).toBe("aya lune");
    expect(legacyArtistAliasDestination("Aya Lune", [
      { name: "Aya Lune", artistId: "profile-1" },
    ])).toBe("/artist/profile-1");
    expect(legacyArtistAliasDestination("sample-artist-aya-lune", [
      { name: "Aya Lune", artistId: "profile-1" },
    ])).toBe("/artist/profile-1");
    expect(legacyArtistAliasDestination("Aya Lune", [
      { name: "Aya Lune", artistId: "profile-1" },
      { name: "Aya Lune", artistId: "profile-2" },
    ])).toBe("/catalog/artists/Aya%20Lune");
    expect(legacyArtistAliasDestination("Missing", [
      { name: "Aya Lune", artistId: "profile-1" },
    ])).toBeNull();
  });
});

describe("releaseArtistProfileHref (#1419)", () => {
  it("links purely off the profile id — the release's OWNER profile", () => {
    expect(releaseArtistProfileHref({ artist: { id: "artist-1" } })).toBe(
      artistProfileHref("artist-1"),
    );
  });

  it("falls back to a bare artistId when no nested artist object is present", () => {
    expect(releaseArtistProfileHref({ artistId: "artist-2" })).toBe(
      artistProfileHref("artist-2"),
    );
  });

  it("returns null when no profile id exists anywhere", () => {
    expect(releaseArtistProfileHref({})).toBeNull();
  });
});

describe("artistCreditHref (#1419)", () => {
  const release = {
    artist: { id: "artist-main", displayName: "Aya Lune" },
    artistCredits: [
      { artistId: "artist-main", displayName: "Aya Lune" },
      { artistId: "artist-feature", displayName: "Nova Beats" },
    ],
  };

  it("links a name matching the release's main/owner artist", () => {
    expect(artistCreditHref("Aya Lune", release)).toBe(
      artistProfileHref("artist-main"),
    );
  });

  it("links a featured-artist credit (not just the main artist)", () => {
    expect(artistCreditHref("Nova Beats", release)).toBe(
      artistProfileHref("artist-feature"),
    );
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(artistCreditHref("  nova beats ", release)).toBe(
      artistProfileHref("artist-feature"),
    );
  });

  // The #1419 regression this fixes: an uploader/manager profile publishes a
  // release credited to a DIFFERENT artist. The displayed primary-artist name
  // must resolve to the CREDITED artist's profile, never the uploader's.
  it("links the credited artist, NOT the uploader/manager profile, when they differ", () => {
    const uploaded = {
      // owner = the uploader's manager profile (e.g. "Bouba")
      artist: { id: "manager-bouba", displayName: "Bouba" },
      artistId: "manager-bouba",
      primaryArtist: "Tiken Jah Fakoly",
      artistCredits: [
        { artistId: "artist-tiken", displayName: "Tiken Jah Fakoly" },
      ],
    };
    expect(artistCreditHref(uploaded.primaryArtist, uploaded)).toBe(
      artistProfileHref("artist-tiken"),
    );
    // and definitely not the manager profile
    expect(artistCreditHref(uploaded.primaryArtist, uploaded)).not.toBe(
      artistProfileHref("manager-bouba"),
    );
  });

  it("routes a free-text name with no matching id-backed entry to its catalog credit", () => {
    expect(artistCreditHref("Some Random Feature", release)).toBe(
      catalogArtistHref("Some Random Feature"),
    );
  });

  it("does not link an ambiguous credit or infer identity from the uploader name", () => {
    expect(artistCreditHref("Aya Lune", {
      artist: { id: "uploader", displayName: "Aya Lune" },
      artistCredits: [{ artistId: "candidate", displayName: "Aya Lune", identityStatus: "ambiguous" }],
    })).toBe(catalogArtistHref("Aya Lune"));
    expect(artistCreditHref("Aya Lune", {
      artist: { id: "uploader", displayName: "Aya Lune" },
      artistCredits: [],
    })).toBe(catalogArtistHref("Aya Lune"));
  });

  it("does not link when there is no name at all", () => {
    expect(artistCreditHref(null, release)).toBeNull();
    expect(artistCreditHref(undefined, release)).toBeNull();
    expect(artistCreditHref("", release)).toBeNull();
  });

  it("uses the catalog fallback when the release has no profile id anywhere", () => {
    expect(artistCreditHref("Anyone", { artistCredits: [] })).toBe(
      catalogArtistHref("Anyone"),
    );
  });
});
