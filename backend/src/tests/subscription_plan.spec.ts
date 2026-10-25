/**
 * The plan a Stripe subscription gives (#2407): active and trialing are Pro
 * until the period end, past due keeps Pro for 7 days, canceled at period end
 * keeps Pro until that end, and nothing else is Pro.
 */
import {
  PAST_DUE_GRACE_MS,
  SUBSCRIPTION_RENEWAL_SLACK_MS,
  pastDueGraceEndsAt,
  planFromSubscription,
  type SubscriptionPlanInput,
} from "../modules/entitlements/subscription_plan";
import { decideEntitlement, ENTITLEMENTS_POLICY } from "../modules/entitlements/entitlements.policy";

const NOW = new Date("2026-10-25T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY);

function sub(overrides: Partial<SubscriptionPlanInput> = {}): SubscriptionPlanInput {
  return { status: "active", currentPeriodEnd: at(20), cancelAtPeriodEnd: false, pastDueSince: null, ...overrides };
}

describe("planFromSubscription (#2407)", () => {
  it("is free with no subscription", () => {
    expect(planFromSubscription(null, NOW)).toEqual({ plan: "free" });
  });

  it.each(["active", "trialing"])("gives Pro until the period end when %s", (status) => {
    expect(planFromSubscription(sub({ status }), NOW)).toEqual({
      plan: "pro",
      source: "stripe_subscription",
      validUntil: at(20).toISOString(),
    });
  });

  it("keeps an active row through a late renewal, but not past the slack", () => {
    expect(planFromSubscription(sub({ currentPeriodEnd: at(-1) }), NOW).plan).toBe("pro");
    const stale = new Date(NOW.getTime() - SUBSCRIPTION_RENEWAL_SLACK_MS);
    expect(planFromSubscription(sub({ currentPeriodEnd: stale }), NOW)).toEqual({ plan: "free" });
  });

  describe("past due: 7 days of grace from pastDueSince", () => {
    it("is Pro until exactly 7 days after the failure, with that end as validUntil", () => {
      const since = at(-6.9);
      const result = planFromSubscription(sub({ status: "past_due", pastDueSince: since }), NOW);
      expect(result).toEqual({
        plan: "pro",
        source: "stripe_subscription",
        validUntil: new Date(since.getTime() + PAST_DUE_GRACE_MS).toISOString(),
      });
      expect(PAST_DUE_GRACE_MS).toBe(7 * DAY);
    });

    it("is free at and after 7 days", () => {
      expect(planFromSubscription(sub({ status: "past_due", pastDueSince: at(-7) }), NOW)).toEqual({ plan: "free" });
      expect(planFromSubscription(sub({ status: "past_due", pastDueSince: at(-30) }), NOW)).toEqual({ plan: "free" });
    });

    it("falls back to the period end when the failure date is unknown", () => {
      expect(pastDueGraceEndsAt(sub({ status: "past_due", currentPeriodEnd: at(-2) }))).toEqual(at(5));
      expect(pastDueGraceEndsAt(sub())).toBeNull();
    });
  });

  it("keeps Pro after cancellation at period end until that end, and no longer", () => {
    expect(planFromSubscription(sub({ status: "canceled", cancelAtPeriodEnd: true }), NOW)).toMatchObject({
      plan: "pro",
      validUntil: at(20).toISOString(),
    });
    expect(
      planFromSubscription(sub({ status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: at(-1) }), NOW),
    ).toEqual({ plan: "free" });
    expect(planFromSubscription(sub({ status: "canceled" }), NOW)).toEqual({ plan: "free" });
  });

  it.each(["incomplete", "incomplete_expired", "unpaid", "paused"])("is free when %s", (status) => {
    expect(planFromSubscription(sub({ status }), NOW)).toEqual({ plan: "free" });
  });

  it("still allows every feature for everyone under the current policy, with the plan recorded", () => {
    const decision = decideEntitlement("remix.pro", planFromSubscription(sub(), NOW), ENTITLEMENTS_POLICY);
    expect(decision).toMatchObject({ allowed: true, reason: "free_for_everyone", plan: "pro", source: "stripe_subscription" });
    const gated = decideEntitlement("remix.pro", planFromSubscription(sub(), NOW), { version: "test", rule: "plan" });
    expect(gated).toMatchObject({ allowed: true, reason: "plan" });
  });
});
