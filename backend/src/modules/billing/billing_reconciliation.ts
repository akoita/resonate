import { BadRequestException } from "@nestjs/common";
import { TOP_UP_DISPUTE_HOLD_REASON, TOP_UP_DISPUTE_RELEASE_REASON, TOP_UP_REASON } from "../credits/top_up_ledger";
import { DEFAULT_CREDIT_REQUEST_GRANT_REASON, SIGNUP_STARTER_REASON } from "../credits/generation-credits.service";

/**
 * The monthly billing reconciliation report (#2497): pure helpers.
 *
 * An operator asks for one UTC month and gets the Stripe payments, the
 * generation-credit ledger and the deferred subscription revenue of that month
 * in one place, as JSON or as one CSV per section. The accountant ties the
 * `controlTotals` out against Stripe's balance report per currency, and builds
 * the bought-credit liability and the deferred-revenue schedules from the
 * rest. The report decides no accounting policy: bought and free credits share
 * one pooled balance, so it shows the pooled roll-forward with grants by
 * reason (the accountant allocates spends with their own rule) next to the
 * bought-credit flows on their own.
 *
 * Sections (also the CSV `section` values):
 * - `purchases`: credit packs paid in the month (not held for review).
 * - `refunds`: credit-pack refunds applied in the month.
 * - `disputes`: card disputes (chargebacks, #2596) opened, closed or with
 *   funds given back in the month, with Stripe's dispute fees.
 * - `needs_review`: packs paid in the month that were never credited.
 * - `held_purchases`: roll-forward of paid-but-not-yet-credited packs.
 * - `credit_balance`: roll-forward of the pooled bought and free balance.
 * - `allowance`: the Artist Pro allowance bucket (never a liability).
 * - `subscription_invoices`: paid Artist Pro invoices with service periods.
 * - `control_totals`: per-currency totals to tie out against Stripe.
 *
 * Every total comes from timestamps and append-only rows, never from a mutable
 * current status, so a past month gives the same numbers on every run. The
 * report holds opaque ids, codes, amounts and dates only: no emails, names,
 * notes or operator-typed text (the free-text reason of an operator grant is
 * reduced to the label `operator_grant`).
 */

export const REPORT_VERSION = "billing-reconciliation/v1";

export const REPORT_SECTIONS = [
  "purchases",
  "refunds",
  "disputes",
  "needs_review",
  "held_purchases",
  "credit_balance",
  "allowance",
  "subscription_invoices",
  "control_totals",
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];

export const REPORT_FORMATS = ["json", "csv"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface ReportPeriod {
  month: string;
  /** Inclusive start (first instant of the month, UTC). */
  start: Date;
  /** Exclusive end (first instant of the next month, UTC). */
  end: Date;
  /** True once the month is over, so its totals can no longer change. */
  complete: boolean;
}

/** `YYYY-MM` to a UTC period. 400 `invalid_month` / `month_in_future`. */
export function parseReportMonth(month: string, now: Date): ReportPeriod {
  if (typeof month !== "string" || !MONTH_PATTERN.test(month)) {
    throw new BadRequestException({ code: "invalid_month", message: "month must be YYYY-MM" });
  }
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  // Date.UTC maps years 0-99 to 1900-1999; the pattern allows them, so pin the year.
  start.setUTCFullYear(year);
  const end = new Date(start.getTime());
  end.setUTCMonth(end.getUTCMonth() + 1);
  if (start.getTime() > now.getTime()) {
    throw new BadRequestException({ code: "month_in_future", message: "that month has not started" });
  }
  return { month, start, end, complete: end.getTime() <= now.getTime() };
}

/**
 * Label of a ledger reason for the report. Grants: `top_up`,
 * `top_up_dispute_release` (paused credits given back, #2596), `signup_starter`,
 * `credit_request` (the default operator request grant) or `operator_grant` for
 * anything else, because an operator's free text must never appear here. Other
 * types keep their reason when it is a short code, else `other`.
 */
export function ledgerReasonLabel(type: string, reason: string): string {
  if (type === "grant") {
    if (reason === TOP_UP_REASON) return "top_up";
    if (reason === TOP_UP_DISPUTE_RELEASE_REASON) return TOP_UP_DISPUTE_RELEASE_REASON;
    if (reason === SIGNUP_STARTER_REASON) return "signup_starter";
    if (reason === DEFAULT_CREDIT_REQUEST_GRANT_REASON) return "credit_request";
    return "operator_grant";
  }
  return SAFE_REASON.test(reason) ? reason : "other";
}

/** A short machine code; the same pattern is applied in SQL by the service. */
export const SAFE_REASON = /^[a-z0-9_.:-]{1,64}$/;
export const SAFE_REASON_SQL = "^[a-z0-9_.:-]{1,64}$";

/** Grant reasons the report names; every other grant reason is operator text. */
export const KNOWN_GRANT_REASONS = [
  TOP_UP_REASON,
  TOP_UP_DISPUTE_RELEASE_REASON,
  SIGNUP_STARTER_REASON,
  DEFAULT_CREDIT_REQUEST_GRANT_REASON,
] as const;

/** The reversal that pauses credits for an open card dispute (#2596); every other reversal is a refund. */
export const DISPUTE_HOLD_REVERSAL_REASON = TOP_UP_DISPUTE_HOLD_REASON;

// ---------------------------------------------------------------------------
// Report shape

export interface PurchaseRow {
  creditTopUpId: string;
  accountId: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  packId: string;
  currency: string;
  priceCents: number;
  amountTotalCents: number | null;
  creditsCents: number;
  delivery: string;
  paidAt: string;
  creditedAt: string | null;
  creditedInMonthCents: number;
  /** Informational only: the current status can change after the month closed. */
  currentStatus: string;
}

export interface RefundRow {
  refundId: string;
  creditTopUpId: string;
  accountId: string;
  stripePaymentIntentId: string | null;
  currency: string;
  amountCents: number;
  withdrawnCreditsCents: number;
  reversedCents: number;
  spentNotReversedCents: number;
  heldReductionCents: number;
  statusBefore: string;
  refundedAt: string;
  backfilled: boolean;
}

export interface DisputeRow {
  disputeId: string;
  stripeDisputeId: string;
  stripePaymentIntentId: string | null;
  /** credit_topup | other (an Artist Pro invoice or any other payment). */
  kind: string;
  creditTopUpId: string | null;
  /** Empty for a dispute that is not over a credit pack. */
  accountId: string | null;
  currency: string;
  amountCents: number;
  reason: string | null;
  /** Money Stripe took back, its dispute fees (net of fees returned) and money it gave back. */
  withdrawnCents: number;
  feeCents: number;
  reinstatedCents: number;
  /** Credits: the disputed share, what was paused in the balance and what was given back. */
  disputedCreditsCents: number;
  heldCreditsCents: number;
  releasedCreditsCents: number;
  statusBefore: string | null;
  openedAt: string;
  closedAt: string | null;
  fundsReinstatedAt: string | null;
  /** Informational only: an open dispute can still close after the month. */
  currentStatus: string;
}

export interface InvoiceRow {
  stripeInvoiceId: string;
  subscriptionId: string;
  accountId: string;
  stripeSubscriptionId: string;
  currency: string;
  amountPaidCents: number;
  amountExcludingTaxCents: number | null;
  billingReason: string | null;
  interval: string;
  periodStart: string;
  periodEnd: string;
  paidAt: string;
}

export interface LabelledTotal {
  label: string;
  count: number;
  cents: number;
}

export interface CountCents {
  count: number;
  cents: number;
}

export interface ChargedTotals {
  count: number;
  priceCents: number;
  chargedCents: number;
  chargedUnknownCount: number;
}

export interface CurrencyControlTotals {
  currency: string;
  creditPackPurchases: ChargedTotals;
  creditPackRefunds: { count: number; amountCents: number };
  needsReview: ChargedTotals;
  subscriptionInvoices: { count: number; amountPaidCents: number };
  /** Disputes opened in the month: money Stripe took back and its dispute fees. */
  disputesOpened: { count: number; withdrawnCents: number; feeCents: number };
  /** Disputes whose funds Stripe gave back in the month. */
  disputesReinstated: { count: number; amountCents: number };
  /** Purchases and invoices, less refunds and dispute withdrawals, plus reinstated funds. Fees are not deducted. */
  netCollectedCents: number;
}

export interface BillingReconciliationReport {
  reportVersion: string;
  month: string;
  periodStart: string;
  periodEnd: string;
  complete: boolean;
  generatedAt: string;
  creditPacks: {
    purchases: PurchaseRow[];
    refunds: RefundRow[];
    needsReview: PurchaseRow[];
  };
  disputes: DisputeRow[];
  heldPurchases: {
    unit: "credit_cents";
    openingCents: number;
    purchasedCents: number;
    creditedCents: number;
    refundWithdrawnCents: number;
    /** Held credits removed by a lost card dispute (#2596). */
    disputeWithdrawnCents: number;
    closingCents: number;
    computedClosingCents: number;
    balanced: boolean;
  };
  creditBalance: {
    unit: "credit_cents";
    openingCents: number;
    grants: LabelledTotal[];
    topUpGrantsCents: number;
    freeGrantsCents: number;
    spends: CountCents;
    spendsByReason: LabelledTotal[];
    jobRefunds: CountCents;
    jobRefundsByReason: LabelledTotal[];
    topUpRefundReversals: CountCents;
    /** Credits paused for open card disputes, and paused credits given back (#2596). */
    disputeHolds: CountCents;
    disputeReleases: CountCents;
    unclassified: { count: number };
    closingCents: number;
    computedClosingCents: number;
    balanced: boolean;
  };
  allowance: {
    unit: "credit_cents";
    note: string;
    grantedCount: number;
    grantedCents: number;
    usedCents: number;
    returnedCents: number;
    lapsedCents: number;
  };
  subscriptionInvoices: InvoiceRow[];
  controlTotals: CurrencyControlTotals[];
  integrity: {
    ledgerBalanceNowCents: number;
    accountsBalanceNowCents: number;
    matches: boolean;
  };
}

// ---------------------------------------------------------------------------
// CSV

/** One CSV field (RFC 4180) with a spreadsheet formula-injection guard. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === "boolean") text = value ? "true" : "false";
  else text = String(value);
  // Numbers stay numeric (a negative number is not a formula); strings that a
  // spreadsheet would evaluate get a leading apostrophe.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV: CRLF line ends, header row first. */
export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [columns.map(csvField).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvField(row[column])).join(","));
  return lines.join("\r\n") + "\r\n";
}

const PURCHASE_COLUMNS = [
  "creditTopUpId",
  "accountId",
  "stripeCheckoutSessionId",
  "stripePaymentIntentId",
  "packId",
  "currency",
  "priceCents",
  "amountTotalCents",
  "creditsCents",
  "delivery",
  "paidAt",
  "creditedAt",
  "creditedInMonthCents",
  "currentStatus",
];
const REFUND_COLUMNS = [
  "refundId",
  "creditTopUpId",
  "accountId",
  "stripePaymentIntentId",
  "currency",
  "amountCents",
  "withdrawnCreditsCents",
  "reversedCents",
  "spentNotReversedCents",
  "heldReductionCents",
  "statusBefore",
  "refundedAt",
  "backfilled",
];
const DISPUTE_COLUMNS = [
  "disputeId",
  "stripeDisputeId",
  "stripePaymentIntentId",
  "kind",
  "creditTopUpId",
  "accountId",
  "currency",
  "amountCents",
  "reason",
  "withdrawnCents",
  "feeCents",
  "reinstatedCents",
  "disputedCreditsCents",
  "heldCreditsCents",
  "releasedCreditsCents",
  "statusBefore",
  "openedAt",
  "closedAt",
  "fundsReinstatedAt",
  "currentStatus",
];
const INVOICE_COLUMNS = [
  "stripeInvoiceId",
  "subscriptionId",
  "accountId",
  "stripeSubscriptionId",
  "currency",
  "amountPaidCents",
  "amountExcludingTaxCents",
  "billingReason",
  "interval",
  "periodStart",
  "periodEnd",
  "paidAt",
];
const CONTROL_COLUMNS = [
  "currency",
  "purchaseCount",
  "purchasePriceCents",
  "purchaseChargedCents",
  "purchaseChargedUnknownCount",
  "refundCount",
  "refundAmountCents",
  "needsReviewCount",
  "needsReviewPriceCents",
  "needsReviewChargedCents",
  "needsReviewChargedUnknownCount",
  "invoiceCount",
  "invoiceAmountPaidCents",
  "netCollectedCents",
  "disputeOpenedCount",
  "disputeWithdrawnCents",
  "disputeFeeCents",
  "disputeReinstatedCount",
  "disputeReinstatedCents",
];
/**
 * Roll-forward sections are `line,count,cents` rows. The `balanced` line has
 * no count and cents 1 (the roll-forward ties out) or 0 (it does not).
 */
const ROLL_FORWARD_COLUMNS = ["line", "count", "cents"];

type Line = { line: string; count?: number; cents?: number };

function rollForward(lines: Line[]): string {
  return toCsv(ROLL_FORWARD_COLUMNS, lines);
}

/** One section of the report as CSV. */
export function sectionToCsv(report: BillingReconciliationReport, section: ReportSection): string {
  switch (section) {
    case "purchases":
      return toCsv(PURCHASE_COLUMNS, report.creditPacks.purchases as unknown as Array<Record<string, unknown>>);
    case "needs_review":
      return toCsv(PURCHASE_COLUMNS, report.creditPacks.needsReview as unknown as Array<Record<string, unknown>>);
    case "refunds":
      return toCsv(REFUND_COLUMNS, report.creditPacks.refunds as unknown as Array<Record<string, unknown>>);
    case "disputes":
      return toCsv(DISPUTE_COLUMNS, report.disputes as unknown as Array<Record<string, unknown>>);
    case "subscription_invoices":
      return toCsv(INVOICE_COLUMNS, report.subscriptionInvoices as unknown as Array<Record<string, unknown>>);
    case "control_totals":
      return toCsv(
        CONTROL_COLUMNS,
        report.controlTotals.map((t) => ({
          currency: t.currency,
          purchaseCount: t.creditPackPurchases.count,
          purchasePriceCents: t.creditPackPurchases.priceCents,
          purchaseChargedCents: t.creditPackPurchases.chargedCents,
          purchaseChargedUnknownCount: t.creditPackPurchases.chargedUnknownCount,
          refundCount: t.creditPackRefunds.count,
          refundAmountCents: t.creditPackRefunds.amountCents,
          needsReviewCount: t.needsReview.count,
          needsReviewPriceCents: t.needsReview.priceCents,
          needsReviewChargedCents: t.needsReview.chargedCents,
          needsReviewChargedUnknownCount: t.needsReview.chargedUnknownCount,
          invoiceCount: t.subscriptionInvoices.count,
          invoiceAmountPaidCents: t.subscriptionInvoices.amountPaidCents,
          netCollectedCents: t.netCollectedCents,
          disputeOpenedCount: t.disputesOpened.count,
          disputeWithdrawnCents: t.disputesOpened.withdrawnCents,
          disputeFeeCents: t.disputesOpened.feeCents,
          disputeReinstatedCount: t.disputesReinstated.count,
          disputeReinstatedCents: t.disputesReinstated.amountCents,
        })),
      );
    case "held_purchases": {
      const h = report.heldPurchases;
      return rollForward([
        { line: "opening", cents: h.openingCents },
        { line: "purchased", cents: h.purchasedCents },
        { line: "credited", cents: h.creditedCents },
        { line: "refund_withdrawn", cents: h.refundWithdrawnCents },
        { line: "dispute_withdrawn", cents: h.disputeWithdrawnCents },
        { line: "closing", cents: h.closingCents },
        { line: "computed_closing", cents: h.computedClosingCents },
        { line: "balanced", cents: h.balanced ? 1 : 0 },
      ]);
    }
    case "credit_balance": {
      const b = report.creditBalance;
      return rollForward([
        { line: "opening", cents: b.openingCents },
        ...b.grants.map((g) => ({ line: `grant:${g.label}`, count: g.count, cents: g.cents })),
        { line: "grants_top_up", cents: b.topUpGrantsCents },
        { line: "grants_free", cents: b.freeGrantsCents },
        ...b.spendsByReason.map((s) => ({ line: `spend:${s.label}`, count: s.count, cents: s.cents })),
        { line: "spends", count: b.spends.count, cents: b.spends.cents },
        ...b.jobRefundsByReason.map((s) => ({ line: `job_refund:${s.label}`, count: s.count, cents: s.cents })),
        { line: "job_refunds", count: b.jobRefunds.count, cents: b.jobRefunds.cents },
        { line: "top_up_refund_reversals", count: b.topUpRefundReversals.count, cents: b.topUpRefundReversals.cents },
        { line: "dispute_holds", count: b.disputeHolds.count, cents: b.disputeHolds.cents },
        { line: "dispute_releases", count: b.disputeReleases.count, cents: b.disputeReleases.cents },
        { line: "unclassified", count: b.unclassified.count },
        { line: "closing", cents: b.closingCents },
        { line: "computed_closing", cents: b.computedClosingCents },
        { line: "balanced", cents: b.balanced ? 1 : 0 },
      ]);
    }
    case "allowance": {
      const a = report.allowance;
      return rollForward([
        { line: "granted", count: a.grantedCount, cents: a.grantedCents },
        { line: "used", cents: a.usedCents },
        { line: "returned", cents: a.returnedCents },
        { line: "lapsed", cents: a.lapsedCents },
      ]);
    }
  }
}
