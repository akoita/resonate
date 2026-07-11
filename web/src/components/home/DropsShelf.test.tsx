/**
 * Home Drops shelf (#1479) — umbrella naming + kind chip, living-collectible
 * card reuse, context footer, collect-module deep link, and the no-dead-shelf
 * empty state.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DropsShelfView, formatPrice, shelfMoment } from "./DropsShelf";
import type { FeaturedDrop, PunchlineMoment } from "../../lib/api";

function moment(overrides: Partial<PunchlineMoment> = {}): PunchlineMoment {
  return {
    id: "m1",
    title: "The Hook",
    lyricText: "Own the punchline",
    artworkUrl: null,
    sourceStemType: "vocals",
    startMs: 1000,
    endMs: 6000,
    clipAssetUri: "/catalog/stems/clip.mp3/blob",
    editionSize: 100,
    priceCents: 0,
    rightsLabel: "NON_COMMERCIAL_COLLECTIBLE",
    collectedCount: 88,
    ...overrides,
  };
}

function drop(overrides: Partial<FeaturedDrop> = {}): FeaturedDrop {
  return {
    id: "drop_1",
    trackId: "trk_1",
    artistId: "art_1",
    status: "published",
    title: "Hook Drop",
    description: null,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    publishedAt: "2026-07-01T00:00:00Z",
    rightsLabel: "NON_COMMERCIAL_COLLECTIBLE",
    rightsSummary: "Personal collectible",
    moments: [moment()],
    unlock: null,
    context: {
      trackTitle: "Anthem",
      releaseId: "rel_1",
      releaseTitle: "Hot Release",
      releaseHasArtwork: false,
      artistName: "Hot Artist",
    },
    ...overrides,
  };
}

describe("DropsShelfView", () => {
  it("renders nothing when no drops exist — no dead shelf", () => {
    expect(renderToStaticMarkup(<DropsShelfView drops={[]} />)).toBe("");
  });

  it("renders the umbrella 'Drops' section with per-card kind chips", () => {
    const html = renderToStaticMarkup(<DropsShelfView drops={[drop()]} />);
    expect(html).toContain(">Drops<");
    expect(html).toContain("Own a piece of the hook");
    // Umbrella naming: the section title is NOT "Punchline Drops"…
    expect(html).not.toContain("Punchline Drops");
    // …the kind lives on the card chip instead (#1476-ready).
    expect(html).toContain("punchline-kind-chip");
    expect(html).toContain(">Punchline<");
  });

  it("reuses the living collectible card and adds the context footer", () => {
    const html = renderToStaticMarkup(<DropsShelfView drops={[drop()]} />);
    expect(html).toContain("punchline-collectible-card"); // shipped card, verbatim
    expect(html).toContain("Hot Artist");
    expect(html).toContain("Anthem");
    expect(html).toContain("12 of 100 left"); // scarcity numerals
    expect(html).toContain("Free to collect");
  });

  it("links each card to the release collect module via ?focus=moments", () => {
    const html = renderToStaticMarkup(<DropsShelfView drops={[drop()]} />);
    expect(html).toContain('href="/release/rel_1?focus=moments"');
  });

  it("card face prefers a still-collectable moment over a sold-out one", () => {
    const soldOut = moment({ id: "m_sold", title: "Gone", collectedCount: 100 });
    const open = moment({ id: "m_open", title: "Still Here", collectedCount: 3 });
    expect(shelfMoment(drop({ moments: [soldOut, open] }))?.id).toBe("m_open");
    // All sold out (edge: drop excluded server-side, but face stays defined).
    expect(shelfMoment(drop({ moments: [soldOut] }))?.id).toBe("m_sold");
  });

  it("formats price as dollars or the free-claim label", () => {
    expect(formatPrice(0)).toBe("Free to collect");
    expect(formatPrice(250)).toBe("$2.50");
  });
});
