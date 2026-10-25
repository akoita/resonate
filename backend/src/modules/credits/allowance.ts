/**
 * The Artist Pro monthly generation allowance, pure rules (#2408,
 * `docs/rfc/artist-pro.md` §5, `docs/rfc/business-model.md` Layer 2b). No
 * database, no SDK calls; `allowance.service.ts` applies them.
 *
 * - **Size:** {@link DEFAULT_ARTIST_PRO_MONTHLY_ALLOWANCE_CENTS} (300¢ = $3.00
 *   at sell prices) per month, overridable with
 *   `ARTIST_PRO_MONTHLY_ALLOWANCE_CENTS` (`0` turns grants off).
 * - **Which invoices grant:** a paid subscription invoice that starts a billing
 *   period: `subscription_create`, `subscription_cycle`, or a
 *   `subscription_update` carrying a full (non-proration) period line, as a
 *   switch from monthly to annual does. Proration-only invoices, manual and
 *   threshold invoices grant nothing.
 * - **Annual plans:** the paid year is cut into twelve monthly slices with
 *   consecutive windows ({@link monthlySlices}), all written when the invoice
 *   is paid. Each slice only becomes spendable in its own month, so nothing
 *   runs on a schedule and the result does not depend on when anyone looks.
 */

import type { StripeInvoice } from "../billing/stripe_gateway";

/** $3.00 a month at sell prices (RFC artist-pro §5 recommended default). */
export const DEFAULT_ARTIST_PRO_MONTHLY_ALLOWANCE_CENTS = 300;

/** Env var that overrides the monthly allowance, in integer cents. */
export const ARTIST_PRO_MONTHLY_ALLOWANCE_ENV = "ARTIST_PRO_MONTHLY_ALLOWANCE_CENTS";

/** Mean Gregorian month, used only to count how many months a period holds. */
const MEAN_MONTH_MS = 30.436875 * 24 * 60 * 60 * 1000;

/** An annual plan is twelve monthly slices; nothing sold is longer. */
export const MAX_ALLOWANCE_SLICES = 12;

/** Billing reasons whose invoice opens a new billing period. */
const PERIOD_OPENING_REASONS = new Set(["subscription_create", "subscription_cycle"]);

/**
 * The configured monthly allowance: a non-negative integer from `raw` (env
 * value, number or numeric string), else the $3.00 default. `0` disables it.
 */
export function resolveMonthlyAllowanceCents(raw?: string | number | null): number {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_ARTIST_PRO_MONTHLY_ALLOWANCE_CENTS;
  const parsed = typeof raw === "string" ? Number(raw.trim()) : raw;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_ARTIST_PRO_MONTHLY_ALLOWANCE_CENTS;
}

/**
 * `anchor` plus `months` calendar months in UTC, keeping the anchor's day and
 * time and clamping to the last day of a shorter month (Jan 31 + 1 → Feb 28/29),
 * the way Stripe anchors billing dates. Always counted from the original
 * anchor, so the clamp never drifts across slices.
 */
export function addUtcMonthsClamped(anchor: Date, months: number): Date {
  const monthIndex = anchor.getUTCMonth() + months;
  const year = anchor.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(anchor.getUTCDate(), lastDay),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
}

export interface AllowanceSlice {
  sliceIndex: number;
  periodStart: Date;
  expiresAt: Date;
}

/**
 * Monthly windows covering `[start, end)`: one for a monthly period, twelve
 * for an annual one (the month count is the period length in mean months,
 * rounded, between 1 and {@link MAX_ALLOWANCE_SLICES}). Windows are
 * consecutive; the last one ends exactly at `end`. Empty for an empty period.
 */
export function monthlySlices(start: Date, end: Date): AllowanceSlice[] {
  const span = end.getTime() - start.getTime();
  if (!(span > 0)) return [];
  const count = Math.min(MAX_ALLOWANCE_SLICES, Math.max(1, Math.round(span / MEAN_MONTH_MS)));
  const slices: AllowanceSlice[] = [];
  for (let index = 0; index < count; index += 1) {
    const periodStart = index === 0 ? start : addUtcMonthsClamped(start, index);
    const boundary = index === count - 1 ? end : addUtcMonthsClamped(start, index + 1);
    const expiresAt = boundary.getTime() > end.getTime() ? end : boundary;
    if (expiresAt.getTime() <= periodStart.getTime()) break;
    slices.push({ sliceIndex: index, periodStart, expiresAt });
  }
  return slices;
}

/** What a paid invoice says about the allowance, or why it grants nothing. */
export type InvoiceAllowancePeriod =
  | {
      grant: true;
      invoiceId: string;
      stripeSubscriptionId: string;
      periodStart: Date;
      periodEnd: Date;
    }
  | { grant: false; reason: "unparseable" | "no_subscription" | "not_period_opening" | "no_period_line" | "unpaid_invoice" };

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id || null;
  }
  return null;
}

function seconds(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null;
}

/**
 * Read the billing period a paid invoice pays for (pinned API version
 * `2026-09-30.endive`): the first subscription line that is not a proration.
 * The line's own period is used rather than the subscription's current one, so
 * an invoice processed late still grants the month it paid for.
 */
export function invoiceAllowancePeriod(invoice: StripeInvoice | null | undefined): InvoiceAllowancePeriod {
  const invoiceId = idOf(invoice);
  if (!invoice || !invoiceId) return { grant: false, reason: "unparseable" };
  const stripeSubscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
  if (!stripeSubscriptionId) return { grant: false, reason: "no_subscription" };
  // ADR-BM-3: free allowances only via promo credits. An invoice nobody paid
  // for (a 100% coupon, a $0 trial invoice) grants no allowance (#2408).
  if (!(typeof invoice.amount_paid === "number" && invoice.amount_paid > 0)) {
    return { grant: false, reason: "unpaid_invoice" };
  }
  const reason = invoice.billing_reason ?? "";
  if (!PERIOD_OPENING_REASONS.has(reason) && reason !== "subscription_update") {
    return { grant: false, reason: "not_period_opening" };
  }
  const line = (invoice.lines?.data ?? []).find(
    (candidate) =>
      candidate?.parent?.type === "subscription_item_details" &&
      candidate.parent.subscription_item_details?.proration !== true &&
      seconds(candidate.period?.start) !== null &&
      seconds(candidate.period?.end) !== null,
  );
  if (!line) {
    return { grant: false, reason: reason === "subscription_update" ? "not_period_opening" : "no_period_line" };
  }
  const periodStart = seconds(line.period.start) as Date;
  const periodEnd = seconds(line.period.end) as Date;
  if (periodEnd.getTime() <= periodStart.getTime()) return { grant: false, reason: "no_period_line" };
  return { grant: true, invoiceId, stripeSubscriptionId, periodStart, periodEnd };
}

/**
 * How a charge splits across the two buckets: the allowance first, up to what
 * is left of it, then the bought/promo balance.
 */
export function splitCharge(
  amountCents: number,
  allowanceRemainingCents: number,
): { fromAllowanceCents: number; fromBalanceCents: number } {
  const fromAllowanceCents = Math.max(0, Math.min(amountCents, allowanceRemainingCents));
  return { fromAllowanceCents, fromBalanceCents: amountCents - fromAllowanceCents };
}
