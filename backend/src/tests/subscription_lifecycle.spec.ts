/**
 * Pure rules of the billing account lifecycle (#2430): which statuses can
 * still be cancelled, and the failure code recorded on the row and in logs
 * (a Stripe code or type, never the message, which can carry an address).
 * The database behaviour is in `billing_lifecycle.integration.spec.ts`.
 */
import {
  CANCELLABLE_STATUSES,
  STRIPE_EVENT_RETENTION_DAYS,
  SubscriptionCancellationPendingError,
  failureCode,
} from "../modules/billing/subscription_lifecycle.service";

describe("subscription lifecycle rules (#2430)", () => {
  it("cancels every status Stripe may still charge, including an incomplete first payment", () => {
    expect([...CANCELLABLE_STATUSES].sort()).toEqual(
      ["active", "incomplete", "past_due", "paused", "trialing", "unpaid"].sort(),
    );
  });

  it("keeps processed events far beyond Stripe's 3-day retry window", () => {
    expect(STRIPE_EVENT_RETENTION_DAYS).toBe(90);
  });

  describe("failureCode", () => {
    it("uses the Stripe code, then the type, never the message", () => {
      const withCode = Object.assign(new Error("No such customer: someone@example.test"), {
        type: "StripeInvalidRequestError",
        code: "resource_missing",
      });
      expect(failureCode(withCode)).toBe("resource_missing");
      const withType = Object.assign(new Error("boom someone@example.test"), { type: "StripeConnectionError" });
      expect(failureCode(withType)).toBe("stripeconnectionerror");
      expect(failureCode(new Error("someone@example.test"))).toBe("error");
      expect(failureCode("text")).toBe("error");
    });

    it("keeps the code of a pending cancellation, bounded and safe", () => {
      expect(failureCode(new SubscriptionCancellationPendingError("row", "billing_unavailable"))).toBe(
        "billing_unavailable",
      );
      const odd = Object.assign(new Error("x"), { code: `a-b c/${"z".repeat(100)}` });
      expect(failureCode(odd)).toMatch(/^[a-z0-9_]{1,64}$/);
    });
  });
});
