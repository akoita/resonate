import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignTrustPanel } from "./CampaignTrustPanel";
import type { Campaign } from "../../lib/shows";

const baseCampaign = {
  id: "show-x",
  backendId: "b1",
  rawStatus: "active",
  campaignLevel: "active_escrow_campaign",
  artistAuthorityStatus: "artist_authorized",
  authorityCredentialId: "secret-credential-123",
  authorityEvidenceBundleId: "secret-evidence-456",
  beneficiaryAddress: "0x1234567890abcdef1234567890abcdef12345678",
  beneficiaryType: "wallet",
  artistName: "Artist",
  artistSlug: "artist",
  title: "Show X",
  city: "Paris",
  country: "FR",
  targetDate: "2026-09-01T00:00:00.000Z",
  deadline: "2026-07-01T00:00:00.000Z",
  bookingDeadline: "2026-07-15T00:00:00.000Z",
  goalCents: 300000,
  raisedCents: 120000,
  currency: "USD",
  paymentAssetSymbol: "USDC",
  chainId: 84532,
  releasePolicy: "staged_release",
  depositReleaseBps: 1000,
  disputeWindowSeconds: 604800,
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

describe("CampaignTrustPanel (#949)", () => {
  it("renders the trust state, immutable terms, and masked beneficiary", () => {
    const html = renderToStaticMarkup(<CampaignTrustPanel campaign={baseCampaign} />);
    expect(html).toContain('data-trust="authorized_escrow"');
    expect(html).toContain("Artist-authorized escrow");
    expect(html).toContain("Artist authorized");
    expect(html).toContain("0x1234…5678"); // masked beneficiary
    expect(html).toContain("USDC on Base Sepolia");
    expect(html).toContain("10%"); // deposit release
    expect(html).toContain("7 days"); // dispute window
    expect(html).toContain("Minimum backers");
    // Honest copy: never a guaranteed ticket.
    expect(html.toLowerCase()).not.toContain("guaranteed ticket");
  });

  it("never leaks sensitive authority evidence/credential ids", () => {
    const html = renderToStaticMarkup(<CampaignTrustPanel campaign={baseCampaign} />);
    expect(html).not.toContain("secret-credential-123");
    expect(html).not.toContain("secret-evidence-456");
    // Full beneficiary address is masked, not shown in full.
    expect(html).not.toContain("0x1234567890abcdef1234567890abcdef12345678");
  });

  it("surfaces an active dispute and hides the row when there is none (#950)", () => {
    const active = renderToStaticMarkup(
      <CampaignTrustPanel
        campaign={{ ...baseCampaign, disputeStatus: "active", disputeWindowClosesAt: "2026-08-01T00:00:00.000Z" }}
      />,
    );
    expect(active).toContain('data-dispute="active"');
    expect(active).toContain("Dispute under review");
    expect(active).toContain("Final release is paused");

    const none = renderToStaticMarkup(<CampaignTrustPanel campaign={baseCampaign} />);
    expect(none).not.toContain("campaign-trust__dispute");
  });

  it("surfaces refund-available and cancelled trust states", () => {
    const refund = renderToStaticMarkup(
      <CampaignTrustPanel campaign={{ ...baseCampaign, rawStatus: "refund_available" }} />,
    );
    expect(refund).toContain('data-trust="refund_available"');
    expect(refund).toContain("Refund available");

    const cancelled = renderToStaticMarkup(
      <CampaignTrustPanel campaign={{ ...baseCampaign, rawStatus: "cancelled" }} />,
    );
    expect(cancelled).toContain('data-trust="cancelled"');
  });
});
