import { describe, expect, it } from "vitest";
import {
  artistCreditHref,
  artistProfileHref,
  releaseArtistProfileHref,
} from "./artistRoutes";

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

  it("does not link a free-text name with no matching id-backed entry", () => {
    expect(artistCreditHref("Some Random Feature", release)).toBeNull();
  });

  it("does not link when there is no name at all", () => {
    expect(artistCreditHref(null, release)).toBeNull();
    expect(artistCreditHref(undefined, release)).toBeNull();
    expect(artistCreditHref("", release)).toBeNull();
  });

  it("does not link when the release has no id anywhere", () => {
    expect(artistCreditHref("Anyone", { artistCredits: [] })).toBeNull();
  });
});
