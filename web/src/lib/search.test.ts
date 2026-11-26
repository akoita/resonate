import { describe, expect, it } from "vitest";
import { moveActive, normalizeQuery, shouldSearch, toSearchOptions, type SearchResults } from "./search";

const results: SearchResults = {
  query: "night",
  artists: [{ kind: "profile", id: "a 1", displayName: "Night Owl", imageUrl: null }],
  releases: [{ id: "r1", title: "Night Drive", type: "ep", artistName: "Night Owl", hasArtwork: true, artworkRevision: 3 }],
  tracks: [
    { id: "t1", title: "Night Song", artistName: "Night Owl", releaseId: "r1", releaseTitle: "Night Drive", hasArtwork: false, artworkRevision: 1 },
  ],
  playlists: [{ id: "p1", name: "Late night", ownerDisplayName: null, playableTrackCount: 1 }],
};

describe("top-bar search helpers (#2671)", () => {
  it("searches from two characters, ignoring extra spaces", () => {
    expect(normalizeQuery("  night   drive ")).toBe("night drive");
    expect(shouldSearch(" n ")).toBe(false);
    expect(shouldSearch("ni")).toBe(true);
  });

  it("groups results in reading order with links and details", () => {
    const groups = toSearchOptions(results);
    expect(groups.map((group) => group.group)).toEqual(["artists", "releases", "tracks", "playlists"]);
    const [artist, release, track, playlist] = groups.flatMap((group) => group.options);
    expect(artist).toMatchObject({ href: "/artist/a%201", detail: "Artist", imageUrl: null });
    expect(release).toMatchObject({ href: "/release/r1", detail: "EP · Night Owl" });
    expect(release.imageUrl).toMatch(/\/catalog\/releases\/r1\/artwork\/v3$/);
    expect(track).toMatchObject({ href: "/release/r1", detail: "Night Owl · Night Drive", imageUrl: null });
    expect(playlist).toMatchObject({ href: "/playlist/p1", detail: "1 track" });
  });

  it("links a credited artist name to its catalog page", () => {
    const [group] = toSearchOptions({
      ...results,
      artists: [{ kind: "credit", id: null, displayName: "Booba", imageUrl: null }],
      releases: [],
      tracks: [],
      playlists: [],
    });
    expect(group.options[0]).toMatchObject({ key: "artist-credit-0", href: "/catalog/artists/Booba", detail: "Artist" });
  });

  it("leaves out empty groups", () => {
    expect(toSearchOptions({ ...results, artists: [], tracks: [] }).map((group) => group.group)).toEqual(["releases", "playlists"]);
  });

  it("moves the active option with wrap-around", () => {
    expect(moveActive(-1, 3, 1)).toBe(0);
    expect(moveActive(-1, 3, -1)).toBe(2);
    expect(moveActive(2, 3, 1)).toBe(0);
    expect(moveActive(0, 3, -1)).toBe(2);
    expect(moveActive(0, 0, 1)).toBe(-1);
  });
});
