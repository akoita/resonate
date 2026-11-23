/**
 * Refunds on an operator closure (#2595). ADR-BM-6 revenue line 2 (Artist Pro
 * and generation credits), Phase 2: a trust fix before live charging. No fee,
 * split or price change (ADR-BM-4 unaffected).
 *
 * When the operator closes an account for a reason other than a serious or
 * repeated breach of the terms by the person (refund policy, "Artist Pro
 * subscription: closing, erasing or suspending an account"), the person gets
 * back:
 * - **the unused days of the current Artist Pro period**: the latest paid
 *   invoice whose period is running, times the whole days left over the days
 *   in the period, rounded down;
 * - **the money value of bought credits not used**, by purchase, newest first:
 *   a held pack in full, then credited packs up to the bought credits still in
 *   the balance. The `charge.refunded` webhook then takes those credits back,
 *   as for any refund (`CreditTopUpService`).
 *
 * A payment already withdrawn from (#2594) or disputed (#2596, open or lost) is skipped: the
 * withdrawal or the bank already returns it. The generation allowance is never
 * refunded in cash.
 *
 * Each refund is a `ClosureRefund` row (unique per payment), so planning twice
 * changes nothing; the Stripe idempotency key is the row id, so a retry after a
 * lost answer returns the same refund. The retention job retries failures
 * (`SubscriptionLifecycleService.reconcile`). Logs carry row ids and short
 * error codes only.
 *
 * Not legal advice: what counts as a serious breach is a question for the
 * operator's lawyer.
 */

import type { ClosureRefund } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { writeStructuredLog } from "../shared/structured_logging";
import type { StripeGateway } from "./stripe_gateway";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Give up retrying after this many attempts; the row stays `failed` for the operator. */
export const MAX_CLOSURE_REFUND_ATTEMPTS = 20;
const RETRY_BATCH = 50;
/** A pending refund untouched this long is retried (the request that created it died). */
const STUCK_PENDING_MS = 10 * 60 * 1000;

export type ClosureRefundKind = "subscription_invoice" | "credit_topup";
export type ClosureRefundOutcome = "refunded" | "not_needed" | "already_done" | "deferred";
export type ClosureRefundSummary = { planned: number; refunded: number; pending: number };

function failureCode(error: unknown): string {
  const value = error && typeof error === "object" ? (error as { code?: unknown; type?: unknown }) : {};
  const raw = typeof value.code === "string" && value.code ? value.code : typeof value.type === "string" ? value.type : "error";
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 64) || "error";
}

/** The unused days of a paid period, in proportion: whole days left over days in the period, rounded down. */
export function unusedDaysRefundCents(input: { paidCents: number; periodStart: Date; periodEnd: Date; at: Date }): number {
  if (input.paidCents <= 0) return 0;
  const totalDays = Math.max(1, Math.round((input.periodEnd.getTime() - input.periodStart.getTime()) / DAY_MS));
  const daysLeft = Math.min(totalDays, Math.max(0, Math.floor((input.periodEnd.getTime() - input.at.getTime()) / DAY_MS)));
  return Math.floor((input.paidCents * daysLeft) / totalDays);
}

export type PackForRefund = {
  id: string;
  status: string;
  currency: string;
  /** What the buyer was charged (tax included when known), in minor units. */
  chargedCents: number;
  creditsCents: number;
  creditedCents: number;
  reversedCents: number;
  refundedAmountCents: number;
  refundedCreditsCents: number;
};

/**
 * Split the unspent bought credits over the packs, newest first: a held pack
 * is refunded in full (its credits are not in the balance yet); credited packs
 * share the bought credits still in the balance. Packs must be given newest
 * first. Returns the money to refund per pack, in the pack's currency.
 */
export function allocatePackRefunds(packs: PackForRefund[], balanceCents: number): { pack: PackForRefund; refundCents: number }[] {
  let budget = Math.max(0, balanceCents);
  const out: { pack: PackForRefund; refundCents: number }[] = [];
  for (const pack of packs) {
    const refundable = Math.max(0, pack.chargedCents - pack.refundedAmountCents);
    if (refundable <= 0 || pack.creditsCents <= 0) continue;
    let credits: number;
    if (pack.status === "held") {
      credits = Math.max(0, pack.creditsCents - pack.refundedCreditsCents);
    } else if (pack.status === "credited") {
      credits = Math.min(budget, Math.max(0, pack.creditedCents - pack.reversedCents));
      budget -= credits;
    } else {
      continue;
    }
    const refundCents = Math.min(refundable, Math.floor((pack.chargedCents * credits) / pack.creditsCents));
    if (refundCents > 0) out.push({ pack, refundCents });
  }
  return out;
}

async function createRow(data: Omit<Prisma.ClosureRefundUncheckedCreateInput, "refundStatus">): Promise<boolean> {
  try {
    await prisma.closureRefund.create({ data: { ...data, refundStatus: "pending" } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

/** Record what an operator closure (not for a breach) refunds. Idempotent per payment. */
export async function planClosureRefunds(userId: string, now: Date = new Date()): Promise<number> {
  let planned = 0;

  // 1. The unused days of the running Artist Pro period.
  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: {
      endReason: true,
      invoices: {
        where: { periodStart: { lte: now }, periodEnd: { gt: now } },
        orderBy: { paidAt: "desc" },
        take: 1,
        select: { id: true, currency: true, amountPaidCents: true, periodStart: true, periodEnd: true, disputes: { where: { status: { in: ["open", "lost"] } }, select: { id: true }, take: 1 } },
      },
    },
  });
  const invoice = subscription?.invoices[0];
  if (invoice && subscription?.endReason !== "contract_withdrawal" && invoice.disputes.length === 0) {
    const withdrawn = await prisma.contractWithdrawal.findUnique({
      where: { contract_subjectId: { contract: "artist_pro", subjectId: invoice.id } },
      select: { id: true },
    });
    const refundCents = unusedDaysRefundCents({ paidCents: invoice.amountPaidCents, periodStart: invoice.periodStart, periodEnd: invoice.periodEnd, at: now });
    if (!withdrawn && refundCents > 0) {
      const created = await createRow({
        userId,
        kind: "subscription_invoice",
        subjectId: invoice.id,
        closedAt: now,
        currency: invoice.currency,
        paidCents: invoice.amountPaidCents,
        refundCents,
      });
      if (created) planned += 1;
    }
  }

  // 2. Unspent bought credits, by purchase, newest first.
  const [packs, account, withdrawals] = await Promise.all([
    prisma.creditTopUp.findMany({
      where: { userId, status: { in: ["held", "credited"] }, stripePaymentIntentId: { not: null }, disputes: { none: { status: { in: ["open", "lost"] } } } },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.generationCreditAccount.findUnique({ where: { userId }, select: { balanceCents: true } }),
    prisma.contractWithdrawal.findMany({ where: { userId, contract: "credit_topup" }, select: { subjectId: true } }),
  ]);
  const withdrawnPacks = new Set(withdrawals.map((row) => row.subjectId));
  const allocations = allocatePackRefunds(
    packs
      .filter((pack) => !withdrawnPacks.has(pack.id))
      .map((pack) => ({
        id: pack.id,
        status: pack.status,
        currency: pack.currency,
        chargedCents: pack.amountTotalCents ?? pack.priceCents,
        creditsCents: pack.creditsCents,
        creditedCents: pack.creditedCents,
        reversedCents: pack.reversedCents,
        refundedAmountCents: pack.refundedAmountCents,
        refundedCreditsCents: pack.refundedCreditsCents,
      })),
    account?.balanceCents ?? 0,
  );
  for (const { pack, refundCents } of allocations) {
    const created = await createRow({
      userId,
      kind: "credit_topup",
      subjectId: pack.id,
      closedAt: now,
      currency: pack.currency,
      paidCents: pack.chargedCents,
      refundCents,
    });
    if (created) planned += 1;
  }
  return planned;
}

async function paymentIntentFor(gateway: StripeGateway, row: ClosureRefund): Promise<string | null> {
  if (row.kind === "credit_topup") {
    const pack = await prisma.creditTopUp.findUnique({ where: { id: row.subjectId }, select: { stripePaymentIntentId: true } });
    return pack?.stripePaymentIntentId ?? null;
  }
  const invoice = await prisma.subscriptionInvoice.findUnique({ where: { id: row.subjectId }, select: { stripeInvoiceId: true } });
  return invoice ? gateway.findPaymentIntentForInvoice(invoice.stripeInvoiceId) : null;
}

/** Ask Stripe for one closure refund, once. Never throws. */
export async function processClosureRefund(gateway: StripeGateway | null, row: ClosureRefund, now: Date = new Date()): Promise<ClosureRefundOutcome> {
  if (row.refundStatus === "refunded" || row.refundStatus === "not_needed") return "already_done";
  if (row.refundCents <= 0) {
    await prisma.closureRefund.update({ where: { id: row.id }, data: { refundStatus: "not_needed" } });
    return "not_needed";
  }
  try {
    if (!gateway) throw Object.assign(new Error("billing unavailable"), { code: "billing_unavailable" });
    const paymentIntentId = await paymentIntentFor(gateway, row);
    if (!paymentIntentId) throw Object.assign(new Error("no payment"), { code: "payment_not_found" });
    const refund = await gateway.createRefund(
      { paymentIntentId, amountCents: row.refundCents, metadata: { reason: "operator_closure", closureRefundId: row.id } },
      `resonate-closure-${row.id}`,
    );
    await prisma.closureRefund.update({
      where: { id: row.id },
      data: { refundStatus: "refunded", stripeRefundId: refund.id, refundedAt: now, refundAttempts: { increment: 1 }, refundLastError: null },
    });
    writeStructuredLog({ level: "info", event: "billing.closure_refunded", message: "billing.closure_refunded", closureRefundId: row.id });
    return "refunded";
  } catch (error) {
    const code = failureCode(error);
    await prisma.closureRefund.update({
      where: { id: row.id },
      data: { refundStatus: "failed", refundAttempts: { increment: 1 }, refundLastError: code },
    });
    writeStructuredLog({ level: "warn", event: "billing.closure_refund_deferred", message: "billing.closure_refund_deferred", closureRefundId: row.id, code });
    return "deferred";
  }
}

/** Plan and start the refunds for one closure. Never throws on a Stripe failure: the retention job retries. */
export async function refundOperatorClosure(gateway: StripeGateway | null, userId: string, now: Date = new Date()): Promise<ClosureRefundSummary> {
  const planned = await planClosureRefunds(userId, now);
  const rows = await prisma.closureRefund.findMany({ where: { userId, refundStatus: { in: ["pending", "failed"] } } });
  const summary: ClosureRefundSummary = { planned, refunded: 0, pending: 0 };
  for (const row of rows) {
    const outcome = await processClosureRefund(gateway, row, now);
    if (outcome === "refunded") summary.refunded += 1;
    else if (outcome === "deferred") summary.pending += 1;
  }
  return summary;
}

/** The retention job's pass: retry every closure refund Stripe has not accepted yet. */
export async function retryPendingClosureRefunds(gateway: StripeGateway | null, now: Date = new Date()): Promise<{ refunded: number; failed: number }> {
  const rows = await prisma.closureRefund.findMany({
    where: {
      refundAttempts: { lt: MAX_CLOSURE_REFUND_ATTEMPTS },
      // A pending row is normally being processed by the request that created
      // it; take it over only once it is clearly stuck.
      OR: [{ refundStatus: "failed" }, { refundStatus: "pending", updatedAt: { lt: new Date(now.getTime() - STUCK_PENDING_MS) } }],
    },
    orderBy: { closedAt: "asc" },
    take: RETRY_BATCH,
  });
  const result = { refunded: 0, failed: 0 };
  for (const row of rows) {
    const outcome = await processClosureRefund(gateway, row, now);
    if (outcome === "refunded") result.refunded += 1;
    else if (outcome === "deferred") result.failed += 1;
  }
  return result;
}
