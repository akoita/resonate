import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../lib/api", () => ({
  ApiRequestError: class extends Error {},
  getBillingState: vi.fn(),
  openBillingPortal: vi.fn(),
  startSubscriptionCheckout: vi.fn(),
}));

import type { BillingState } from "../../lib/api";
import {
  ARTIST_PRO_PRICE_HEADLINE,
  PlanBillingView,
  planBillingKind,
  readBillingReturn,
  type PlanBillingViewProps,
} from "./PlanBilling";

const NOW = Date.parse("2026-10-25T12:00:00.000Z");

const consent = {
  version: "2026-10-25.subscription-draft-1",
  reviewStatus: "for_legal_review_before_production",
  heading: "Your subscription starts now",
  intro: "You can withdraw within 14 days.",
  acknowledgement: "I ask for my Artist Pro subscription to start now.",
  cancellation: "You can cancel at any time.",
  confirmation: "We record your choice.",
};

function billing(overrides: Partial<BillingState> = {}): BillingState {
  return {
    available: true,
    testMode: true,
    contactEmailConfirmed: true,
    hasBillingAccount: false,
    plan: { plan: "free" },
    subscription: null,
    consent,
    ...overrides,
  };
}

function sub(overrides: Partial<NonNullable<BillingState["subscription"]>> = {}): BillingState["subscription"] {
  return {
    status: "active",
    interval: "month",
    currentPeriodEnd: "2026-11-25T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    pastDueSince: null,
    graceEndsAt: null,
    ...overrides,
  };
}

function render(state: BillingState | null, props: Partial<PlanBillingViewProps> = {}) {
  return renderToStaticMarkup(
    <PlanBillingView
      billing={state}
      kind={planBillingKind(state, { now: NOW })}
      chosenInterval={null}
      acknowledged={false}
      {...props}
    />,
  );
}

describe("planBillingKind (#2407)", () => {
  it("maps every state", () => {
    expect(planBillingKind(null)).toBe("loading");
    expect(planBillingKind(null, { error: true })).toBe("error");
    expect(planBillingKind(billing({ available: false }))).toBe("unavailable");
    expect(planBillingKind(billing())).toBe("subscribe");
    expect(planBillingKind(billing({ subscription: sub() }))).toBe("active");
    expect(planBillingKind(billing({ subscription: sub({ status: "trialing" }) }))).toBe("active");
    expect(planBillingKind(billing({ subscription: sub({ cancelAtPeriodEnd: true }) }))).toBe("ending");
    expect(
      planBillingKind(billing({ subscription: sub({ status: "canceled", cancelAtPeriodEnd: true }) }), { now: NOW }),
    ).toBe("ending");
    expect(planBillingKind(billing({ subscription: sub({ status: "canceled" }) }))).toBe("subscribe");
    expect(planBillingKind(billing({ subscription: sub({ status: "past_due" }) }))).toBe("past_due");
    expect(planBillingKind(billing({ subscription: sub({ status: "unpaid" }) }))).toBe("unpaid");
    expect(planBillingKind(billing({ plan: { plan: "pro", source: "operator_grant" } }))).toBe("granted");
  });

  it("reads the Stripe return parameter", () => {
    expect(readBillingReturn("?section=usage&billing=success")).toBe("success");
    expect(readBillingReturn("?billing=cancel")).toBe("cancel");
    expect(readBillingReturn("?billing=portal")).toBe("portal");
    expect(readBillingReturn("?billing=other")).toBeNull();
    expect(readBillingReturn("")).toBeNull();
  });
});

describe("PlanBillingView (#2407)", () => {
  it("free: offers monthly and yearly with the price and the test-mode note, nothing pre-selected", () => {
    const html = render(billing());
    expect(html).toContain(ARTIST_PRO_PRICE_HEADLINE);
    expect(html).toContain("$14.99/month or yearly");
    expect(html).toContain("Subscribe monthly");
    expect(html).toContain("Subscribe yearly");
    expect(html).toContain("Test mode.");
    expect(html).toContain("no real card is");
    expect(html).not.toContain("Continue to secure checkout");
    expect(html).not.toContain("Manage billing");
  });

  it("consent step: shows the server wording with an unticked box and a disabled continue", () => {
    const html = render(billing(), { chosenInterval: "year" });
    expect(html).toContain("Your subscription starts now");
    expect(html).toContain("Artist Pro · Yearly");
    expect(html).toContain(consent.intro);
    expect(html).toContain(consent.acknowledgement);
    expect(html).toContain(consent.cancellation);
    expect(html).toContain("for legal review before production");
    expect(html).toMatch(/<input type="checkbox"\/>/);
    expect(html).not.toContain("checked");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue to secure checkout<\/button>/);
    expect(html).toContain("Nothing is ticked for you");
    expect(html).not.toContain("Subscribe monthly");
  });

  it("consent step: once ticked, the continue button is enabled", () => {
    const html = render(billing(), { chosenInterval: "month", acknowledged: true });
    expect(html).toContain('checked=""');
    expect(html).toMatch(/<button class="ui-btn ui-btn-primary" type="button">Continue to secure checkout<\/button>/);
    expect(html).not.toContain("Nothing is ticked for you");
  });

  it("free without a confirmed contact email: links to the email settings instead of a dead button", () => {
    const html = render(billing({ contactEmailConfirmed: false }));
    expect(html).toContain("Subscribing needs a confirmed contact email");
    expect(html).toContain('href="/settings?section=email"');
    expect(html).not.toContain("Subscribe monthly");
  });

  it("billing unavailable: says so, with no button", () => {
    const html = render(billing({ available: false }));
    expect(html).toContain("Subscriptions are not available on this server yet");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Test mode.");
  });

  it("active: status, renewal date and Manage billing", () => {
    const html = render(billing({ hasBillingAccount: true, subscription: sub(), plan: { plan: "pro", source: "stripe_subscription" } }));
    expect(html).toContain("Artist Pro · Monthly");
    expect(html).toContain("active.");
    expect(html).toContain("Renews on Nov 25, 2026");
    expect(html).toContain("Manage billing");
    expect(html).not.toContain("Subscribe monthly");
  });

  it("canceled at period end: says when Pro ends", () => {
    const html = render(billing({ hasBillingAccount: true, subscription: sub({ cancelAtPeriodEnd: true }) }));
    expect(html).toContain("canceled.");
    expect(html).toContain("Pro stays on until Nov 25, 2026");
    expect(html).toContain("Manage billing");
  });

  it("past due: a clear payment-failed alert with the grace end and the card update", () => {
    const html = render(
      billing({
        hasBillingAccount: true,
        subscription: sub({ status: "past_due", pastDueSince: "2026-10-24T00:00:00.000Z", graceEndsAt: "2026-10-31T00:00:00.000Z" }),
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Your last payment failed — update your card.");
    expect(html).toContain("Artist Pro stays on until Oct 31, 2026");
    expect(html).toContain("Update your card");
  });

  it("unpaid: Pro has ended, with the card update", () => {
    const html = render(billing({ hasBillingAccount: true, subscription: sub({ status: "unpaid" }) }));
    expect(html).toContain("Artist Pro has ended");
    expect(html).toContain("Update your card");
  });

  it("granted Pro: no subscription offer and no test-mode note", () => {
    const html = render(billing({ plan: { plan: "pro", source: "promo" } }));
    expect(html).not.toContain("Subscribe monthly");
    expect(html).not.toContain("Test mode.");
  });

  it("loading, error with Retry, and the return notice", () => {
    expect(render(null)).toContain("Loading subscription");
    const error = renderToStaticMarkup(
      <PlanBillingView billing={null} kind="error" chosenInterval={null} acknowledged={false} />,
    );
    expect(error).toContain("Could not load your subscription");
    expect(error).toContain("Retry");
    expect(render(billing(), { returnNotice: "Checkout canceled. Nothing was charged." })).toContain(
      "Checkout canceled. Nothing was charged.",
    );
  });
});
