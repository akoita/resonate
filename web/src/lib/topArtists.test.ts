import { describe, expect, it } from "vitest";
import { API_BASE, mapTopArtistItem, resolveApiAssetUrl, type TopArtistItem } from "./api";

function artist(overrides: Partial<TopArtistItem> = {}): TopArtistItem {
  return {
    rank: 1,
    artistId: "artist-1",
    name: "Aya Lune",
    imageUrl: null,
    score: 1,
    plays: 4,
    uniqueListeners: 3,
    saves: 0,
    ...overrides,
  };
}

describe("Top Artists API mapping (#1820)", () => {
  it("resolves backend-relative portraits against the API origin", () => {
    expect(resolveApiAssetUrl("/shows/campaigns/show-1/visuals/portrait")).toBe(
      `${API_BASE}/shows/campaigns/show-1/visuals/portrait`,
    );
    expect(mapTopArtistItem(artist({ imageUrl: "/artists/artist-1/image" }))).toMatchObject({
      imageUrl: `${API_BASE}/artists/artist-1/image`,
    });
  });

  it("preserves absolute HTTP image URLs", () => {
    expect(resolveApiAssetUrl("https://cdn.example.test/artist.jpg")).toBe(
      "https://cdn.example.test/artist.jpg",
    );
  });

  it("drops empty, malformed, and unsupported image URLs", () => {
    expect(resolveApiAssetUrl(null)).toBeNull();
    expect(resolveApiAssetUrl("  ")).toBeNull();
    expect(resolveApiAssetUrl("javascript:alert(1)")).toBeNull();
  });
});
