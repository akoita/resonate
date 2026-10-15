import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ token: "t" }) }));

import { UnclaimedRefundsList, UnclaimedRefundsSection, reminderLabel } from "./UnclaimedRefundsSection";
import type { UnclaimedRefundCampaign } from "../../lib/shows";

const campaign: UnclaimedRefundCampaign = {
  campaignId: "camp-1",
  slug: "lyon-show",
  title: "Lyon Show",
  artistDisplayName: "Artist",
  city: "Lyon",
  status: "refund_available",
  asset: { symbol: "USDC", decimals: 6 },
  backerCount: 3,
  totalUnclaimedUnits: "12500000",
  refundsOpenedAt: "2026-10-01T00:00:00.000Z",
  oldestAgeDays: 9,
  lastReminderStep: 1,
};

describe("UnclaimedRefundsList", () => {
  it("shows backers, the unclaimed total, the age and the last reminder step", () => {
    const html = renderToStaticMarkup(<UnclaimedRefundsList campaigns={[campaign]} />);
    expect(html).toContain("Lyon Show");
    expect(html).toContain('href="/shows/camp-1"');
    expect(html).toContain("12.5 USDC");
    expect(html).toContain("9 days");
    expect(html).toContain("Sent at day 7");
    expect(html).toContain(">3<");
  });

  it("says so when nothing is unclaimed", () => {
    expect(renderToStaticMarkup(<UnclaimedRefundsList campaigns={[]} />)).toContain("No unclaimed refunds");
  });

  it("labels every reminder step", () => {
    expect(reminderLabel(null)).toBe("None sent yet");
    expect(reminderLabel(0)).toBe("Sent on opening");
    expect(reminderLabel(2)).toBe("Sent at day 30 (final)");
  });
});

describe("UnclaimedRefundsSection", () => {
  it("renders its heading and the lag caveat while loading", () => {
    const html = renderToStaticMarkup(<UnclaimedRefundsSection campaignId="camp-1" />);
    expect(html).toContain("Unclaimed refunds");
    expect(html).toContain("Loading unclaimed refunds");
    expect(html).toContain("after 7 and 30 days");
  });
});
