import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The panel pulls in the Next router + auth context. Stub them so it renders
// standalone. Effects don't run under renderToStaticMarkup, so the managed-read
// fetch in lib/shows is never invoked — we pass disputes via the prop instead.
const auth = vi.hoisted(() => ({
  current: { token: "t", status: "authenticated", role: "operator" as string, connect: () => {} },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => auth.current }));

import { CampaignOperatorPanel } from "./CampaignOperatorPanel";
import type { Campaign } from "../../lib/shows";

const baseCampaign = {
  id: "show-x",
  backendId: "b1",
  rawStatus: "booking_confirmed",
  campaignLevel: "active_escrow_campaign",
  artistAuthorityStatus: "artist_authorized",
  authorityCredentialId: null,
  authorityEvidenceBundleId: null,
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

afterEach(() => {
  auth.current = { token: "t", status: "authenticated", role: "operator", connect: () => {} };
});

describe("CampaignOperatorPanel disputes (#950 operator controls)", () => {
  it("renders nothing for a non-operator viewer", () => {
    auth.current = { ...auth.current, role: "listener" };
    const html = renderToStaticMarkup(<CampaignOperatorPanel campaign={baseCampaign} />);
    expect(html).toBe("");
  });

  it("lets an operator raise a dispute in the booking → release window", () => {
    const html = renderToStaticMarkup(<CampaignOperatorPanel campaign={baseCampaign} />);
    expect(html).toContain("Disputes");
    expect(html).toContain("Raise dispute");
    // The active hint (not the disabled-window hint) is shown when eligible.
    expect(html).toContain("Flag a problem between booking confirmation");
    // No open dispute → resolve controls are absent.
    expect(html).not.toContain("Resolve dispute");
  });

  it("disables raising a dispute outside the booking → release window", () => {
    const html = renderToStaticMarkup(
      <CampaignOperatorPanel campaign={{ ...baseCampaign, rawStatus: "draft" }} />,
    );
    expect(html).toContain("Disputes can be raised only between booking confirmation");
  });

  it("surfaces resolve controls and history when a dispute is open", () => {
    const html = renderToStaticMarkup(
      <CampaignOperatorPanel
        campaign={{
          ...baseCampaign,
          disputes: [
            {
              id: "d1",
              status: "open",
              reason: "Venue pulled out",
              initiatorRole: "operator",
              createdAt: "2026-06-20T00:00:00.000Z",
            },
          ],
        }}
      />,
    );
    expect(html).toContain("Open dispute");
    expect(html).toContain("Venue pulled out");
    expect(html).toContain("Resolve dispute");
    expect(html).toContain("Upheld");
    expect(html).toContain("Inconclusive");
    // The open dispute is not also offered as "raise" again.
    expect(html).not.toContain("Raise dispute");
  });

  it("shows resolved dispute history with its outcome and note", () => {
    const html = renderToStaticMarkup(
      <CampaignOperatorPanel
        campaign={{
          ...baseCampaign,
          rawStatus: "fulfilled",
          disputes: [
            {
              id: "d2",
              status: "resolved",
              outcome: "rejected",
              operatorNote: "Show happened as planned",
              initiatorRole: "operator",
              createdAt: "2026-06-10T00:00:00.000Z",
              resolvedAt: "2026-06-12T00:00:00.000Z",
            },
          ],
        }}
      />,
    );
    expect(html).toContain("rejected");
    expect(html).toContain("Show happened as planned");
  });
});
