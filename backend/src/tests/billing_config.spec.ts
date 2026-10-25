/**
 * Stripe billing configuration (#2407): nothing works without every variable,
 * a live key is refused unless BILLING_LIVE_MODE=true, and production needs a
 * web address for the return pages. No value is ever a source-code default.
 */
import { BillingConfig } from "../modules/billing/billing_config";
import { createStripeGateway } from "../modules/billing/stripe_gateway";

const CONFIGURED = {
  STRIPE_SECRET_KEY: "sk_test_example",
  STRIPE_WEBHOOK_SECRET: "whsec_example",
  STRIPE_PRICE_ARTIST_PRO_MONTHLY: "price_month",
  STRIPE_PRICE_ARTIST_PRO_ANNUAL: "price_year",
};

describe("BillingConfig (#2407)", () => {
  it("is unavailable and names every missing variable when nothing is set", () => {
    const config = new BillingConfig({});
    expect(config.isAvailable()).toBe(false);
    expect(config.unavailableReason).toBe("not_configured");
    expect(config.missing).toEqual([
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_ARTIST_PRO_MONTHLY",
      "STRIPE_PRICE_ARTIST_PRO_ANNUAL",
    ]);
    expect(createStripeGateway(config)).toBeNull();
  });

  it("is unavailable when one variable is missing", () => {
    const config = new BillingConfig({ ...CONFIGURED, STRIPE_PRICE_ARTIST_PRO_ANNUAL: " " });
    expect(config.isAvailable()).toBe(false);
    expect(config.missing).toEqual(["STRIPE_PRICE_ARTIST_PRO_ANNUAL"]);
  });

  it("is available in test mode with a test key and the localhost web address in development", () => {
    const config = new BillingConfig(CONFIGURED);
    expect(config.isAvailable()).toBe(true);
    expect(config.testMode).toBe(true);
    expect(config.liveMode).toBe(false);
    expect(config.priceFor("month")).toBe("price_month");
    expect(config.priceFor("year")).toBe("price_year");
    expect(config.returnUrl("success")).toBe("http://localhost:3001/settings?section=usage&billing=success");
  });

  it.each(["sk_live_example", "rk_live_example"])("refuses the live key %s unless BILLING_LIVE_MODE=true", (key) => {
    const refused = new BillingConfig({ ...CONFIGURED, STRIPE_SECRET_KEY: key });
    expect(refused.isAvailable()).toBe(false);
    expect(refused.unavailableReason).toBe("live_key_refused");
    expect(createStripeGateway(refused)).toBeNull();

    const notTrue = new BillingConfig({ ...CONFIGURED, STRIPE_SECRET_KEY: key, BILLING_LIVE_MODE: "yes" });
    expect(notTrue.unavailableReason).toBe("live_key_refused");

    const live = new BillingConfig({ ...CONFIGURED, STRIPE_SECRET_KEY: key, BILLING_LIVE_MODE: "true" });
    expect(live.isAvailable()).toBe(true);
    expect(live.testMode).toBe(false);
  });

  it("needs FRONTEND_URL in production and uses its first entry without a trailing slash", () => {
    expect(new BillingConfig({ ...CONFIGURED, NODE_ENV: "production" }).unavailableReason).toBe("no_frontend_url");
    const config = new BillingConfig({
      ...CONFIGURED,
      NODE_ENV: "production",
      FRONTEND_URL: "https://app.example.org/, https://other.example.org",
    });
    expect(config.isAvailable()).toBe(true);
    expect(config.returnUrl("cancel")).toBe("https://app.example.org/settings?section=usage&billing=cancel");
    expect(config.returnUrl("portal")).toBe("https://app.example.org/settings?section=usage&billing=portal");
  });

  it("turns Stripe Tax on only with STRIPE_AUTOMATIC_TAX=true", () => {
    expect(new BillingConfig(CONFIGURED).automaticTax).toBe(false);
    expect(new BillingConfig({ ...CONFIGURED, STRIPE_AUTOMATIC_TAX: "true" }).automaticTax).toBe(true);
  });

  it("builds the SDK gateway with no network call when configured", () => {
    expect(createStripeGateway(new BillingConfig(CONFIGURED))).not.toBeNull();
  });
});
