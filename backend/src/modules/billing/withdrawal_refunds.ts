/**
 * The Stripe refund behind an exercised withdrawal (#2594). Started as soon
 * as the withdrawal is recorded, and retried by the retention job
 * (`SubscriptionLifecycleService.reconcile`) until Stripe accepts it.
 *
 * - Idempotent: the Stripe idempotency key is the withdrawal row id, so a
 *   retry after a lost answer returns the same refund, never a second one.
 * - A credit pack is refunded in full; the `charge.refunded` webhook then
 *   cancels the held credits as for any refund (`CreditTopUpService`).
 * - Artist Pro is refunded `refundCents`, the price less the days used.
 *
 * Logs carry the row id and a short error code only.
 */

import type { ContractWithdrawal } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { writeStructuredLog } from "../shared/structured_logging";
import type { StripeGateway } from "./stripe_gateway";

/** Give up retrying after this many attempts; the row stays `failed` for the operator. */
export const MAX_WITHDRAWAL_REFUND_ATTEMPTS = 20;
const RETRY_BATCH = 50;
/** A pending refund untouched this long is retried (the request that created it died). */
const STUCK_PENDING_MS = 10 * 60 * 1000;

export type WithdrawalRefundOutcome = "refunded" | "not_needed" | "already_done" | "deferred";

/** A short, safe code for a failure: a Stripe error code or type, never its message. */
function failureCode(error: unknown): string {
  const value = error && typeof error === "object" ? (error as { code?: unknown; type?: unknown }) : {};
  const raw = typeof value.code === "string" && value.code ? value.code : typeof value.type === "string" ? value.type : "error";
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 64) || "error";
}

/**
 * What to refund on withdrawal from a paid period (refund policy, "Withdrawing
 * within 14 days"): the price less the service received, which is the larger
 * of the share of the period that has passed and the share of the period's
 * generation allowance used. The used part is rounded down, in the person's
 * favour. No payment-provider fee is deducted.
 */
export function proratedRefundCents(input: {
  paidCents: number;
  periodStart: Date;
  periodEnd: Date;
  at: Date;
  allowance?: { grantedCents: number; consumedCents: number };
}): number {
  const total = input.periodEnd.getTime() - input.periodStart.getTime();
  if (input.paidCents <= 0) return 0;
  if (total <= 0) return 0;
  const used = Math.min(total, Math.max(0, input.at.getTime() - input.periodStart.getTime()));
  const byTime = Math.floor((input.paidCents * used) / total);
  const granted = input.allowance?.grantedCents ?? 0;
  const consumed = Math.min(granted, Math.max(0, input.allowance?.consumedCents ?? 0));
  const byAllowance = granted > 0 ? Math.floor((input.paidCents * consumed) / granted) : 0;
  return Math.max(0, input.paidCents - Math.max(byTime, byAllowance));
}

async function paymentIntentFor(gateway: StripeGateway, row: ContractWithdrawal): Promise<string | null> {
  if (row.contract === "credit_topup") {
    const pack = await prisma.creditTopUp.findUnique({ where: { id: row.subjectId }, select: { stripePaymentIntentId: true } });
    return pack?.stripePaymentIntentId ?? null;
  }
  const invoice = await prisma.subscriptionInvoice.findUnique({ where: { id: row.subjectId }, select: { stripeInvoiceId: true } });
  return invoice ? gateway.findPaymentIntentForInvoice(invoice.stripeInvoiceId) : null;
}

/** Ask Stripe for the refund of one withdrawal, once. Never throws. */
export async function processWithdrawalRefund(
  gateway: StripeGateway | null,
  row: ContractWithdrawal,
  now: Date = new Date(),
): Promise<WithdrawalRefundOutcome> {
  if (row.refundStatus === "refunded" || row.refundStatus === "not_needed") return "already_done";
  if (row.refundCents <= 0) {
    await prisma.contractWithdrawal.update({ where: { id: row.id }, data: { refundStatus: "not_needed" } });
    return "not_needed";
  }
  try {
    if (!gateway) throw Object.assign(new Error("billing unavailable"), { code: "billing_unavailable" });
    const paymentIntentId = await paymentIntentFor(gateway, row);
    if (!paymentIntentId) throw Object.assign(new Error("no payment"), { code: "payment_not_found" });
    const refund = await gateway.createRefund(
      {
        paymentIntentId,
        ...(row.contract === "credit_topup" ? {} : { amountCents: row.refundCents }),
        metadata: { reason: "contract_withdrawal", withdrawalId: row.id },
      },
      `resonate-withdrawal-${row.id}`,
    );
    await prisma.contractWithdrawal.update({
      where: { id: row.id },
      data: {
        refundStatus: "refunded",
        stripeRefundId: refund.id,
        refundedAt: now,
        refundAttempts: { increment: 1 },
        refundLastError: null,
      },
    });
    writeStructuredLog({ level: "info", event: "billing.withdrawal_refunded", message: "billing.withdrawal_refunded", withdrawalId: row.id });
    return "refunded";
  } catch (error) {
    const code = failureCode(error);
    await prisma.contractWithdrawal.update({
      where: { id: row.id },
      data: { refundStatus: "failed", refundAttempts: { increment: 1 }, refundLastError: code },
    });
    writeStructuredLog({
      level: "warn",
      event: "billing.withdrawal_refund_deferred",
      message: "billing.withdrawal_refund_deferred",
      withdrawalId: row.id,
      code,
    });
    return "deferred";
  }
}

/** The retention job's pass: retry every withdrawal refund Stripe has not accepted yet. */
export async function retryPendingWithdrawalRefunds(
  gateway: StripeGateway | null,
  now: Date = new Date(),
): Promise<{ refunded: number; failed: number }> {
  const rows = await prisma.contractWithdrawal.findMany({
    where: {
      refundAttempts: { lt: MAX_WITHDRAWAL_REFUND_ATTEMPTS },
      // A pending row is normally being processed by the request that created
      // it; take it over only once it is clearly stuck.
      OR: [{ refundStatus: "failed" }, { refundStatus: "pending", updatedAt: { lt: new Date(now.getTime() - STUCK_PENDING_MS) } }],
    },
    orderBy: { withdrawnAt: "asc" },
    take: RETRY_BATCH,
  });
  const result = { refunded: 0, failed: 0 };
  for (const row of rows) {
    const outcome = await processWithdrawalRefund(gateway, row, now);
    if (outcome === "refunded") result.refunded += 1;
    else if (outcome === "deferred") result.failed += 1;
  }
  return result;
}
