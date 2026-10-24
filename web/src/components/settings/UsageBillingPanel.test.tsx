import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UsageSummary } from "../../lib/api";
import {
  UsageBillingBody,
  UsageBillingView,
  formatLedgerAmount,
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
        percentLeft: 96,
        windowSeconds: 3600,
        resetsAt: "2026-07-10T12:42:00.000Z",
      },
      {
        kind: "remix_draft",
        label: "AI remix draft",
        remaining: 10,
        limit: 10,
        percentLeft: 100,
        windowSeconds: 3600,
        resetsAt: null,
      },
    ],
    breakdown: {
      periodDays: 30,
      since: "2026-06-10T12:00:00.000Z",
      items: [
        {
          kind: "lyria",
          lineId: "lyria",
          label: "Track generation",
          unitSeconds: 30,
          unitCostCents: 10,
          charges: 3,
          spentCents: 30,
          refundedCents: 10,
          netCents: 20,
        },
        {
          kind: "remix_draft",
          lineId: "draft",
          label: "AI remix draft",
          unitSeconds: 30,
          unitCostCents: 10,
          charges: 0,
          spentCents: 0,
          refundedCents: 0,
          netCents: 0,
        },
        {
          kind: "remix_draft",
          lineId: "part_take",
          label: "AI part takes",
          unitSeconds: 30,
          unitCostCents: 10,
          charges: 2,
          spentCents: 20,
          refundedCents: 0,
          netCents: 20,
        },
      ],
    },
    plan: { tier: "free", monthlyAllowanceCents: null },
    ...overrides,
  };
}

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

  it("explains how credits are granted today and offers no purchase or auto-reload control", () => {
    const html = renderToStaticMarkup(<UsageBillingView summary={summary()} now={NOW} />);
    expect(html).toContain("How credits are granted today");
    expect(html).toContain("Buying credits and automatic top-ups are not available yet.");
    expect(html).not.toMatch(/buy credits|purchase|auto-reload|top up now|add funds/i);
    // No dead buttons: with a healthy balance and no request handler there is
    // not a single <button> on the page.
    expect(html).not.toContain("<button");
  });

  it("renders one row per usage limit with counts and reset timers", () => {
    const html = renderToStaticMarkup(<UsageBillingView summary={summary()} now={NOW} />);
    expect(html).toContain("Track generation");
    expect(html).toContain("96% left");
    expect(html).toContain("48 / 50 per hour");
    expect(html).toContain("resets in 42 min");
    expect(html).toContain("AI remix draft");
    expect(html).toContain("AI part takes");
    expect(html).toContain("100% left");
    expect(html).toContain("10 / 10 per hour");
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

  it("keeps credits, usage limits and spend by action as separate sections", () => {
    const html = renderToStaticMarkup(<UsageBillingView summary={summary()} now={NOW} />);
    const credits = html.indexOf("usage-credits-heading");
    const limits = html.indexOf("usage-limits-heading");
    const breakdown = html.indexOf("usage-breakdown-heading");
    expect(credits).toBeGreaterThan(-1);
    expect(limits).toBeGreaterThan(credits);
    expect(breakdown).toBeGreaterThan(limits);
  });

  it("renders the per-kind spend breakdown with unit price and net cost", () => {
    const html = renderToStaticMarkup(<UsageBillingView summary={summary()} now={NOW} />);
    expect(html).toContain("Spend by action");
    expect(html).toContain("$0.10 / 30s");
    expect(html).toContain("$0.30");
    expect(html).toContain("$0.20");
  });

  it("renders a spend empty state that still lists each action price", () => {
    const base = summary();
    const html = renderToStaticMarkup(
      <UsageBillingView
        summary={summary({
          breakdown: {
            ...base.breakdown,
            items: base.breakdown.items.map((item) => ({
              ...item,
              charges: 0,
              spentCents: 0,
              refundedCents: 0,
              netCents: 0,
            })),
          },
        })}
        now={NOW}
      />,
    );
    expect(html).toContain("No credits spent in the last 30 days.");
    expect(html).toContain("Track generation: $0.10 per 30s");
    expect(html).toContain("AI remix draft: $0.10 per 30s");
    expect(html).toContain("AI part takes: $0.10 per 30s");
  });
});

describe("UsageBillingBody (fetch states)", () => {
  it("shows a loading status while the first read is in flight", () => {
    const html = renderToStaticMarkup(
      <UsageBillingBody summary={null} loading error={false} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading usage");
    expect(html).not.toContain("Spend by action");
  });

  it("shows an error alert with a Retry action when the read fails", () => {
    const html = renderToStaticMarkup(
      <UsageBillingBody summary={null} loading={false} error onRetry={() => {}} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not load your usage");
    expect(html).toContain("Retry");
    expect(html).not.toMatch(/purchase|buy credits/i);
  });

  it("renders the loaded view once a summary exists, even while refreshing", () => {
    const html = renderToStaticMarkup(
      <UsageBillingBody summary={summary()} loading error={false} now={NOW} />,
    );
    expect(html).toContain("Spend by action");
    expect(html).not.toContain("Loading usage");
  });

  it("renders a brand-new account (no spend, no history, idle windows) without crashing", () => {
    const base = summary();
    const html = renderToStaticMarkup(
      <UsageBillingBody
        summary={{
          credits: { balanceCents: 100, priceCentsPer30s: 10, recentTransactions: [] },
          limits: base.limits.map((l) => ({
            ...l,
            remaining: l.limit,
            percentLeft: 100,
            resetsAt: null,
          })),
          breakdown: {
            ...base.breakdown,
            items: base.breakdown.items.map((i) => ({
              ...i,
              charges: 0,
              spentCents: 0,
              refundedCents: 0,
              netCents: 0,
            })),
          },
          plan: { tier: "free", monthlyAllowanceCents: null },
        }}
        loading={false}
        error={false}
        now={NOW}
      />,
    );
    expect(html).toContain("No usage yet.");
    expect(html).toContain("No credits spent in the last 30 days.");
  });
});
