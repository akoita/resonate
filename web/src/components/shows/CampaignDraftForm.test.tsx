import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The editor pulls in Next router + auth/zerodev context; stub them so the form
// renders standalone. Effects don't run under renderToStaticMarkup, so the
// network helpers in lib/api / lib/shows are never invoked.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ token: "t", status: "authenticated", role: "operator", connect: vi.fn() }),
}));
vi.mock("../auth/ZeroDevProviderClient", () => ({
  useZeroDev: () => ({ chainId: 84532 }),
}));

import { CampaignDraftForm } from "./CampaignDraftForm";
import type { Campaign } from "../../lib/shows";

const baseCampaign = {
  id: "show-x",
  backendId: "b1",
  rawStatus: "draft",
  campaignLevel: "active_escrow_campaign",
  artistAuthorityStatus: "artist_authorized",
  authorityCredentialId: null,
  authorityEvidenceBundleId: "evidence-1",
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
  deadline: "2026-07-01T00:00:00.000Z",
  bookingDeadline: "2026-07-15T00:00:00.000Z",
  goalCents: 300000,
  raisedCents: 0,
  currency: "USD",
  paymentAssetSymbol: "USDC",
  paymentAssetDecimals: 6,
  chainId: 84532,
  releasePolicy: "staged_release",
  depositReleaseBps: 1000,
  disputeWindowSeconds: 604800,
  backerCount: 0,
  thresholdBackers: 100,
  feeBps: 600,
  campaignFeeBreakdown: {
    feeBps: 600,
    totalFeePaidUnits: "0",
    grossReleasedUnits: "0",
    netReleasedToArtistUnits: "0",
    estimatedFeeAtGoalUnits: "180000000",
    estimatedNetToArtistAtGoalUnits: "2820000000",
    feeChargedOnlyOnSuccessfulRelease: true,
    refundFeeUnits: "0",
  },
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

const countDisabled = (html: string) => (html.match(/disabled=""/g) ?? []).length;

describe("CampaignDraftForm approved-terms lock (#946)", () => {
  it("locks the critical term fields once artist authority is approved", () => {
    const html = renderToStaticMarkup(<CampaignDraftForm campaign={baseCampaign} />);
    expect(html).toContain("Approved terms are locked");
    expect(html).toContain("revoke artist authority");
    expect(html).toContain("Estimated artist payout at goal");
    expect(html).toContain("2820 USDC");
    expect(html).toContain("failed campaigns refund backers 100%");
    // goal, min backers, both deadlines, payment token, beneficiary, plus the
    // tier title/amount inputs and the add-tier control are all disabled.
    expect(countDisabled(html)).toBeGreaterThanOrEqual(8);
  });

  it("keeps terms editable before authority is approved", () => {
    const acknowledged = renderToStaticMarkup(
      <CampaignDraftForm campaign={{ ...baseCampaign, artistAuthorityStatus: "artist_acknowledged" }} />,
    );
    expect(acknowledged).not.toContain("Approved terms are locked");
    // Far fewer disabled controls than the locked variant.
    const locked = renderToStaticMarkup(<CampaignDraftForm campaign={baseCampaign} />);
    expect(countDisabled(locked)).toBeGreaterThan(countDisabled(acknowledged));
  });
});
