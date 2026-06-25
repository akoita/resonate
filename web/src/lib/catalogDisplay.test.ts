import { describe, expect, it } from "vitest";
import type { PublicPlaylistSummary, Release } from "./api";
import {
  filterPublicPlaylists,
  getArtistName,
  getCatalogSortTime,
  summarizeCreditedArtists,
} from "./catalogDisplay";

describe("catalog display helpers", () => {
  it("sorts recent catalog surfaces by upload time instead of original release date", () => {
    const release = {
      id: "rel-rednex",
      artistId: "manager-bouba",
      title: "Sex & Violins",
      status: "ready",
      type: "single",
      primaryArtist: "Rednex",
      releaseDate: "1995-01-01T00:00:00.000Z",
      createdAt: "2026-06-05T14:11:17.092Z",
      explicit: false,
    } satisfies Release;

    expect(getCatalogSortTime(release)).toBe(new Date("2026-06-05T14:11:17.092Z").getTime());
  });

  it("summarizes artists from main release credits rather than uploader profiles", () => {
    const releases = [
      {
        id: "rel-rednex",
        artistId: "manager-bouba",
        title: "Sex & Violins",
        status: "ready",
        type: "single",
        primaryArtist: "Rednex",
        genre: "Pop",
        releaseDate: "1995-01-01T00:00:00.000Z",
        createdAt: "2026-06-05T14:11:17.092Z",
        explicit: false,
        artist: { id: "manager-bouba", displayName: "bouba" },
        artistCredits: [
          {
            id: "credit-rednex",
            releaseId: "rel-rednex",
            artistId: "public-rednex",
            role: "main",
            displayName: "Rednex",
            sortOrder: 0,
          },
        ],
        tracks: [
          {
            id: "trk-rednex",
            title: "Wish You Were Here",
            artist: "Rednex",
            position: 1,
            explicit: false,
            createdAt: "2026-06-05T14:11:17.092Z",
            stems: [
              { id: "stem-original", type: "original", uri: "/stem-original", title: "Original" },
              { id: "stem-vocals", type: "vocals", uri: "/stem-vocals", title: "Vocals" },
            ],
          },
        ],
      },
    ] satisfies Release[];

    expect(getArtistName(releases[0])).toBe("Rednex");
    expect(summarizeCreditedArtists(releases)).toEqual([
      expect.objectContaining({
        name: "Rednex",
        artistId: "public-rednex",
        releaseCount: 1,
        stemCount: 2,
        latestAt: new Date("2026-06-05T14:11:17.092Z").getTime(),
      }),
    ]);
  });
});

describe("filterPublicPlaylists", () => {
  const playlists: PublicPlaylistSummary[] = [
    {
      id: "p1",
      name: "Late Night Drive",
      ownerUserId: "u1",
      ownerDisplayName: "Nova",
      trackCount: 8,
      playableTrackCount: 8,
      coverArtworkUrls: [],
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z",
    },
    {
      id: "p2",
      name: "Morning Focus",
      ownerUserId: "u2",
      ownerDisplayName: "Atlas",
      trackCount: 5,
      playableTrackCount: 5,
      coverArtworkUrls: [],
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
    },
  ];

  it("returns everything when the query is empty", () => {
    expect(filterPublicPlaylists(playlists, "")).toHaveLength(2);
  });

  it("matches on the playlist name (case-insensitive)", () => {
    const result = filterPublicPlaylists(playlists, "drive");
    expect(result.map((p) => p.id)).toEqual(["p1"]);
  });

  it("matches on the owner display name", () => {
    const result = filterPublicPlaylists(playlists, "atlas");
    expect(result.map((p) => p.id)).toEqual(["p2"]);
  });

  it("returns nothing for a non-matching query", () => {
    expect(filterPublicPlaylists(playlists, "techno")).toHaveLength(0);
  });

  it("does not throw when the owner name is null", () => {
    const anon: PublicPlaylistSummary[] = [{ ...playlists[0], ownerDisplayName: null }];
    expect(filterPublicPlaylists(anon, "nova")).toHaveLength(0);
    expect(filterPublicPlaylists(anon, "late")).toHaveLength(1);
  });
});
