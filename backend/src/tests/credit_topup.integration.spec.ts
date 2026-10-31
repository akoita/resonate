/**
 * Buying generation-credit packs (#1422), against Postgres.
 *
 * Stripe is a fake gateway (jest.fn): nothing here calls Stripe. Covered: 503
 * when unconfigured; checkout needs a confirmed contact email and a recorded
 * `credit_topup` consent BEFORE the Checkout Session, and ignores any amount
 * in the request; the person's one Stripe customer; fulfilment exactly once
 * per Checkout Session; deliver now vs the 14-day hold (lazy release, release
 * on request, concurrent releases); refunds that never take the balance below
 * zero; a live-mode event ignored; an amount that does not match the pack.
 */
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import { BillingConfig } from "../modules/billing/billing_config";
import { BillingService } from "../modules/billing/billing.service";
import { CreditPackConfig } from "../modules/billing/credit_packs";
import { CreditTopUpService } from "../modules/billing/credit_topup.service";
import type { StripeEvent, StripeGateway } from "../modules/billing/stripe_gateway";
import { StripeWebhookService } from "../modules/billing/stripe_webhook.service";
import { GenerationCreditsService } from "../modules/credits/generation-credits.service";
import { releaseDueTopUpHolds, releaseHeldTopUp } from "../modules/credits/top_up_ledger";
import { EntitlementsService } from "../modules/entitlements/entitlements.service";
import { NoticeService } from "../modules/notifications/notice.service";
import { CONSENT_TEXT_VERSION, SUBSCRIPTION_CONSENT_TEXT_VERSION } from "../modules/purchase_consent/purchase_consent.constants";
import { PurchaseConsentService } from "../modules/purchase_consent/purchase_consent.service";
import { EventBus } from "../modules/shared/event_bus";

const P = `credtop_${Date.now()}_`;
const U = {
  buyer: `${P}buyer`,
  noEmail: `${P}no_email`,
  pending: `${P}pending`,
  waiter: `${P}waiter`,
  refunds: `${P}refunds`,
  misc: `${P}misc`,
  euro: `${P}euro`,
};
const USERS = Object.values(U);
const DAY = 24 * 60 * 60 * 1000;
const sec = (date: Date) => Math.floor(date.getTime() / 1000);

const BILLING_ENV = {
  STRIPE_SECRET_KEY: "sk_test_integration",
  STRIPE_WEBHOOK_SECRET: "whsec_integration",
  STRIPE_PRICE_ARTIST_PRO_MONTHLY: "price_month",
  STRIPE_PRICE_ARTIST_PRO_ANNUAL: "price_year",
  FRONTEND_URL: "https://app.example.test",
};
const PACK_ENV = {
  STRIPE_PRICE_CREDITS_5: "price_c5",
  STRIPE_PRICE_CREDITS_10: "price_c10",
  STRIPE_PRICE_CREDITS_25: "price_c25",
};
const config = new BillingConfig(BILLING_ENV);
const packs = new CreditPackConfig(PACK_ENV);
const notices = new NoticeService(new EventBus(), new AuditService());
const consents = new PurchaseConsentService(notices);
const credits = new GenerationCreditsService();

let customerSeq = 0;
let sessionSeq = 0;
const gateway = {
  createCustomer: jest.fn(async () => ({ id: `cus_${P}${++customerSeq}` })),
  createCheckoutSession: jest.fn(async () => ({ id: `cs_${P}${++sessionSeq}`, url: "https://checkout.stripe.test/c/pay" })),
  createPortalSession: jest.fn(async () => ({ url: "https://billing.stripe.test/p/session" })),
  retrieveSubscription: jest.fn(async () => {
    throw new Error("not used");
  }),
  constructEvent: jest.fn(),
  cancelSubscription: jest.fn(),
  updateSubscription: jest.fn(),
  updateCustomerEmail: jest.fn(),
} satisfies StripeGateway;

const topUps = new CreditTopUpService(config, consents, notices, gateway, packs);
const eurTopUps = new CreditTopUpService(new BillingConfig({ ...BILLING_ENV, STRIPE_EUR_PRICES: "true" }), consents, notices, gateway, packs);
const webhooks = new StripeWebhookService(config, gateway, topUps);
const billing = new BillingService(config, consents, gateway, new EntitlementsService());

let eventSeq = 0;
function event(type: string, object: unknown, created = new Date(), livemode = false): StripeEvent {
  return { id: `evt_${P}${++eventSeq}`, object: "event", type, created: sec(created), livemode, data: { object } } as unknown as StripeEvent;
}

const deliverNow = { choice: "deliver_now", acknowledgedWaiver: true, textVersion: CONSENT_TEXT_VERSION };
const wait = { choice: "wait", acknowledgedWaiver: false, textVersion: CONSENT_TEXT_VERSION };
const body = (packId: string, consent: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ packId, consent, ...extra }) as any;

/** Run a checkout and return the Checkout Session the fake gateway was asked for. */
async function checkout(userId: string, packId: string, consent: Record<string, unknown>, currency?: "usd" | "eur") {
  gateway.createCheckoutSession.mockClear();
  const service = currency === "eur" ? eurTopUps : topUps;
  await service.startCheckout(userId, body(packId, consent, currency ? { currency } : {}));
  const [params] = gateway.createCheckoutSession.mock.calls[0] as unknown as [Record<string, any>];
  const sessionId = (await gateway.createCheckoutSession.mock.results[0].value).id as string;
  return { params, sessionId };
}

/** The `checkout.session.completed` object Stripe would send for that session. */
function completedSession(
  started: { params: Record<string, any>; sessionId: string },
  overrides: Record<string, unknown> = {},
) {
  const price = { price_c5: 500, price_c10: 1000, price_c25: 2500 }[started.params.line_items[0].price as string];
  return {
    id: started.sessionId,
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    payment_intent: `pi_${started.sessionId}`,
    customer: started.params.customer,
    client_reference_id: started.params.client_reference_id,
    metadata: started.params.metadata,
    amount_subtotal: price,
    amount_total: price,
    currency: started.params.currency ?? "usd",
    ...overrides,
  };
}

async function balance(userId: string) {
  return (await prisma.generationCreditAccount.findUnique({ where: { userId } }))?.balanceCents ?? 0;
}

describe("Credit packs (integration, #1422)", () => {
  beforeAll(async () => {
    for (const id of USERS) await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    for (const id of [U.buyer, U.waiter, U.refunds, U.misc, U.euro]) {
      await prisma.contactEmail.create({
        data: { userId: id, address: `${id}@mail.test`, addressNormalized: `${id}@mail.test`, status: "confirmed", confirmedAt: new Date() },
      });
    }
    await prisma.contactEmail.create({
      data: { userId: U.pending, address: `${U.pending}@mail.test`, addressNormalized: `${U.pending}@mail.test`, status: "pending" },
    });
  });

  afterAll(async () => {
    await prisma.stripeEvent.deleteMany({ where: { eventId: { startsWith: `evt_${P}` } } });
    await prisma.creditTopUp.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.generationCreditTransaction.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.generationCreditAccount.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.purchaseConsent.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.notice.deleteMany({ where: { recipientUserId: { in: USERS } } });
    await prisma.contactEmail.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  });

  beforeEach(() => jest.clearAllMocks());

  describe("checkout", () => {
    it("answers 503 when billing or a pack price is not configured, and says so in the state", async () => {
      const off = new CreditTopUpService(new BillingConfig({}), consents, notices, null, packs);
      await expect(off.startCheckout(U.buyer, body("credits_10", deliverNow))).rejects.toBeInstanceOf(ServiceUnavailableException);
      const noPrices = new CreditTopUpService(config, consents, notices, gateway, new CreditPackConfig({}));
      await expect(noPrices.startCheckout(U.buyer, body("credits_10", deliverNow))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect((await noPrices.getState(U.buyer)).available).toBe(false);
      expect(await prisma.purchaseConsent.count({ where: { userId: U.buyer } })).toBe(0);
      expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
    });

    it.each([
      ["no contact address", U.noEmail],
      ["an unconfirmed address", U.pending],
    ])("needs a confirmed contact email (409) with %s, and records nothing", async (_label, userId) => {
      const error = await topUps.startCheckout(userId, body("credits_10", deliverNow)).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ code: "contact_email_required" });
      expect(await prisma.purchaseConsent.count({ where: { userId } })).toBe(0);
      expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
    });

    it("needs a valid consent before any session: outdated wording 409, missing or stray acknowledgement 400", async () => {
      const outdated = await topUps.startCheckout(U.buyer, body("credits_10", { ...deliverNow, textVersion: "old" })).catch((e) => e);
      expect(outdated).toBeInstanceOf(ConflictException);
      expect(outdated.getResponse()).toMatchObject({ code: "consent_text_outdated" });
      const unticked = await topUps
        .startCheckout(U.buyer, body("credits_10", { ...deliverNow, acknowledgedWaiver: false }))
        .catch((e) => e);
      expect(unticked).toBeInstanceOf(BadRequestException);
      expect(unticked.getResponse()).toMatchObject({ code: "waiver_acknowledgement_required" });
      const stray = await topUps.startCheckout(U.buyer, body("credits_10", { ...wait, acknowledgedWaiver: true })).catch((e) => e);
      expect(stray.getResponse()).toMatchObject({ code: "waiver_without_consent" });
      expect(await prisma.purchaseConsent.count({ where: { userId: U.buyer } })).toBe(0);
      expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
    });

    it("records the consent first, ignores any amount in the request, and opens a one-time session for the pack's price", async () => {
      let consentsWhenSessionCreated = -1;
      gateway.createCheckoutSession.mockImplementationOnce(async () => {
        consentsWhenSessionCreated = await prisma.purchaseConsent.count({ where: { userId: U.buyer, surface: "credit_topup" } });
        return { id: `cs_${P}first`, url: "https://checkout.stripe.test/c/pay" };
      });
      await expect(
        topUps.startCheckout(U.buyer, body("credits_10", deliverNow, { amountCents: 1, priceCents: 1, creditsCents: 99999, price: "price_evil" })),
      ).resolves.toEqual({ url: "https://checkout.stripe.test/c/pay" });
      expect(consentsWhenSessionCreated).toBe(1);

      const consent = await prisma.purchaseConsent.findFirstOrThrow({ where: { userId: U.buyer, surface: "credit_topup" } });
      expect(consent).toMatchObject({
        subjectId: "credits_10",
        subjectLabel: "$10 credit pack",
        consented: true,
        acknowledgedWaiver: true,
        textVersion: CONSENT_TEXT_VERSION,
        purchaseRef: `cs_${P}first`,
      });

      const [params, key] = gateway.createCheckoutSession.mock.calls[0] as unknown as [Record<string, any>, string];
      const customer = (await prisma.subscription.findUniqueOrThrow({ where: { userId: U.buyer } })).stripeCustomerId;
      const metadata = { purpose: "credit_topup", userId: U.buyer, packId: "credits_10", consentId: consent.id };
      expect(params).toEqual({
        mode: "payment",
        currency: "usd",
        customer,
        client_reference_id: U.buyer,
        line_items: [{ price: "price_c10", quantity: 1 }],
        success_url: "https://app.example.test/settings?section=usage&credits=success&credits_session={CHECKOUT_SESSION_ID}",
        cancel_url: "https://app.example.test/settings?section=usage&credits=cancel",
        metadata,
        payment_intent_data: { metadata },
      });
      expect(key).toBe(`resonate-credits-checkout-${consent.id}`);
      expect(gateway.createCustomer).toHaveBeenCalledTimes(1);
    });

    it("reuses the person's one Stripe customer for the next pack and for a subscription", async () => {
      const customer = (await prisma.subscription.findUniqueOrThrow({ where: { userId: U.buyer } })).stripeCustomerId;
      const { params } = await checkout(U.buyer, "credits_25", wait);
      expect(params).toMatchObject({ customer, line_items: [{ price: "price_c25", quantity: 1 }] });
      await billing.startCheckout(U.buyer, {
        interval: "month",
        acknowledgedImmediateStart: true,
        textVersion: SUBSCRIPTION_CONSENT_TEXT_VERSION,
      });
      expect(gateway.createCustomer).not.toHaveBeenCalled();
      // The billing row is not a subscription until one is bought.
      expect((await billing.getState(U.buyer)).subscription).toBeNull();
    });

    it("serves the packs, the default and the delivery wording, with nothing chosen", async () => {
      const state = await topUps.getState(U.buyer);
      expect(state).toMatchObject({
        available: true,
        testMode: true,
        contactEmailConfirmed: true,
        defaultPackId: "credits_10",
        heldCents: 0,
        consent: { version: CONSENT_TEXT_VERSION },
      });
      expect(state.packs.map((pack) => [pack.id, pack.prices, pack.creditsCents, pack.isDefault])).toEqual([
        ["credits_5", { usd: 500, eur: 500 }, 500, false],
        ["credits_10", { usd: 1000, eur: 1000 }, 1000, true],
        ["credits_25", { usd: 2500, eur: 2500 }, 2500, false],
      ]);
      expect(state.currencies).toEqual(["usd"]);
      expect((await eurTopUps.getState(U.buyer)).currencies).toEqual(["usd", "eur"]);
    });

    it("opens the session in the currency shown: EUR only when offered (#2496)", async () => {
      const consentsBefore = await prisma.purchaseConsent.count({ where: { userId: U.euro } });
      const refused = await topUps.startCheckout(U.euro, body("credits_10", deliverNow, { currency: "eur" })).catch((e) => e);
      expect(refused).toBeInstanceOf(ConflictException);
      expect(refused.getResponse()).toMatchObject({ code: "currency_unavailable" });
      expect(await prisma.purchaseConsent.count({ where: { userId: U.euro } })).toBe(consentsBefore);
      expect(gateway.createCheckoutSession).not.toHaveBeenCalled();

      const { params } = await checkout(U.euro, "credits_10", wait, "eur");
      expect(params).toMatchObject({ mode: "payment", currency: "eur", line_items: [{ price: "price_c10", quantity: 1 }] });
      const consent = await prisma.purchaseConsent.findFirstOrThrow({ where: { id: params.metadata.consentId } });
      expect(consent.subjectLabel).toBe("€10 credit pack");
    });
  });

  describe("fulfilment", () => {
    it("deliver now: credits the ledger once per Checkout Session, with the payment intent id, and sends a purchase notice", async () => {
      const started = await checkout(U.buyer, "credits_10", deliverNow);
      const before = await balance(U.buyer);
      const session = completedSession(started);

      expect(await webhooks.handle(event("checkout.session.completed", session))).toEqual({ received: true, outcome: "credited" });
      // The same session delivered again under a new event id (or replayed) is not credited twice.
      expect(await webhooks.handle(event("checkout.session.completed", session))).toEqual({
        received: true,
        outcome: "duplicate_checkout_session",
      });
      expect(await topUps.fulfilFromCheckout(session as any, new Date())).toBe("duplicate_checkout_session");
      expect(await balance(U.buyer)).toBe(before + 1000);

      const grants = await prisma.generationCreditTransaction.findMany({ where: { userId: U.buyer, reason: "top_up" } });
      expect(grants).toEqual([
        expect.objectContaining({ type: "grant", amountCents: 1000, paymentRef: `pi_${started.sessionId}` }),
      ]);
      const row = await prisma.creditTopUp.findUniqueOrThrow({ where: { stripeCheckoutSessionId: started.sessionId } });
      expect(row).toMatchObject({ status: "credited", delivery: "deliver_now", releaseBasis: "consent", creditedCents: 1000, heldUntil: null });

      const notice = await prisma.notice.findFirstOrThrow({ where: { dedupeKey: `credit-topup:${row.id}`, recipientUserId: U.buyer } });
      expect(notice).toMatchObject({ category: "purchase", title: "Credits bought: $10.00", link: "/settings?section=usage" });
      expect(notice.body).toContain("immediate delivery");
      expect(notice.body).toContain(`Receipt reference: pi_${started.sessionId}`);
    });

    it("concurrent deliveries of one session credit it once", async () => {
      const started = await checkout(U.misc, "credits_5", deliverNow);
      const session = completedSession(started);
      const outcomes = await Promise.all([
        topUps.fulfilFromCheckout(session as any, new Date()),
        topUps.fulfilFromCheckout(session as any, new Date()),
        topUps.fulfilFromCheckout(session as any, new Date()),
      ]);
      expect(outcomes.filter((o) => o === "credited")).toHaveLength(1);
      expect(await prisma.generationCreditTransaction.count({ where: { userId: U.misc, paymentRef: `pi_${started.sessionId}` } })).toBe(1);
    });

    it("waits for an asynchronous payment, then credits on async_payment_succeeded", async () => {
      const started = await checkout(U.misc, "credits_5", deliverNow);
      const unpaid = completedSession(started, { payment_status: "unpaid" });
      expect(await webhooks.handle(event("checkout.session.completed", unpaid))).toMatchObject({ outcome: "pending_payment" });
      expect(await prisma.creditTopUp.count({ where: { stripeCheckoutSessionId: started.sessionId } })).toBe(0);
      expect(await webhooks.handle(event("checkout.session.async_payment_succeeded", completedSession(started)))).toMatchObject({
        outcome: "credited",
      });
    });

    it("credits nothing when Stripe reports another amount or currency than the pack's (needs review)", async () => {
      const started = await checkout(U.misc, "credits_25", deliverNow);
      const before = await balance(U.misc);
      const outcome = await topUps.fulfilFromCheckout(completedSession(started, { amount_subtotal: 100 }) as any, new Date());
      expect(outcome).toBe("needs_review");
      expect(await balance(U.misc)).toBe(before);
      const other = await checkout(U.misc, "credits_5", deliverNow);
      const gbp = completedSession(other, { currency: "gbp", amount_subtotal: 430, amount_total: 430 });
      expect(await topUps.fulfilFromCheckout(gbp as any, new Date())).toBe("needs_review");
      // The review row keeps what Stripe reported, in its currency.
      expect(await prisma.creditTopUp.findUniqueOrThrow({ where: { stripeCheckoutSessionId: other.sessionId } })).toMatchObject({
        status: "needs_review",
        currency: "gbp",
        priceCents: 430,
        creditedCents: 0,
      });
      const euroShort = await checkout(U.misc, "credits_10", deliverNow, "eur");
      const short = completedSession(euroShort, { amount_subtotal: 900, amount_total: 900 });
      expect(await topUps.fulfilFromCheckout(short as any, new Date())).toBe("needs_review");
      expect(await balance(U.misc)).toBe(before);
      const row = await prisma.creditTopUp.findUniqueOrThrow({ where: { stripeCheckoutSessionId: started.sessionId } });
      expect(row).toMatchObject({ status: "needs_review", creditedCents: 0 });
      const notice = await prisma.notice.findFirstOrThrow({ where: { dedupeKey: `credit-topup:${row.id}` } });
      expect(notice.title).toBe("Credit purchase received: under review");
    });

    it("EUR, VAT included: credits the same credits as USD and records the currency paid (#2496)", async () => {
      const started = await checkout(U.euro, "credits_10", deliverNow, "eur");
      const before = await balance(U.euro);
      // Stripe reports the included VAT inside the subtotal; the total is still the price.
      const session = completedSession(started, { total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 167 } });
      expect(await webhooks.handle(event("checkout.session.completed", session))).toMatchObject({ outcome: "credited" });
      expect(await balance(U.euro)).toBe(before + 1000);
      const row = await prisma.creditTopUp.findUniqueOrThrow({ where: { stripeCheckoutSessionId: started.sessionId } });
      expect(row).toMatchObject({ status: "credited", currency: "eur", priceCents: 1000, creditsCents: 1000, creditedCents: 1000 });

      const view = (await eurTopUps.getState(U.euro)).purchases.find((p) => p.checkoutSessionId === started.sessionId);
      expect(view).toMatchObject({ label: "€10 credit pack", priceCents: 1000, currency: "eur", creditsCents: 1000 });
      const notice = await prisma.notice.findFirstOrThrow({ where: { dedupeKey: `credit-topup:${row.id}` } });
      expect(notice.title).toBe("Credits bought: $10.00");
      expect(notice.body).toContain("the €10 credit pack for €10.00 (VAT included)");
    });

    it("EUR: also credits when Stripe reports the VAT beside a net subtotal", async () => {
      const started = await checkout(U.euro, "credits_5", wait, "eur");
      const session = completedSession(started, {
        amount_subtotal: 417,
        amount_total: 500,
        total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 83 },
      });
      expect(await topUps.fulfilFromCheckout(session as any, new Date())).toBe("held");
      expect(await prisma.creditTopUp.findUniqueOrThrow({ where: { stripeCheckoutSessionId: started.sessionId } })).toMatchObject({
        status: "held",
        currency: "eur",
        priceCents: 500,
        creditsCents: 500,
      });
    });

    it("ignores a live-mode event on a test deployment, and sessions that are not credit packs", async () => {
      const started = await checkout(U.misc, "credits_5", deliverNow);
      const live = await webhooks.handle(event("checkout.session.completed", completedSession(started), new Date(), true));
      expect(live).toMatchObject({ outcome: "ignored_livemode" });
      expect(await prisma.creditTopUp.count({ where: { stripeCheckoutSessionId: started.sessionId } })).toBe(0);
      const foreign = completedSession(started, { metadata: {} });
      expect(await webhooks.handle(event("checkout.session.completed", foreign))).toMatchObject({ outcome: "ignored_not_credit_topup" });
      const unknownPack = completedSession(started, { metadata: { ...started.params.metadata, packId: "credits_1000" } });
      expect(await webhooks.handle(event("checkout.session.completed", unknownPack))).toMatchObject({ outcome: "ignored_unknown_pack" });
    });
  });

  describe("the 14-day hold", () => {
    let heldSession: string;

    it("wait: holds the credits, leaves the balance alone and says when they arrive", async () => {
      const started = await checkout(U.waiter, "credits_10", wait);
      heldSession = started.sessionId;
      const paidAt = new Date(Date.now() - 60_000);
      expect(await webhooks.handle(event("checkout.session.completed", completedSession(started), paidAt))).toMatchObject({
        outcome: "held",
      });
      expect(await balance(U.waiter)).toBe(0);
      const row = await prisma.creditTopUp.findUniqueOrThrow({ where: { stripeCheckoutSessionId: heldSession } });
      expect(row).toMatchObject({ status: "held", delivery: "wait", creditedCents: 0 });
      expect(row.heldUntil).toEqual(new Date(sec(paidAt) * 1000 + 14 * DAY));

      const state = await topUps.getState(U.waiter);
      expect(state.heldCents).toBe(1000);
      expect(state.purchases[0]).toMatchObject({ status: "held", heldUntil: row.heldUntil!.toISOString() });
      // A balance read before the end of the hold releases nothing.
      expect((await credits.getBalance(U.waiter)).balanceCents).toBe(0);
      const notice = await prisma.notice.findFirstOrThrow({ where: { dedupeKey: `credit-topup:${row.id}` } });
      expect(notice.title).toBe("Credits bought: $10.00, on hold for 14 days");
    });

    it("releases lazily once the hold ends, exactly once even when reads race", async () => {
      const row = await prisma.creditTopUp.findUniqueOrThrow({ where: { stripeCheckoutSessionId: heldSession } });
      const after = new Date(row.heldUntil!.getTime() + 1000);
      const released = await Promise.all([releaseDueTopUpHolds(U.waiter, after), releaseDueTopUpHolds(U.waiter, after)]);
      expect(released.reduce((a, b) => a + b, 0)).toBe(1000);
      expect(await balance(U.waiter)).toBe(1000);
      expect(await prisma.creditTopUp.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        status: "credited",
        releaseBasis: "hold_elapsed",
        creditedCents: 1000,
      });
      expect(await prisma.generationCreditTransaction.count({ where: { userId: U.waiter, reason: "top_up" } })).toBe(1);
    });

    it("is released by the next balance read or debit once its date has passed", async () => {
      const started = await checkout(U.waiter, "credits_5", wait);
      await webhooks.handle(event("checkout.session.completed", completedSession(started)));
      // Fast-forward: the hold ended a minute ago.
      await prisma.creditTopUp.update({
        where: { stripeCheckoutSessionId: started.sessionId },
        data: { heldUntil: new Date(Date.now() - 60_000) },
      });
      await credits.debit(U.waiter, 1500, "test spend", undefined, "remix_draft");
      expect(await balance(U.waiter)).toBe(0);
    });

    it("deliver now later: needs the acknowledgement and the current wording, then credits at once", async () => {
      const started = await checkout(U.waiter, "credits_25", wait);
      await webhooks.handle(event("checkout.session.completed", completedSession(started)));
      const row = await prisma.creditTopUp.findUniqueOrThrow({ where: { stripeCheckoutSessionId: started.sessionId } });

      const unticked = await topUps
        .deliverHeldNow(U.waiter, row.id, { acknowledgedWaiver: false, textVersion: CONSENT_TEXT_VERSION })
        .catch((e) => e);
      expect(unticked.getResponse()).toMatchObject({ code: "waiver_acknowledgement_required" });
      const outdated = await topUps.deliverHeldNow(U.waiter, row.id, { acknowledgedWaiver: true, textVersion: "old" }).catch((e) => e);
      expect(outdated.getResponse()).toMatchObject({ code: "consent_text_outdated" });
      await expect(
        topUps.deliverHeldNow(U.buyer, row.id, { acknowledgedWaiver: true, textVersion: CONSENT_TEXT_VERSION }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await balance(U.waiter)).toBe(0);

      const state = await topUps.deliverHeldNow(U.waiter, row.id, { acknowledgedWaiver: true, textVersion: CONSENT_TEXT_VERSION });
      expect(state.heldCents).toBe(0);
      expect(await balance(U.waiter)).toBe(2500);
      expect(await prisma.creditTopUp.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
        status: "credited",
        releaseBasis: "deliver_now_later",
      });
      const consent = await prisma.purchaseConsent.findFirstOrThrow({
        where: { userId: U.waiter, surface: "credit_topup", consented: true },
      });
      expect(consent.purchaseRef).toBe(started.sessionId);

      const again = await topUps
        .deliverHeldNow(U.waiter, row.id, { acknowledgedWaiver: true, textVersion: CONSENT_TEXT_VERSION })
        .catch((e) => e);
      expect(again).toBeInstanceOf(ConflictException);
      expect(again.getResponse()).toMatchObject({ code: "credit_purchase_not_held" });
      expect(await releaseHeldTopUp(row.id, "hold_elapsed")).toBeNull();
    });
  });

  describe("refunds", () => {
    const charge = (sessionId: string, amount: number, refunded: number, full = false) => ({
      id: `ch_${sessionId}`,
      object: "charge",
      payment_intent: `pi_${sessionId}`,
      amount,
      amount_refunded: refunded,
      refunded: full,
      currency: "usd",
    });

    it("takes back only the unspent credits on a full refund: the balance never goes negative", async () => {
      const started = await checkout(U.refunds, "credits_10", deliverNow);
      await webhooks.handle(event("checkout.session.completed", completedSession(started)));
      await credits.debit(U.refunds, 700, "spend", undefined, "remix_draft");
      expect(await balance(U.refunds)).toBe(300);

      const outcome = await webhooks.handle(event("charge.refunded", charge(started.sessionId, 1000, 1000, true)));
      expect(outcome).toMatchObject({ outcome: "reversed_partially_spent" });
      expect(await balance(U.refunds)).toBe(0);
      const reversal = await prisma.generationCreditTransaction.findFirstOrThrow({
        where: { userId: U.refunds, type: "reversal" },
      });
      expect(reversal).toMatchObject({ amountCents: 300, reason: "top_up_refund", paymentRef: `pi_${started.sessionId}`, balanceAfterCents: 0 });
      expect(await prisma.creditTopUp.findUniqueOrThrow({ where: { stripeCheckoutSessionId: started.sessionId } })).toMatchObject({
        status: "refunded",
        refundedAmountCents: 1000,
        refundedCreditsCents: 1000,
        reversedCents: 300,
      });
      // The same refund again (a new event id) changes nothing.
      expect(await webhooks.handle(event("charge.refunded", charge(started.sessionId, 1000, 1000, true)))).toMatchObject({
        outcome: "skipped_refund_already_applied",
      });
      expect(await prisma.generationCreditTransaction.count({ where: { userId: U.refunds, type: "reversal" } })).toBe(1);
      const notice = await prisma.notice.findFirstOrThrow({ where: { recipientUserId: U.refunds, title: "Credit purchase refunded" } });
      expect(notice.body).toContain("$7.00 had already been used");
    });

    it("withdraws the refunded share on partial refunds, cumulatively", async () => {
      const started = await checkout(U.refunds, "credits_10", deliverNow);
      await webhooks.handle(event("checkout.session.completed", completedSession(started)));
      expect(await balance(U.refunds)).toBe(1000);
      await webhooks.handle(event("charge.refunded", charge(started.sessionId, 1000, 250)));
      expect(await balance(U.refunds)).toBe(750);
      await webhooks.handle(event("charge.refunded", charge(started.sessionId, 1000, 600)));
      expect(await balance(U.refunds)).toBe(400);
      expect(await prisma.creditTopUp.findUniqueOrThrow({ where: { stripeCheckoutSessionId: started.sessionId } })).toMatchObject({
        status: "credited",
        refundedCreditsCents: 600,
        reversedCents: 600,
      });
      await prisma.generationCreditAccount.update({ where: { userId: U.refunds }, data: { balanceCents: 0 } });
    });

    it("a refunded held purchase is never released", async () => {
      const started = await checkout(U.refunds, "credits_5", wait);
      await webhooks.handle(event("checkout.session.completed", completedSession(started)));
      expect(await webhooks.handle(event("charge.refunded", charge(started.sessionId, 500, 500, true)))).toMatchObject({
        outcome: "reversed",
      });
      const row = await prisma.creditTopUp.findUniqueOrThrow({ where: { stripeCheckoutSessionId: started.sessionId } });
      expect(row).toMatchObject({ status: "refunded", reversedCents: 0 });
      expect(await releaseDueTopUpHolds(U.refunds, new Date(Date.now() + 15 * DAY))).toBe(0);
      expect(await balance(U.refunds)).toBe(0);
    });

    it("a partly refunded held purchase releases only the rest", async () => {
      const started = await checkout(U.refunds, "credits_10", wait);
      await webhooks.handle(event("checkout.session.completed", completedSession(started)));
      await webhooks.handle(event("charge.refunded", charge(started.sessionId, 1000, 400)));
      expect(await releaseDueTopUpHolds(U.refunds, new Date(Date.now() + 15 * DAY))).toBe(600);
      expect(await balance(U.refunds)).toBe(600);
    });

    it("refunds an EUR purchase proportionally, and says so in euros", async () => {
      const started = await checkout(U.euro, "credits_25", deliverNow, "eur");
      await webhooks.handle(event("checkout.session.completed", completedSession(started)));
      const before = await balance(U.euro);
      const eurCharge = { ...charge(started.sessionId, 2500, 1000), currency: "eur" };
      expect(await webhooks.handle(event("charge.refunded", eurCharge))).toMatchObject({ outcome: "reversed" });
      expect(await balance(U.euro)).toBe(before - 1000);
      const row = await prisma.creditTopUp.findUniqueOrThrow({ where: { stripeCheckoutSessionId: started.sessionId } });
      expect(row).toMatchObject({ currency: "eur", refundedAmountCents: 1000, refundedCreditsCents: 1000, reversedCents: 1000 });
      const notice = await prisma.notice.findFirstOrThrow({ where: { dedupeKey: `credit-topup-refund:${row.id}:1000` } });
      expect(notice.body).toContain("€25 credit pack was refunded (€10.00 in total)");
      expect(notice.body).toContain("$10.00 of credits were removed");
    });

    it("ignores a refund of a payment that is not a credit pack", async () => {
      expect(await webhooks.handle(event("charge.refunded", charge(`${P}unknown`, 1000, 1000, true)))).toMatchObject({
        outcome: "ignored_not_credit_topup",
      });
    });
  });
});
