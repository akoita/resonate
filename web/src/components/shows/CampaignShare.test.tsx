import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Click-time links, copy, and analytics are unit-tested against the pure
// helpers in lib/campaignShare.test.ts; this covers the rendered control.
vi.mock("../../lib/productAnalytics", () => ({
  recordProductAnalyticsFromBrowser: () => {},
}));

import { CampaignShare } from "./CampaignShare";
import type { ShareableCampaign } from "../../lib/campaignShare";

const campaign: ShareableCampaign = {
  id: "nadia-okoro-paris",
  backendId: "cmp_123",
  title: "Nadia Okoro in Paris",
  artistName: "Nadia Okoro",
  city: "Paris",
  rawStatus: "active",
  campaignLevel: "active_escrow_campaign",
  artistAuthorityStatus: "artist_authorized",
  beneficiaryAddress: "0x1111111111111111111111111111111111111111",
  beneficiaryType: "artist",
  contractAddress: "0x2222222222222222222222222222222222222222",
  contractCampaignId: "7",
  deadline: "2026-12-01T00:00:00.000Z",
  goalCents: 1_000_000,
  raisedCents: 420_000,
};

describe("CampaignShare", () => {
  it("renders every share channel with a label and trigger", () => {
    const html = renderToStaticMarkup(<CampaignShare campaign={campaign} trigger="after_pledge" label="Share it" />);
    for (const name of ["Share", "Share on X", "Share on Facebook", "Share on Reddit", "Copy link"]) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    expect(html).toContain("Share it");
    expect(html).toContain('data-trigger="after_pledge"');
  });

  it("stays inert until mounted, so server and client render the same markup", () => {
    const html = renderToStaticMarkup(<CampaignShare campaign={campaign} trigger="page" />);
    expect(html).toContain("Share this campaign");
    expect(html).toMatch(/inert=""/);
    expect(html).not.toContain("x.com/intent");
  });
});
