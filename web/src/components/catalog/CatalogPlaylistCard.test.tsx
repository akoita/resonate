import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicPlaylistSummary } from "../../lib/api";
import { CatalogPlaylistCard, CatalogPlaylistThumb } from "./CatalogPlaylistCard";

const basePlaylist: PublicPlaylistSummary = {
  id: "pl-1",
  name: "Sunset Drive",
  ownerUserId: "u1",
  ownerDisplayName: "Nova",
  trackCount: 12,
  playableTrackCount: 12,
  coverArtworkUrls: [],
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
};

describe("CatalogPlaylistCard", () => {
  it("links to the public playlist viewer with name, owner, and track count", () => {
    const html = renderToStaticMarkup(<CatalogPlaylistCard playlist={basePlaylist} />);
    expect(html).toContain('href="/playlist/pl-1"');
    expect(html).toContain("Sunset Drive");
    expect(html).toContain("by Nova");
    expect(html).toContain("12 tracks");
  });

  it("singularizes a one-track playlist and falls back when there is no owner name", () => {
    const html = renderToStaticMarkup(
      <CatalogPlaylistCard playlist={{ ...basePlaylist, trackCount: 1, ownerDisplayName: null }} />,
    );
    expect(html).toContain("1 track");
    expect(html).not.toContain("1 tracks");
    expect(html).toContain("Public playlist");
  });
});

describe("CatalogPlaylistThumb", () => {
  it("renders a 2×2 mosaic when there are at least four covers", () => {
    const covers = ["a", "b", "c", "d", "e"].map((s) => `https://cdn/${s}.jpg`);
    const html = renderToStaticMarkup(
      <CatalogPlaylistThumb playlist={{ ...basePlaylist, coverArtworkUrls: covers }} />,
    );
    expect(html).toContain("ng-playlist-thumb__mosaic");
    // capped at 4 cells
    expect(html.match(/ng-playlist-thumb__cell/g) ?? []).toHaveLength(4);
    expect(html).not.toContain("ng-playlist-thumb__monogram");
  });

  it("renders a single cover for one-to-three covers", () => {
    const html = renderToStaticMarkup(
      <CatalogPlaylistThumb playlist={{ ...basePlaylist, coverArtworkUrls: ["https://cdn/a.jpg"] }} />,
    );
    expect(html).toContain("ng-playlist-thumb__single");
    expect(html).not.toContain("ng-playlist-thumb__mosaic");
  });

  it("falls back to a name monogram with no covers", () => {
    const html = renderToStaticMarkup(
      <CatalogPlaylistThumb playlist={{ ...basePlaylist, name: "zen", coverArtworkUrls: [] }} />,
    );
    expect(html).toContain("ng-playlist-thumb__monogram");
    expect(html).toContain(">Z<");
  });
});
