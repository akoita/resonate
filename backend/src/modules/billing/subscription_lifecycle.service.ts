/**
 * What an account's lifecycle does to its Artist Pro subscription at Stripe
 * (#2430). ADR-BM-6 revenue line 2 (Artist Pro), Phase 2: correctness and
 * trust fixes that must land before live charging (#2409).
 *
 * - **Erasure and operator closure cancel immediately**, with no proration
 *   credit and no final invoice: a closed or erased account cannot use the rest
 *   of the period, and a period-end cancellation would only leave a live
 *   subscription behind an account that no longer exists. The refund policy
 *   states what a person gets back; nothing extra is refunded here.
 *   {@link endForAccount} records the request on the row first
 *   (`endReason`, `endRequestedAt`, `endAttempts`), then cancels, and sets
 *   `endConfirmedAt` only once Stripe answers with a canceled subscription.
 *   Until then it throws {@link SubscriptionCancellationPendingError}, so the
 *   erasure engine keeps the closure pending and retries on its next run.
 * - **A self-service closure request** (30-day window, cancelled by signing
 *   in) sets `cancel_at_period_end`, so no renewal is charged while the window
 *   runs; the erasure at the end of the window then cancels immediately.
 * - **Suspension pauses collection** (`pause_collection`, behavior `void`, and
 *   `resumes_at` set to the suspension's end when it has one): a suspended
 *   person is not charged for a service they cannot use. Lifting the
 *   suspension resumes collection.
 * - **The billing email follows the confirmed contact address**: confirming a
 *   new address marks the row `billingEmailStale` and pushes the address to
 *   the Stripe customer.
 *
 * Every Stripe call that fails is retried by {@link reconcile}, which the
 * retention job runs: it finds the rows whose Stripe state does not match the
 * account (an erased or closed account with a live subscription, a suspended
 * one still collecting, a reinstated one still paused, a pending closure with
 * renewal still on, a stale billing email) and repairs them.
 *
 * Logs carry the subscription row id, the reason and an error code only:
 * never an email, a Stripe id or a payload.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";
import { type Subscription, type SubscriptionEndReason, type SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { writeStructuredLog } from "../shared/structured_logging";
import { BillingConfig } from "./billing_config";
import { STRIPE_GATEWAY, createStripeGateway, type StripeGateway, type StripeSubscription } from "./stripe_gateway";
import { SUBSCRIPTION_STATUSES, isSubscriptionStatus, isTerminalStatus } from "./subscription_state";

/** Statuses of a subscription Stripe may still charge, including an `incomplete` first payment. */
export const CANCELLABLE_STATUSES: readonly SubscriptionStatus[] = SUBSCRIPTION_STATUSES.filter(
  (status) => !isTerminalStatus(status),
);
/** Statuses for which pausing or scheduling an end means something. */
const COLLECTING_STATUSES: readonly SubscriptionStatus[] = ["trialing", "active", "past_due", "unpaid"];

/** How long a processed Stripe event id is kept for idempotency. Far beyond Stripe's 3-day retry window. */
export const STRIPE_EVENT_RETENTION_DAYS = 90;
const STRIPE_EVENT_PRUNE_BATCH = 5_000;
const RECONCILE_BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Thrown while Stripe has not confirmed a cancellation; the caller retries later. */
export class SubscriptionCancellationPendingError extends Error {
  constructor(
    readonly subscriptionRowId: string,
    readonly code: string,
  ) {
    super(`Stripe has not confirmed the subscription cancellation yet (${code}); it is retried on the next run`);
    this.name = "SubscriptionCancellationPendingError";
  }
}

export type EndOutcome = "none" | "already_ended" | "canceled";
export type CollectionOutcome = "none" | "paused" | "resumed" | "deferred";
export type ScheduleOutcome = "none" | "scheduled" | "already_scheduled" | "deferred";
export type EmailSyncOutcome = "none" | "synced" | "deferred";

export type BillingReconcileResult = {
  /** False when Stripe is not configured: nothing could be repaired. */
  available: boolean;
  ended: number;
  paused: number;
  resumed: number;
  closureScheduled: number;
  billingContactsUpdated: number;
  failed: number;
};

/** A short, safe code for a failure: a Stripe error code or type, never its message. */
export function failureCode(error: unknown): string {
  if (error instanceof SubscriptionCancellationPendingError) return error.code;
  const value = error && typeof error === "object" ? (error as { code?: unknown; type?: unknown }) : {};
  const raw = typeof value.code === "string" && value.code ? value.code : typeof value.type === "string" ? value.type : "error";
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 64) || "error";
}

function isResourceMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "resource_missing");
}

function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown>) {
  writeStructuredLog({ level, event, message: event, ...fields });
}

@Injectable()
export class SubscriptionLifecycleService {
  constructor(
    private readonly config: BillingConfig,
    @Optional() @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway | null = null,
  ) {}

  private available(): boolean {
    return Boolean(this.gateway) && this.config.isAvailable();
  }

  // ============ Erasure and closure ============

  /**
   * Cancel the person's subscription at Stripe now, before their account is
   * erased or once it is closed. Idempotent: an ended or absent subscription
   * answers without calling Stripe. Throws
   * {@link SubscriptionCancellationPendingError} until Stripe confirms.
   */
  async endForAccount(userId: string, reason: SubscriptionEndReason, now: Date = new Date()): Promise<EndOutcome> {
    const row = await prisma.subscription.findUnique({ where: { userId } });
    return row ? this.endRow(row, reason, now) : "none";
  }

  private async endRow(row: Subscription, reason: SubscriptionEndReason, now: Date): Promise<EndOutcome> {
    const subscriptionId = row.stripeSubscriptionId;
    if (!subscriptionId) return "none";
    if (isTerminalStatus(row.status)) {
      if (row.endRequestedAt && !row.endConfirmedAt) {
        // Ended at Stripe (a webhook got there first): the request is satisfied.
        await prisma.subscription.update({ where: { id: row.id }, data: { endConfirmedAt: now, endLastError: null } });
      }
      return "already_ended";
    }

    const requested = await prisma.subscription.update({
      where: { id: row.id },
      data: {
        endReason: row.endReason ?? reason,
        endRequestedAt: row.endRequestedAt ?? now,
        endAttempts: { increment: 1 },
      },
    });

    let status: SubscriptionStatus;
    try {
      if (!this.available()) throw new SubscriptionCancellationPendingError(row.id, "billing_unavailable");
      const gateway = this.gateway as StripeGateway;
      let remote: StripeSubscription | null;
      try {
        remote = await gateway.retrieveSubscription(subscriptionId);
      } catch (error) {
        // Stripe has no such subscription: nothing there can charge anyone.
        if (!isResourceMissing(error)) throw error;
        remote = null;
      }
      if (remote && !isTerminalStatus(remote.status as SubscriptionStatus)) {
        remote = await gateway.cancelSubscription(subscriptionId, `resonate-cancel-${subscriptionId}`);
      }
      const answered = remote ? remote.status : "canceled";
      if (!isSubscriptionStatus(answered) || !isTerminalStatus(answered)) {
        throw new SubscriptionCancellationPendingError(row.id, "not_confirmed");
      }
      status = answered;
    } catch (error) {
      const code = failureCode(error);
      await prisma.subscription.update({ where: { id: row.id }, data: { endLastError: code } });
      log("warn", "billing.subscription_end_pending", {
        subscriptionRowId: row.id,
        reason: requested.endReason,
        attempts: requested.endAttempts,
        code,
      });
      throw error instanceof SubscriptionCancellationPendingError
        ? error
        : new SubscriptionCancellationPendingError(row.id, code);
    }

    await prisma.subscription.update({
      where: { id: row.id },
      data: {
        status,
        cancelAtPeriodEnd: false,
        pastDueSince: null,
        collectionPausedAt: null,
        endConfirmedAt: new Date(),
        endLastError: null,
      },
    });
    log("info", "billing.subscription_ended", {
      subscriptionRowId: row.id,
      reason: requested.endReason,
      attempts: requested.endAttempts,
    });
    return "canceled";
  }

  /**
   * A self-service closure was requested: stop renewals while its 30-day
   * window runs. Best effort here; {@link reconcile} retries. Signing in to
   * cancel the closure does not undo it: the person renews in the Customer
   * Portal if they want to keep Pro.
   */
  async scheduleEndForClosureRequest(userId: string, closureRequestId: string): Promise<ScheduleOutcome> {
    const row = await prisma.subscription.findUnique({ where: { userId } });
    if (!row || !row.stripeSubscriptionId || !COLLECTING_STATUSES.includes(row.status)) return "none";
    if (row.closureRequestId === closureRequestId) return "already_scheduled";
    if (!this.available()) return "deferred";
    try {
      await (this.gateway as StripeGateway).updateSubscription(row.stripeSubscriptionId, { cancel_at_period_end: true });
    } catch (error) {
      log("warn", "billing.subscription_closure_schedule_failed", { subscriptionRowId: row.id, code: failureCode(error) });
      return "deferred";
    }
    await prisma.subscription.update({
      where: { id: row.id },
      data: { cancelAtPeriodEnd: true, closureRequestId },
    });
    log("info", "billing.subscription_closure_scheduled", { subscriptionRowId: row.id });
    return "scheduled";
  }

  // ============ Suspension ============

  /** Pause collection while the account is suspended; Stripe resumes it at `until` when set. */
  async pauseForSuspension(userId: string, until: Date | null): Promise<CollectionOutcome> {
    const row = await prisma.subscription.findUnique({ where: { userId } });
    if (!row) return "none";
    return this.pauseRow(row, until);
  }

  private async pauseRow(row: Subscription, until: Date | null): Promise<CollectionOutcome> {
    if (!row.stripeSubscriptionId || !COLLECTING_STATUSES.includes(row.status)) return "none";
    if (!this.available()) return "deferred";
    try {
      await (this.gateway as StripeGateway).updateSubscription(row.stripeSubscriptionId, {
        pause_collection: { behavior: "void", ...(until ? { resumes_at: seconds(until) } : {}) },
      });
    } catch (error) {
      log("warn", "billing.subscription_pause_failed", { subscriptionRowId: row.id, code: failureCode(error) });
      return "deferred";
    }
    await prisma.subscription.update({ where: { id: row.id }, data: { collectionPausedAt: new Date() } });
    log("info", "billing.subscription_paused", { subscriptionRowId: row.id });
    return "paused";
  }

  /** Resume collection once the suspension is lifted. */
  async resumeAfterSuspension(userId: string): Promise<CollectionOutcome> {
    const row = await prisma.subscription.findUnique({ where: { userId } });
    if (!row) return "none";
    return this.resumeRow(row);
  }

  private async resumeRow(row: Subscription): Promise<CollectionOutcome> {
    if (!row.stripeSubscriptionId || isTerminalStatus(row.status)) {
      if (row.collectionPausedAt) {
        await prisma.subscription.update({ where: { id: row.id }, data: { collectionPausedAt: null } });
      }
      return "none";
    }
    if (!this.available()) return "deferred";
    try {
      // Clearing is safe when nothing is paused, so a lost earlier answer never strands a pause.
      await (this.gateway as StripeGateway).updateSubscription(row.stripeSubscriptionId, { pause_collection: "" });
    } catch (error) {
      log("warn", "billing.subscription_resume_failed", { subscriptionRowId: row.id, code: failureCode(error) });
      return "deferred";
    }
    await prisma.subscription.update({ where: { id: row.id }, data: { collectionPausedAt: null } });
    log("info", "billing.subscription_resumed", { subscriptionRowId: row.id });
    return "resumed";
  }

  // ============ Billing email ============

  /**
   * The confirmed contact address changed: mark the billing email stale and
   * push the current address to the Stripe customer. Best effort here;
   * {@link reconcile} retries while the row stays stale.
   */
  async syncCustomerEmail(userId: string): Promise<EmailSyncOutcome> {
    const { count } = await prisma.subscription.updateMany({ where: { userId }, data: { billingEmailStale: true } });
    if (count === 0) return "none";
    const row = await prisma.subscription.findUnique({ where: { userId } });
    return row ? this.syncRow(row) : "none";
  }

  private async syncRow(row: Subscription): Promise<EmailSyncOutcome> {
    const contact = await prisma.contactEmail.findUnique({
      where: { userId: row.userId },
      select: { status: true, address: true },
    });
    if (!contact || contact.status !== "confirmed") {
      // No confirmed address to send: Stripe keeps the last one it was given.
      await prisma.subscription.update({ where: { id: row.id }, data: { billingEmailStale: false } });
      return "none";
    }
    if (!this.available()) return "deferred";
    try {
      await (this.gateway as StripeGateway).updateCustomerEmail(row.stripeCustomerId, contact.address);
    } catch (error) {
      log("warn", "billing.customer_email_sync_failed", { subscriptionRowId: row.id, code: failureCode(error) });
      return "deferred";
    }
    await prisma.subscription.update({ where: { id: row.id }, data: { billingEmailStale: false } });
    log("info", "billing.customer_email_synced", { subscriptionRowId: row.id });
    return "synced";
  }

  // ============ The retention job ============

  /** Delete `StripeEvent` rows processed more than {@link STRIPE_EVENT_RETENTION_DAYS} ago, in one bounded batch. */
  async pruneStripeEvents(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - STRIPE_EVENT_RETENTION_DAYS * DAY_MS);
    const expired = await prisma.stripeEvent.findMany({
      where: { processedAt: { lt: cutoff } },
      select: { eventId: true },
      orderBy: { processedAt: "asc" },
      take: STRIPE_EVENT_PRUNE_BATCH,
    });
    if (expired.length === 0) return 0;
    const { count } = await prisma.stripeEvent.deleteMany({
      where: { eventId: { in: expired.map((event) => event.eventId) }, processedAt: { lt: cutoff } },
    });
    return count;
  }

  /**
   * Repair every row whose Stripe state does not match its account. Each row
   * is settled on its own, so one failure never strands the rest; failures
   * are counted and retried on the next run.
   */
  async reconcile(now: Date = new Date()): Promise<BillingReconcileResult> {
    const result: BillingReconcileResult = {
      available: this.available(),
      ended: 0,
      paused: 0,
      resumed: 0,
      closureScheduled: 0,
      billingContactsUpdated: 0,
      failed: 0,
    };

    // 1. Erased or closed accounts, and every requested end not yet confirmed.
    const toEnd = await prisma.subscription.findMany({
      where: {
        stripeSubscriptionId: { not: null },
        status: { in: [...CANCELLABLE_STATUSES] },
        OR: [
          { endRequestedAt: { not: null } },
          { user: { erasedAt: { not: null } } },
          { user: { accountStatus: "closed" } },
        ],
      },
      include: { user: { select: { erasedAt: true } } },
      take: RECONCILE_BATCH,
    });
    for (const row of toEnd) {
      try {
        const reason = row.endReason ?? (row.user.erasedAt ? "account_erasure" : "account_closure");
        if ((await this.endRow(row, reason, now)) === "canceled") result.ended += 1;
      } catch {
        result.failed += 1;
      }
    }

    // 2. Suspended accounts still collecting.
    const toPause = await prisma.subscription.findMany({
      where: {
        stripeSubscriptionId: { not: null },
        status: { in: [...COLLECTING_STATUSES] },
        collectionPausedAt: null,
        user: {
          accountStatus: "suspended",
          OR: [{ accountStatusUntil: null }, { accountStatusUntil: { gt: now } }],
        },
      },
      include: { user: { select: { accountStatusUntil: true } } },
      take: RECONCILE_BATCH,
    });
    for (const row of toPause) {
      const outcome = await this.pauseRow(row, row.user.accountStatusUntil);
      if (outcome === "paused") result.paused += 1;
      else if (outcome === "deferred") result.failed += 1;
    }

    // 3. Reinstated accounts (lifted, or a suspension past its end) still paused.
    const toResume = await prisma.subscription.findMany({
      where: {
        collectionPausedAt: { not: null },
        user: {
          OR: [{ accountStatus: "active" }, { accountStatus: "suspended", accountStatusUntil: { lte: now } }],
        },
      },
      take: RECONCILE_BATCH,
    });
    for (const row of toResume) {
      const outcome = await this.resumeRow(row);
      if (outcome === "resumed") result.resumed += 1;
      else if (outcome === "deferred") result.failed += 1;
    }

    // 4. Pending self-service closures whose renewal is still on.
    const toSchedule = await prisma.subscription.findMany({
      where: {
        stripeSubscriptionId: { not: null },
        status: { in: [...COLLECTING_STATUSES] },
        endRequestedAt: null,
        user: { accountClosureRequests: { some: { status: "pending" } } },
      },
      include: {
        user: { select: { accountClosureRequests: { where: { status: "pending" }, select: { id: true }, take: 1 } } },
      },
      take: RECONCILE_BATCH,
    });
    for (const row of toSchedule) {
      const pending = row.user.accountClosureRequests[0];
      if (!pending || row.closureRequestId === pending.id) continue;
      const outcome = await this.scheduleEndForClosureRequest(row.userId, pending.id);
      if (outcome === "scheduled") result.closureScheduled += 1;
      else if (outcome === "deferred") result.failed += 1;
    }

    // 5. Billing emails not yet pushed to Stripe.
    const stale = await prisma.subscription.findMany({ where: { billingEmailStale: true }, take: RECONCILE_BATCH });
    for (const row of stale) {
      const outcome = await this.syncRow(row);
      if (outcome === "synced") result.billingContactsUpdated += 1;
      else if (outcome === "deferred") result.failed += 1;
    }

    log(result.failed > 0 ? "warn" : "info", "billing.lifecycle_reconciled", { ...result });
    return result;
  }
}

/** For the scheduled jobs, which build services without Nest: the real gateway when billing is configured. */
export function createSubscriptionLifecycleFromEnv(env: NodeJS.ProcessEnv = process.env): SubscriptionLifecycleService {
  const config = new BillingConfig(env);
  return new SubscriptionLifecycleService(config, createStripeGateway(config));
}

