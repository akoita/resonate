import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BrowseDrop,
  DropsBrowseResponse,
  PunchlineMoment,
} from "../../lib/api";
import { fetchDropsBrowse } from "../../lib/api";
import {
  DropsBrowseView,
  dropsBrowseHref,
  parseDropsBrowseQuery,
} from "./DropsBrowseView";
import { discoveryMoment } from "./DropDiscoveryCard";

function moment(overrides: Partial<PunchlineMoment> = {}): PunchlineMoment {
  return {
    id: "moment-1",
    title: "Golden line",
    lyricText: "A line worth keeping",
    artworkUrl: null,
    sourceStemType: "vocals",
    startMs: 1000,
    endMs: 5000,
    clipAssetUri: "/clip.mp3",
    editionSize: 10,
    priceCents: 0,
    rightsLabel: "NON_COMMERCIAL_COLLECTIBLE",
    collectedCount: 2,
    ...overrides,
  };
}

function drop(id: string, overrides: Partial<BrowseDrop> = {}): BrowseDrop {
  return {
    id,
    trackId: `track-${id}`,
    artistId: `artist-${id}`,
    status: "published",
    title: `Drop ${id}`,
    description: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    publishedAt: "2026-08-01T00:00:00Z",
    rightsLabel: "NON_COMMERCIAL_COLLECTIBLE",
    rightsSummary: "Personal collectible",
    moments: [moment({ title: `Moment ${id}` })],
    unlock: null,
    kind: "punchline",
    availability: {
      soldOut: false,
      totalEditions: 10,
      collectedCount: 2,
      remainingEditions: 8,
    },
    context: {
      trackTitle: `Track ${id}`,
      releaseId: `release-${id}`,
      releaseTitle: `Release ${id}`,
      releaseHasArtwork: false,
      artistName: `Artist ${id}`,
      genre: "Electronic",
    },
    ...overrides,
  };
}

function response(items: BrowseDrop[], meta: Partial<DropsBrowseResponse["meta"]> = {}): DropsBrowseResponse {
  return {
    items,
    meta: {
      count: items.length,
      page: 1,
      limit: 24,
      totalCount: items.length,
      totalPages: 1,
      hasNextPage: false,
      ...meta,
    },
    facets: { genres: ["Electronic", "Hip-hop"] },
  };
}

const defaultQuery = parseDropsBrowseQuery(undefined);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DropsBrowseView", () => {
  it("renders the collection positioning, ranked order, controls, and deep links", () => {
    const html = renderToStaticMarkup(
      <DropsBrowseView result={response([drop("first"), drop("second")])} query={defaultQuery} />,
    );
    expect(html).toContain("Collection gallery");
    expect(html).toContain("Own the moments.");
    expect(html).toContain('href="/marketplace"');
    expect(html).toContain("License the ingredients");
    expect(html).toContain('class="ng-filter-deck"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<select");
    expect(html.indexOf("Moment first")).toBeLessThan(html.indexOf("Moment second"));
    expect(html).toContain('href="/release/release-first?focus=moments"');
    expect(html).toContain('aria-label="Play preview of Moment first"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Play preview");
    const releaseLinkStart = html.indexOf('href="/release/release-first?focus=moments"');
    const releaseLinkEnd = html.indexOf("</a>", releaseLinkStart);
    const previewButtonStart = html.indexOf("<button", releaseLinkStart);
    expect(releaseLinkEnd).toBeLessThan(previewButtonStart);
  });

  it("renders the filters as instant link chips with canonical hrefs", () => {
    const html = renderToStaticMarkup(
      <DropsBrowseView result={response([drop("first")])} query={defaultQuery} />,
    );
    expect(html).toContain('aria-labelledby="drops-filter-title"');
    expect(html).toContain("Filter Drops");
    for (const label of ["Kind", "Genre", "Price", "Availability"]) {
      expect(html).toContain(`>${label}</span>`);
    }
    expect(html).toContain('href="/drops?kind=punchline"');
    expect(html).toContain('href="/drops?genre=Electronic"');
    expect(html).toContain('href="/drops?genre=Hip-hop"');
    expect(html).toContain('href="/drops?price=free"');
    expect(html).toContain('href="/drops?price=paid"');
    expect(html).toContain('href="/drops?includeSoldOut=1"');
    expect(html).not.toContain("Apply filters");
    expect(html).not.toContain("aria-pressed=\"true\"");
  });

  it("marks exactly one active chip per row with aria-current", () => {
    const defaults = renderToStaticMarkup(
      <DropsBrowseView result={response([drop("first")])} query={defaultQuery} />,
    );
    expect(defaults.match(/aria-current="true"/g)).toHaveLength(4);
    expect(defaults).toMatch(/class="ng-chip ng-chip--active" aria-current="true"[^>]*>All genres</);
    expect(defaults).toMatch(/class="ng-chip ng-chip--active" aria-current="true"[^>]*>Available now</);

    const filtered = renderToStaticMarkup(
      <DropsBrowseView
        result={response([drop("first")])}
        query={parseDropsBrowseQuery({ kind: "punchline", price: "free", genre: "Hip-hop", includeSoldOut: "1" })}
      />,
    );
    expect(filtered.match(/aria-current="true"/g)).toHaveLength(4);
    expect(filtered).toMatch(/class="ng-chip ng-chip--active" aria-current="true"[^>]*>Punchline</);
    expect(filtered).toMatch(/class="ng-chip ng-chip--active" aria-current="true"[^>]*>Hip-hop</);
    expect(filtered).toMatch(/class="ng-chip ng-chip--active" aria-current="true"[^>]*>Free</);
    expect(filtered).toMatch(/class="ng-chip ng-chip--active" aria-current="true"[^>]*>Include sold out</);
  });

  it("builds chip links that keep the other filters and reset to the first page", () => {
    const query = parseDropsBrowseQuery({ page: "3", kind: "punchline", genre: "Hip-hop" });
    const html = renderToStaticMarkup(
      <DropsBrowseView
        result={response([drop("p3")], { page: 3, totalPages: 3, totalCount: 60 })}
        query={query}
      />,
    );
    expect(html).toContain('href="/drops?kind=punchline&amp;genre=Hip-hop&amp;price=free"');
    expect(html).toContain('href="/drops?genre=Hip-hop"');
    expect(html).toContain('href="/drops?kind=punchline"');
    expect(html).toContain('href="/drops?kind=punchline&amp;genre=Hip-hop&amp;includeSoldOut=1"');
    const chipHrefs = [...html.matchAll(/<a[^>]*class="ng-chip[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(chipHrefs.length).toBeGreaterThan(0);
    for (const chip of chipHrefs) expect(chip).not.toContain("page=");
  });

  it("keeps an unknown active genre visible as the active chip", () => {
    const html = renderToStaticMarkup(
      <DropsBrowseView
        result={response([drop("first")])}
        query={{ ...defaultQuery, genre: "Jazz" }}
      />,
    );
    expect(html).toMatch(/class="ng-chip ng-chip--active" aria-current="true"[^>]*>Jazz</);
  });

  it("shows Clear filters only when a filter differs from the defaults", () => {
    const defaults = renderToStaticMarkup(
      <DropsBrowseView result={response([drop("first")])} query={defaultQuery} />,
    );
    expect(defaults).not.toContain("Clear filters");

    for (const query of [
      { ...defaultQuery, kind: "punchline" as const },
      { ...defaultQuery, genre: "Hip-hop" },
      { ...defaultQuery, price: "paid" as const },
      { ...defaultQuery, includeSoldOut: true },
    ]) {
      const html = renderToStaticMarkup(
        <DropsBrowseView result={response([drop("first")])} query={query} />,
      );
      expect(html).toMatch(/<a class="ng-section-link ng-filter-deck__clear" href="\/drops">Clear filters<\/a>/);
    }
  });

  it("renders an honest disabled preview when the selected moment has no clip", () => {
    const unavailable = drop("unavailable", {
      moments: [moment({ clipAssetUri: null })],
    });
    const html = renderToStaticMarkup(
      <DropsBrowseView result={response([unavailable])} query={defaultQuery} />,
    );
    expect(html).toContain('aria-label="Preview unavailable for Golden line"');
    expect(html).toContain("disabled");
    expect(html).toContain("Preview unavailable");
    expect(html).toContain('href="/release/release-unavailable?focus=moments"');
  });

  it("normalizes invalid incoming values to safe defaults", () => {
    expect(parseDropsBrowseQuery({ page: "-7", kind: "future", price: "crypto" })).toEqual({
      page: 1,
      kind: "all",
      genre: "",
      price: "all",
      includeSoldOut: false,
    });
  });

  it("preserves active filters in pagination links", () => {
    const query = parseDropsBrowseQuery({
      page: "2",
      kind: "punchline",
      genre: "Hip-hop",
      price: "paid",
      includeSoldOut: "1",
    });
    const html = renderToStaticMarkup(
      <DropsBrowseView
        result={response([drop("page-two")], { page: 2, totalPages: 3, totalCount: 49, hasNextPage: true })}
        query={query}
      />,
    );
    expect(html).toContain(
      'href="/drops?kind=punchline&amp;genre=Hip-hop&amp;price=paid&amp;includeSoldOut=1"',
    );
    expect(html).toContain(
      'href="/drops?page=3&amp;kind=punchline&amp;genre=Hip-hop&amp;price=paid&amp;includeSoldOut=1"',
    );
    expect(dropsBrowseHref(query, { page: 1 })).not.toContain("page=");
  });

  it("renders distinct default, filtered, sold-out-inclusive, and error states", () => {
    const empty = response([]);
    expect(renderToStaticMarkup(<DropsBrowseView result={empty} query={defaultQuery} />))
      .toContain("No Drops to collect yet.");
    expect(renderToStaticMarkup(
      <DropsBrowseView result={empty} query={{ ...defaultQuery, genre: "Jazz" }} />,
    )).toContain("No Drops match these filters.");
    expect(renderToStaticMarkup(
      <DropsBrowseView result={empty} query={{ ...defaultQuery, includeSoldOut: true }} />,
    )).toContain("No published Drops yet.");
    const failed = renderToStaticMarkup(<DropsBrowseView query={defaultQuery} failed />);
    expect(failed).toContain("We couldn&#x27;t load Drops.");
    expect(failed).toContain('href="/drops"');
  });

  it("explains an out-of-range page without claiming the gallery is empty", () => {
    const html = renderToStaticMarkup(
      <DropsBrowseView
        result={response([], { page: 9, totalCount: 3, totalPages: 1 })}
        query={{ ...defaultQuery, page: 9 }}
      />,
    );
    expect(html).toContain("That Drops page is empty.");
    expect(html).toContain("Back to the first page");
    expect(html).not.toContain("No Drops to collect yet.");
  });

  it("keeps sold-out cards honest", () => {
    const soldOut = drop("gone", {
      availability: { soldOut: true, totalEditions: 10, collectedCount: 10, remainingEditions: 0 },
      moments: [moment({ editionSize: 10, collectedCount: 10 })],
    });
    const html = renderToStaticMarkup(
      <DropsBrowseView result={response([soldOut])} query={{ ...defaultQuery, includeSoldOut: true }} />,
    );
    expect(html).toContain("Sold out");
    expect(html).toContain("View sold-out Golden line from Track gone");
  });

  it("uses an available moment matching the selected price class when possible", () => {
    const mixed = drop("mixed", {
      moments: [
        moment({ id: "free", title: "Free face", priceCents: 0 }),
        moment({ id: "paid-sold", title: "Paid sold", priceCents: 200, collectedCount: 10 }),
        moment({ id: "paid-open", title: "Paid open", priceCents: 300, collectedCount: 1 }),
      ],
    });
    expect(discoveryMoment(mixed, "paid")?.id).toBe("paid-open");
    const html = renderToStaticMarkup(
      <DropsBrowseView result={response([mixed])} query={{ ...defaultQuery, price: "paid" }} />,
    );
    expect(html).toContain("Paid open");
    expect(html).not.toContain("Free face");
  });

  it("builds the strict backend query through the shared API helper without caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(response([])),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchDropsBrowse({
      page: 2,
      limit: 24,
      kind: "punchline",
      genre: "Hip-hop",
      price: "paid",
      availability: "all",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain(
      "/punchline/drops?page=2&limit=24&kind=punchline&genre=Hip-hop&price=paid&availability=all",
    );
    expect(options).toMatchObject({ cache: "no-store" });
  });
});
