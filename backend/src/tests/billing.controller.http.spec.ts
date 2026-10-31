/**
 * Billing HTTP contract (#2407): JWT on the person's routes, DTO validation,
 * 503 `billing_unavailable` when Stripe is not configured, and the public
 * webhook's signature check over the raw body (valid / invalid / missing).
 * Stripe is never called: the webhook uses the SDK's local signature check.
 */
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import Stripe from "stripe";
import { BillingConfig } from "../modules/billing/billing_config";
import { BillingController } from "../modules/billing/billing.controller";
import { BillingService } from "../modules/billing/billing.service";
import { STRIPE_GATEWAY, createStripeGateway, type StripeGateway } from "../modules/billing/stripe_gateway";
import { StripeWebhookController } from "../modules/billing/stripe_webhook.controller";
import { StripeWebhookService } from "../modules/billing/stripe_webhook.service";
import { CreditTopUpService } from "../modules/billing/credit_topup.service";
import { PurchaseConsentService } from "../modules/purchase_consent/purchase_consent.service";
import { SUBSCRIPTION_CONSENT_TEXT_VERSION } from "../modules/purchase_consent/purchase_consent.constants";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const WEBHOOK_SECRET = "whsec_test_http_spec";
const CONFIGURED = {
  STRIPE_SECRET_KEY: "sk_test_http_spec",
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_PRICE_ARTIST_PRO_MONTHLY: "price_month",
  STRIPE_PRICE_ARTIST_PRO_ANNUAL: "price_year",
};
const consents = { recordSubscriptionStart: jest.fn(), link: jest.fn() };
// The webhook requires the credit-pack service (#2492); this spec covers subscriptions only.
const topUps = { fulfilFromCheckout: jest.fn(), reverseFromRefund: jest.fn() };
const bearer = (userId = "user-1") => ({ Authorization: `Bearer ${authToken(userId)}` });
const validCheckout = { interval: "month", acknowledgedImmediateStart: true, textVersion: SUBSCRIPTION_CONSENT_TEXT_VERSION };

async function appWith(config: BillingConfig, gateway: StripeGateway | null) {
  return createControllerTestApp(
    [BillingController, StripeWebhookController],
    [
      { provide: BillingConfig, useValue: config },
      { provide: STRIPE_GATEWAY, useValue: gateway },
      { provide: PurchaseConsentService, useValue: consents },
      { provide: CreditTopUpService, useValue: topUps },
      BillingService,
      StripeWebhookService,
    ],
    { rawBody: true },
  );
}

describe("Billing (HTTP, #2407)", () => {
  describe("when Stripe is not configured", () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await appWith(new BillingConfig({}), null);
    });
    afterAll(() => app.close());

    it("requires a JWT on the person's routes", async () => {
      await request(app.getHttpServer()).get("/billing/subscription").expect(401);
      await request(app.getHttpServer()).post("/billing/subscription/checkout").send(validCheckout).expect(401);
      await request(app.getHttpServer()).post("/billing/portal").expect(401);
    });

    it("answers 503 billing_unavailable on checkout and the portal, and records no consent", async () => {
      const checkout = await request(app.getHttpServer())
        .post("/billing/subscription/checkout")
        .set(bearer())
        .send(validCheckout)
        .expect(503);
      expect(checkout.body.code).toBe("billing_unavailable");
      const portal = await request(app.getHttpServer()).post("/billing/portal").set(bearer()).expect(503);
      expect(portal.body.code).toBe("billing_unavailable");
      expect(consents.recordSubscriptionStart).not.toHaveBeenCalled();
    });

    it("answers 503 on the webhook", async () => {
      const res = await request(app.getHttpServer())
        .post("/billing/stripe/webhook")
        .set("Content-Type", "application/json")
        .send("{}")
        .expect(503);
      expect(res.body.code).toBe("billing_unavailable");
    });

    it("validates the checkout body with 400 before anything else", async () => {
      for (const body of [
        { ...validCheckout, interval: "week" },
        { ...validCheckout, currency: "gbp" },
        { ...validCheckout, currency: "EUR" },
        { interval: "month", textVersion: SUBSCRIPTION_CONSENT_TEXT_VERSION },
        { ...validCheckout, acknowledgedImmediateStart: "yes" },
        { ...validCheckout, textVersion: undefined },
      ]) {
        await request(app.getHttpServer()).post("/billing/subscription/checkout").set(bearer()).send(body).expect(400);
      }
    });
  });

  describe("the webhook signature", () => {
    let app: INestApplication;
    let webhooks: StripeWebhookService;
    const signer = new Stripe("sk_test_http_spec");
    const payload = JSON.stringify({
      id: "evt_http_1",
      object: "event",
      type: "customer.subscription.updated",
      created: 1_790_000_000,
      livemode: false,
      data: { object: { id: "sub_1", object: "subscription" } },
    });

    beforeAll(async () => {
      const config = new BillingConfig(CONFIGURED);
      app = await appWith(config, createStripeGateway(config));
      webhooks = app.get(StripeWebhookService);
    });
    afterAll(() => app.close());

    beforeEach(() => {
      jest.restoreAllMocks();
    });

    it("accepts a correctly signed raw body without a JWT and hands the parsed event over", async () => {
      const handle = jest.spyOn(webhooks, "handle").mockResolvedValue({ received: true, outcome: "applied" });
      const header = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
      const res = await request(app.getHttpServer())
        .post("/billing/stripe/webhook")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", header)
        .send(payload)
        .expect(200);
      expect(res.body).toEqual({ received: true, outcome: "applied" });
      expect(handle).toHaveBeenCalledTimes(1);
      expect(handle.mock.calls[0][0]).toMatchObject({ id: "evt_http_1", type: "customer.subscription.updated" });
    });

    it("rejects a signature made with another secret, a tampered body and a missing header with 400", async () => {
      const handle = jest.spyOn(webhooks, "handle");
      const wrong = signer.webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_else" });
      for (const [header, body] of [
        [wrong, payload],
        [signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }), payload.replaceAll("sub_1", "sub_2")],
        ["", payload],
      ] as const) {
        const req = request(app.getHttpServer()).post("/billing/stripe/webhook").set("Content-Type", "application/json");
        if (header) req.set("Stripe-Signature", header);
        const res = await req.send(body).expect(400);
        expect(res.body.code).toBe("invalid_signature");
      }
      expect(handle).not.toHaveBeenCalled();
    });

    it("rejects a stale signature (outside Stripe's tolerance) with 400", async () => {
      const old = signer.webhooks.generateTestHeaderString({
        payload,
        secret: WEBHOOK_SECRET,
        timestamp: Math.floor(Date.now() / 1000) - 60 * 60,
      });
      await request(app.getHttpServer())
        .post("/billing/stripe/webhook")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", old)
        .send(payload)
        .expect(400);
    });
  });
});
