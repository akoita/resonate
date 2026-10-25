/**
 * Stripe webhook handling (#2407, `docs/rfc/artist-pro.md` §6).
 *
 * - **Verified:** the signature over the raw body is checked with
 *   `STRIPE_WEBHOOK_SECRET` before anything is read (400 otherwise).
 * - **Idempotent:** each event id is recorded in `StripeEvent`; an event
 *   already processed is acknowledged and skipped. An event received but not
 *   processed (the handler failed) is applied again on Stripe's retry.
 * - **Ordered:** `subscription_state.ts` decides whether a snapshot may
 *   overwrite the stored row, so an older event never overwrites a newer one.
 * - **Handled:** `checkout.session.completed`,
 *   `customer.subscription.created|updated|deleted`, `invoice.paid` and
 *   `invoice.payment_failed`. One-time (`mode: payment`) sessions,
 *   `checkout.session.async_payment_succeeded` and `charge.refunded` are credit
 *   packs (#1422), handed to `CreditTopUpService`. Checkout and invoice events re-read the
 *   subscription from Stripe, so the row mirrors the current state rather than
 *   the event's partial view.
 *
 * Logs carry the event id and type only: never a payload, an email, a card
 * detail or a customer id.
 */

import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma, type Subscription } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { writeStructuredLog } from "../shared/structured_logging";
import { BillingConfig } from "./billing_config";
import { CreditTopUpService } from "./credit_topup.service";
import {
  STRIPE_GATEWAY,
  type StripeCharge,
  type StripeCheckoutSession,
  type StripeEvent,
  type StripeGateway,
  type StripeInvoice,
  type StripeSubscription,
} from "./stripe_gateway";
import {
  decideSubscriptionApply,
  nextPastDueSince,
  snapshotFromStripeSubscription,
  type SubscriptionSnapshot,
} from "./subscription_state";

export const HANDLED_STRIPE_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  // Credit packs (#1422).
  "checkout.session.async_payment_succeeded",
  "charge.refunded",
] as const;

export type WebhookResult = {
  received: true;
  duplicate?: true;
  outcome?: string;
};

export type ApplyOutcome =
  | "applied"
  | "created"
  | "ignored_unknown_customer"
  | "ignored_customer_mismatch"
  | "ignored_unparseable"
  | `skipped_${string}`;

const MAX_APPLY_ATTEMPTS = 3;

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown>) {
  writeStructuredLog({ level, event, message: event, ...fields });
}

@Injectable()
export class StripeWebhookService {
  constructor(
    private readonly config: BillingConfig,
    @Optional() @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway | null = null,
    @Optional() private readonly topUps: CreditTopUpService | null = null,
  ) {}

  /** Whether the webhook can verify events (billing configured). */
  isAvailable(): boolean {
    return Boolean(this.gateway) && this.config.isAvailable() && Boolean(this.config.webhookSecret);
  }

  /** The verified event, or 400 `invalid_signature`. */
  verify(rawBody: Buffer | undefined, signature: unknown): StripeEvent {
    if (!this.gateway || !rawBody || typeof signature !== "string" || !signature) {
      throw new BadRequestException({ code: "invalid_signature", message: "Invalid signature" });
    }
    try {
      return this.gateway.constructEvent(rawBody, signature, this.config.webhookSecret);
    } catch {
      throw new BadRequestException({ code: "invalid_signature", message: "Invalid signature" });
    }
  }

  async handle(event: StripeEvent, now: Date = new Date()): Promise<WebhookResult> {
    const existing = await prisma.stripeEvent.findUnique({ where: { eventId: event.id } });
    if (existing?.processedAt) return { received: true, duplicate: true };
    if (!existing) {
      try {
        await prisma.stripeEvent.create({ data: { eventId: event.id, type: event.type, receivedAt: now } });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const raced = await prisma.stripeEvent.findUnique({ where: { eventId: event.id } });
        if (raced?.processedAt) return { received: true, duplicate: true };
      }
    }

    let outcome: string;
    if (event.livemode && this.config.testMode) {
      // A live event reaching a test deployment is never applied.
      outcome = "ignored_livemode";
      log("warn", "billing.webhook_livemode_ignored", { eventId: event.id, type: event.type });
    } else {
      outcome = await this.dispatch(event);
    }

    await prisma.stripeEvent.update({ where: { eventId: event.id }, data: { processedAt: new Date() } });
    log("info", "billing.webhook_processed", { eventId: event.id, type: event.type, outcome });
    return { received: true, outcome };
  }

  private async dispatch(event: StripeEvent): Promise<string> {
    const createdAt = new Date(event.created * 1000);
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as StripeCheckoutSession;
        if (session.mode === "payment") return this.topUps?.fulfilFromCheckout(session, createdAt) ?? "ignored_unavailable";
        if (session.mode !== "subscription") return "ignored_not_subscription";
        const subscriptionId = idOf(session.subscription);
        if (!subscriptionId) return "ignored_no_subscription";
        const userIdHint = session.client_reference_id || session.metadata?.userId || null;
        return this.applyFromStripe(subscriptionId, createdAt, userIdHint);
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const snapshot = snapshotFromStripeSubscription(event.data.object as StripeSubscription);
        if (!snapshot) return "ignored_unparseable";
        return this.applySnapshot(snapshot, createdAt, { fresh: false });
      }
      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as StripeInvoice;
        const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
        if (!subscriptionId) return "ignored_no_subscription";
        // #2408: `invoice.paid` is where the monthly allowance will be granted.
        return this.applyFromStripe(subscriptionId, createdAt, null);
      }
      case "checkout.session.async_payment_succeeded":
        return (
          this.topUps?.fulfilFromCheckout(event.data.object as StripeCheckoutSession, createdAt) ?? "ignored_unavailable"
        );
      case "charge.refunded":
        return this.topUps?.reverseFromRefund(event.data.object as StripeCharge) ?? "ignored_unavailable";
      default:
        return "ignored_unhandled_type";
    }
  }

  /** Re-read the subscription from Stripe and apply its current state. */
  private async applyFromStripe(subscriptionId: string, createdAt: Date, userIdHint: string | null) {
    if (!this.gateway) return "ignored_unavailable";
    const sub = await this.gateway.retrieveSubscription(subscriptionId);
    const snapshot = snapshotFromStripeSubscription(sub);
    if (!snapshot) return "ignored_unparseable";
    return this.applySnapshot(
      { ...snapshot, userIdHint: snapshot.userIdHint ?? userIdHint },
      createdAt,
      { fresh: true },
    );
  }

  /**
   * Apply one snapshot to the customer's row. The row is found by Stripe
   * customer id (one customer per person). A conditional update on
   * `updatedAt` makes two concurrent deliveries re-decide against each
   * other's result instead of overwriting it.
   */
  async applySnapshot(
    snapshot: SubscriptionSnapshot,
    eventCreatedAt: Date,
    options: { fresh: boolean },
  ): Promise<ApplyOutcome> {
    for (let attempt = 0; attempt < MAX_APPLY_ATTEMPTS; attempt += 1) {
      const row = await prisma.subscription.findUnique({ where: { stripeCustomerId: snapshot.stripeCustomerId } });
      if (!row) return this.adopt(snapshot, eventCreatedAt);
      if (snapshot.userIdHint && snapshot.userIdHint !== row.userId) {
        log("warn", "billing.webhook_user_hint_mismatch", { subscriptionRowId: row.id });
      }
      const decision = decideSubscriptionApply(row, snapshot, eventCreatedAt, options);
      if (!decision.apply) return `skipped_${decision.reason}`;
      const lastEventCreatedAt =
        row.lastEventCreatedAt && row.lastEventCreatedAt.getTime() > eventCreatedAt.getTime()
          ? row.lastEventCreatedAt
          : eventCreatedAt;
      const { count } = await prisma.subscription.updateMany({
        where: { id: row.id, updatedAt: row.updatedAt },
        data: {
          ...this.mirroredFields(row, snapshot, eventCreatedAt),
          lastEventCreatedAt,
        },
      });
      if (count === 1) return "applied";
    }
    throw new Error("Subscription row changed concurrently; Stripe will retry the event");
  }

  private mirroredFields(row: Subscription | null, snapshot: SubscriptionSnapshot, eventCreatedAt: Date) {
    return {
      stripeSubscriptionId: snapshot.stripeSubscriptionId,
      status: snapshot.status,
      interval: snapshot.interval ?? row?.interval ?? "month",
      currentPeriodStart: snapshot.currentPeriodStart,
      currentPeriodEnd: snapshot.currentPeriodEnd,
      cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
      pastDueSince: nextPastDueSince(row, snapshot, eventCreatedAt),
    };
  }

  /**
   * A customer with no row: only adopted when the checkout metadata names a
   * live account that has no billing row yet. Anything else is logged and
   * acknowledged, never guessed.
   */
  private async adopt(snapshot: SubscriptionSnapshot, eventCreatedAt: Date): Promise<ApplyOutcome> {
    const userId = snapshot.userIdHint;
    if (!userId) {
      log("warn", "billing.webhook_unknown_customer", {});
      return "ignored_unknown_customer";
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, erasedAt: true } });
    if (!user || user.erasedAt) {
      log("warn", "billing.webhook_unknown_customer", {});
      return "ignored_unknown_customer";
    }
    const existing = await prisma.subscription.findUnique({ where: { userId }, select: { id: true } });
    if (existing) {
      log("warn", "billing.webhook_customer_mismatch", { subscriptionRowId: existing.id });
      return "ignored_customer_mismatch";
    }
    try {
      await prisma.subscription.create({
        data: {
          userId,
          stripeCustomerId: snapshot.stripeCustomerId,
          ...this.mirroredFields(null, snapshot, eventCreatedAt),
          lastEventCreatedAt: eventCreatedAt,
        },
      });
      return "created";
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error("Subscription row created concurrently; Stripe will retry the event");
      throw error;
    }
  }
}
