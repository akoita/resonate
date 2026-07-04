import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    address: "0x1234567890abcdef1234567890abcdef12345678",
    smartAccountAddress: null,
    token: null,
    status: "unauthenticated",
    connect: vi.fn(),
  }),
}));
vi.mock("../auth/ZeroDevProviderClient", () => ({
  useZeroDev: () => ({ chainId: 84532 }),
}));
vi.mock("../../hooks/useShowPledgeExecution", () => ({
  useShowPledgeExecution: () => ({
    executePledge: vi.fn(),
    phase: "idle",
    pending: false,
    error: null,
    txHash: null,
  }),
  useShowRefundExecution: () => ({
    claimRefund: vi.fn(),
    phase: "idle",
    pending: false,
    error: null,
    txHash: null,
  }),
}));

import { PledgeIntentPanel } from "./PledgeIntentPanel";
import type { Campaign, CampaignTier } from "../../lib/shows";

const tiers: CampaignTier[] = [
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
  targetDate: "2026-09-01T00:00:00.000Z",
  deadline: "2026-07-01T00:00:00.000Z",
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
  tiers,
} satisfies Campaign;

describe("PledgeIntentPanel campaign fee copy", () => {
  it("shows success-only fee copy beside the pledge CTA", () => {
    const html = renderToStaticMarkup(<PledgeIntentPanel campaign={campaign} fallbackTiers={tiers} />);
    expect(html).toContain("Connect wallet to pledge");
    expect(html).toContain("A 6% platform fee applies only if the campaign is funded");
    expect(html).toContain("If the campaign fails, you are refunded 100%.");
  });

  it("omits fee copy when the campaign has no platform fee", () => {
    const html = renderToStaticMarkup(
      <PledgeIntentPanel campaign={{ ...campaign, feeBps: 0 }} fallbackTiers={tiers} />,
    );
    expect(html).not.toContain("platform fee applies");
  });
});
