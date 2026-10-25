/**
 * The plan a Stripe subscription gives (#2407, `docs/rfc/artist-pro.md` §4).
 *
 * {@link planFromSubscription} is pure: given the person's `Subscription` row,
 * what it is worth at `now`. {@link SubscriptionPlanService} reads the row.
 *
 * - `active` or `trialing`: `pro` until the current period end. A period end
 *   more than {@link SUBSCRIPTION_RENEWAL_SLACK_MS} in the past means the
 *   renewal webhook never arrived; the row is stale and gives `free`, so a
 *   broken webhook can never leave Pro on forever.
 * - `past_due`: `pro` for {@link PAST_DUE_GRACE_DAYS} days from `pastDueSince`
 *   (RFC §9 decision 6), then `free`. Nothing is deleted.
 * - `canceled` with `cancelAtPeriodEnd`: `pro` until the period end.
 * - anything else (`incomplete`, `incomplete_expired`, `unpaid`, `paused`, an
 *   immediate cancellation): `free`.
 */

import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import type { PlanResolution } from "./entitlements.policy";
import { FREE_PLAN } from "./entitlements.policy";

export const PAST_DUE_GRACE_DAYS = 7;
export const PAST_DUE_GRACE_MS = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;

/** How long after the period end an `active` row is still trusted while the renewal event is in flight. */
export const SUBSCRIPTION_RENEWAL_SLACK_MS = 3 * 24 * 60 * 60 * 1000;

export type SubscriptionPlanInput = {
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: Date | null;
  updatedAt?: Date | null;
};

/** When the past-due grace ends, or null when the row is not past due. */
export function pastDueGraceEndsAt(sub: SubscriptionPlanInput): Date | null {
  if (sub.status !== "past_due") return null;
  const since = sub.pastDueSince ?? sub.currentPeriodEnd ?? sub.updatedAt ?? null;
  return since ? new Date(since.getTime() + PAST_DUE_GRACE_MS) : null;
}

function pro(validUntil: Date | null): PlanResolution {
  return {
    plan: "pro",
    source: "stripe_subscription",
    ...(validUntil ? { validUntil: validUntil.toISOString() } : {}),
  };
}

export function planFromSubscription(sub: SubscriptionPlanInput | null | undefined, now: Date): PlanResolution {
  if (!sub) return FREE_PLAN;
  const t = now.getTime();
  const end = sub.currentPeriodEnd;
  switch (sub.status) {
    case "active":
    case "trialing":
      if (end && end.getTime() + SUBSCRIPTION_RENEWAL_SLACK_MS <= t) return FREE_PLAN;
      return pro(end);
    case "past_due": {
      const graceEnd = pastDueGraceEndsAt(sub);
      if (!graceEnd || graceEnd.getTime() <= t) return FREE_PLAN;
      return pro(graceEnd);
    }
    case "canceled":
      if (sub.cancelAtPeriodEnd && end && end.getTime() > t) return pro(end);
      return FREE_PLAN;
    default:
      return FREE_PLAN;
  }
}

/**
 * Reads the person's `Subscription` row (one indexed read on the unique
 * `userId`) and turns it into a plan. Injected into `EntitlementsService` so
 * unit tests replace it; Postgres tests use it for real.
 */
@Injectable()
export class SubscriptionPlanService {
  async resolvePlan(userId: string, now: Date = new Date()): Promise<PlanResolution> {
    if (!userId) return FREE_PLAN;
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
      select: { status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, pastDueSince: true, updatedAt: true },
    });
    return planFromSubscription(subscription, now);
  }
}
