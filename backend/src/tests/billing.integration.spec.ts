/**
 * Artist Pro subscriptions through Stripe (#2407), against Postgres.
 *
 * Stripe is a fake gateway (jest.fn): nothing here calls Stripe. Covered:
 * checkout needs a confirmed contact email and records the subscription
 * consent BEFORE the Checkout Session is created; the customer is created once
 * and reused; the portal; the state route; each handled webhook event's state
 * transition; idempotency on the event id (and a retry after a failure);
 * ordering (an older event after a newer one); the entitlement plan from the
 * subscription; and erasure keeping the billing record.
 */
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import { BillingConfig } from "../modules/billing/billing_config";
import { BillingService } from "../modules/billing/billing.service";
import { CreditPackConfig } from "../modules/billing/credit_packs";
import { CreditTopUpService } from "../modules/billing/credit_topup.service";
import type { StripeEvent, StripeGateway, StripeSubscription } from "../modules/billing/stripe_gateway";
import { StripeWebhookService } from "../modules/billing/stripe_webhook.service";
import { EntitlementsService } from "../modules/entitlements/entitlements.service";
import { NoticeService } from "../modules/notifications/notice.service";
import { SUBSCRIPTION_CONSENT_TEXT_VERSION } from "../modules/purchase_consent/purchase_consent.constants";
import { PurchaseConsentService } from "../modules/purchase_consent/purchase_consent.service";
import { EventBus } from "../modules/shared/event_bus";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import { PersonalDataResolverService } from "../modules/identity/personal_data_resolver.service";
import { AccountClosureService } from "../modules/privacy/account_closure.service";
import { PersonalDataErasureService } from "../modules/privacy/personal_data_erasure.service";

const P = `billing_${Date.now()}_`;
const U = {
  buyer: `${P}buyer`,
  noEmail: `${P}no_email`,
  pending: `${P}pending`,
  hooks: `${P}hooks`,
  adopted: `${P}adopted`,
  erased: `${P}erased`,
};
const USERS = Object.values(U);
const DAY = 24 * 60 * 60 * 1000;
const sec = (date: Date) => Math.floor(date.getTime() / 1000);

const config = new BillingConfig({
  STRIPE_SECRET_KEY: "sk_test_integration",
  STRIPE_WEBHOOK_SECRET: "whsec_integration",
  STRIPE_PRICE_ARTIST_PRO_MONTHLY: "price_month",
  STRIPE_PRICE_ARTIST_PRO_ANNUAL: "price_year",
  FRONTEND_URL: "https://app.example.test",
});
const consents = new PurchaseConsentService(new NoticeService(new EventBus(), new AuditService()));
const entitlements = new EntitlementsService();

/** Stripe subscriptions the fake gateway "holds", by id. */
const remote = new Map<string, StripeSubscription>();
let customerSeq = 0;
const gateway = {
  createCustomer: jest.fn(async () => ({ id: `cus_${P}${++customerSeq}` })),
  createCheckoutSession: jest.fn(async () => ({ id: `cs_${P}${Date.now()}`, url: "https://checkout.stripe.test/c/pay" })),
  createPortalSession: jest.fn(async () => ({ url: "https://billing.stripe.test/p/session" })),
  retrieveSubscription: jest.fn(async (id: string) => {
    const sub = remote.get(id);
    if (!sub) throw new Error(`no such subscription ${id}`);
    return sub;
  }),
  constructEvent: jest.fn(),
  cancelSubscription: jest.fn(),
  updateSubscription: jest.fn(),
  updateCustomerEmail: jest.fn(),
} satisfies StripeGateway;

const billing = new BillingService(config, consents, gateway, entitlements);
const topUps = new CreditTopUpService(
  config,
  consents,
  new NoticeService(new EventBus(), new AuditService()),
  gateway,
  new CreditPackConfig({}),
);
const webhooks = new StripeWebhookService(config, gateway, topUps);

function stripeSub(
  id: string,
  customer: string,
  status: string,
  opts: { start?: Date; end?: Date; cancelAtPeriodEnd?: boolean; userId?: string; interval?: string } = {},
): StripeSubscription {
  const start = opts.start ?? new Date();
  const end = opts.end ?? new Date(start.getTime() + 30 * DAY);
  return {
    id,
    object: "subscription",
    customer,
    status,
    cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
    cancel_at: null,
    metadata: opts.userId ? { userId: opts.userId } : {},
    items: {
      data: [
        {
          current_period_start: sec(start),
          current_period_end: sec(end),
          price: { recurring: { interval: opts.interval ?? "month" } },
        },
      ],
    },
  } as unknown as StripeSubscription;
}

let eventSeq = 0;
function event(type: string, object: unknown, created: Date, id = `evt_${P}${++eventSeq}`): StripeEvent {
  return { id, object: "event", type, created: sec(created), livemode: false, data: { object } } as unknown as StripeEvent;
}

const checkoutBody = (overrides: Record<string, unknown> = {}) =>
  ({ interval: "month", acknowledgedImmediateStart: true, textVersion: SUBSCRIPTION_CONSENT_TEXT_VERSION, ...overrides }) as any;

async function row(userId: string) {
  return prisma.subscription.findUnique({ where: { userId } });
}

describe("Billing (integration, #2407)", () => {
  const erasedIds: string[] = [];

  beforeAll(async () => {
    for (const id of USERS) await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    for (const id of [U.buyer, U.hooks, U.erased]) {
      await prisma.contactEmail.create({
        data: { userId: id, address: `${id}@mail.test`, addressNormalized: `${id}@mail.test`, status: "confirmed", confirmedAt: new Date() },
      });
    }
    await prisma.contactEmail.create({
      data: { userId: U.pending, address: `${U.pending}@mail.test`, addressNormalized: `${U.pending}@mail.test`, status: "pending" },
    });
  });

  afterAll(async () => {
    const ids = [...USERS, ...erasedIds];
    await prisma.stripeEvent.deleteMany({ where: { eventId: { startsWith: `evt_${P}` } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: ids } } });
    await prisma.purchaseConsent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.notice.deleteMany({ where: { recipientUserId: { in: ids } } });
    await prisma.contactEmail.deleteMany({ where: { userId: { in: ids } } });
    await prisma.accountClosureRequest.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  beforeEach(() => jest.clearAllMocks());

  describe("checkout", () => {
    it("answers 503 when billing is not configured", async () => {
      const off = new BillingService(new BillingConfig({}), consents, null, entitlements);
      await expect(off.startCheckout(U.buyer, checkoutBody())).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect((await off.getState(U.buyer)).available).toBe(false);
    });

    it.each([
      ["no contact address", U.noEmail],
      ["an unconfirmed address", U.pending],
    ])("needs a confirmed contact email (409 contact_email_required) with %s, and records nothing", async (_label, userId) => {
      const error = await billing.startCheckout(userId, checkoutBody()).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ code: "contact_email_required" });
      expect(await prisma.purchaseConsent.count({ where: { userId } })).toBe(0);
      expect(gateway.createCheckoutSession).not.toHaveBeenCalled();
    });

    it("refuses an outdated wording (409) and a missing acknowledgement (400) without recording a consent", async () => {
      const outdated = await billing.startCheckout(U.buyer, checkoutBody({ textVersion: "old" })).catch((e) => e);
      expect(outdated).toBeInstanceOf(ConflictException);
      expect(outdated.getResponse()).toMatchObject({ code: "consent_text_outdated" });
      const unticked = await billing.startCheckout(U.buyer, checkoutBody({ acknowledgedImmediateStart: false })).catch((e) => e);
      expect(unticked).toBeInstanceOf(BadRequestException);
      expect(unticked.getResponse()).toMatchObject({ code: "subscription_consent_required" });
      expect(await prisma.purchaseConsent.count({ where: { userId: U.buyer } })).toBe(0);
    });

    it("records the consent before creating the session, creates one customer and returns the Checkout URL", async () => {
      let consentsWhenSessionCreated = -1;
      gateway.createCheckoutSession.mockImplementationOnce(async () => {
        consentsWhenSessionCreated = await prisma.purchaseConsent.count({ where: { userId: U.buyer, surface: "subscription" } });
        return { id: `cs_${P}first`, url: "https://checkout.stripe.test/c/pay" };
      });

      await expect(billing.startCheckout(U.buyer, checkoutBody())).resolves.toEqual({ url: "https://checkout.stripe.test/c/pay" });
      expect(consentsWhenSessionCreated).toBe(1);

      const consent = await prisma.purchaseConsent.findFirstOrThrow({ where: { userId: U.buyer, surface: "subscription" } });
      expect(consent).toMatchObject({
        subjectId: "artist_pro_month",
        subjectLabel: "Artist Pro (monthly)",
        deliveryKind: "service",
        consented: true,
        acknowledgedWaiver: true,
        textVersion: SUBSCRIPTION_CONSENT_TEXT_VERSION,
        deliveryAvailableAt: null,
        purchaseRef: `cs_${P}first`,
      });

      expect(gateway.createCustomer).toHaveBeenCalledTimes(1);
      expect(gateway.createCustomer.mock.calls[0]).toEqual([
        { email: `${U.buyer}@mail.test`, metadata: { userId: U.buyer } },
        expect.stringMatching(new RegExp(`^resonate-customer-${U.buyer}-[0-9a-f]{16}$`)),
      ]);
      const [params, key] = gateway.createCheckoutSession.mock.calls[0] as unknown as [Record<string, any>, string];
      const customer = (await row(U.buyer))!.stripeCustomerId;
      expect(params).toMatchObject({
        mode: "subscription",
        customer,
        client_reference_id: U.buyer,
        line_items: [{ price: "price_month", quantity: 1 }],
        success_url: "https://app.example.test/settings?section=usage&billing=success",
        cancel_url: "https://app.example.test/settings?section=usage&billing=cancel",
        metadata: { userId: U.buyer, consentId: consent.id, interval: "month" },
        subscription_data: { metadata: { userId: U.buyer, consentId: consent.id } },
      });
      expect(params.automatic_tax).toBeUndefined();
      expect(key).toBe(`resonate-checkout-${consent.id}`);
      expect(await row(U.buyer)).toMatchObject({ status: "incomplete", stripeSubscriptionId: null, interval: "month" });

      // The durable confirmation notice names the subscription.
      const notice = await prisma.notice.findFirst({ where: { dedupeKey: `purchase-consent:${consent.id}`, recipientUserId: U.buyer } });
      expect(notice?.title).toBe("Subscription start confirmed");
    });

    it("reuses the same customer on the next checkout (yearly)", async () => {
      const before = (await row(U.buyer))!.stripeCustomerId;
      await billing.startCheckout(U.buyer, checkoutBody({ interval: "year" }));
      expect(gateway.createCustomer).not.toHaveBeenCalled();
      const [params] = gateway.createCheckoutSession.mock.calls[0] as unknown as [Record<string, any>];
      expect(params).toMatchObject({ customer: before, line_items: [{ price: "price_year", quantity: 1 }] });
    });

    it("never takes the subscription consent through the generic consent route", async () => {
      const error = await consents
        .record(U.buyer, {
          surface: "subscription",
          subjectId: "artist_pro_month",
          consented: true,
          acknowledgedWaiver: true,
          textVersion: SUBSCRIPTION_CONSENT_TEXT_VERSION,
        })
        .catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toMatchObject({ code: "use_subscription_checkout" });
    });
  });

  describe("webhook events", () => {
    let customer: string;
    const subId = `sub_${P}hooks`;
    const t0 = new Date(Date.now() - 2 * DAY);
    const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

    beforeAll(async () => {
      await billing.startCheckout(U.hooks, checkoutBody());
      customer = (await row(U.hooks))!.stripeCustomerId;
    });

    it("checkout.session.completed re-reads the subscription and makes the person Pro", async () => {
      const periodEnd = new Date(Date.now() + 28 * DAY);
      remote.set(subId, stripeSub(subId, customer, "active", { start: t0, end: periodEnd, userId: U.hooks }));
      const result = await webhooks.handle(
        event("checkout.session.completed", { object: "checkout.session", mode: "subscription", subscription: subId, customer, client_reference_id: U.hooks }, at(1)),
      );
      expect(result).toEqual({ received: true, outcome: "applied" });
      expect(gateway.retrieveSubscription).toHaveBeenCalledWith(subId);
      expect(await row(U.hooks)).toMatchObject({
        stripeSubscriptionId: subId,
        status: "active",
        currentPeriodEnd: new Date(sec(periodEnd) * 1000),
        cancelAtPeriodEnd: false,
        pastDueSince: null,
        lastEventCreatedAt: new Date(sec(at(1)) * 1000),
      });
      expect(await entitlements.resolvePlan(U.hooks)).toEqual({
        plan: "pro",
        source: "stripe_subscription",
        validUntil: new Date(sec(periodEnd) * 1000).toISOString(),
      });
      // While live, a second checkout is refused.
      const again = await billing.startCheckout(U.hooks, checkoutBody()).catch((e) => e);
      expect(again.getResponse()).toMatchObject({ code: "already_subscribed" });
    });

    it("is idempotent on the event id: the same event twice is applied once", async () => {
      const sub = stripeSub(subId, customer, "active", { start: t0, end: new Date(Date.now() + 28 * DAY), cancelAtPeriodEnd: true });
      const evt = event("customer.subscription.updated", sub, at(2));
      expect(await webhooks.handle(evt)).toEqual({ received: true, outcome: "applied" });
      const afterFirst = await row(U.hooks);
      expect(afterFirst?.cancelAtPeriodEnd).toBe(true);

      // Someone changes the row in between; a replay of the same event must not touch it.
      await prisma.subscription.update({ where: { userId: U.hooks }, data: { cancelAtPeriodEnd: false } });
      expect(await webhooks.handle(evt)).toEqual({ received: true, duplicate: true });
      expect((await row(U.hooks))?.cancelAtPeriodEnd).toBe(false);
      expect(await prisma.stripeEvent.findUnique({ where: { eventId: evt.id } })).toMatchObject({
        type: "customer.subscription.updated",
        processedAt: expect.any(Date),
      });
      await prisma.subscription.update({ where: { userId: U.hooks }, data: { cancelAtPeriodEnd: true } });
    });

    it("never lets an older event overwrite a newer state", async () => {
      const stale = stripeSub(subId, customer, "incomplete", { start: t0, end: new Date(Date.now() + 28 * DAY) });
      const result = await webhooks.handle(event("customer.subscription.created", stale, at(0)));
      expect(result).toEqual({ received: true, outcome: "skipped_older_event" });
      expect(await row(U.hooks)).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
    });

    it("invoice.payment_failed marks the subscription past due and starts the 7-day grace", async () => {
      remote.set(subId, stripeSub(subId, customer, "past_due", { start: t0, end: new Date(Date.now() + 28 * DAY) }));
      const failedAt = at(10);
      const invoice = { object: "invoice", parent: { subscription_details: { subscription: subId } } };
      expect(await webhooks.handle(event("invoice.payment_failed", invoice, failedAt))).toMatchObject({ outcome: "applied" });
      const pastDue = await row(U.hooks);
      expect(pastDue).toMatchObject({ status: "past_due", pastDueSince: new Date(sec(failedAt) * 1000) });

      const plan = await entitlements.resolvePlan(U.hooks);
      expect(plan).toEqual({
        plan: "pro",
        source: "stripe_subscription",
        validUntil: new Date(sec(failedAt) * 1000 + 7 * DAY).toISOString(),
      });
      // Eight days later, the grace is over.
      expect((await entitlements.resolvePlan(U.hooks, new Date(failedAt.getTime() + 8 * DAY))).plan).toBe("free");

      const state = await billing.getState(U.hooks);
      expect(state.subscription).toMatchObject({
        status: "past_due",
        graceEndsAt: new Date(sec(failedAt) * 1000 + 7 * DAY).toISOString(),
      });

      // A repeated failure keeps the original start of the grace.
      await webhooks.handle(event("invoice.payment_failed", invoice, at(20)));
      expect((await row(U.hooks))?.pastDueSince).toEqual(new Date(sec(failedAt) * 1000));
    });

    it("invoice.paid brings the subscription back to active and clears the grace", async () => {
      const nextEnd = new Date(Date.now() + 58 * DAY);
      remote.set(subId, stripeSub(subId, customer, "active", { start: new Date(), end: nextEnd }));
      const invoice = { object: "invoice", parent: { subscription_details: { subscription: { id: subId } } } };
      expect(await webhooks.handle(event("invoice.paid", invoice, at(30)))).toMatchObject({ outcome: "applied" });
      expect(await row(U.hooks)).toMatchObject({ status: "active", pastDueSince: null, currentPeriodEnd: new Date(sec(nextEnd) * 1000) });
    });

    it("retries an event whose processing failed, then applies it", async () => {
      const invoice = { object: "invoice", parent: { subscription_details: { subscription: subId } } };
      const evt = event("invoice.paid", invoice, at(31));
      gateway.retrieveSubscription.mockRejectedValueOnce(new Error("network"));
      await expect(webhooks.handle(evt)).rejects.toThrow("network");
      expect((await prisma.stripeEvent.findUnique({ where: { eventId: evt.id } }))?.processedAt).toBeNull();
      expect(await webhooks.handle(evt)).toMatchObject({ outcome: "applied" });
    });

    it("customer.subscription.deleted ends Pro; nothing reopens it afterwards", async () => {
      const ended = stripeSub(subId, customer, "canceled", { start: t0, end: new Date(Date.now() + 58 * DAY) });
      expect(await webhooks.handle(event("customer.subscription.deleted", ended, at(40)))).toMatchObject({ outcome: "applied" });
      expect(await row(U.hooks)).toMatchObject({ status: "canceled", cancelAtPeriodEnd: false });
      expect((await entitlements.resolvePlan(U.hooks)).plan).toBe("free");

      const late = stripeSub(subId, customer, "active", { start: t0, end: new Date(Date.now() + 58 * DAY) });
      expect(await webhooks.handle(event("customer.subscription.updated", late, at(41)))).toMatchObject({
        outcome: "skipped_terminal",
      });
      // A new subscription can start again, with the same customer.
      gateway.createCustomer.mockClear();
      await billing.startCheckout(U.hooks, checkoutBody());
      expect(gateway.createCustomer).not.toHaveBeenCalled();
    });

    it("cancellation at period end keeps Pro until that end", async () => {
      const end = new Date(Date.now() + 5 * DAY);
      const next = `sub_${P}hooks_2`;
      const sub = stripeSub(next, customer, "canceled", { start: new Date(), end, cancelAtPeriodEnd: true });
      await webhooks.handle(event("customer.subscription.updated", sub, at(50)));
      expect(await entitlements.resolvePlan(U.hooks)).toEqual({
        plan: "pro",
        source: "stripe_subscription",
        validUntil: new Date(sec(end) * 1000).toISOString(),
      });
    });

    it("adopts an unknown customer only when the metadata names a live account without a billing row", async () => {
      const sub = stripeSub(`sub_${P}adopt`, `cus_${P}adopt`, "active", { userId: U.adopted });
      expect(await webhooks.handle(event("customer.subscription.created", sub, new Date()))).toMatchObject({ outcome: "created" });
      expect(await row(U.adopted)).toMatchObject({ stripeCustomerId: `cus_${P}adopt`, status: "active" });

      const stranger = stripeSub(`sub_${P}stranger`, `cus_${P}stranger`, "active");
      expect(await webhooks.handle(event("customer.subscription.created", stranger, new Date()))).toMatchObject({
        outcome: "ignored_unknown_customer",
      });
      const clash = stripeSub(`sub_${P}clash`, `cus_${P}clash`, "active", { userId: U.adopted });
      expect(await webhooks.handle(event("customer.subscription.created", clash, new Date()))).toMatchObject({
        outcome: "ignored_customer_mismatch",
      });
    });

    it("acknowledges an unhandled event type and a live-mode event without applying them", async () => {
      expect(await webhooks.handle(event("customer.created", { object: "customer" }, new Date()))).toMatchObject({
        outcome: "ignored_unhandled_type",
      });
      const live = { ...event("customer.subscription.updated", stripeSub(subId, customer, "active"), new Date()), livemode: true } as StripeEvent;
      expect(await webhooks.handle(live)).toMatchObject({ outcome: "ignored_livemode" });
    });
  });

  describe("portal and state", () => {
    it("opens the portal for a person with a customer, and 404 without one", async () => {
      await expect(billing.openPortal(U.buyer)).resolves.toEqual({ url: "https://billing.stripe.test/p/session" });
      expect(gateway.createPortalSession).toHaveBeenCalledWith({
        customer: (await row(U.buyer))!.stripeCustomerId,
        return_url: "https://app.example.test/settings?section=usage&billing=portal",
      });
      await expect(billing.openPortal(U.noEmail)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("reports availability, test mode, the email gate, the account and the wording", async () => {
      const buyer = await billing.getState(U.buyer);
      expect(buyer).toMatchObject({
        available: true,
        testMode: true,
        contactEmailConfirmed: true,
        hasBillingAccount: true,
        plan: { plan: "free" },
        subscription: null,
        consent: { version: SUBSCRIPTION_CONSENT_TEXT_VERSION },
      });
      expect((await billing.getState(U.pending)).contactEmailConfirmed).toBe(false);
      expect((await billing.getState(U.noEmail)).hasBillingAccount).toBe(false);
    });
  });

  describe("erasure", () => {
    it("keeps the billing record, re-keyed to the erased account", async () => {
      await billing.startCheckout(U.erased, checkoutBody());
      const before = (await row(U.erased))!;
      const erasure = new PersonalDataErasureService(
        new PersonalDataResolverService(),
        new AnalyticsGovernanceService(),
        new AccountClosureService(),
      );
      const result = await erasure.eraseAccount(U.erased);
      erasedIds.push(result.newUserId);
      const after = await prisma.subscription.findUniqueOrThrow({ where: { id: before.id } });
      expect(after).toMatchObject({ userId: result.newUserId, stripeCustomerId: before.stripeCustomerId });
      expect(await prisma.purchaseConsent.count({ where: { userId: result.newUserId, surface: "subscription" } })).toBe(1);
    });
  });
});
