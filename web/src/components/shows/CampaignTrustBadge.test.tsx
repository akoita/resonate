import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignTrustBadge } from "./CampaignTrustBadge";

describe("CampaignTrustBadge (#949)", () => {
  it("renders a tone-coded pill for an artist-authorized escrow campaign", () => {
    const html = renderToStaticMarkup(
      <CampaignTrustBadge
        campaign={{
          campaignLevel: "active_escrow_campaign",
          rawStatus: "active",
          artistAuthorityStatus: "artist_authorized",
        }}
      />,
    );
    expect(html).toContain('data-trust="authorized_escrow"');
    expect(html).toContain("campaign-trust-badge--positive");
    expect(html).toContain("Artist-authorized escrow");
  });

  it("reflects terminal/refund states and merges a custom className", () => {
    const refund = renderToStaticMarkup(
      <CampaignTrustBadge
        campaign={{ campaignLevel: "active_escrow_campaign", rawStatus: "refund_available", artistAuthorityStatus: "artist_authorized" }}
        className="campaign-card__trust"
      />,
    );
    expect(refund).toContain('data-trust="refund_available"');
    expect(refund).toContain("campaign-trust-badge--warning");
    expect(refund).toContain("campaign-card__trust");

    const signal = renderToStaticMarkup(
      <CampaignTrustBadge
        campaign={{ campaignLevel: "signal", rawStatus: "active", artistAuthorityStatus: "none" }}
      />,
    );
    expect(signal).toContain('data-trust="demand_signal"');
    expect(signal).toContain("Demand signal");
  });
});
