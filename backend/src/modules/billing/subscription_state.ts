/**
 * Pure webhook state rules for Stripe subscriptions (#2407,
 * `docs/rfc/artist-pro.md` §6). No database, no SDK calls.
 *
 * - {@link snapshotFromStripeSubscription} reads the fields we mirror from a
 *   Stripe subscription object (pinned API version `2026-09-30.endive`, where
 *   the billing period lives on the subscription item).
 * - {@link decideSubscriptionApply} decides whether a snapshot may overwrite
 *   the stored row, so an older event never overwrites a newer state:
 *     1. an event created before the last applied one is stale;
 *     2. for the same subscription, a snapshot whose period ends before the
 *        stored period end is stale;
 *     3. a canceled or expired subscription is final: nothing reopens it;
 *     4. a different subscription of the same customer that has ended, or is
 *        still `incomplete`, never replaces a live one;
 *     5. in the same second, an `incomplete` snapshot never replaces the
 *        state that followed it.
 *   A snapshot re-read from Stripe while handling the event (`fresh`) is the
 *   current state, so rule 1 does not apply to it; the others still do.
 * - {@link nextPastDueSince} keeps the start of the 7-day grace stable across
 *   repeated past-due events.
 */

import type { SubscriptionStatus } from "@prisma/client";
import type { BillingInterval } from "./billing_config";
import type { StripeSubscription } from "./stripe_gateway";

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
];

/** Statuses after which Stripe never reactivates the subscription. */
const TERMINAL: ReadonlySet<SubscriptionStatus> = new Set(["canceled", "incomplete_expired"]);
/** Statuses of a subscription that still exists and bills (or tries to). */
const LIVE: ReadonlySet<SubscriptionStatus> = new Set(["trialing", "active", "past_due", "unpaid", "paused"]);

export function isLiveStatus(status: SubscriptionStatus): boolean {
  return LIVE.has(status);
}

export function isTerminalStatus(status: SubscriptionStatus): boolean {
  return TERMINAL.has(status);
}

export type SubscriptionSnapshot = {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: SubscriptionStatus;
  /** Null for an interval this plan does not sell (the stored one is kept). */
  interval: BillingInterval | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** `metadata.userId` set at checkout, when present. */
  userIdHint: string | null;
};

export type StoredSubscription = {
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
  lastEventCreatedAt: Date | null;
};

export type ApplyDecision =
  | { apply: true }
  | {
      apply: false;
      reason: "older_event" | "older_period" | "terminal" | "other_subscription_ended" | "incomplete_after_newer";
    };

function seconds(value: number | null | undefined): Date | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null;
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id ?? null;
}

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === "string" && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/** The mirrored fields, or null when the object lacks an id, a customer or a known status. */
export function snapshotFromStripeSubscription(sub: StripeSubscription): SubscriptionSnapshot | null {
  const customer = idOf(sub.customer as string | { id: string } | null);
  if (!sub.id || !customer || !isSubscriptionStatus(sub.status)) return null;
  const item = sub.items?.data?.[0];
  const recurring: string | undefined = item?.price?.recurring?.interval;
  const currentPeriodEnd = seconds(item?.current_period_end);
  const cancelAt = seconds(sub.cancel_at);
  const cancelAtPeriodEnd =
    sub.cancel_at_period_end === true ||
    Boolean(cancelAt && currentPeriodEnd && cancelAt.getTime() <= currentPeriodEnd.getTime());
  const userIdHint = typeof sub.metadata?.userId === "string" && sub.metadata.userId ? sub.metadata.userId : null;
  return {
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customer,
    status: sub.status,
    interval: recurring === "month" ? "month" : recurring === "year" ? "year" : null,
    currentPeriodStart: seconds(item?.current_period_start),
    currentPeriodEnd,
    cancelAtPeriodEnd,
    userIdHint,
  };
}

export function decideSubscriptionApply(
  stored: StoredSubscription | null,
  snapshot: Pick<SubscriptionSnapshot, "stripeSubscriptionId" | "status" | "currentPeriodEnd">,
  eventCreatedAt: Date,
  options: { fresh?: boolean } = {},
): ApplyDecision {
  if (!stored) return { apply: true };
  const last = stored.lastEventCreatedAt?.getTime() ?? null;
  const created = eventCreatedAt.getTime();
  if (!options.fresh && last !== null && created < last) return { apply: false, reason: "older_event" };

  const sameSubscription = stored.stripeSubscriptionId === snapshot.stripeSubscriptionId;
  if (sameSubscription) {
    if (isTerminalStatus(stored.status) && !isTerminalStatus(snapshot.status)) {
      return { apply: false, reason: "terminal" };
    }
    if (
      stored.currentPeriodEnd &&
      snapshot.currentPeriodEnd &&
      snapshot.currentPeriodEnd.getTime() < stored.currentPeriodEnd.getTime()
    ) {
      return { apply: false, reason: "older_period" };
    }
    if (
      !options.fresh &&
      last !== null &&
      created === last &&
      snapshot.status === "incomplete" &&
      stored.status !== "incomplete"
    ) {
      return { apply: false, reason: "incomplete_after_newer" };
    }
    return { apply: true };
  }

  if (stored.stripeSubscriptionId && isLiveStatus(stored.status)) {
    if (isTerminalStatus(snapshot.status) || snapshot.status === "incomplete") {
      return { apply: false, reason: "other_subscription_ended" };
    }
  }
  return { apply: true };
}

/** When the 7-day grace started: kept while the same subscription stays past due or unpaid. */
export function nextPastDueSince(
  stored: StoredSubscription | null,
  snapshot: Pick<SubscriptionSnapshot, "stripeSubscriptionId" | "status">,
  eventCreatedAt: Date,
): Date | null {
  const same = stored?.stripeSubscriptionId === snapshot.stripeSubscriptionId;
  const carried = same && stored?.pastDueSince ? stored.pastDueSince : null;
  if (snapshot.status === "past_due") return carried ?? eventCreatedAt;
  if (snapshot.status === "unpaid") return carried ?? eventCreatedAt;
  return null;
}
