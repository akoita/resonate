/**
 * Credit pack HTTP contract (#1422): JWT on every route, DTO validation (pack
 * id from the catalogue, a nested consent with no default), and 503
 * `billing_unavailable` when Stripe or a pack price is not configured, before
 * any consent is recorded. Prisma is never reached: the service is real but
 * every request here stops before it reads the database.
 */
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { BillingConfig } from "../modules/billing/billing_config";
import { CreditPackConfig } from "../modules/billing/credit_packs";
import { CreditTopUpController } from "../modules/billing/credit_topup.controller";
import { CreditTopUpService } from "../modules/billing/credit_topup.service";
import { STRIPE_GATEWAY, type StripeGateway } from "../modules/billing/stripe_gateway";
import { NoticeService } from "../modules/notifications/notice.service";
import { CONSENT_TEXT_VERSION } from "../modules/purchase_consent/purchase_consent.constants";
import { PurchaseConsentService } from "../modules/purchase_consent/purchase_consent.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const BILLING = {
  STRIPE_SECRET_KEY: "sk_test_http_spec",
  STRIPE_WEBHOOK_SECRET: "whsec_test_http_spec",
  STRIPE_PRICE_ARTIST_PRO_MONTHLY: "price_month",
  STRIPE_PRICE_ARTIST_PRO_ANNUAL: "price_year",
};
const PACK_PRICES = {
  STRIPE_PRICE_CREDITS_5: "price_c5",
  STRIPE_PRICE_CREDITS_10: "price_c10",
  STRIPE_PRICE_CREDITS_25: "price_c25",
};
const consents = { record: jest.fn(), link: jest.fn() };
const gateway = {
  createCustomer: jest.fn(),
  createCheckoutSession: jest.fn(),
  createPortalSession: jest.fn(),
  retrieveSubscription: jest.fn(),
  constructEvent: jest.fn(),
} satisfies StripeGateway;
const bearer = (userId = "user-1") => ({ Authorization: `Bearer ${authToken(userId)}` });
const consent = { choice: "deliver_now", acknowledgedWaiver: true, textVersion: CONSENT_TEXT_VERSION };
const validCheckout = { packId: "credits_10", consent };

async function appWith(billing: BillingConfig, packs: CreditPackConfig, withGateway: boolean) {
  return createControllerTestApp(
    [CreditTopUpController],
    [
      { provide: BillingConfig, useValue: billing },
      { provide: CreditPackConfig, useValue: packs },
      { provide: STRIPE_GATEWAY, useValue: withGateway ? gateway : null },
      { provide: PurchaseConsentService, useValue: consents },
      { provide: NoticeService, useValue: { sendTargeted: jest.fn() } },
      CreditTopUpService,
    ],
  );
}

describe("Credit packs (HTTP, #1422)", () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each([
    ["Stripe is not configured", new BillingConfig({}), new CreditPackConfig(PACK_PRICES), false],
    ["a pack price is missing", new BillingConfig(BILLING), new CreditPackConfig({ STRIPE_PRICE_CREDITS_5: "price_c5" }), true],
  ])("when %s", (_label, billing, packs, withGateway) => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await appWith(billing, packs, withGateway);
    });
    afterAll(() => app.close());

    it("requires a JWT on every route", async () => {
      await request(app.getHttpServer()).get("/billing/credits").expect(401);
      await request(app.getHttpServer()).post("/billing/credits/checkout").send(validCheckout).expect(401);
      await request(app.getHttpServer())
        .post("/billing/credits/purchases/p1/deliver-now")
        .send({ acknowledgedWaiver: true, textVersion: CONSENT_TEXT_VERSION })
        .expect(401);
    });

    it("answers 503 billing_unavailable on checkout and records no consent", async () => {
      const res = await request(app.getHttpServer())
        .post("/billing/credits/checkout")
        .set(bearer())
        .send(validCheckout)
        .expect(503);
      expect(res.body.code).toBe("billing_unavailable");
      expect(consents.record).not.toHaveBeenCalled();
      expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await appWith(new BillingConfig(BILLING), new CreditPackConfig(PACK_PRICES), true);
    });
    afterAll(() => app.close());

    it("validates the checkout body with 400 before anything else", async () => {
      for (const body of [
        { ...validCheckout, packId: "credits_1" },
        { ...validCheckout, packId: 1000 },
        { packId: "credits_10" },
        { ...validCheckout, consent: "deliver_now" },
        { ...validCheckout, consent: { ...consent, choice: null } },
        { ...validCheckout, consent: { ...consent, choice: "later" } },
        { ...validCheckout, consent: { ...consent, acknowledgedWaiver: "yes" } },
        { ...validCheckout, consent: { choice: "wait", acknowledgedWaiver: false } },
      ]) {
        await request(app.getHttpServer()).post("/billing/credits/checkout").set(bearer()).send(body).expect(400);
      }
      expect(consents.record).not.toHaveBeenCalled();
      expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
    });

    it("validates the deliver-now body with 400", async () => {
      for (const body of [{}, { acknowledgedWaiver: "true", textVersion: CONSENT_TEXT_VERSION }, { acknowledgedWaiver: true }]) {
        await request(app.getHttpServer())
          .post("/billing/credits/purchases/p1/deliver-now")
          .set(bearer())
          .send(body)
          .expect(400);
      }
      expect(consents.record).not.toHaveBeenCalled();
    });
  });
});
