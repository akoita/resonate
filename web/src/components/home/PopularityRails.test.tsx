/**
 * Home popularity rails (#1451 WS-4) — ranked render, genre re-rank labels,
 * and the honest low-data/empty state (no recency fallback).
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TopArtistsRail, TrendingNowRail } from "./PopularityRails";
import type { TopArtistItem, TrendingTrackItem } from "../../lib/api";

function trendingItem(overrides: Partial<TrendingTrackItem> = {}): TrendingTrackItem {
  return {
    rank: 1,
    trackId: "trk_1",
    title: "Anthem",
    artist: "Hot Artist",
    artistId: "art_1",
    releaseId: "rel_1",
    releaseTitle: "Hot Release",
    genre: "Hip Hop",
    artworkUrl: null,
    artworkMimeType: null,
    score: 3.2,
    plays: 4,
    uniqueListeners: 4,
    saves: 0,
    ...overrides,
  };
}

function artistItem(overrides: Partial<TopArtistItem> = {}): TopArtistItem {
  return {
    rank: 1,
    artistId: "art_1",
    name: "Hot Artist",
    imageUrl: null,
    score: 5.1,
    plays: 7,
    uniqueListeners: 4,
    saves: 1,
    ...overrides,
  };
}

describe("TrendingNowRail", () => {
  it("renders nothing while loading (items === null)", () => {
    expect(renderToStaticMarkup(<TrendingNowRail items={null} />)).toBe("");
  });

  it("renders items in served rank order with rank badges and listener counts", () => {
    const html = renderToStaticMarkup(
      <TrendingNowRail
        items={[
          trendingItem(),
          trendingItem({ rank: 2, trackId: "trk_2", title: "Deep Cut", uniqueListeners: 3 }),
        ]}
      />,
    );
    expect(html).toContain("Trending Now");
    expect(html.indexOf("Anthem")).toBeLessThan(html.indexOf("Deep Cut"));
    expect(html).toContain("#1");
    expect(html).toContain("#2");
    expect(html).toContain("4 listeners");
    expect(html).toContain("3 listeners");
    expect(html).toContain('href="/release/rel_1"');
  });

  it("shows the honest low-data state instead of a recency fallback", () => {
    const html = renderToStaticMarkup(<TrendingNowRail items={[]} genreLabel="Jazz" />);
    expect(html).toContain("Not enough listening yet in Jazz");
    expect(html).not.toContain("ng-play-card__title");
  });
});

describe("TopArtistsRail", () => {
  it("renders nothing while loading (items === null)", () => {
    expect(renderToStaticMarkup(<TopArtistsRail items={null} />)).toBe("");
  });

  it("renders engagement-ranked artist pills linking to profiles", () => {
    const html = renderToStaticMarkup(
      <TopArtistsRail
        items={[
          artistItem(),
          artistItem({ rank: 2, artistId: "art_2", name: "Second Artist", uniqueListeners: 3 }),
        ]}
      />,
    );
    expect(html).toContain("Top Artists");
    expect(html.indexOf("Hot Artist")).toBeLessThan(html.indexOf("Second Artist"));
    expect(html).toContain("#1");
    expect(html).toContain("#2");
    expect(html).toContain("art_1");
    expect(html).toContain("art_2");
  });

  it("links a credited artist WITH a matching account to the profile route (#1492)", () => {
    const html = renderToStaticMarkup(
      <TopArtistsRail items={[artistItem({ artistId: "art_1", name: "Claimed Star" })]} />,
    );
    expect(html).toContain('href="/artist/art_1"');
    expect(html).not.toContain("/catalog/artists/");
  });

  it("links a credited artist WITHOUT an account to the catalog artist route (#1492)", () => {
    // artistId is null when the credited name has no matching account; the pill
    // must still be a working link — to the catalog artist route by name.
    const html = renderToStaticMarkup(
      <TopArtistsRail items={[artistItem({ artistId: null, name: "Hot Credited" })]} />,
    );
    expect(html).toContain('href="/catalog/artists/Hot%20Credited"');
    expect(html).not.toContain('href="/artist/');
  });

  it("re-ranks per genre: a different ranking for the selected genre renders as served", () => {
    // The genre chip triggers a server-side re-rank; the rail renders whatever
    // ranking the endpoint returns for that genre, labeled accordingly.
    const overall = renderToStaticMarkup(
      <TopArtistsRail items={[artistItem(), artistItem({ rank: 2, artistId: "art_2", name: "Second Artist" })]} />,
    );
    const genreRanked = renderToStaticMarkup(
      <TopArtistsRail
        items={[
          artistItem({ rank: 1, artistId: "art_2", name: "Second Artist" }),
          artistItem({ rank: 2, artistId: "art_1", name: "Hot Artist" }),
        ]}
        genreLabel="Hip Hop"
      />,
    );
    expect(overall.indexOf("Hot Artist")).toBeLessThan(overall.indexOf("Second Artist"));
    expect(genreRanked.indexOf("Second Artist")).toBeLessThan(genreRanked.indexOf("Hot Artist"));
  });

  it("shows the honest low-data state for a quiet genre", () => {
    const html = renderToStaticMarkup(<TopArtistsRail items={[]} genreLabel="Jazz" />);
    expect(html).toContain("Not enough listening yet in Jazz");
    expect(html).not.toContain("ng-artist-pill\"");
  });
});
