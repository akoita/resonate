import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../lib/api", () => ({
  ApiRequestError: class extends Error {},
  getCreditTopUpState: vi.fn(),
  startCreditCheckout: vi.fn(),
  deliverHeldCreditsNow: vi.fn(),
  getPurchaseConsentWording: vi.fn(),
  recordPurchaseConsent: vi.fn(),
}));

import type { CreditPurchase, CreditTopUpState } from "../../lib/api";
import { INITIAL_DELIVERY_CONSENT } from "../consent/deliveryConsent";
import {
  BuyCreditsView,
  buyCreditsKind,
  creditPackLabel,
  defaultPackId,
  describeCreditPurchase,
  findReturnedPurchase,
  readCreditsReturn,
  type BuyCreditsViewProps,
} from "./BuyCredits";

const consent = {
  version: "2026-10-24.draft-1",
  reviewStatus: "for_legal_review_before_production",
  heading: "Delivery and your right to withdraw",
  intro: "You can withdraw within 14 days.",
  deliverNow: { label: "Deliver now", description: "Right away.", acknowledgement: "I lose my right to withdraw." },
  wait: { label: "Wait 14 days", description: "Keep your right." },
  mint: { explanation: "Minting cannot be undone." },
  confirmation: "We confirm it in your notices.",
};

function purchase(overrides: Partial<CreditPurchase> = {}): CreditPurchase {
  return {
    id: "p1",
    packId: "credits_10",
    label: "$10 credit pack",
    priceCents: 1000,
    currency: "usd",
    creditsCents: 1000,
    delivery: "deliver_now",
    status: "credited",
    heldUntil: null,
    creditedAt: "2026-10-25T10:00:00.000Z",
    creditedCents: 1000,
    refundedCreditsCents: 0,
    reversedCents: 0,
    receiptRef: "pi_test_123",
    checkoutSessionId: "cs_test_1",
    paidAt: "2026-10-25T10:00:00.000Z",
    ...overrides,
  };
}

function state(overrides: Partial<CreditTopUpState> = {}): CreditTopUpState {
  return {
    available: true,
    testMode: true,
    contactEmailConfirmed: true,
    currencies: ["usd"],
    packs: [
      { id: "credits_5", prices: { usd: 500, eur: 500 }, creditsCents: 500, isDefault: false },
      { id: "credits_10", prices: { usd: 1000, eur: 1000 }, creditsCents: 1000, isDefault: true },
      { id: "credits_25", prices: { usd: 2500, eur: 2500 }, creditsCents: 2500, isDefault: false },
    ],
    defaultPackId: "credits_10",
    heldCents: 0,
    purchases: [],
    consent,
    ...overrides,
  };
}

function render(s: CreditTopUpState | null, props: Partial<BuyCreditsViewProps> = {}) {
  return renderToStaticMarkup(
    <BuyCreditsView
      state={s}
      kind={buyCreditsKind(s)}
      selectedPackId={defaultPackId(s)}
      consentOpen={false}
      consent={INITIAL_DELIVERY_CONSENT}
      {...props}
    />,
  );
}

describe("BuyCredits (#1422)", () => {
  it("derives the state kind", () => {
    expect(buyCreditsKind(null)).toBe("loading");
    expect(buyCreditsKind(null, { error: true })).toBe("error");
    expect(buyCreditsKind(state({ available: false }))).toBe("unavailable");
    expect(buyCreditsKind(state())).toBe("buy");
  });

  it("reads the Stripe return once, with a well-formed Checkout Session id only", () => {
    expect(readCreditsReturn("?section=usage&credits=success&credits_session=cs_test_a1B2")).toEqual({
      result: "success",
      sessionId: "cs_test_a1B2",
    });
    expect(readCreditsReturn("?credits=cancel")).toEqual({ result: "cancel", sessionId: null });
    expect(readCreditsReturn("?credits=success&credits_session={CHECKOUT_SESSION_ID}")).toEqual({
      result: "success",
      sessionId: null,
    });
    expect(readCreditsReturn("?credits=maybe")).toBeNull();
    expect(readCreditsReturn("?billing=success")).toBeNull();
  });

  it("finds the purchase a return is waiting for", () => {
    const s = state({ purchases: [purchase({ checkoutSessionId: "cs_test_new" }), purchase({ id: "p0" })] });
    expect(findReturnedPurchase(s, "cs_test_new", Date.now())?.checkoutSessionId).toBe("cs_test_new");
    expect(findReturnedPurchase(s, "cs_test_other", Date.now())).toBeNull();
    expect(findReturnedPurchase(null, "cs_test_new", Date.now())).toBeNull();
    const returnedAt = Date.parse("2026-10-25T10:05:00.000Z");
    expect(findReturnedPurchase(s, null, returnedAt)?.id).toBe("p1");
    expect(findReturnedPurchase(s, null, returnedAt + 60 * 60 * 1000)).toBeNull();
  });

  it("shows loading, error with Retry, and an unavailable state with no buy button", () => {
    expect(render(null)).toContain("Loading credit packs");
    const error = renderToStaticMarkup(
      <BuyCreditsView
        state={null}
        kind="error"
        selectedPackId={null}
        consentOpen={false}
        consent={INITIAL_DELIVERY_CONSENT}
      />,
    );
    expect(error).toContain("Could not load the credit packs.");
    expect(error).toContain("Retry");
    const off = render(state({ available: false, testMode: true }));
    expect(off).toContain("Buying credits is not available on this server yet.");
    expect(off).not.toContain("<button");
    expect(off).not.toContain("Test mode");
  });

  it("offers the three packs with $10 preselected, the Test mode note, and a Buy button", () => {
    const html = render(state());
    expect(html).toContain("Test mode.");
    expect(html).toContain("$5.00");
    expect(html).toContain("$10.00");
    expect(html).toContain("$25.00");
    expect(html.match(/type="radio"[^>]*checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/data-selected="true"[^>]*><input type="radio"[^>]*checked=""/);
    expect(html).toContain("Buy $10.00 of credits");
    expect(html).toContain("Bought credits do not expire.");
    expect(html).toContain("plus any applicable tax");
    expect(html).not.toContain("before any tax");
    expect(html).not.toContain("VAT included");
    expect(html).not.toContain("Where is your billing address?");
    expect(html).not.toContain("€");
    // The delivery choice is not shown until Buy is pressed.
    expect(html).not.toContain("Delivery and your right to withdraw");
  });

  it("USD and EUR offered, euros chosen: euro prices with VAT included, credits still in dollars, and the choice", () => {
    const html = render(state({ currencies: ["usd", "eur"] }), { currency: "eur" });
    expect(html).toContain("€5.00");
    expect(html).toContain("€10.00");
    expect(html).toContain("€25.00");
    expect(html).toContain("$10.00 of credits");
    expect(html).toContain("Buy €10.00 of credits");
    expect(html).toContain("VAT included");
    expect(html).toContain("Bought credits do not expire.");
    expect(html).toContain("Where is your billing address?");
    expect(html).toContain("In the EU — prices in euros, VAT included");
    expect(html).toMatch(/<input(?=[^>]*value="eur")(?=[^>]*checked="")/);
  });

  it("names the chosen pack in its currency and locks the currency choice while the delivery choice is open", () => {
    const html = render(state({ currencies: ["usd", "eur"] }), {
      currency: "eur",
      consentOpen: true,
      selectedPackId: "credits_25",
    });
    expect(html).toContain("You chose the <strong>€25 credit pack</strong>: $25.00 of generation credits.");
    expect(html).toMatch(/<input(?=[^>]*value="eur")(?=[^>]*disabled="")/);
    expect(creditPackLabel(state().packs[0], "usd")).toBe("$5 credit pack");
  });

  it("asks for a confirmed contact email instead of a Buy button", () => {
    const html = render(state({ contactEmailConfirmed: false }));
    expect(html).toContain("Buying credits needs a confirmed contact email");
    expect(html).toContain('href="/settings?section=email"');
    expect(html).not.toContain("Buy $10.00 of credits");
  });

  it("shows the delivery choice with nothing selected and Continue disabled until it is complete", () => {
    const html = render(state(), { consentOpen: true, selectedPackId: "credits_25" });
    expect(html).toContain("You chose the <strong>$25 credit pack</strong>");
    expect(html).toContain("Deliver now");
    expect(html).toContain("Wait 14 days");
    expect(html).toContain("Nothing is selected for you");
    // Neither delivery radio is checked (only the pack radio is).
    expect(html.match(/type="radio"[^>]*checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue to secure checkout/);

    const unticked = render(state(), { consentOpen: true, consent: { choice: "deliver_now", acknowledged: false } });
    expect(unticked).toContain("I lose my right to withdraw.");
    expect(unticked).toMatch(/<button[^>]*disabled=""[^>]*>Continue to secure checkout/);

    for (const complete of [
      { choice: "deliver_now" as const, acknowledged: true },
      { choice: "wait" as const, acknowledged: false },
    ]) {
      const ready = render(state(), { consentOpen: true, consent: complete });
      expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*>Continue to secure checkout/);
      expect(ready).toContain("Continue to secure checkout");
    }
  });

  it("lists held credits with Deliver now, and an unticked acknowledgement once asked", () => {
    const held = purchase({ status: "held", delivery: "wait", heldUntil: "2026-11-08T10:00:00.000Z", creditedCents: 0 });
    const s = state({ heldCents: 1000, purchases: [held] });
    const html = render(s);
    expect(html).toContain("$10.00 of credits on hold.");
    expect(html).toContain("On hold until Nov 8, 2026");
    expect(html).toContain("Deliver now");

    const asking = render(s, { releaseId: "p1", releaseAcknowledged: false });
    expect(asking).toContain("I lose my right to withdraw.");
    expect(asking).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(asking).toMatch(/<button[^>]*disabled=""[^>]*>Add them to my balance now/);
    expect(render(s, { releaseId: "p1", releaseAcknowledged: true })).not.toMatch(
      /<button[^>]*disabled=""[^>]*>Add them to my balance now/,
    );
  });

  it("shows recent purchases with status and receipt reference, even when buying is off", () => {
    const html = render(
      state({
        available: false,
        purchases: [
          purchase(),
          purchase({ id: "p2", status: "refunded", receiptRef: "pi_test_456" }),
          purchase({ id: "p3", refundedCreditsCents: 250 }),
          purchase({ id: "p4", status: "needs_review", receiptRef: null }),
        ],
      }),
    );
    expect(html).toContain("Your recent credit purchases");
    expect(html).toContain("pi_test_123");
    expect(html).toContain("Refunded");
    expect(html).toContain("Added to your balance; $2.50 refunded");
    expect(html).toContain("Payment received, under review");
  });

  it("describes each purchase status", () => {
    expect(describeCreditPurchase(purchase())).toBe("Added to your balance");
    expect(describeCreditPurchase(purchase({ status: "held", heldUntil: null }))).toBe("On hold for 14 days");
  });
});
