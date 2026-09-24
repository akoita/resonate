/**
 * Shows explorer card artwork: one fallback chain for every image source
 * (declared image → card endpoint → hero endpoint) and a typographic city
 * poster — never a broken image or a lone initial — once the chain is empty.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import {
  CampaignCard,
  campaignCardVisualSources,
  campaignVisualIndexAfterFailure,
} from "./CampaignCard";
import { campaignPosterHue } from "./CampaignPoster";
import { campaignVisualEndpoint, type Campaign } from "../../lib/shows";

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "show-x",
    backendId: "",
    rawStatus: "active",
    campaignLevel: "active_escrow_campaign",
    artistAuthorityStatus: "artist_authorized",
    artistName: "Artist",
    artistSlug: "artist",
    artistImage: "",
    artistLinks: {},
    isSample: false,
    title: "Show X",
    city: "Lisbon",
    country: "PT",
    venue: "Coliseu",
    targetDate: "2026-12-25T12:00:00.000Z",
    deadline: "2026-12-01T12:00:00.000Z",
    goalCents: 400000,
    raisedCents: 100000,
    currency: "USD",
    backerCount: 12,
    thresholdBackers: 100,
    heroImage: "",
    cardImage: "",
    visuals: [],
    status: "active",
    featured: false,
    tagline: "",
    tiers: [],
    ...overrides,
  };
}

describe("campaignCardVisualSources", () => {
  it("orders the declared image before the card and hero endpoints", () => {
    const withBackend = campaign({ backendId: "b1", cardImage: "https://cdn.example.test/card.jpg" });
    expect(campaignCardVisualSources(withBackend)).toEqual([
      "https://cdn.example.test/card.jpg",
      campaignVisualEndpoint(withBackend, "card"),
      campaignVisualEndpoint(withBackend, "hero"),
    ]);
  });

  it("skips empty and duplicate sources", () => {
    expect(campaignCardVisualSources(campaign())).toEqual([]);
    const backendOnly = campaign({ backendId: "b1" });
    expect(campaignCardVisualSources(backendOnly)).toEqual([
      campaignVisualEndpoint(backendOnly, "card"),
      campaignVisualEndpoint(backendOnly, "hero"),
    ]);
    const declaredIsEndpoint = campaign({
      backendId: "b1",
      cardImage: campaignVisualEndpoint(backendOnly, "card"),
    });
    expect(campaignCardVisualSources(declaredIsEndpoint)).toEqual([
      campaignVisualEndpoint(backendOnly, "card"),
      campaignVisualEndpoint(backendOnly, "hero"),
    ]);
  });
});

describe("campaignVisualIndexAfterFailure", () => {
  const sources = ["declared.jpg", "card-endpoint", "hero-endpoint"];

  it("advances to the next source when the current one errors, then exhausts", () => {
    expect(campaignVisualIndexAfterFailure(sources, 0, "declared.jpg")).toBe(1);
    expect(campaignVisualIndexAfterFailure(sources, 1, "card-endpoint")).toBe(2);
    const exhausted = campaignVisualIndexAfterFailure(sources, 2, "hero-endpoint");
    expect(exhausted).toBe(3);
    expect(sources[exhausted]).toBeUndefined();
  });

  it("ignores stale or unknown failures", () => {
    expect(campaignVisualIndexAfterFailure(sources, 2, "declared.jpg")).toBe(2);
    expect(campaignVisualIndexAfterFailure(sources, 1, "elsewhere.jpg")).toBe(1);
  });
});

describe("CampaignCard", () => {
  it("renders the typographic city poster, not a monogram, when there is no image", () => {
    const html = renderToStaticMarkup(<CampaignCard campaign={campaign()} />);
    expect(html).toContain("campaign-card__art--poster");
    expect(html).toContain('class="campaign-poster"');
    expect(html).toContain(`--poster-hue:${campaignPosterHue("show-x")}`);
    expect(html).toContain('<span class="campaign-poster__city">Lisbon</span>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("campaign-card__monogram");
  });

  it("renders the first source as the image and keeps the card a single labelled button", () => {
    const html = renderToStaticMarkup(
      <CampaignCard campaign={campaign({ backendId: "b1", cardImage: "https://cdn.example.test/card.jpg" })} />,
    );
    expect(html).toContain('src="https://cdn.example.test/card.jpg"');
    expect(html).toContain("campaign-card__art--image");
    expect(html).not.toContain("campaign-poster");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Open campaign — Show X"');
    expect(html).toContain('<span class="campaign-card__city-chip">Lisbon</span>');
  });

  it("falls back to the card visual endpoint when nothing is declared", () => {
    const backendOnly = campaign({ backendId: "b1" });
    const html = renderToStaticMarkup(<CampaignCard campaign={backendOnly} />);
    expect(html).toContain(`src="${campaignVisualEndpoint(backendOnly, "card")}"`);
  });
});
