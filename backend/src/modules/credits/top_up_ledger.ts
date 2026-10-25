/**
 * The ledger side of bought generation credits (#1422, Artist Pro slice 4,
 * `docs/rfc/artist-pro.md` §7). The Stripe side lives in
 * `billing/credit_topup.service.ts`; this file only moves credits.
 *
 * - `creditTopUpInTx`: a `grant` row with reason `top_up` and the payment
 *   intent id as `paymentRef`.
 * - `reverseTopUpInTx`: a `reversal` row with reason `top_up_refund`, taking
 *   back at most what is left in the balance (never below zero: credits
 *   already spent stay spent).
 * - `releaseDueTopUpHolds`: the lazy release of "wait" purchases whose 14-day
 *   hold has ended. Called on every balance read and before every debit, so a
 *   held pack is spendable the moment its hold ends without a scheduler. Each
 *   release is a conditional claim on the `CreditTopUp` row, so two concurrent
 *   reads credit it once.
 *
 * Bought credits carry no expiry. The balance is one pooled number with no
 * per-purchase lots, so an expiry date could not be enforced cleanly; the RFC
 * promises at least 24 months, and "never" satisfies it.
 */

import { Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

/** Ledger reason of a bought-credit grant. */
export const TOP_UP_REASON = "top_up";
/** Ledger reason of the reversal that follows a Stripe refund. */
export const TOP_UP_REFUND_REASON = "top_up_refund";
/** Ledger type of that reversal: not a `debit`, so spend-by-action never counts it. */
export const TOP_UP_REVERSAL_TYPE = "reversal";

export type TopUpReleaseBasis = "consent" | "hold_elapsed" | "deliver_now_later";

const logger = new Logger("TopUpLedger");

/** Add bought credits to the balance, inside the caller's transaction. */
export async function creditTopUpInTx(
  tx: Prisma.TransactionClient,
  input: { userId: string; amountCents: number; paymentRef: string | null },
): Promise<{ balanceAfterCents: number; transactionId: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("A top-up credits a positive whole number of cents");
  }
  const account = await tx.generationCreditAccount.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId, balanceCents: input.amountCents },
    update: { balanceCents: { increment: input.amountCents } },
  });
  const txn = await tx.generationCreditTransaction.create({
    data: {
      userId: input.userId,
      type: "grant",
      amountCents: input.amountCents,
      reason: TOP_UP_REASON,
      paymentRef: input.paymentRef,
      balanceAfterCents: account.balanceCents,
    },
  });
  return { balanceAfterCents: account.balanceCents, transactionId: txn.id };
}

/**
 * Take back up to `wantedCents` of refunded credits, inside the caller's
 * transaction. Returns how much was actually taken: the balance never goes
 * below zero.
 */
export async function reverseTopUpInTx(
  tx: Prisma.TransactionClient,
  input: { userId: string; wantedCents: number; paymentRef: string | null },
): Promise<{ reversedCents: number; balanceAfterCents: number }> {
  // Lock the account row so a concurrent debit cannot spend what is being taken back.
  const rows = await tx.$queryRaw<Array<{ balanceCents: number }>>`
    SELECT "balanceCents" FROM "GenerationCreditAccount" WHERE "userId" = ${input.userId} FOR UPDATE`;
  const balance = rows[0]?.balanceCents ?? 0;
  const take = Math.min(balance, Math.max(0, input.wantedCents));
  if (take <= 0) return { reversedCents: 0, balanceAfterCents: balance };
  const account = await tx.generationCreditAccount.update({
    where: { userId: input.userId },
    data: { balanceCents: { decrement: take } },
  });
  await tx.generationCreditTransaction.create({
    data: {
      userId: input.userId,
      type: TOP_UP_REVERSAL_TYPE,
      amountCents: take,
      reason: TOP_UP_REFUND_REASON,
      paymentRef: input.paymentRef,
      balanceAfterCents: account.balanceCents,
    },
  });
  return { reversedCents: take, balanceAfterCents: account.balanceCents };
}

/**
 * Release one held purchase: a conditional claim (`held` → `credited`) and the
 * ledger grant in one transaction. Returns the credits added, or null when the
 * row was not held any more (released by a concurrent call, or refunded).
 */
export async function releaseHeldTopUp(
  topUpId: string,
  basis: TopUpReleaseBasis,
  now: Date = new Date(),
): Promise<number | null> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.creditTopUp.findUnique({ where: { id: topUpId } });
    if (!row || row.status !== "held") return null;
    const amount = Math.max(0, row.creditsCents - row.refundedCreditsCents);
    const claimed = await tx.creditTopUp.updateMany({
      where: { id: row.id, status: "held", refundedCreditsCents: row.refundedCreditsCents },
      data: { status: "credited", creditedAt: now, releaseBasis: basis, creditedCents: amount },
    });
    if (claimed.count !== 1) return null;
    if (amount > 0) {
      await creditTopUpInTx(tx, { userId: row.userId, amountCents: amount, paymentRef: row.stripePaymentIntentId });
    }
    return amount;
  });
}

/**
 * The lazy release (#1422): every "wait" purchase of this person whose hold
 * has ended is credited now. Never throws into the caller: a failure leaves
 * the hold for the next read.
 */
export async function releaseDueTopUpHolds(userId: string, now: Date = new Date()): Promise<number> {
  try {
    const due = await prisma.creditTopUp.findMany({
      where: { userId, status: "held", heldUntil: { lte: now } },
      select: { id: true },
      orderBy: { heldUntil: "asc" },
      take: 50,
    });
    let released = 0;
    for (const row of due) released += (await releaseHeldTopUp(row.id, "hold_elapsed", now)) ?? 0;
    return released;
  } catch (error) {
    logger.warn(
      `Could not release held credit purchases for ${userId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 0;
  }
}
