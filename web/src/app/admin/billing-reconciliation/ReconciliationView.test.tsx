import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BillingReconciliationReport } from "../../../lib/api";
import { BILLING_RECONCILIATION_SECTIONS } from "../../../lib/api";
import ReconciliationView, { type ReconciliationViewProps } from "./ReconciliationView";
import { reconciliationMonthOptions } from "./reconciliation";

const PURCHASE = {
  creditTopUpId: "topup-0001-aaaa-bbbb-cccc-000000000001",
  accountId: "acct-0001-aaaa-bbbb-cccc-000000000001",
  stripeCheckoutSessionId: "cs_test_a1B2c3D4e5F6g7H8",
  stripePaymentIntentId: "pi_3Abc",
  packId: "pack_10",
  currency: "usd",
  priceCents: 1000,
  amountTotalCents: 1000,
  creditsCents: 1000,
  delivery: "immediate",
  paidAt: "2026-09-04T12:30:00.000Z",
  creditedAt: "2026-09-04T12:30:05.000Z",
  creditedInMonthCents: 1000,
  currentStatus: "credited",
};

function makeReport(overrides: Partial<BillingReconciliationReport> = {}): BillingReconciliationReport {
  return {
    reportVersion: "billing-reconciliation/v1",
    month: "2026-09",
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-10-01T00:00:00.000Z",
    complete: true,
    generatedAt: "2026-10-31T10:00:00.000Z",
    creditPacks: {
      purchases: [PURCHASE],
      refunds: [
        {
          refundId: "re_1AbcdefghijkLMN",
          creditTopUpId: PURCHASE.creditTopUpId,
          accountId: PURCHASE.accountId,
          stripePaymentIntentId: "pi_3Abc",
          currency: "usd",
          amountCents: 400,
          withdrawnCreditsCents: 400,
          reversedCents: 300,
          spentNotReversedCents: 100,
          heldReductionCents: 0,
          statusBefore: "credited",
          refundedAt: "2026-09-20T08:00:00.000Z",
          backfilled: true,
        },
      ],
      needsReview: [],
    },
    heldPurchases: {
      unit: "credit_cents",
      openingCents: 0,
      purchasedCents: 500,
      creditedCents: 400,
      refundWithdrawnCents: 0,
      closingCents: 100,
      computedClosingCents: 100,
      balanced: true,
    },
    creditBalance: {
      unit: "credit_cents",
      openingCents: 2000,
      grants: [{ label: "top_up", count: 3, cents: 3000 }],
      topUpGrantsCents: 3000,
      freeGrantsCents: 200,
      spends: { count: 12, cents: 700 },
      spendsByReason: [{ label: "generation", count: 12, cents: 700 }],
      jobRefunds: { count: 1, cents: 50 },
      jobRefundsByReason: [],
      topUpRefundReversals: { count: 1, cents: 300 },
      unclassified: { count: 0 },
      closingCents: 4250,
      computedClosingCents: 4250,
      balanced: true,
    },
    allowance: {
      unit: "credit_cents",
      note: "Allowance credits are included with Artist Pro and are not a liability.",
      grantedCount: 4,
      grantedCents: 2000,
      usedCents: 600,
      returnedCents: 0,
      lapsedCents: 150,
    },
    subscriptionInvoices: [
      {
        stripeInvoiceId: "in_1AbcdefghijkLMNOP",
        subscriptionId: "sub-row-1",
        accountId: PURCHASE.accountId,
        stripeSubscriptionId: "sub_1AbcdefghijkLMNOP",
        currency: "usd",
        amountPaidCents: 1200,
        amountExcludingTaxCents: 1000,
        billingReason: "subscription_cycle",
        interval: "month",
        periodStart: "2026-09-01T00:00:00.000Z",
        periodEnd: "2026-10-01T00:00:00.000Z",
        paidAt: "2026-09-01T00:05:00.000Z",
      },
    ],
    controlTotals: [
      {
        currency: "usd",
        creditPackPurchases: { count: 1, priceCents: 1000, chargedCents: 1000, chargedUnknownCount: 0 },
        creditPackRefunds: { count: 1, amountCents: 400 },
        needsReview: { count: 0, priceCents: 0, chargedCents: 0, chargedUnknownCount: 0 },
        subscriptionInvoices: { count: 1, amountPaidCents: 1200 },
        netCollectedCents: 1800,
      },
    ],
    integrity: { ledgerBalanceNowCents: 5000, accountsBalanceNowCents: 5000, matches: true },
    ...overrides,
  };
}

function viewProps(overrides: Partial<ReconciliationViewProps> = {}): ReconciliationViewProps {
  return {
    allowed: true,
    month: "2026-09",
    monthOptions: reconciliationMonthOptions(new Date("2026-10-31T10:00:00Z"), 6),
    state: { status: "ready", report: makeReport() },
    downloading: null,
    downloadError: null,
    onMonthChange: vi.fn(),
    onRefresh: vi.fn(),
    onDownloadCsv: vi.fn(),
    onDownloadJson: vi.fn(),
    ...overrides,
  };
}

function render(overrides: Partial<ReconciliationViewProps> = {}) {
  return renderToStaticMarkup(<ReconciliationView {...viewProps(overrides)} />);
}


/**
 * Expand the view's element tree (it has no hooks) down to host elements and
 * return every `<button>` / `<select>` with its props, so a test can press one.
 */
function collectControls(element: React.ReactNode): Array<{ type: string; props: Record<string, unknown> }> {
  const found: Array<{ type: string; props: Record<string, unknown> }> = [];
  const visit = (node: React.ReactNode): void => {
    if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const el = node as React.ReactElement<Record<string, unknown>>;
    if (typeof el.type === "function") {
      visit((el.type as (props: unknown) => React.ReactNode)(el.props));
      return;
    }
    if (typeof el.type !== "string") {
      // A fragment: only its children matter.
      visit(el.props.children as React.ReactNode);
      return;
    }
    if (el.type === "button" || el.type === "select") found.push({ type: el.type, props: el.props });
    visit(el.props.children as React.ReactNode);
  };
  visit(element);
  return found;
}

function controls(overrides: Partial<ReconciliationViewProps> = {}) {
  return collectControls(<ReconciliationView {...viewProps(overrides)} />);
}

describe("ReconciliationView (#2497)", () => {
  it("shows the control totals per currency, the checks and the month picker above everything else", () => {
    const html = render();
    expect(html).toContain("Billing reconciliation");
    expect(html).toContain('id="billing-reconciliation-month"');
    expect(html).toContain("October 2026 (in progress)");
    expect(html).toContain('<option value="2026-09" selected="">September 2026</option>');
    expect(html).toContain("Held purchases balance");
    expect(html).toContain("Credit balance balances");
    expect(html).toContain("Ledger matches account balances");
    expect(html).toContain("Nothing needs review");
    expect(html).toContain("Month closed");
    expect(html).toContain('data-currency="usd"');
    expect(html).toContain("$10.00");
    expect(html).toContain("$18.00");
    expect(html).toContain("Net collected");
    // Totals come before the roll-forwards and the tables.
    expect(html.indexOf("Control totals")).toBeLessThan(html.indexOf("Held purchases</h2>"));
    expect(html.indexOf("Held purchases</h2>")).toBeLessThan(html.indexOf("Credit pack purchases</h2>"));
    expect(html).not.toContain("review-queue-notice--warning");
  });

  it("renders the roll-forwards, the allowance as not a liability, and the tables with shortened ids", () => {
    const html = render();
    expect(html).toContain("Opening");
    expect(html).toContain("Closing recomputed from the movements");
    expect(html).toContain("Not a liability");
    expect(html).toContain("Allowance credits are included with Artist Pro and are not a liability.");
    expect(html).toContain('title="cs_test_a1B2c3D4e5F6g7H8"');
    expect(html).toContain(">cs_test_…g7H8<");
    expect(html).toContain("2026-09-04 12:30 UTC");
    expect(html).toContain("backfilled");
    expect(html).toContain("2026-09-01 to 2026-10-01");
    expect(html).toContain("generation");
  });

  it("warns when a roll-forward does not balance or the ledger and accounts differ", () => {
    const report = makeReport({
      heldPurchases: { ...makeReport().heldPurchases, balanced: false, closingCents: 100, computedClosingCents: 150 },
      creditBalance: { ...makeReport().creditBalance, balanced: false, unclassified: { count: 2 } },
      integrity: { ledgerBalanceNowCents: 5000, accountsBalanceNowCents: 4900, matches: false },
    });
    const html = render({ state: { status: "ready", report } });
    expect(html).toContain("Held purchases do not balance");
    expect(html).toContain("Credit balance does not balance");
    expect(html).toContain("Ledger and account balances differ");
    expect(html).toContain("The credit ledger ($50.00) and the account balances ($49.00) do not match today.");
    expect(html).toContain("the closing balance is $1.00 but the movements add up to $1.50");
    expect(html).toContain("2 credit ledger entries were not recognised");
    expect(html).toContain("Does not balance");
    expect(html).not.toContain("Held purchases balance");
  });

  it("warns about packs that were paid and never credited", () => {
    const report = makeReport({
      creditPacks: { ...makeReport().creditPacks, needsReview: [{ ...PURCHASE, creditedAt: null, currentStatus: "needs_review" }] },
    });
    const html = render({ state: { status: "ready", report } });
    expect(html).toContain("1 need review");
    expect(html).toContain("1 credit pack payment was taken but never credited");
    expect(html).toContain("needs review");
    expect(html).not.toContain("Nothing needs review");
  });

  it("flags the month in progress", () => {
    const html = render({ state: { status: "ready", report: makeReport({ complete: false, month: "2026-10" }) }, month: "2026-10" });
    expect(html).toContain("In progress");
    expect(html).toContain("October 2026 is still in progress, so its totals can still change.");
    expect(html).not.toContain("Month closed");
  });

  it("explains each empty table", () => {
    const report = makeReport({
      creditPacks: { purchases: [], refunds: [], needsReview: [] },
      subscriptionInvoices: [],
      controlTotals: [],
    });
    const html = render({ state: { status: "ready", report } });
    expect(html).toContain("No payments, refunds or invoices in this month.");
    expect(html).toContain("No credit packs were bought in this month.");
    expect(html).toContain("No credit packs were refunded in this month.");
    expect(html).toContain("Nothing needs review: every credit pack paid in this month was credited.");
    expect(html).toContain("No Artist Pro invoices were paid in this month.");
    expect(html).not.toContain("<table");
  });

  it("notes charges without a recorded amount", () => {
    const base = makeReport();
    const report = makeReport({
      controlTotals: [{ ...base.controlTotals[0], creditPackPurchases: { ...base.controlTotals[0].creditPackPurchases, chargedUnknownCount: 2 } }],
    });
    expect(render({ state: { status: "ready", report } })).toContain("2 without a recorded charge amount");
  });

  it("renders the loading state with a status message and no report", () => {
    const html = render({ state: { status: "loading" } });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading the September 2026 report…");
    expect(html).not.toContain("Control totals");
    expect(html).toContain("Loading…");
  });

  it("renders the error state with a retry that calls onRefresh", () => {
    const onRefresh = vi.fn();
    const props = { state: { status: "error" as const, message: "That month has not started yet." }, onRefresh };
    const html = render(props);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Unable to load the report");
    expect(html).toContain("That month has not started yet.");
    const retry = controls(props).find((control) => control.props.children === "Try again");
    expect(retry).toBeDefined();
    (retry!.props.onClick as () => void)();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("denies a signed-in account that is not an operator or admin, without the report controls", () => {
    const html = render({ allowed: false, state: { status: "loading" } });
    expect(html).toContain("Access denied");
    expect(html).toContain("Only operators and administrators");
    expect(html).not.toContain("Download");
    expect(html).not.toContain("billing-reconciliation-month");
    expect(controls({ allowed: false })).toHaveLength(0);
  });

  it("dims the report and disables refresh while refreshing", () => {
    const html = render({ state: { status: "ready", report: makeReport(), refreshing: true } });
    expect(html).toContain("opacity-60");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading…");
  });

  it("shows a download error", () => {
    expect(render({ downloadError: "API 500: boom" })).toContain("API 500: boom");
  });

  it("offers one CSV download per section and calls the handler with that section", () => {
    const onDownloadCsv = vi.fn();
    const csv = controls({ onDownloadCsv }).filter((control) => String(control.props["aria-label"] ?? "").endsWith("as CSV"));
    expect(csv).toHaveLength(BILLING_RECONCILIATION_SECTIONS.length);
    for (const control of csv) (control.props.onClick as () => void)();
    expect(onDownloadCsv.mock.calls.map((call) => call[0]).sort()).toEqual([...BILLING_RECONCILIATION_SECTIONS].sort());
    const html = render();
    for (const label of ["Control totals", "Held purchases", "Credit balance", "Artist Pro allowance", "Credit pack purchases", "Credit pack refunds", "Needs review", "Subscription invoices"]) {
      expect(html).toContain(`aria-label="Download ${label} as CSV"`);
    }
  });

  it("downloads the whole report as JSON, and only once it is loaded", () => {
    const onDownloadJson = vi.fn();
    const ready = controls({ onDownloadJson }).find((control) => control.props.children === "Download JSON");
    expect(ready?.props.disabled).toBe(false);
    (ready!.props.onClick as () => void)();
    expect(onDownloadJson).toHaveBeenCalledTimes(1);

    const loading = controls({ state: { status: "loading" } }).find((control) => control.props.children === "Download JSON");
    expect(loading?.props.disabled).toBe(true);
  });

  it("disables every download while one runs and labels the running one", () => {
    const props = { downloading: "refunds" as const };
    const downloads = controls(props).filter((control) => String(control.props["aria-label"] ?? "").endsWith("as CSV") || control.props.children === "Download JSON");
    expect(downloads.length).toBe(BILLING_RECONCILIATION_SECTIONS.length + 1);
    expect(downloads.every((control) => control.props.disabled === true)).toBe(true);
    expect(render(props)).toContain("Downloading…");
  });

  it("changes the month from the picker and keeps an unlisted month visible", () => {
    const onMonthChange = vi.fn();
    const select = controls({ onMonthChange }).find((control) => control.type === "select");
    (select!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "2026-08" } });
    expect(onMonthChange).toHaveBeenCalledWith("2026-08");
    expect(render({ month: "2019-01" })).toContain('<option value="2019-01" selected="">January 2019</option>');
  });

  it("states what the report holds and that opening it is logged", () => {
    const html = render();
    expect(html).toContain("never names or email addresses");
    expect(html).toContain("recorded in the audit log");
  });
});

