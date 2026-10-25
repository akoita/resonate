import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UsageSummary } from "../../lib/api";
import {
  UsageBillingBody,
  UsageBillingView,
  describeAllowance,
  describeLedgerReason,
  describePlan,
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

const LIVE_ALLOWANCE = {
  remainingCents: 240,
  grantedCents: 300,
  spentCents: 60,
  periodStart: "2026-10-19T14:00:00.000Z",
  expiresAt: "2026-11-19T14:00:00.000Z",
  previousExpiredCents: 0,
  previousEndedAt: null,
};

describe("describeAllowance (#2408)", () => {
  it("reads what is left of this month's Pro allowance and when it resets", () => {
    expect(describeAllowance(LIVE_ALLOWANCE, 300)).toEqual({
      headline: "$2.40 of $3.00 Pro allowance left · resets Nov 19, 2026",
      percentLeft: 80,
      note: null,
    });
  });

  it("mentions what lapsed when the previous month ended", () => {
    const copy = describeAllowance(
      { ...LIVE_ALLOWANCE, previousExpiredCents: 60, previousEndedAt: "2026-10-19T14:00:00.000Z" },
      300,
    );
    expect(copy?.note).toBe("$0.60 left unused expired on Oct 19, 2026.");
  });

  it("says when the next allowance arrives for a subscriber with no live month", () => {
    const ended = { ...LIVE_ALLOWANCE, remainingCents: 0, grantedCents: 0, spentCents: 0, periodStart: null, expiresAt: null };
    expect(describeAllowance(ended, 300)?.headline).toBe(
      "$3.00 Pro allowance a month · arrives when your next month is paid",
    );
    expect(describeAllowance(null, 300)?.percentLeft).toBe(0);
  });

  it("is absent without an allowance", () => {
    expect(describeAllowance(null, null)).toBeNull();
    expect(describeAllowance(undefined, null)).toBeNull();
  });
});

describe("describeLedgerReason (#2408)", () => {
  it("marks the part of a charge the Pro allowance paid", () => {
    expect(describeLedgerReason({ reason: "lyria_generation", allowanceCents: 10 })).toBe(
      "lyria_generation · 10¢ from Pro allowance",
    );
    expect(describeLedgerReason({ reason: "lyria_generation", allowanceCents: 0 })).toBe("lyria_generation");
    expect(describeLedgerReason({ reason: "", allowanceCents: undefined })).toBe("—");
  });
});

describe("UsageBillingView", () => {
  it("shows the Pro allowance next to the bought-credit balance, with the spend order (#2408)", () => {
    const html = renderToStaticMarkup(
      <UsageBillingView
        summary={summary({
          credits: {
            ...summary().credits,
            balanceCents: 100,
            spendableCents: 340,
            allowance: LIVE_ALLOWANCE,
          },
          plan: { tier: "pro", monthlyAllowanceCents: 300, source: "stripe_subscription" },
        })}
        now={NOW}
      />,
    );
    const credits = html.slice(html.indexOf("usage-credits-heading"), html.indexOf("usage-limits-heading"));
    expect(credits).toContain("$2.40 of $3.00 Pro allowance left · resets Nov 19, 2026");
    expect(credits).toContain('aria-valuenow="80"');
    expect(credits).toContain("Spent before your credits.");
    // The capacity meter counts both buckets: 340¢ at 10¢ per 30 s is 17 minutes.
    expect(credits).toContain("≈ 17 min · 17 tracks");
  });

  it("shows no allowance row on the free plan", () => {
    const html = renderToStaticMarkup(<UsageBillingView summary={summary()} now={NOW} />);
    expect(html).not.toContain("usage-allowance");
    expect(html).not.toContain("Pro allowance left");
  });

  it("renders the free plan tier and its note", () => {
    const html = renderToStaticMarkup(<UsageBillingView summary={summary()} now={NOW} />);
    expect(html).toContain("Free");
    expect(html).toContain("Uploading, selling and payouts are always free.");
    expect(html).not.toContain("coming soon");
  });

  it("renders the subscription controls under the plan chip when given (#2407)", () => {
    const html = renderToStaticMarkup(
      <UsageBillingView summary={summary()} now={NOW} planExtra={<p>plan-extra-slot</p>} />,
    );
    const planSection = html.slice(html.indexOf("usage-plan-heading"), html.indexOf("usage-credits-heading"));
    expect(planSection).toContain("plan-extra-slot");
  });

  it("renders a granted Pro plan with its end date and no upgrade prompt (#2406)", () => {
    const html = renderToStaticMarkup(
      <UsageBillingView
        summary={summary({
          plan: { tier: "pro", monthlyAllowanceCents: null, source: "operator_grant", validUntil: "2026-12-31T23:59:59.000Z" },
        })}
        now={NOW}
      />,
    );
    expect(html).toContain("Pro (granted)");
    expect(html).toContain('data-tier="pro"');
    expect(html).toContain("2026");
    expect(html).toContain("Pro tools are free for everyone for now.");
    expect(html).not.toMatch(/upgrade|subscribe/i);
  });

  it("describes plans: free, granted with an end, open-ended promo, subscription", () => {
    expect(describePlan({ tier: "free", monthlyAllowanceCents: null })).toEqual({
      label: "Free",
      note: "Uploading, selling and payouts are always free.",
    });
    expect(describePlan({ tier: "pro", monthlyAllowanceCents: null, source: "promo" })).toEqual({
      label: "Pro (granted)",
      note: "No end date. Pro tools are free for everyone for now.",
    });
    expect(describePlan({ tier: "pro", monthlyAllowanceCents: null, source: "stripe_subscription" }).label).toBe("Pro");
    expect(
      describePlan({ tier: "pro", monthlyAllowanceCents: null, source: "stripe_subscription", validUntil: "2026-11-25T00:00:00.000Z" }),
    ).toEqual({
      label: "Pro",
      note: "Artist Pro subscription, paid through Nov 25, 2026. Pro tools are free for everyone for now.",
    });
  });

  it("renders the credits capacity via CreditBalanceMeter", () => {
    const html = renderToStaticMarkup(<UsageBillingView summary={summary()} now={NOW} />);
    // 100¢ at 10¢/30s → 300s → 5 min · 5 tracks (formatCreditCapacity).
    expect(html).toContain("Generation credits");
    expect(html).toContain("≈ 5 min · 5 tracks");
  });

  it("explains how credits are added and offers no purchase or auto-reload control of its own", () => {
    const html = renderToStaticMarkup(<UsageBillingView summary={summary()} now={NOW} />);
    expect(html).toContain("How credits are added");
    expect(html).toContain("Credit packs ($5, $10 or $25) are bought through Stripe");
    expect(html).toContain("Bought credits do not expire. Automatic top-ups are not available yet.");
    expect(html).not.toMatch(/auto-reload|top up now|add funds/i);
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

  it("renders the Buy credits controls under the balance (#1422)", () => {
    const html = renderToStaticMarkup(
      <UsageBillingView summary={summary()} now={NOW} creditsExtra={<div data-testid="buy-credits">BUY</div>} />,
    );
    expect(html.indexOf("Generation credits")).toBeLessThan(html.indexOf('data-testid="buy-credits"'));
    expect(html.indexOf('data-testid="buy-credits"')).toBeLessThan(html.indexOf("How credits are added"));
  });

  it("signs a reversal negative and labels the credit pack reasons (#1422)", () => {
    expect(formatLedgerAmount("reversal", 300)).toBe("−300¢");
    expect(formatLedgerAmount("grant", 1000)).toBe("+1000¢");
    expect(describeLedgerReason({ reason: "top_up", allowanceCents: 0 })).toBe("Credit pack");
    expect(describeLedgerReason({ reason: "top_up_refund" })).toBe("Credit pack refund");
    expect(describeLedgerReason({ reason: "Signup starter" })).toBe("Signup starter");
    expect(describeLedgerReason({ reason: "" })).toBe("—");
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
