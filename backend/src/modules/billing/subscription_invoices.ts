/**
 * The append-only record of paid Artist Pro invoices (#2497), written from the
 * verified `invoice.paid` webhook so the monthly billing reconciliation report
 * can list subscription revenue with the service period each invoice pays for
 * (an annual plan is spread over its 12 months by the accountant).
 *
 * - **Every paid invoice** that belongs to a known subscription is recorded,
 *   including $0 and proration invoices; the report decides what to show.
 * - **Exactly once:** `SubscriptionInvoice.stripeInvoiceId` is unique, so a
 *   redelivered event records nothing more.
 * - **Period:** the first non-proration subscription line (the same rule as the
 *   allowance grant, `credits/allowance.ts`), else the span of all dated lines,
 *   else the invoice's own period.
 *
 * Logs carry ids only: never an email, a card detail or a payload.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { writeStructuredLog } from "../shared/structured_logging";
import type { StripeInvoice } from "./stripe_gateway";

export type RecordPaidInvoiceOutcome =
  | "recorded"
  | "duplicate"
  | "skipped_no_subscription"
  | "skipped_unknown_subscription"
  | "skipped_no_period"
  | "skipped_unparseable";

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

function validPeriod(start: Date | null, end: Date | null): { periodStart: Date; periodEnd: Date } | null {
  return start && end && end.getTime() > start.getTime() ? { periodStart: start, periodEnd: end } : null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * The service period a paid invoice covers (pinned API version
 * `2026-09-30.endive`), or `null` when it names no valid period.
 */
export function invoiceServicePeriod(invoice: StripeInvoice): { periodStart: Date; periodEnd: Date } | null {
  const lines = invoice.lines?.data ?? [];

  const subscriptionLine = lines.find(
    (line) =>
      line?.parent?.type === "subscription_item_details" &&
      line.parent.subscription_item_details?.proration !== true &&
      validPeriod(seconds(line.period?.start), seconds(line.period?.end)) !== null,
  );
  if (subscriptionLine) {
    return validPeriod(seconds(subscriptionLine.period.start), seconds(subscriptionLine.period.end));
  }

  let earliest: Date | null = null;
  let latest: Date | null = null;
  for (const line of lines) {
    const start = seconds(line?.period?.start);
    const end = seconds(line?.period?.end);
    if (!validPeriod(start, end)) continue;
    if (!earliest || (start as Date).getTime() < earliest.getTime()) earliest = start;
    if (!latest || (end as Date).getTime() > latest.getTime()) latest = end;
  }
  const spanned = validPeriod(earliest, latest);
  if (spanned) return spanned;

  return validPeriod(seconds(invoice.period_start), seconds(invoice.period_end));
}

/** Record one paid subscription invoice, once. */
export async function recordPaidInvoice(
  invoice: StripeInvoice,
  eventCreatedAt: Date,
): Promise<RecordPaidInvoiceOutcome> {
  const stripeInvoiceId = idOf(invoice);
  if (!stripeInvoiceId || typeof invoice.amount_paid !== "number" || typeof invoice.currency !== "string") {
    return "skipped_unparseable";
  }
  const stripeSubscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
  if (!stripeSubscriptionId) return "skipped_no_subscription";

  const subscription = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId },
    select: { id: true, interval: true },
  });
  if (!subscription) {
    writeStructuredLog({
      level: "warn",
      event: "billing.invoice_unknown_subscription",
      message: "billing.invoice_unknown_subscription",
      stripeInvoiceId,
      stripeSubscriptionId,
    });
    return "skipped_unknown_subscription";
  }

  const period = invoiceServicePeriod(invoice);
  if (!period) {
    writeStructuredLog({
      level: "warn",
      event: "billing.invoice_no_period",
      message: "billing.invoice_no_period",
      stripeInvoiceId,
      subscriptionRowId: subscription.id,
    });
    return "skipped_no_period";
  }

  try {
    await prisma.subscriptionInvoice.create({
      data: {
        subscriptionId: subscription.id,
        stripeInvoiceId,
        stripeSubscriptionId,
        currency: invoice.currency.toLowerCase(),
        amountPaidCents: invoice.amount_paid,
        amountExcludingTaxCents:
          typeof invoice.total_excluding_tax === "number" ? invoice.total_excluding_tax : null,
        billingReason: invoice.billing_reason ?? null,
        interval: subscription.interval,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        paidAt: seconds(invoice.status_transitions?.paid_at) ?? eventCreatedAt,
      },
    });
    return "recorded";
  } catch (error) {
    if (isUniqueViolation(error)) return "duplicate";
    throw error;
  }
}
