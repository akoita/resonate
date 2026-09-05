import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UsageSummary } from "../../lib/api";
import {
  UsageBillingView,
  formatLedgerAmount,
  formatResetIn,
} from "./UsageBillingPanel";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

function summary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    credits: {
      balanceCents: 100,
      priceCentsPer30s: 10,
      recentTransactions: [
        {
          id: "txn-1",
          type: "debit",
          amountCents: 20,
          reason: "Track generation",
          jobId: "job-1",
          balanceAfterCents: 100,
          createdAt: "2026-07-10T11:30:00.000Z",
        },
        {
          id: "txn-2",
          type: "grant",
          amountCents: 120,
          reason: "Signup starter",
          jobId: null,
          balanceAfterCents: 120,
          createdAt: "2026-07-09T09:00:00.000Z",
        },
      ],
    },
    limits: [
      {
        kind: "lyria",
        label: "Track generation",
        remaining: 48,
        limit: 50,
        windowSeconds: 3600,
        resetsAt: "2026-07-10T12:42:00.000Z",
      },
      {
        kind: "remix_draft",
        label: "AI remix draft",
        remaining: 10,
        limit: 10,
        windowSeconds: 3600,
        resetsAt: null,
      },
    ],
    plan: { tier: "free", monthlyAllowanceCents: null },
    ...overrides,
  };
}

describe("formatResetIn", () => {
  it("returns an em dash when there is no active window", () => {
    expect(formatResetIn(null, NOW)).toBe("—");
  });

  it("returns an em dash for an unparseable timestamp", () => {
    expect(formatResetIn("not-a-date", NOW)).toBe("—");
  });

  it("says resets now when the window has already lapsed", () => {
    expect(formatResetIn("2026-07-10T11:59:00.000Z", NOW)).toBe("resets now");
  });

  it("renders minutes under an hour", () => {
    expect(formatResetIn("2026-07-10T12:42:00.000Z", NOW)).toBe("resets in 42 min");
  });

  it("renders hours and minutes over an hour", () => {
    expect(formatResetIn("2026-07-10T14:05:00.000Z", NOW)).toBe("resets in 2h 5min");
  });

  it("renders whole hours without a minute part", () => {
    expect(formatResetIn("2026-07-10T15:00:00.000Z", NOW)).toBe("resets in 3h");
  });

  it("renders days beyond 24h", () => {
    expect(formatResetIn("2026-07-12T13:00:00.000Z", NOW)).toBe("resets in 2d 1h");
  });
});

describe("formatLedgerAmount", () => {
  it("renders debits as negative", () => {
    expect(formatLedgerAmount("debit", 20)).toBe("−20¢");
  });

  it("renders grants as positive", () => {
    expect(formatLedgerAmount("grant", 120)).toBe("+120¢");
  });

  it("normalizes an already-negative debit amount", () => {
    expect(formatLedgerAmount("spend", -15)).toBe("−15¢");
  });
});

describe("UsageBillingView", () => {
  it("renders the free plan tier and the Artist Pro note", () => {
    const html = renderToStaticMarkup(<UsageBillingView summary={summary()} now={NOW} />);
    expect(html).toContain("Free");
    expect(html).toContain("Artist Pro — coming soon");
  });

  it("renders the credits capacity via CreditBalanceMeter", () => {
    const html = renderToStaticMarkup(<UsageBillingView summary={summary()} now={NOW} />);
    // 100¢ at 10¢/30s → 300s → 5 min · 5 tracks (formatCreditCapacity).
    expect(html).toContain("Generation credits");
    expect(html).toContain("≈ 5 min · 5 tracks");
  });

  it("shows the Auto-reload coming-soon affordance", () => {
    const html = renderToStaticMarkup(<UsageBillingView summary={summary()} now={NOW} />);
    expect(html).toContain("Auto-reload");
    expect(html).toContain("Coming soon");
  });

  it("renders one row per usage limit with counts and reset timers", () => {
    const html = renderToStaticMarkup(<UsageBillingView summary={summary()} now={NOW} />);
    expect(html).toContain("Track generation");
    expect(html).toContain("48 / 50");
    expect(html).toContain("resets in 42 min");
    expect(html).toContain("AI remix draft");
    expect(html).toContain("10 / 10");
    // remix_draft has a null resetsAt → em dash.
    expect(html).toContain("—");
  });

  it("renders the usage-history rows newest first from the ledger", () => {
    const html = renderToStaticMarkup(<UsageBillingView summary={summary()} now={NOW} />);
    expect(html).toContain("Signup starter");
    expect(html).toContain("Track generation");
    expect(html).toContain("−20¢");
    expect(html).toContain("+120¢");
  });

  it("renders an empty history state when there are no transactions", () => {
    const html = renderToStaticMarkup(
      <UsageBillingView
        summary={summary({
          credits: { balanceCents: 0, priceCentsPer30s: 10, recentTransactions: [] },
        })}
        now={NOW}
      />,
    );
    expect(html).toContain("No usage yet.");
  });

  it("renders sanely with a zero balance and shows the top-up state", () => {
    const html = renderToStaticMarkup(
      <UsageBillingView
        summary={summary({
          credits: { balanceCents: 0, priceCentsPer30s: 10, recentTransactions: [] },
        })}
        onRequestCredits={() => {}}
        now={NOW}
      />,
    );
    expect(html).toContain("0 — top up");
    expect(html).toContain("Request credits from an operator");
  });

  it("renders a limits empty state when no limits apply", () => {
    const html = renderToStaticMarkup(
      <UsageBillingView summary={summary({ limits: [] })} now={NOW} />,
    );
    expect(html).toContain("No usage limits apply to your account.");
  });
});
