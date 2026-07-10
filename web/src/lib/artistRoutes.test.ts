import { describe, expect, it } from "vitest";
import {
  artistProfileHref,
  releaseArtistCreditHref,
  releaseArtistProfileHref,
  trackArtistCreditHref,
} from "./artistRoutes";

describe("releaseArtistProfileHref (#1419)", () => {
  it("links purely off the profile id — it never looks at any name field", () => {
    // Contrast with releaseArtistCreditHref below: this helper's type doesn't
    // even accept a free-text name to compare against, by design (#1419's
    // "id present -> always link" rule).
    expect(
      releaseArtistProfileHref({
        artist: { id: "artist-1" },
      }),
    ).toBe(artistProfileHref("artist-1"));
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

describe("releaseArtistCreditHref (name-match heuristic, still available for free-text-only surfaces)", () => {
  it("does NOT link when the free-text credit disagrees with the profile name", () => {
    expect(
      releaseArtistCreditHref({
        artist: { id: "artist-1", displayName: "Aya Lune" },
        primaryArtist: "DJ Somebody Else",
      }),
    ).toBeNull();
  });

  it("links when the free-text credit matches the profile name", () => {
    expect(
      releaseArtistCreditHref({
        artist: { id: "artist-1", displayName: "Aya Lune" },
        primaryArtist: "Aya Lune",
      }),
    ).toBe(artistProfileHref("artist-1"));
  });
});

describe("trackArtistCreditHref (#1419)", () => {
  const release = {
    artist: { id: "artist-main", displayName: "Aya Lune" },
    artistCredits: [
      { artistId: "artist-main", displayName: "Aya Lune" },
      { artistId: "artist-feature", displayName: "Nova Beats" },
    ],
  };

  it("links a track credit matching the release's main artist", () => {
    expect(trackArtistCreditHref("Aya Lune", release)).toBe(
      artistProfileHref("artist-main"),
    );
  });

  it("links a track credit matching a featured artist credit (not just the main artist)", () => {
    expect(trackArtistCreditHref("Nova Beats", release)).toBe(
      artistProfileHref("artist-feature"),
    );
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(trackArtistCreditHref("  nova beats ", release)).toBe(
      artistProfileHref("artist-feature"),
    );
  });

  it("does not link a free-text credit with no matching id-backed entry", () => {
    expect(trackArtistCreditHref("Some Random Feature", release)).toBeNull();
  });

  it("does not link when the track has no credit name at all", () => {
    expect(trackArtistCreditHref(null, release)).toBeNull();
    expect(trackArtistCreditHref(undefined, release)).toBeNull();
    expect(trackArtistCreditHref("", release)).toBeNull();
  });

  it("does not link when the release itself has no profile id at all", () => {
    expect(trackArtistCreditHref("Anyone", { artistCredits: [] })).toBeNull();
  });
});
