/**
 * What an account's lifecycle does to its Stripe subscription (#2430), against
 * Postgres. Stripe is a fake gateway (jest.fn) holding subscriptions in a map:
 * nothing here calls Stripe.
 *
 * Covered: erasure cancels a live subscription first and does not run until
 * Stripe confirms (retried by the due-erasure run); operator closure cancels
 * immediately and a Stripe failure is retried by the retention job; suspension
 * pauses collection and lifting it resumes; a self-service closure request
 * stops renewals; a confirmed contact address becomes the billing email; and
 * StripeEvent rows processed more than 90 days ago are pruned.
 */
import type { SubscriptionStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { AccountStandingService } from "../modules/accounts/account_standing.service";
import { AccountStatusService } from "../modules/accounts/account_status.service";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import { AuditService } from "../modules/audit/audit.service";
import { BillingConfig } from "../modules/billing/billing_config";
import { CreditPackConfig } from "../modules/billing/credit_packs";
import { CreditTopUpService } from "../modules/billing/credit_topup.service";
import { runBillingRetention } from "../modules/billing/billing_retention";
import type { StripeGateway, StripeSubscription } from "../modules/billing/stripe_gateway";
import { StripeWebhookService } from "../modules/billing/stripe_webhook.service";
import {
  SubscriptionCancellationPendingError,
  SubscriptionLifecycleService,
} from "../modules/billing/subscription_lifecycle.service";
import { ContactEmailService } from "../modules/email/contact_email.service";
import { EmailConfig } from "../modules/email/email_config";
import { sha256Hex } from "../modules/email/email_tokens";
import { PersonalDataResolverService } from "../modules/identity/personal_data_resolver.service";
import { NoticeService } from "../modules/notifications/notice.service";
import { PurchaseConsentService } from "../modules/purchase_consent/purchase_consent.service";
import { AccountClosureService } from "../modules/privacy/account_closure.service";
import { PersonalDataErasureService } from "../modules/privacy/personal_data_erasure.service";
import { EventBus } from "../modules/shared/event_bus";

const P = `billing_life_${Date.now()}_`;
const DAY = 24 * 60 * 60 * 1000;
const sec = (date: Date) => Math.floor(date.getTime() / 1000);

const config = new BillingConfig({
  STRIPE_SECRET_KEY: "sk_test_lifecycle",
  STRIPE_WEBHOOK_SECRET: "whsec_lifecycle",
  STRIPE_PRICE_ARTIST_PRO_MONTHLY: "price_month",
  STRIPE_PRICE_ARTIST_PRO_ANNUAL: "price_year",
  FRONTEND_URL: "https://app.example.test",
});

/** Stripe subscriptions the fake gateway "holds", by id. */
const remote = new Map<string, StripeSubscription>();
function stripeSub(id: string, customer: string, status: string): StripeSubscription {
  const start = new Date();
  return {
    id,
    object: "subscription",
    customer,
    status,
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: {},
    items: {
      data: [
        {
          current_period_start: sec(start),
          current_period_end: sec(new Date(start.getTime() + 30 * DAY)),
          price: { recurring: { interval: "month" } },
        },
      ],
    },
  } as unknown as StripeSubscription;
}
function stripeError(code: string) {
  return Object.assign(new Error(`Stripe said ${code} with some@address.test`), { type: "StripeAPIError", code });
}

const gateway = {
  createCustomer: jest.fn(),
  createCheckoutSession: jest.fn(),
  createPortalSession: jest.fn(),
  retrieveSubscription: jest.fn(async (id: string) => {
    const sub = remote.get(id);
    if (!sub) throw stripeError("resource_missing");
    return sub;
  }),
  cancelSubscription: jest.fn(async (id: string) => {
    const sub = remote.get(id)!;
    const canceled = { ...sub, status: "canceled" } as StripeSubscription;
    remote.set(id, canceled);
    return canceled;
  }),
  updateSubscription: jest.fn(async (id: string) => remote.get(id)!),
  updateCustomerEmail: jest.fn(async () => undefined),
  constructEvent: jest.fn(),
} satisfies StripeGateway;

const lifecycle = new SubscriptionLifecycleService(config, gateway);
const audit = new AuditService();
const notices = new NoticeService(new EventBus(), audit);
const accounts = new AccountStatusService(
  audit,
  notices,
  new AccountClosureService(),
  new AccountStandingService(),
  lifecycle,
);
const erasure = new PersonalDataErasureService(
  new PersonalDataResolverService(),
  new AnalyticsGovernanceService(),
  new AccountClosureService(),
  lifecycle,
);
const operator = { userId: `${P}operator`, role: "admin" };

const created: string[] = [operator.userId];
const erasedIds: string[] = [];
let seq = 0;

/** A person with a live (by default) subscription, mirrored at Stripe. */
async function subscriber(name: string, status: SubscriptionStatus = "active") {
  const userId = `${P}${name}`;
  const n = ++seq;
  const customer = `cus_${P}${n}`;
  const subscriptionId = `sub_${P}${n}`;
  await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
  created.push(userId);
  await prisma.subscription.create({
    data: {
      userId,
      stripeCustomerId: customer,
      stripeSubscriptionId: subscriptionId,
      interval: "month",
      status,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * DAY),
    },
  });
  remote.set(subscriptionId, stripeSub(subscriptionId, customer, status));
  return { userId, customer, subscriptionId };
}

const row = (userId: string) => prisma.subscription.findUniqueOrThrow({ where: { userId } });

describe("Billing account lifecycle (integration, #2430)", () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: operator.userId, email: `${operator.userId}@test.resonate` } });
  });

  afterAll(async () => {
    const ids = [...created, ...erasedIds];
    await prisma.stripeEvent.deleteMany({ where: { eventId: { startsWith: `evt_${P}` } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: ids } } });
    await prisma.adminAuditEvent.deleteMany({ where: { actorUserId: operator.userId } });
    await prisma.notice.deleteMany({ where: { recipientUserId: { in: ids } } });
    await prisma.contactEmail.deleteMany({ where: { userId: { in: ids } } });
    await prisma.accountClosureRequest.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  beforeEach(() => jest.clearAllMocks());

  describe("cancellation (endForAccount)", () => {
    it("answers none without a subscription, and cancels nothing before a checkout completes", async () => {
      const userId = `${P}no_sub`;
      await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
      created.push(userId);
      expect(await lifecycle.endForAccount(userId, "account_closure")).toBe("none");
      await prisma.subscription.create({
        data: { userId, stripeCustomerId: `cus_${P}incomplete`, interval: "month", status: "incomplete" },
      });
      expect(await lifecycle.endForAccount(userId, "account_closure")).toBe("none");
      expect(gateway.cancelSubscription).not.toHaveBeenCalled();
    });

    it("cancels immediately, records the request, and is idempotent", async () => {
      const { userId, subscriptionId } = await subscriber("cancel");
      expect(await lifecycle.endForAccount(userId, "account_closure")).toBe("canceled");
      expect(gateway.cancelSubscription).toHaveBeenCalledWith(subscriptionId, `resonate-cancel-${subscriptionId}`);
      const after = await row(userId);
      expect(after).toMatchObject({
        status: "canceled",
        endReason: "account_closure",
        endAttempts: 1,
        endLastError: null,
        cancelAtPeriodEnd: false,
      });
      expect(after.endRequestedAt).toBeInstanceOf(Date);
      expect(after.endConfirmedAt).toBeInstanceOf(Date);

      expect(await lifecycle.endForAccount(userId, "account_erasure")).toBe("already_ended");
      expect(gateway.cancelSubscription).toHaveBeenCalledTimes(1);
      expect((await row(userId)).endReason).toBe("account_closure");
    });

    it("does not cancel again what Stripe already canceled, and treats a missing subscription as ended", async () => {
      const ended = await subscriber("remote_ended");
      remote.set(ended.subscriptionId, stripeSub(ended.subscriptionId, ended.customer, "canceled"));
      expect(await lifecycle.endForAccount(ended.userId, "account_closure")).toBe("canceled");
      expect(gateway.cancelSubscription).not.toHaveBeenCalled();

      const missing = await subscriber("remote_missing");
      remote.delete(missing.subscriptionId);
      expect(await lifecycle.endForAccount(missing.userId, "account_closure")).toBe("canceled");
      expect((await row(missing.userId)).status).toBe("canceled");
    });

    it("throws while Stripe has not confirmed, keeping a code but never the message", async () => {
      const { userId } = await subscriber("cancel_fails");
      gateway.cancelSubscription.mockRejectedValueOnce(stripeError("api_connection_error"));
      await expect(lifecycle.endForAccount(userId, "account_closure")).rejects.toBeInstanceOf(
        SubscriptionCancellationPendingError,
      );
      const pending = await row(userId);
      expect(pending).toMatchObject({ status: "active", endAttempts: 1, endLastError: "api_connection_error", endConfirmedAt: null });
      expect(pending.endRequestedAt).toBeInstanceOf(Date);

      const off = new SubscriptionLifecycleService(new BillingConfig({}), null);
      await expect(off.endForAccount(userId, "account_closure")).rejects.toMatchObject({ code: "billing_unavailable" });
    });

    it("keeps a canceled subscription canceled when an older webhook arrives afterwards", async () => {
      const { userId, customer, subscriptionId } = await subscriber("late_webhook");
      await lifecycle.endForAccount(userId, "account_closure");
      const topUps = new CreditTopUpService(config, new PurchaseConsentService(notices), notices, gateway, new CreditPackConfig({}));
      const webhooks = new StripeWebhookService(config, gateway, topUps);
      const outcome = await webhooks.applySnapshot(
        {
          stripeSubscriptionId: subscriptionId,
          stripeCustomerId: customer,
          status: "active",
          interval: "month",
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * DAY),
          cancelAtPeriodEnd: false,
          userIdHint: null,
        },
        new Date(Date.now() - 60_000),
        { fresh: false },
      );
      expect(outcome).toBe("skipped_terminal");
      expect((await row(userId)).status).toBe("canceled");
    });
  });

  describe("erasure", () => {
    it("does not erase until Stripe confirms the cancellation; the due run retries", async () => {
      const { userId, subscriptionId } = await subscriber("erased");
      const closure = await new AccountClosureService().request(userId);
      await prisma.accountClosureRequest.update({ where: { id: closure.id }, data: { dueAt: new Date(Date.now() - 1000) } });

      gateway.cancelSubscription.mockRejectedValueOnce(stripeError("rate_limit"));
      const first = await erasure.runDueErasures({ limit: 50 });
      expect(first.results.find((r) => r.requestId === closure.id)).toMatchObject({ status: "failed" });
      const stillPending = await prisma.accountClosureRequest.findUniqueOrThrow({ where: { id: closure.id } });
      expect(stillPending.status).toBe("pending");
      expect(stillPending.failureMessage).toContain("rate_limit");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).erasedAt).toBeNull();
      expect(remote.get(subscriptionId)!.status).toBe("active");

      const second = await erasure.runDueErasures({ limit: 50 });
      const outcome = second.results.find((r) => r.requestId === closure.id);
      expect(outcome).toMatchObject({ status: "erased" });
      erasedIds.push((outcome as { newUserId: string }).newUserId);
      expect(remote.get(subscriptionId)!.status).toBe("canceled");
      const billingRecord = await prisma.subscription.findUniqueOrThrow({ where: { stripeSubscriptionId: subscriptionId } });
      expect(billingRecord).toMatchObject({
        userId: (outcome as { newUserId: string }).newUserId,
        status: "canceled",
        endReason: "account_erasure",
        endAttempts: 2,
      });
      expect(billingRecord.endConfirmedAt).toBeInstanceOf(Date);
      expect((await prisma.accountClosureRequest.findUniqueOrThrow({ where: { id: closure.id } })).status).toBe("completed");
    });

    it("never erases an account with a live subscription when no Stripe gateway is configured", async () => {
      const { userId } = await subscriber("erase_no_gateway");
      const unbilled = new PersonalDataErasureService(
        new PersonalDataResolverService(),
        new AnalyticsGovernanceService(),
        new AccountClosureService(),
      );
      await expect(unbilled.eraseAccount(userId)).rejects.toBeInstanceOf(SubscriptionCancellationPendingError);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).erasedAt).toBeNull();
    });
  });

  describe("operator closure", () => {
    it("cancels immediately and records the outcome in the audit trail", async () => {
      const { userId, subscriptionId } = await subscriber("closed");
      await accounts.close(operator, userId, { reason: "fraud" });
      expect(remote.get(subscriptionId)!.status).toBe("canceled");
      expect(await row(userId)).toMatchObject({ status: "canceled", endReason: "account_closure" });
      const event = await prisma.adminAuditEvent.findFirstOrThrow({
        where: { actorUserId: operator.userId, targetUserId: userId, action: "account.closed" },
      });
      expect(event.detail).toMatchObject({ subscription: "canceled" });
    });

    it("still closes when Stripe fails, and the retention job finishes the cancellation", async () => {
      const { userId, subscriptionId } = await subscriber("closed_retry");
      gateway.cancelSubscription.mockRejectedValueOnce(stripeError("api_error"));
      await accounts.close(operator, userId, { reason: "abuse" });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).accountStatus).toBe("closed");
      expect((await row(userId)).endConfirmedAt).toBeNull();
      const event = await prisma.adminAuditEvent.findFirstOrThrow({
        where: { actorUserId: operator.userId, targetUserId: userId, action: "account.closed" },
      });
      expect(event.detail).toMatchObject({ subscription: "pending" });

      const result = await runBillingRetention(lifecycle);
      expect(result.reconciled!.ended).toBeGreaterThanOrEqual(1);
      expect(remote.get(subscriptionId)!.status).toBe("canceled");
      expect(await row(userId)).toMatchObject({ status: "canceled", endAttempts: 2 });
    });
  });

  describe("suspension", () => {
    it("pauses collection until the suspension ends, and resumes when it is lifted", async () => {
      const { userId, subscriptionId } = await subscriber("suspended");
      const until = new Date(Date.now() + 10 * DAY);
      await accounts.suspend(operator, userId, { reason: "terms_violation", until: until.toISOString() });
      expect(gateway.updateSubscription).toHaveBeenCalledWith(subscriptionId, {
        pause_collection: { behavior: "void", resumes_at: sec(until) },
      });
      expect((await row(userId)).collectionPausedAt).toBeInstanceOf(Date);
      expect(remote.get(subscriptionId)!.status).toBe("active");

      await accounts.unsuspend(operator, userId);
      expect(gateway.updateSubscription).toHaveBeenLastCalledWith(subscriptionId, { pause_collection: "" });
      expect((await row(userId)).collectionPausedAt).toBeNull();
      const lifted = await prisma.adminAuditEvent.findFirstOrThrow({
        where: { actorUserId: operator.userId, targetUserId: userId, action: "account.unsuspended" },
      });
      expect(lifted.detail).toMatchObject({ billingCollection: "resumed" });
    });

    it("retries a failed pause, and clears the pause of a suspension that ran out", async () => {
      const { userId, subscriptionId } = await subscriber("suspended_retry");
      gateway.updateSubscription.mockRejectedValueOnce(stripeError("api_error"));
      await accounts.suspend(operator, userId, { reason: "abuse" });
      expect((await row(userId)).collectionPausedAt).toBeNull();

      await runBillingRetention(lifecycle);
      expect(gateway.updateSubscription).toHaveBeenCalledWith(subscriptionId, { pause_collection: { behavior: "void" } });
      expect((await row(userId)).collectionPausedAt).toBeInstanceOf(Date);

      // The suspension's end passes (lazy expiry: the row still says suspended).
      await prisma.user.update({ where: { id: userId }, data: { accountStatusUntil: new Date(Date.now() - 1000) } });
      await runBillingRetention(lifecycle);
      expect(gateway.updateSubscription).toHaveBeenLastCalledWith(subscriptionId, { pause_collection: "" });
      expect((await row(userId)).collectionPausedAt).toBeNull();
    });
  });

  describe("self-service closure request", () => {
    it("stops renewals once per request, and the retention job retries a failure", async () => {
      const { userId, subscriptionId } = await subscriber("closure_request");
      const closure = await new AccountClosureService().request(userId);
      gateway.updateSubscription.mockRejectedValueOnce(stripeError("api_error"));
      expect(await lifecycle.scheduleEndForClosureRequest(userId, closure.id)).toBe("deferred");
      expect((await row(userId)).cancelAtPeriodEnd).toBe(false);

      await runBillingRetention(lifecycle);
      expect(gateway.updateSubscription).toHaveBeenLastCalledWith(subscriptionId, { cancel_at_period_end: true });
      expect(await row(userId)).toMatchObject({ cancelAtPeriodEnd: true, closureRequestId: closure.id });

      expect(await lifecycle.scheduleEndForClosureRequest(userId, closure.id)).toBe("already_scheduled");
    });
  });

  describe("billing email", () => {
    it("pushes a newly confirmed contact address to the Stripe customer, retrying a failure", async () => {
      const { userId, customer } = await subscriber("email");
      const contacts = new ContactEmailService(new EmailConfig({ NODE_ENV: "test" }), null, notices, lifecycle);
      const token = `${P}confirm-token-email`;
      await prisma.contactEmail.create({
        data: {
          userId,
          address: `${userId}@new.test`,
          addressNormalized: `${userId}@new.test`,
          status: "pending",
          confirmTokenHash: sha256Hex(token),
          confirmTokenExpiresAt: new Date(Date.now() + DAY),
        },
      });
      gateway.updateCustomerEmail.mockRejectedValueOnce(stripeError("api_error"));
      await expect(contacts.confirm(token)).resolves.toEqual({ status: "confirmed" });
      expect((await row(userId)).billingEmailStale).toBe(true);

      await runBillingRetention(lifecycle);
      expect(gateway.updateCustomerEmail).toHaveBeenLastCalledWith(customer, `${userId}@new.test`);
      expect((await row(userId)).billingEmailStale).toBe(false);
    });
  });

  describe("StripeEvent retention", () => {
    it("prunes events processed more than 90 days ago and keeps the rest", async () => {
      const now = new Date();
      await prisma.stripeEvent.createMany({
        data: [
          { eventId: `evt_${P}old`, type: "invoice.paid", receivedAt: new Date(now.getTime() - 120 * DAY), processedAt: new Date(now.getTime() - 91 * DAY) },
          { eventId: `evt_${P}recent`, type: "invoice.paid", receivedAt: new Date(now.getTime() - 89 * DAY), processedAt: new Date(now.getTime() - 89 * DAY) },
          { eventId: `evt_${P}unprocessed`, type: "invoice.paid", receivedAt: new Date(now.getTime() - 120 * DAY), processedAt: null },
        ],
      });
      const result = await runBillingRetention(lifecycle, now);
      expect(result.stripeEventsPruned).toBeGreaterThanOrEqual(1);
      const left = await prisma.stripeEvent.findMany({ where: { eventId: { startsWith: `evt_${P}` } }, select: { eventId: true } });
      expect(left.map((e) => e.eventId).sort()).toEqual([`evt_${P}recent`, `evt_${P}unprocessed`]);
    });
  });
});
