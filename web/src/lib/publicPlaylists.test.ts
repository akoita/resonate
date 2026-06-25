import { describe, expect, it } from "vitest";
import { API_BASE, mapPublicPlaylistSummary } from "./api";

describe("mapPublicPlaylistSummary", () => {
  const base = {
    id: "p1",
    name: "Crate Diggers",
    ownerUserId: "u1",
    ownerDisplayName: "Selecta",
    trackCount: 4,
    playableTrackCount: 3,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
  };

  it("resolves relative catalog artwork paths into absolute URLs", () => {
    const mapped = mapPublicPlaylistSummary({
      ...base,
      coverArtworkPaths: ["/catalog/releases/rel-1/artwork", "/catalog/releases/rel-2/artwork"],
    });
    expect(mapped.coverArtworkUrls).toEqual([
      `${API_BASE}/catalog/releases/rel-1/artwork`,
      `${API_BASE}/catalog/releases/rel-2/artwork`,
    ]);
  });

  it("defaults coverArtworkUrls to an empty array when paths are missing", () => {
    const mapped = mapPublicPlaylistSummary({ ...base, coverArtworkPaths: undefined });
    expect(mapped.coverArtworkUrls).toEqual([]);
  });

  it("preserves the rest of the summary fields", () => {
    const mapped = mapPublicPlaylistSummary({ ...base, coverArtworkPaths: [] });
    expect(mapped).toMatchObject({
      id: "p1",
      name: "Crate Diggers",
      ownerDisplayName: "Selecta",
      trackCount: 4,
      playableTrackCount: 3,
    });
  });
});
