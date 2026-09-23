import { describe, expect, it } from "vitest";
import type { PublicPlaylistSummary, Release } from "./api";
import {
  filterPublicPlaylists,
  flattenCatalogStems,
  formatCatalogAge,
  formatCount,
  formatReleaseType,
  formatStemType,
  getArtistName,
  getCatalogReleaseArtworkUrl,
  getCatalogSortTime,
  getReleaseCreditProfileId,
  groupCatalogStemsByTrack,
  orderStemTypes,
  summarizeCreditedArtists,
  topCatalogGenres,
  type CatalogStemSummary,
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
            releaseId: "rel-rednex",
            title: "Wish You Were Here",
            artist: "Rednex",
            position: 1,
            explicit: false,
            createdAt: "2026-06-05T14:11:17.092Z",
            stems: [
              {
                id: "stem-original",
                trackId: "trk-rednex",
                type: "original",
                uri: "/stem-original",
                title: "Original",
              },
              {
                id: "stem-vocals",
                trackId: "trk-rednex",
                type: "vocals",
                uri: "/stem-vocals",
                title: "Vocals",
              },
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

  it("keeps ambiguous and missing credits separate from manager identity", () => {
    const release = {
      id: "unresolved",
      artistId: "manager",
      title: "Unresolved",
      status: "ready",
      type: "single",
      primaryArtist: "Same Name",
      createdAt: "2026-09-23T00:00:00.000Z",
      explicit: false,
      artist: { id: "manager", displayName: "Same Name" },
      artistCredits: [{
        id: "credit",
        releaseId: "unresolved",
        artistId: "candidate",
        role: "main",
        displayName: "Same Name",
        sortOrder: 0,
        identityStatus: "ambiguous",
      }],
    } satisfies Release;
    expect(getReleaseCreditProfileId(release)).toBeNull();
    expect(summarizeCreditedArtists([release])[0].artistId).toBeNull();
    expect(getReleaseCreditProfileId({ ...release, artistCredits: [] })).toBeNull();
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

function stem(overrides: Partial<CatalogStemSummary>): CatalogStemSummary {
  return {
    id: "stem",
    releaseId: "rel-1",
    releaseTitle: "Lovebird",
    trackId: "trk-1",
    trackTitle: "Lovebird",
    title: "Vocals",
    type: "vocals",
    artistName: "Nova",
    artworkUrl: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("groupCatalogStemsByTrack", () => {
  it("returns one entry per track in first-seen order with ordered, deduped stem types", () => {
    const groups = groupCatalogStemsByTrack([
      stem({ id: "a1", type: "other" }),
      stem({ id: "b1", trackId: "trk-2", trackTitle: "Second", type: "drums", artworkUrl: "https://cdn/b.jpg" }),
      stem({ id: "a2", type: "synth" }),
      stem({ id: "a3", type: "vocals" }),
      stem({ id: "a4", type: "bass" }),
      stem({ id: "a5", type: "original", artworkUrl: "https://cdn/a.jpg" }),
      stem({ id: "a6", type: "Master" }),
      stem({ id: "a7", type: "arp" }),
    ]);

    expect(groups.map((group) => group.trackId)).toEqual(["trk-1", "trk-2"]);
    expect(groups[0]).toMatchObject({
      key: "rel-1:trk-1",
      releaseId: "rel-1",
      trackTitle: "Lovebird",
      releaseTitle: "Lovebird",
      artistName: "Nova",
      artworkUrl: "https://cdn/a.jpg",
      stemCount: 7,
      stemTypes: ["original", "vocals", "bass", "other", "arp", "synth"],
    });
    expect(groups[1]).toMatchObject({ stemCount: 1, stemTypes: ["drums"], artworkUrl: "https://cdn/b.jpg" });
  });

  it("keeps same-titled tracks from different releases apart", () => {
    const groups = groupCatalogStemsByTrack([
      stem({ id: "x", releaseId: "rel-1" }),
      stem({ id: "y", releaseId: "rel-2" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("returns nothing for no stems", () => {
    expect(groupCatalogStemsByTrack([])).toEqual([]);
  });
});

describe("stem type labels", () => {
  it("formats known and unknown stem types in sentence case", () => {
    expect(formatStemType("original")).toBe("Full mix");
    expect(formatStemType("FULL")).toBe("Full mix");
    expect(formatStemType("master")).toBe("Full mix");
    expect(formatStemType("vocals")).toBe("Vocals");
    expect(formatStemType("backing_vocals")).toBe("Backing vocals");
    expect(formatStemType("  ")).toBe("Stem");
  });

  it("orders types Full mix, Vocals, Drums, Bass, Piano, Guitar, Other, then unknown alphabetically", () => {
    expect(orderStemTypes(["zither", "other", "guitar", "piano", "bass", "drums", "vocals", "full", "accordion"]))
      .toEqual(["full", "vocals", "drums", "bass", "piano", "guitar", "other", "accordion", "zither"]);
  });
});

describe("catalog label helpers", () => {
  it("pluralizes counts", () => {
    expect(formatCount(1, "release")).toBe("1 release");
    expect(formatCount(0, "release")).toBe("0 releases");
    expect(formatCount(2, "match", "matches")).toBe("2 matches");
  });

  it("formats catalog ages relative to now", () => {
    const now = new Date("2026-09-23T12:00:00.000Z").getTime();
    expect(formatCatalogAge(0, now)).toBe("Unknown");
    expect(formatCatalogAge(now - 30_000, now)).toBe("1m ago");
    expect(formatCatalogAge(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatCatalogAge(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatCatalogAge(now - 3 * 86_400_000, now)).toBe("3d ago");
  });

  it("formats release types", () => {
    expect(formatReleaseType("SINGLE")).toBe("Single");
    expect(formatReleaseType("ep")).toBe("EP");
    expect(formatReleaseType("remix")).toBe("Remix");
    expect(formatReleaseType(null)).toBe("Release");
  });

  it("resolves release artwork from the explicit URL, then the stored canonical artwork", () => {
    const base = {
      id: "rel-art",
      artistId: "a",
      title: "Art",
      status: "ready",
      type: "single",
      explicit: false,
      createdAt: "2026-09-01T00:00:00.000Z",
    } satisfies Release;
    expect(getCatalogReleaseArtworkUrl({ ...base, artworkUrl: "https://cdn/art.jpg" })).toBe("https://cdn/art.jpg");
    expect(getCatalogReleaseArtworkUrl({ ...base, artworkMimeType: "image/png", artworkRevision: 3 }))
      .toMatch(/\/catalog\/releases\/rel-art\/artwork\/v3$/);
    expect(getCatalogReleaseArtworkUrl(base)).toBeUndefined();
  });

  it("carries track identity into flattened stems", () => {
    const release = {
      id: "rel-f",
      artistId: "a",
      title: "Flat",
      status: "ready",
      type: "single",
      explicit: false,
      createdAt: "2026-09-01T00:00:00.000Z",
      artworkMimeType: "image/jpeg",
      tracks: [{
        id: "trk-f",
        releaseId: "rel-f",
        title: "Flat Track",
        position: 1,
        explicit: false,
        createdAt: "2026-09-01T00:00:00.000Z",
        stems: [{ id: "s1", trackId: "trk-f", type: "vocals", uri: "/s1", title: "Vocals" }],
      }],
    } satisfies Release;
    expect(flattenCatalogStems([release])[0]).toMatchObject({
      trackId: "trk-f",
      trackTitle: "Flat Track",
      title: "Vocals",
      artworkUrl: expect.stringContaining("/catalog/releases/rel-f/artwork"),
    });
  });
});

describe("topCatalogGenres", () => {
  const release = (id: string, genre?: string | null) => ({
    id,
    artistId: "a",
    title: id,
    status: "ready",
    type: "single",
    explicit: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    genre,
  }) satisfies Release;

  it("ranks by frequency, breaks ties alphabetically, and dedupes case-insensitively keeping the first spelling", () => {
    const releases = [
      release("1", "Pop"),
      release("2", "hip hop"),
      release("3", "pop"),
      release("4", "Afrobeat"),
      release("5", "Hip Hop"),
      release("6", "Jazz"),
      release("7", null),
      release("8", "  "),
      release("9", "POP"),
    ];
    expect(topCatalogGenres(releases, 8)).toEqual(["Pop", "hip hop", "Afrobeat", "Jazz"]);
    expect(topCatalogGenres(releases, 2)).toEqual(["Pop", "hip hop"]);
    expect(topCatalogGenres([], 8)).toEqual([]);
  });
});
