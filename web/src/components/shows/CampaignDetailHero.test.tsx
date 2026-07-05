import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignDetailHero } from "./CampaignDetailHero";
import type { Campaign, CampaignTier } from "../../lib/shows";

const tiers: CampaignTier[] = [
  {
    id: "fan-signal",
    title: "Fan signal",
    amountCents: 2500,
    currency: "USD",
    paymentAssetSymbol: "USDC",
  },
  {
    id: "ticket-intent",
    title: "Ticket intent",
    amountCents: 7500,
    currency: "USD",
    paymentAssetSymbol: "USDC",
  },
];

const campaign = {
  id: "show-x",
  backendId: "b1",
  rawStatus: "active",
  campaignLevel: "active_escrow_campaign",
  artistAuthorityStatus: "artist_authorized",
  beneficiaryAddress: "0x1234567890abcdef1234567890abcdef12345678",
  beneficiaryType: "wallet",
  artistName: "Artist",
  artistSlug: "artist",
  artistImage: "",
  artistLinks: {},
  isSample: false,
  title: "Show X",
  city: "Paris",
  country: "FR",
  venue: "Le Trianon",
  targetDate: "2026-09-01T00:00:00.000Z",
  deadline: "2026-07-20T00:00:00.000Z",
  goalCents: 300000,
  raisedCents: 120000,
  currency: "USD",
  paymentAssetSymbol: "USDC",
  paymentAssetDecimals: 6,
  feeBps: 600,
  backerCount: 4,
  thresholdBackers: 100,
  heroImage: "https://example.com/hero.jpg",
  cardImage: "",
  visuals: [],
  status: "active",
  featured: false,
  contractAddress: "0xescrow",
  etherscanUrl: "https://sepolia.basescan.org/address/0xescrow",
  tagline: "A live demand signal.",
  tiers,
} satisfies Campaign;

describe("CampaignDetailHero", () => {
  it("uses pledge-focused copy and anchors to the pledge rail", () => {
    const html = renderToStaticMarkup(<CampaignDetailHero campaign={campaign} tiers={tiers} />);

    expect(html).toContain("campaign-detail-hero");
    expect(html).toContain('href="#campaign-pledge-rail"');
    expect(html).toContain("Pledge with wallet");
    expect(html).toContain("Fan signal");
    expect(html).toContain("Ticket intent");
    expect(html).toContain("A 6% platform fee applies only if the campaign is funded");
    expect(html).not.toContain("Send Your Signal");
    expect(html).not.toContain(`href="/shows/${campaign.id}"`);
  });
});
