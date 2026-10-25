/**
 * The Artist Pro monthly generation allowance bucket (#2408,
 * `docs/rfc/artist-pro.md` §5, `docs/rfc/business-model.md` Layer 2b).
 *
 * **Model.** Allowance credits live in `GenerationAllowanceGrant`, apart from
 * the bought/promo balance in `GenerationCreditAccount`. A grant row holds what
 * one month of a paid invoice gave (`amountCents`) and how much of it has been
 * spent (`consumedCents`). Every debit and refund still writes exactly one
 * ledger row; `allowanceCents` / `allowanceGrantId` on it say how much of that
 * movement went through the bucket, so `consumedCents` reconciles against the
 * ledger and `balanceAfterCents` keeps meaning the bought/promo balance. A
 * separate table (rather than a bucket column alone) is what makes the grant
 * idempotent per invoice and lets expiry be computed instead of written.
 *
 * **Spend order.** {@link consumeAllowance} runs inside the debit transaction,
 * before the balance is touched: the live grant pays first, the balance pays
 * the rest. A transaction-scoped advisory lock per person serializes every
 * allowance movement, and the conditional update and the table's CHECK
 * constraint keep a grant from ever spending more than it holds.
 *
 * **Live grant.** At time `t`, the person's grant with the latest
 * `periodStart <= t`, when `t < expiresAt` and its subscription still gives
 * the `pro` plan (`planFromSubscription`). A later grant starting inside an
 * earlier window (a switch from monthly to annual) ends the earlier one at its
 * own start: Stripe has closed that period. Expiry is therefore computed at
 * read and debit time; no job runs and nothing is written when a month ends.
 * What a grant did not spend by its end lapsed: `amountCents - consumedCents`.
 */

import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { GenerationAllowanceGrant, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../db/prisma";
import type { StripeInvoice } from "../billing/stripe_gateway";
import { planFromSubscription } from "../entitlements/subscription_plan";
import { writeStructuredLog } from "../shared/structured_logging";
import {
  ARTIST_PRO_MONTHLY_ALLOWANCE_ENV,
  invoiceAllowancePeriod,
  monthlySlices,
  resolveMonthlyAllowanceCents,
  splitCharge,
} from "./allowance";

type Db = Prisma.TransactionClient | PrismaClient;

/** The allowance as the person sees it (Usage & Billing, `/credits/balance`). */
export interface GenerationAllowanceStatus {
  /** What is left of the live month's allowance (0 when none is live). */
  remainingCents: number;
  /** What the live month granted (0 when none is live). */
  grantedCents: number;
  /** What has been spent from the live month (net of refunds). */
  spentCents: number;
  /** Start of the live month, or null. */
  periodStart: Date | null;
  /** When the live allowance stops (unused cents lapse; the next paid month brings a new one), or null. */
  expiresAt: Date | null;
  /** Unused allowance that lapsed when the previous month ended (no cash value, not carried over). */
  previousExpiredCents: number;
  /** When that previous month ended, or null when there is none. */
  previousEndedAt: Date | null;
}

export type AllowanceGrantOutcome =
  | "granted"
  | "duplicate"
  | "disabled"
  | "skipped_unknown_subscription"
  | `skipped_${string}`;

type LiveGrant = Pick<GenerationAllowanceGrant, "id" | "amountCents" | "consumedCents" | "periodStart" | "expiresAt">;

/** Serialize every allowance movement of one person (transaction-scoped). */
export async function lockAllowance(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`generation_allowance:${userId}`}, 0))`;
}

/** The person's live grant at `now` (see the file header), or null. */
export async function findLiveGrant(db: Db, userId: string, now: Date): Promise<LiveGrant | null> {
  const latest = await db.generationAllowanceGrant.findFirst({
    where: { userId, periodStart: { lte: now } },
    orderBy: { periodStart: "desc" },
    select: {
      id: true,
      amountCents: true,
      consumedCents: true,
      periodStart: true,
      expiresAt: true,
      subscription: {
        select: { status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, pastDueSince: true, updatedAt: true },
      },
    },
  });
  if (!latest || latest.expiresAt.getTime() <= now.getTime()) return null;
  if (planFromSubscription(latest.subscription, now).plan !== "pro") return null;
  const { subscription: _subscription, ...grant } = latest;
  return grant;
}

/**
 * Spend up to `amountCents` from the live grant, inside the debit's
 * transaction. Takes the person's allowance lock first. Returns what the
 * allowance paid and from which grant; the caller charges the rest to the
 * balance, and a throw there rolls this back with it.
 */
export async function consumeAllowance(
  tx: Prisma.TransactionClient,
  userId: string,
  amountCents: number,
  now: Date,
): Promise<{ fromAllowanceCents: number; grantId: string | null; remainingCents: number }> {
  await lockAllowance(tx, userId);
  const live = await findLiveGrant(tx, userId, now);
  if (!live) return { fromAllowanceCents: 0, grantId: null, remainingCents: 0 };
  const remainingCents = live.amountCents - live.consumedCents;
  const { fromAllowanceCents } = splitCharge(amountCents, remainingCents);
  if (fromAllowanceCents === 0) return { fromAllowanceCents: 0, grantId: null, remainingCents };
  const updated = await tx.generationAllowanceGrant.updateMany({
    where: { id: live.id, consumedCents: { lte: live.amountCents - fromAllowanceCents } },
    data: { consumedCents: { increment: fromAllowanceCents } },
  });
  if (updated.count !== 1) throw new Error(`Allowance grant ${live.id} changed under its lock`);
  return { fromAllowanceCents, grantId: live.id, remainingCents };
}

/**
 * Put `cents` back on the grant a refunded debit spent from, inside the
 * refund's transaction. Never more than the grant has consumed. A grant whose
 * month has ended takes the cents back too: they lapse with it, because
 * allowance never moves to the bought balance and is never paid out.
 */
export async function restoreAllowance(
  tx: Prisma.TransactionClient,
  userId: string,
  grantId: string,
  cents: number,
): Promise<number> {
  await lockAllowance(tx, userId);
  const grant = await tx.generationAllowanceGrant.findUnique({
    where: { id: grantId },
    select: { userId: true, consumedCents: true },
  });
  if (!grant || grant.userId !== userId) return 0;
  const restored = Math.max(0, Math.min(cents, grant.consumedCents));
  if (restored === 0) return 0;
  await tx.generationAllowanceGrant.update({
    where: { id: grantId },
    data: { consumedCents: { decrement: restored } },
  });
  return restored;
}

/** The allowance as reported to the person, or null when they never had one. */
export async function readAllowanceStatus(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<GenerationAllowanceStatus | null> {
  const started = await db.generationAllowanceGrant.findMany({
    where: { userId, periodStart: { lte: now } },
    orderBy: { periodStart: "desc" },
    take: 2,
    select: { id: true, amountCents: true, consumedCents: true, periodStart: true, expiresAt: true },
  });
  if (started.length === 0) return null;

  const live = await findLiveGrant(db, userId, now);
  const next = live
    ? await db.generationAllowanceGrant.findFirst({
        where: { userId, periodStart: { gt: live.periodStart } },
        orderBy: { periodStart: "asc" },
        select: { periodStart: true },
      })
    : null;
  const liveEndsAt =
    live && next && next.periodStart.getTime() < live.expiresAt.getTime() ? next.periodStart : live?.expiresAt ?? null;

  // The previous month: the grant before the live one, or the latest started
  // one when none is live. It ended at its expiry or when the next one began.
  const previous = live ? started.find((row) => row.id !== live.id) ?? null : started[0];
  let previousExpiredCents = 0;
  let previousEndedAt: Date | null = null;
  if (previous) {
    const after = started.find((row) => row.periodStart.getTime() > previous.periodStart.getTime());
    const endedAt =
      after && after.periodStart.getTime() < previous.expiresAt.getTime() ? after.periodStart : previous.expiresAt;
    if (endedAt.getTime() <= now.getTime()) {
      previousEndedAt = endedAt;
      previousExpiredCents = Math.max(0, previous.amountCents - previous.consumedCents);
    }
  }

  return {
    remainingCents: live ? live.amountCents - live.consumedCents : 0,
    grantedCents: live?.amountCents ?? 0,
    spentCents: live?.consumedCents ?? 0,
    periodStart: live?.periodStart ?? null,
    expiresAt: liveEndsAt,
    previousExpiredCents,
    previousEndedAt,
  };
}

/**
 * Grants, status and refund arithmetic for the allowance bucket. The debit
 * and refund halves live in `GenerationCreditsService`, which calls the
 * transaction helpers above.
 */
@Injectable()
export class GenerationAllowanceService {
  /** `ARTIST_PRO_MONTHLY_ALLOWANCE_CENTS`, default 300 (= $3.00); 0 disables grants. */
  readonly monthlyAllowanceCents: number;

  constructor(@Optional() configService?: ConfigService) {
    const raw = configService
      ? configService.get<string | number>(ARTIST_PRO_MONTHLY_ALLOWANCE_ENV)
      : process.env[ARTIST_PRO_MONTHLY_ALLOWANCE_ENV];
    this.monthlyAllowanceCents = resolveMonthlyAllowanceCents(raw);
  }

  /**
   * Credit the allowance a paid Artist Pro invoice buys (called from the
   * Stripe `invoice.paid` webhook, after the subscription row is updated).
   * One grant row per month of the paid period: one for a monthly invoice,
   * twelve for an annual one. Idempotent per invoice (`stripeInvoiceId`,
   * `sliceIndex`) and per month (`userId`, `periodStart`), so a redelivered
   * event or a second invoice for the same period grants nothing more.
   * Unknown subscriptions and invoices that open no period are skipped and
   * logged, never guessed.
   */
  async grantForInvoice(invoice: StripeInvoice): Promise<AllowanceGrantOutcome> {
    const period = invoiceAllowancePeriod(invoice);
    if (!period.grant) return `skipped_${period.reason}`;
    if (this.monthlyAllowanceCents <= 0) return "disabled";

    const subscription = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: period.stripeSubscriptionId },
      select: { id: true, userId: true },
    });
    if (!subscription) {
      writeStructuredLog({
        level: "warn",
        event: "billing.allowance_unknown_subscription",
        message: "billing.allowance_unknown_subscription",
      });
      return "skipped_unknown_subscription";
    }

    const slices = monthlySlices(period.periodStart, period.periodEnd);
    const { count } = await prisma.generationAllowanceGrant.createMany({
      data: slices.map((slice) => ({
        userId: subscription.userId,
        subscriptionId: subscription.id,
        stripeInvoiceId: period.invoiceId,
        sliceIndex: slice.sliceIndex,
        amountCents: this.monthlyAllowanceCents,
        periodStart: slice.periodStart,
        expiresAt: slice.expiresAt,
      })),
      skipDuplicates: true,
    });
    writeStructuredLog({
      level: "info",
      event: count > 0 ? "billing.allowance_granted" : "billing.allowance_duplicate",
      message: count > 0 ? "billing.allowance_granted" : "billing.allowance_duplicate",
      subscriptionRowId: subscription.id,
      slices: count,
      amountCents: count * this.monthlyAllowanceCents,
    });
    return count > 0 ? "granted" : "duplicate";
  }

  /** The person's allowance status at `now`, or null when they never had one. */
  getStatus(userId: string, now: Date = new Date()): Promise<GenerationAllowanceStatus | null> {
    return readAllowanceStatus(prisma, userId, now);
  }

  /**
   * Allowance spent (net of refunds, in cents) from grants of `subscriptionId`
   * whose month starts in `[periodStart, periodEnd)`. The withdrawal refund
   * (RFC artist-pro §9, consent text `subscription/v1`) deducts this value of
   * the allowance already used; allowance itself is never refunded in cash.
   */
  async spentInBillingPeriodCents(subscriptionId: string, periodStart: Date, periodEnd: Date): Promise<number> {
    const result = await prisma.generationAllowanceGrant.aggregate({
      where: { subscriptionId, periodStart: { gte: periodStart, lt: periodEnd } },
      _sum: { consumedCents: true },
    });
    return result._sum.consumedCents ?? 0;
  }

  /** {@link spentInBillingPeriodCents} for the person's current billing period; 0 without one. */
  async spentThisBillingPeriodCents(userId: string): Promise<number> {
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
      select: { id: true, currentPeriodStart: true, currentPeriodEnd: true },
    });
    if (!subscription?.currentPeriodStart || !subscription.currentPeriodEnd) return 0;
    return this.spentInBillingPeriodCents(
      subscription.id,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
    );
  }
}
