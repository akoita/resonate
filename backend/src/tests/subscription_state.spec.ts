/**
 * Pure Stripe webhook state rules (#2407): what is mirrored from a subscription
 * object, and why an older event never overwrites a newer state.
 */
import {
  decideSubscriptionApply,
  nextPastDueSince,
  snapshotFromStripeSubscription,
  type StoredSubscription,
} from "../modules/billing/subscription_state";
import type { StripeSubscription } from "../modules/billing/stripe_gateway";

const T = (iso: string) => new Date(iso);
const s = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function stripeSub(overrides: Record<string, unknown> = {}, item: Record<string, unknown> = {}): StripeSubscription {
  return {
    id: "sub_1",
    object: "subscription",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: { userId: "user-1" },
    items: {
      data: [
        {
          current_period_start: s("2026-10-01T00:00:00Z"),
          current_period_end: s("2026-11-01T00:00:00Z"),
          price: { recurring: { interval: "month" } },
          ...item,
        },
      ],
    },
    ...overrides,
  } as unknown as StripeSubscription;
}

function stored(overrides: Partial<StoredSubscription> = {}): StoredSubscription {
  return {
    stripeSubscriptionId: "sub_1",
    status: "active",
    currentPeriodEnd: T("2026-11-01T00:00:00Z"),
    pastDueSince: null,
    lastEventCreatedAt: T("2026-10-10T00:00:00Z"),
    ...overrides,
  };
}

describe("snapshotFromStripeSubscription (#2407)", () => {
  it("reads the period from the subscription item (API 2026-09-30.endive)", () => {
    expect(snapshotFromStripeSubscription(stripeSub())).toEqual({
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
      status: "active",
      interval: "month",
      currentPeriodStart: T("2026-10-01T00:00:00Z"),
      currentPeriodEnd: T("2026-11-01T00:00:00Z"),
      cancelAtPeriodEnd: false,
      userIdHint: "user-1",
    });
  });

  it("accepts an expanded customer, a yearly price and cancel_at at the period end", () => {
    const snap = snapshotFromStripeSubscription(
      stripeSub(
        { customer: { id: "cus_2" }, cancel_at: s("2026-11-01T00:00:00Z") },
        { price: { recurring: { interval: "year" } } },
      ),
    );
    expect(snap).toMatchObject({ stripeCustomerId: "cus_2", interval: "year", cancelAtPeriodEnd: true });
  });

  it("returns null for an unknown status or a missing customer", () => {
    expect(snapshotFromStripeSubscription(stripeSub({ status: "something_new" }))).toBeNull();
    expect(snapshotFromStripeSubscription(stripeSub({ customer: null }))).toBeNull();
  });

  it("leaves the interval null for an interval the plan does not sell", () => {
    expect(snapshotFromStripeSubscription(stripeSub({}, { price: { recurring: { interval: "week" } } }))?.interval).toBeNull();
  });
});

describe("decideSubscriptionApply (#2407 ordering)", () => {
  const snap = { stripeSubscriptionId: "sub_1", status: "active" as const, currentPeriodEnd: T("2026-11-01T00:00:00Z") };

  it("applies to an empty row and to a newer event", () => {
    expect(decideSubscriptionApply(null, snap, T("2026-10-01T00:00:00Z"))).toEqual({ apply: true });
    expect(decideSubscriptionApply(stored(), snap, T("2026-10-11T00:00:00Z"))).toEqual({ apply: true });
  });

  it("skips an event created before the last applied one", () => {
    expect(decideSubscriptionApply(stored(), { ...snap, status: "past_due" }, T("2026-10-09T00:00:00Z"))).toEqual({
      apply: false,
      reason: "older_event",
    });
  });

  it("lets a state re-read from Stripe through even when the event itself is older", () => {
    expect(
      decideSubscriptionApply(stored(), { ...snap, status: "past_due" }, T("2026-10-09T00:00:00Z"), { fresh: true }),
    ).toEqual({ apply: true });
  });

  it("skips a snapshot whose period ends before the stored period end", () => {
    expect(
      decideSubscriptionApply(
        stored({ currentPeriodEnd: T("2026-12-01T00:00:00Z") }),
        snap,
        T("2026-10-11T00:00:00Z"),
        { fresh: true },
      ),
    ).toEqual({ apply: false, reason: "older_period" });
  });

  it("never reopens a canceled or expired subscription", () => {
    for (const status of ["canceled", "incomplete_expired"] as const) {
      expect(decideSubscriptionApply(stored({ status }), snap, T("2026-10-11T00:00:00Z"))).toEqual({
        apply: false,
        reason: "terminal",
      });
    }
  });

  it("does not let another subscription that ended (or never started) replace a live one", () => {
    const other = { ...snap, stripeSubscriptionId: "sub_old" };
    expect(decideSubscriptionApply(stored(), { ...other, status: "canceled" }, T("2026-10-11T00:00:00Z"))).toEqual({
      apply: false,
      reason: "other_subscription_ended",
    });
    expect(decideSubscriptionApply(stored(), { ...other, status: "incomplete" }, T("2026-10-11T00:00:00Z"))).toEqual({
      apply: false,
      reason: "other_subscription_ended",
    });
    // A new subscription after the old one ended replaces it.
    expect(
      decideSubscriptionApply(stored({ status: "canceled" }), other, T("2026-10-11T00:00:00Z")),
    ).toEqual({ apply: true });
  });

  it("in the same second, keeps the state that followed `incomplete`", () => {
    const same = T("2026-10-10T00:00:00Z");
    expect(decideSubscriptionApply(stored(), { ...snap, status: "incomplete" }, same)).toEqual({
      apply: false,
      reason: "incomplete_after_newer",
    });
    expect(decideSubscriptionApply(stored({ status: "incomplete" }), snap, same)).toEqual({ apply: true });
  });
});

describe("nextPastDueSince (#2407 grace start)", () => {
  const at = T("2026-10-12T00:00:00Z");
  it("starts the grace at the event and keeps it across repeated past-due events", () => {
    expect(nextPastDueSince(stored(), { stripeSubscriptionId: "sub_1", status: "past_due" }, at)).toEqual(at);
    const since = T("2026-10-11T00:00:00Z");
    expect(
      nextPastDueSince(stored({ status: "past_due", pastDueSince: since }), { stripeSubscriptionId: "sub_1", status: "past_due" }, at),
    ).toEqual(since);
    expect(
      nextPastDueSince(stored({ status: "past_due", pastDueSince: since }), { stripeSubscriptionId: "sub_1", status: "unpaid" }, at),
    ).toEqual(since);
  });

  it("clears it once the subscription is paid again, and never carries it to another subscription", () => {
    const since = T("2026-10-11T00:00:00Z");
    expect(
      nextPastDueSince(stored({ status: "past_due", pastDueSince: since }), { stripeSubscriptionId: "sub_1", status: "active" }, at),
    ).toBeNull();
    expect(
      nextPastDueSince(stored({ status: "past_due", pastDueSince: since }), { stripeSubscriptionId: "sub_2", status: "past_due" }, at),
    ).toEqual(at);
  });
});
