/**
 * #2492: the Stripe webhook fulfils credit packs through the REAL Nest wiring.
 *
 * `StripeWebhookService` once declared its credit-pack dependency as
 * `CreditTopUpService | null`. TypeScript serializes a union type as `Object`
 * in the decorator metadata, so Nest found no provider, `@Optional()` yielded
 * undefined and every credit-pack event was acknowledged as
 * `ignored_unavailable` and never retried. Specs that build the service with
 * `new StripeWebhookService(...)` could not see it, so this one boots
 * `BillingModule` and resolves the service from the container.
 *
 * Stripe is a fake gateway (the only override); the module's own providers for
 * `StripeWebhookService` and `CreditTopUpService` are the real ones. The global
 * `ConfigModule` is imported as `AppModule` does, for the modules `BillingModule`
 * pulls in transitively.
 */
import "reflect-metadata";
import { ConfigModule } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { prisma } from "../db/prisma";
import { BillingModule } from "../modules/billing/billing.module";
import { CreditTopUpService } from "../modules/billing/credit_topup.service";
import { STRIPE_GATEWAY, type StripeEvent, type StripeGateway } from "../modules/billing/stripe_gateway";
import { StripeWebhookService } from "../modules/billing/stripe_webhook.service";
import { CONSENT_TEXT_VERSION } from "../modules/purchase_consent/purchase_consent.constants";

const P = `whwiring_${Date.now()}_`;
const USER = `${P}buyer`;

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_wiring",
  STRIPE_WEBHOOK_SECRET: "whsec_wiring",
  STRIPE_PRICE_ARTIST_PRO_MONTHLY: "price_month",
  STRIPE_PRICE_ARTIST_PRO_ANNUAL: "price_year",
  STRIPE_PRICE_CREDITS_5: "price_c5",
  STRIPE_PRICE_CREDITS_10: "price_c10",
  STRIPE_PRICE_CREDITS_25: "price_c25",
  FRONTEND_URL: "https://app.example.test",
  // Read by `CryptoService` (SharedModule), pulled in through NotificationModule.
  JWT_SECRET: "stripe-webhook-wiring-integration-test-only",
} as const;

let sessionSeq = 0;
const gateway = {
  createCustomer: jest.fn(async () => ({ id: `cus_${P}1` })),
  createCheckoutSession: jest.fn(async () => ({ id: `cs_${P}${++sessionSeq}`, url: "https://checkout.stripe.test/c/pay" })),
  createPortalSession: jest.fn(),
  retrieveSubscription: jest.fn(),
  constructEvent: jest.fn(),
  cancelSubscription: jest.fn(),
  updateSubscription: jest.fn(),
  updateCustomerEmail: jest.fn(),
} satisfies StripeGateway;

let eventSeq = 0;
const event = (type: string, object: unknown): StripeEvent =>
  ({ id: `evt_${P}${++eventSeq}`, object: "event", type, created: Math.floor(Date.now() / 1000), livemode: false, data: { object } }) as unknown as StripeEvent;

describe("Stripe webhook credit-pack wiring (integration, #2492)", () => {
  const savedEnv: Record<string, string | undefined> = {};
  let moduleRef: TestingModule;
  let webhooks: StripeWebhookService;
  let topUps: CreditTopUpService;

  beforeAll(async () => {
    for (const [key, value] of Object.entries(ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.resonate` } });
    await prisma.contactEmail.create({
      data: { userId: USER, address: `${USER}@mail.test`, addressNormalized: `${USER}@mail.test`, status: "confirmed", confirmedAt: new Date() },
    });
    moduleRef = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), BillingModule] })
      .overrideProvider(STRIPE_GATEWAY)
      .useValue(gateway)
      .compile();
    webhooks = moduleRef.get(StripeWebhookService);
    topUps = moduleRef.get(CreditTopUpService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await prisma.stripeEvent.deleteMany({ where: { eventId: { startsWith: `evt_${P}` } } });
    await prisma.creditTopUp.deleteMany({ where: { userId: USER } });
    await prisma.generationCreditTransaction.deleteMany({ where: { userId: USER } });
    await prisma.generationCreditAccount.deleteMany({ where: { userId: USER } });
    await prisma.subscription.deleteMany({ where: { userId: USER } });
    await prisma.purchaseConsent.deleteMany({ where: { userId: USER } });
    await prisma.notice.deleteMany({ where: { recipientUserId: USER } });
    await prisma.contactEmail.deleteMany({ where: { userId: USER } });
    await prisma.user.deleteMany({ where: { id: USER } });
  });

  it("injects the module's CreditTopUpService into the webhook service", () => {
    expect((webhooks as unknown as { topUps: unknown }).topUps).toBe(topUps);
  });

  it("credits a paid credit pack from checkout.session.completed and takes it back on charge.refunded", async () => {
    await topUps.startCheckout(USER, {
      packId: "credits_10",
      consent: { choice: "deliver_now", acknowledgedWaiver: true, textVersion: CONSENT_TEXT_VERSION },
    } as any);
    const [params] = gateway.createCheckoutSession.mock.calls[0] as unknown as [Record<string, any>];
    const sessionId = (await gateway.createCheckoutSession.mock.results[0].value).id as string;

    const session = {
      id: sessionId,
      object: "checkout.session",
      mode: "payment",
      payment_status: "paid",
      payment_intent: `pi_${sessionId}`,
      customer: params.customer,
      client_reference_id: params.client_reference_id,
      metadata: params.metadata,
      amount_subtotal: 1000,
      amount_total: 1000,
      currency: "usd",
    };

    const completed = await webhooks.handle(event("checkout.session.completed", session));
    expect(completed.outcome).not.toBe("ignored_unavailable");
    expect(completed).toEqual({ received: true, outcome: "credited" });
    expect((await prisma.generationCreditAccount.findUnique({ where: { userId: USER } }))?.balanceCents).toBe(1000);
    expect(await prisma.creditTopUp.findFirstOrThrow({ where: { userId: USER } })).toMatchObject({ status: "credited" });

    const refunded = await webhooks.handle(
      event("charge.refunded", {
        id: `ch_${sessionId}`,
        object: "charge",
        payment_intent: `pi_${sessionId}`,
        amount: 1000,
        amount_refunded: 1000,
        refunded: true,
      }),
    );
    expect(refunded.outcome).not.toBe("ignored_unavailable");
    expect((await prisma.generationCreditAccount.findUnique({ where: { userId: USER } }))?.balanceCents).toBe(0);
    expect(await prisma.creditTopUp.findFirstOrThrow({ where: { userId: USER } })).toMatchObject({
      status: "refunded",
      refundedCreditsCents: 1000,
    });
  });
});
