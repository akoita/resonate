import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Campaign } from "../../lib/shows";
import { ArtistCampaignBanners, ArtistCampaignLink, artistCampaignKicker } from "./ArtistCampaignLink";

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "tiken-jah-fakoly-brooklyn",
    backendId: "campaign-1",
    rawStatus: "active",
    campaignLevel: "signal",
    artistAuthorityStatus: "none",
    artistName: "Tiken Jah Fakoly",
    artistId: "artist-1",
    artistSlug: "tiken-jah-fakoly",
    artistImage: "",
    artistLinks: {},
    isSample: false,
    title: "Tiken Jah Fakoly in Brooklyn",
    city: "Brooklyn",
    country: "US",
    venue: "Brooklyn Steel",
    targetDate: "2027-03-01T00:00:00.000Z",
    deadline: "2026-12-01T00:00:00.000Z",
    goalCents: 1_000_000,
    raisedCents: 530_000,
    currency: "USD",
    backerCount: 40,
    thresholdBackers: 100,
    heroImage: "",
    cardImage: "",
    visuals: [],
    status: "active",
    featured: false,
    tagline: "Bring reggae to Brooklyn.",
    tiers: [],
    ...overrides,
  };
}

describe("ArtistCampaignBanners", () => {
  it("renders nothing without campaigns", () => {
    expect(renderToStaticMarkup(<ArtistCampaignBanners campaigns={[]} />)).toBe("");
  });

  it("links to the campaign with title, place and progress", () => {
    const html = renderToStaticMarkup(<ArtistCampaignBanners campaigns={[campaign()]} />);

    expect(html).toContain('href="/shows/tiken-jah-fakoly-brooklyn"');
    expect(html).toContain("Live show campaign");
    expect(html).toContain("Tiken Jah Fakoly in Brooklyn");
    expect(html).toContain("Brooklyn Steel · Brooklyn");
    expect(html).toContain("53% funded");
    expect(html).toContain(
      'aria-label="Live show campaign: Tiken Jah Fakoly in Brooklyn, Brooklyn Steel · Brooklyn, 53% funded. Open the campaign"',
    );
    expect(html).toContain("artist-campaign-link__pulse");
  });

  it("shows the campaign card image and encodes the route id", () => {
    const html = renderToStaticMarkup(
      <ArtistCampaignBanners
        campaigns={[campaign({ id: "a b", cardImage: "https://cdn.example/card.jpg", rawStatus: "funded" })]}
      />,
    );

    expect(html).toContain('href="/shows/a%20b"');
    expect(html).toContain("artist-campaign-link__thumb--image");
    expect(html).toContain("https://cdn.example/card.jpg");
    expect(html).toContain("Funded show campaign");
    expect(html).not.toContain("artist-campaign-link__pulse");
  });

  it("labels booked campaigns", () => {
    expect(artistCampaignKicker({ rawStatus: "booking_confirmed" }).label).toBe("Show booked");
  });
});

describe("ArtistCampaignLink", () => {
  it("renders nothing before campaigns load", () => {
    expect(renderToStaticMarkup(<ArtistCampaignLink artistId="artist-1" artistName="Tiken Jah Fakoly" />)).toBe("");
  });
});
