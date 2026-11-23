import { reconcileArtistEngagement } from "../modules/catalog/discovery-artist-reconcile";
import type {
  DiscoveryArtistEngagementRow,
  DiscoveryTrackPopularityRow,
} from "../modules/catalog/discovery-popularity-export.service";

const computedAt = new Date("2026-11-23T23:25:00Z");

function track(trackId: string, overrides: Partial<DiscoveryTrackPopularityRow> = {}): DiscoveryTrackPopularityRow {
  return {
    trackId, window: "7d", genre: "", score: 2, plays: 20, uniqueListeners: 3, saves: 0, purchases: 0, computedAt,
    ...overrides,
  };
}

function artist(artistId: string, overrides: Partial<DiscoveryArtistEngagementRow> = {}): DiscoveryArtistEngagementRow {
  return {
    artistId, window: "7d", genre: "", score: 5, plays: 60, uniqueListeners: 4, saves: 0, purchases: 0, computedAt,
    ...overrides,
  };
}

describe("reconcileArtistEngagement (#2653)", () => {
  it("keeps an artist whose charting tracks the warehouse failed to attribute", () => {
    // Leona-style regression: two tracks chart in Trending, but the warehouse
    // artist mart has no row for their credited artist.
    const rows = reconcileArtistEngagement(
      [],
      [track("lovebird", { score: 2.5, plays: 28 }), track("when-it-hurts", { score: 1.5, plays: 18 })],
      new Map([["lovebird", ["leona"]], ["when-it-hurts", ["leona"]]]),
      new Set(["leona"]),
    );
    expect(rows).toEqual([
      expect.objectContaining({ artistId: "leona", score: 4, plays: 46, uniqueListeners: 3 }),
    ]);
  });

  it("leaves a correctly attributed warehouse row unchanged", () => {
    const warehouse = artist("felicia", { score: 4.764, plays: 62, uniqueListeners: 4 });
    const rows = reconcileArtistEngagement(
      [warehouse],
      [track("love-will-find-you", { score: 3, plays: 40, uniqueListeners: 4 })],
      new Map([["love-will-find-you", ["felicia"]]]),
      new Set(["felicia"]),
    );
    expect(rows).toEqual([warehouse]);
  });

  it("takes the larger value per metric when the warehouse row is incomplete", () => {
    const rows = reconcileArtistEngagement(
      [artist("senna", { score: 1, plays: 5, uniqueListeners: 3, saves: 2 })],
      [track("melt", { score: 2.4, plays: 30, uniqueListeners: 4 })],
      new Map([["melt", ["senna"]]]),
      new Set(["senna"]),
    );
    expect(rows).toEqual([
      expect.objectContaining({ artistId: "senna", score: 2.4, plays: 30, uniqueListeners: 4, saves: 2 }),
    ]);
  });

  it("drops warehouse rows for ids no current credit names, such as an old duplicate profile", () => {
    const rows = reconcileArtistEngagement(
      [artist("old-duplicate"), artist("current")],
      [],
      new Map(),
      new Set(["current"]),
    );
    expect(rows.map((row) => row.artistId)).toEqual(["current"]);
  });

  it("keeps genre and window rows apart and returns a stable order", () => {
    const rows = reconcileArtistEngagement(
      [],
      [
        track("a", { genre: "pop" }),
        track("a", { window: "30d" }),
        track("a"),
      ],
      new Map([["a", ["z-artist", "a-artist", "a-artist"]]]),
      new Set(["z-artist", "a-artist"]),
    );
    expect(rows.map((row) => `${row.window}/${row.genre}/${row.artistId}`)).toEqual([
      "30d//a-artist",
      "30d//z-artist",
      "7d//a-artist",
      "7d//z-artist",
      "7d/pop/a-artist",
      "7d/pop/z-artist",
    ]);
    // A duplicated credit id does not double-count the track.
    expect(rows.find((row) => row.artistId === "a-artist" && row.window === "7d" && row.genre === "")?.score).toBe(2);
  });
});
