/**
 * Home v3 "Upcoming Live Events" — ticket cards with real funding progress,
 * the typographic poster fallback, and nothing rendered without campaigns.
 */
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveEventRail } from "./LiveEventRail";
import type { Campaign } from "../../lib/shows";

const DAY_MS = 24 * 60 * 60 * 1000;

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "show-x",
    backendId: "b1",
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
    deadline: new Date(Date.now() + 10 * DAY_MS).toISOString(),
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

describe("LiveEventRail", () => {
  it("renders nothing when there are no campaigns", () => {
    expect(renderToStaticMarkup(<LiveEventRail campaigns={[]} />)).toBe("");
  });

  it("renders a ticket linking to the campaign with its real funding progress", () => {
    const html = renderToStaticMarkup(<LiveEventRail campaigns={[campaign()]} />);
    expect(html).toContain("Upcoming Live Events");
    expect(html).toContain('href="/shows"');
    expect(html).toContain('href="/shows/show-x"');
    expect(html).toContain("Show X");
    expect(html).toContain("Coliseu");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="25"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-label="Funding progress"');
    expect(html).toContain("25% funded");
    expect(html).toContain("12 backers");
    expect(html).toContain("10d left");
    expect(html).toContain("25 Dec");
    expect(html).toContain("Back this show");
  });

  it("omits the days-left part once the deadline has passed", () => {
    const html = renderToStaticMarkup(
      <LiveEventRail
        campaigns={[campaign({ deadline: new Date(Date.now() - DAY_MS).toISOString(), backerCount: 1 })]}
      />,
    );
    expect(html).toContain("1 backer<");
    expect(html).not.toContain("d left");
  });

  it("uses a typographic city poster instead of a monogram when there is no image", () => {
    const html = renderToStaticMarkup(<LiveEventRail campaigns={[campaign()]} />);
    expect(html).toContain("ng-ticket__art--poster");
    expect(html).toContain('class="campaign-poster"');
    expect(html).toContain('<span class="campaign-poster__city">Lisbon</span>');

    const withImage = renderToStaticMarkup(
      <LiveEventRail campaigns={[campaign({ cardImage: "https://cdn.example.test/card.jpg" })]} />,
    );
    expect(withImage).toContain("ng-ticket__art--image");
    expect(withImage).toContain('src="https://cdn.example.test/card.jpg"');
    expect(withImage).not.toContain("campaign-poster");
  });

  it("shows at most eight campaigns in the given order", () => {
    const campaigns = Array.from({ length: 10 }, (_, i) => campaign({ id: `show-${i}`, title: `Show ${i}` }));
    const html = renderToStaticMarkup(<LiveEventRail campaigns={campaigns} />);
    expect(html.match(/class="ng-ticket"/g)).toHaveLength(8);
    expect(html.indexOf("Show 0")).toBeLessThan(html.indexOf("Show 1"));
    expect(html).not.toContain("show-8");
  });
});
