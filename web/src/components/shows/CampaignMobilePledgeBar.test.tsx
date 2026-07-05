import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignMobilePledgeBar } from "./CampaignMobilePledgeBar";
import type { Campaign } from "../../lib/shows";

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
  heroImage: "",
  cardImage: "",
  visuals: [],
  status: "active",
  featured: false,
  contractAddress: "0xescrow",
  etherscanUrl: "",
  tagline: "",
  tiers: [],
} satisfies Campaign;

describe("CampaignMobilePledgeBar", () => {
  it("shows compact progress and links to the pledge rail", () => {
    const html = renderToStaticMarkup(<CampaignMobilePledgeBar campaign={campaign} />);

    expect(html).toContain("show-detail__mobile-pledge-bar");
    expect(html).toContain("40% funded");
    expect(html).toContain("$1.2k");
    expect(html).toContain("$3k");
    expect(html).toContain('href="#campaign-pledge-rail"');
    expect(html).toContain("Pledge");
  });
});
