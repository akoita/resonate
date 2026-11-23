/**
 * Refunds on an operator closure (#2595) against a real Postgres, with a fake
 * Stripe gateway: a closure that is not for a serious breach refunds the
 * unused days of the running Artist Pro period and unspent bought credits
 * (newest pack first, a held pack in full); a breach closure refunds nothing;
 * a Stripe failure is retried by the retention job; nothing is refunded twice.
 */
import { prisma } from "../db/prisma";
import { AccountStandingService } from "../modules/accounts/account_standing.service";
import { AccountStatusService, CLOSURE_REFUND_NOTE } from "../modules/accounts/account_status.service";
import { AuditService } from "../modules/audit/audit.service";
import { BillingConfig } from "../modules/billing/billing_config";
import { runBillingRetention } from "../modules/billing/billing_retention";
import { allocatePackRefunds, planClosureRefunds, unusedDaysRefundCents } from "../modules/billing/closure_refunds";
import type { StripeGateway, StripeSubscription } from "../modules/billing/stripe_gateway";
import { SubscriptionLifecycleService } from "../modules/billing/subscription_lifecycle.service";
import { NoticeService } from "../modules/notifications/notice.service";
import { AccountClosureService } from "../modules/privacy/account_closure.service";
import { EventBus } from "../modules/shared/event_bus";

const P = `closure_refund_${Date.now()}_`;
const DAY = 24 * 60 * 60 * 1000;

const config = new BillingConfig({
  STRIPE_SECRET_KEY: "sk_test_closure",
  STRIPE_WEBHOOK_SECRET: "whsec_closure",
  STRIPE_PRICE_ARTIST_PRO_MONTHLY: "price_month",
  STRIPE_PRICE_ARTIST_PRO_ANNUAL: "price_year",
  FRONTEND_URL: "https://app.example.test",
});

let refundSeq = 0;
const gateway = {
  createCustomer: jest.fn(),
  createCheckoutSession: jest.fn(),
  createPortalSession: jest.fn(),
  retrieveSubscription: jest.fn(),
  cancelSubscription: jest.fn(async (id: string) => ({ id, object: "subscription", status: "canceled" }) as unknown as StripeSubscription),
  updateSubscription: jest.fn(),
  updateCustomerEmail: jest.fn(async () => undefined),
  createRefund: jest.fn(async () => ({ id: `re_${P}${++refundSeq}`, status: "succeeded" })),
  findPaymentIntentForInvoice: jest.fn(async (invoiceId: string) => `pi_for_${invoiceId}`),
  findInvoiceIdForPaymentIntent: jest.fn(async () => null),
  constructEvent: jest.fn(),
} satisfies StripeGateway;

const lifecycle = new SubscriptionLifecycleService(config, gateway);
const audit = new AuditService();
const notices = new NoticeService(new EventBus(), audit);
const accounts = new AccountStatusService(audit, notices, new AccountClosureService(), new AccountStandingService(), lifecycle);
const operator = { userId: `${P}operator`, role: "admin" };
const created: string[] = [operator.userId];
let seq = 0;

/** A person with a monthly subscription whose $14.99 invoice period started `daysIn` days ago (30-day period). */
async function person(name: string, options: { daysIn?: number; balanceCents?: number } = {}) {
  const userId = `${P}${name}`;
  const n = ++seq;
  await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
  created.push(userId);
  const now = Date.now();
  const periodStart = new Date(now - (options.daysIn ?? 10) * DAY - 60_000);
  const periodEnd = new Date(periodStart.getTime() + 30 * DAY);
  const sub = await prisma.subscription.create({
    data: {
      userId,
      stripeCustomerId: `cus_${P}${n}`,
      stripeSubscriptionId: `sub_${P}${n}`,
      interval: "month",
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
  });
  const invoice = await prisma.subscriptionInvoice.create({
    data: {
      subscriptionId: sub.id,
      stripeInvoiceId: `in_${P}${n}`,
      stripeSubscriptionId: `sub_${P}${n}`,
      currency: "usd",
      amountPaidCents: 1499,
      interval: "month",
      periodStart,
      periodEnd,
      paidAt: periodStart,
    },
  });
  if (options.balanceCents !== undefined) {
    await prisma.generationCreditAccount.create({ data: { userId, balanceCents: options.balanceCents } });
  }
  return { userId, invoice };
}

async function pack(userId: string, name: string, options: { status: "held" | "credited"; credits: number; daysAgo: number; charged?: number }) {
  const paidAt = new Date(Date.now() - options.daysAgo * DAY);
  return prisma.creditTopUp.create({
    data: {
      userId,
      packId: `pack_${options.credits}`,
      priceCents: options.credits,
      currency: "usd",
      creditsCents: options.credits,
      amountTotalCents: options.charged ?? options.credits,
      stripeCheckoutSessionId: `cs_${P}${name}`,
      stripePaymentIntentId: `pi_${P}${name}`,
      delivery: options.status === "held" ? "wait" : "deliver_now",
      status: options.status,
      heldUntil: options.status === "held" ? new Date(paidAt.getTime() + 14 * DAY) : null,
      creditedAt: options.status === "credited" ? paidAt : null,
      creditedCents: options.status === "credited" ? options.credits : 0,
      paidAt,
    },
  });
}

const refundsOf = (userId: string) => prisma.closureRefund.findMany({ where: { userId }, orderBy: { refundCents: "desc" } });

describe("operator closure refunds (integration, #2595)", () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: operator.userId, email: `${operator.userId}@test.resonate` } });
  });

  afterAll(async () => {
    await prisma.adminAuditEvent.deleteMany({ where: { actorUserId: operator.userId } });
    await prisma.closureRefund.deleteMany({ where: { userId: { in: created } } });
    await prisma.creditTopUp.deleteMany({ where: { userId: { in: created } } });
    await prisma.generationCreditAccount.deleteMany({ where: { userId: { in: created } } });
    await prisma.subscriptionInvoice.deleteMany({ where: { subscription: { userId: { in: created } } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: created } } });
    await prisma.notice.deleteMany({ where: { recipientUserId: { in: created } } });
    await prisma.accountClosureRequest.deleteMany({ where: { userId: { in: created } } });
    await prisma.user.deleteMany({ where: { id: { in: created } } });
  });

  beforeEach(() => jest.clearAllMocks());

  it("computes the unused days and splits bought credits newest first", () => {
    const start = new Date("2026-11-01T00:00:00Z");
    const end = new Date("2026-12-01T00:00:00Z");
    expect(unusedDaysRefundCents({ paidCents: 1500, periodStart: start, periodEnd: end, at: new Date("2026-11-11T12:00:00Z") })).toBe(950);
    expect(unusedDaysRefundCents({ paidCents: 1500, periodStart: start, periodEnd: end, at: end })).toBe(0);

    const base = { currency: "usd", reversedCents: 0, refundedAmountCents: 0, refundedCreditsCents: 0 };
    const allocations = allocatePackRefunds(
      [
        { ...base, id: "held", status: "held", chargedCents: 500, creditsCents: 500, creditedCents: 0 },
        { ...base, id: "new", status: "credited", chargedCents: 1080, creditsCents: 1000, creditedCents: 1000 },
        { ...base, id: "old", status: "credited", chargedCents: 2500, creditsCents: 2500, creditedCents: 2500 },
      ],
      1200,
    );
    // Held in full; then 1,000 credits of the newest (tax included in what it charged); 200 of the older.
    expect(allocations.map((a) => [a.pack.id, a.refundCents])).toEqual([
      ["held", 500],
      ["new", 1080],
      ["old", 200],
    ]);
  });

  it("refunds the unused days and unspent bought credits when the closure is not for a breach, once", async () => {
    const { userId, invoice } = await person("not_breach", { daysIn: 10, balanceCents: 1200 });
    const held = await pack(userId, "held", { status: "held", credits: 500, daysAgo: 1 });
    const recent = await pack(userId, "recent", { status: "credited", credits: 1000, daysAgo: 20 });
    const older = await pack(userId, "older", { status: "credited", credits: 2500, daysAgo: 40 });

    await accounts.close(operator, userId, { reason: "other", seriousBreach: false });

    const rows = await refundsOf(userId);
    expect(rows.map((r) => [r.kind, r.subjectId, r.refundCents, r.refundStatus])).toEqual([
      ["credit_topup", recent.id, 1000, "refunded"],
      ["subscription_invoice", invoice.id, 949, "refunded"],
      ["credit_topup", held.id, 500, "refunded"],
      ["credit_topup", older.id, 200, "refunded"],
    ]);
    expect(gateway.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentId: `pi_for_${invoice.stripeInvoiceId}`, amountCents: 949 }),
      `resonate-closure-${rows[1].id}`,
    );
    expect(gateway.createRefund).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: `pi_${P}older`, amountCents: 200 }), expect.any(String));

    const event = await prisma.adminAuditEvent.findFirstOrThrow({ where: { actorUserId: operator.userId, targetUserId: userId, action: "account.closed" } });
    expect(event.detail).toMatchObject({ seriousBreach: false, refunds: { planned: 4, refunded: 4, pending: 0 } });
    const notice = await prisma.notice.findFirstOrThrow({ where: { recipientUserId: userId, title: "Your account has been closed" } });
    expect(notice.body).toContain(CLOSURE_REFUND_NOTE);

    // Planning again changes nothing.
    expect(await planClosureRefunds(userId)).toBe(0);
    expect(await refundsOf(userId)).toHaveLength(4);
  });

  it("refunds nothing when the closure is for a serious breach, and records the choice", async () => {
    const { userId } = await person("breach", { balanceCents: 1000 });
    await pack(userId, "breach_pack", { status: "credited", credits: 1000, daysAgo: 3 });
    await accounts.close(operator, userId, { reason: "fraud", seriousBreach: true });
    expect(await refundsOf(userId)).toEqual([]);
    expect(gateway.createRefund).not.toHaveBeenCalled();
    const event = await prisma.adminAuditEvent.findFirstOrThrow({ where: { actorUserId: operator.userId, targetUserId: userId, action: "account.closed" } });
    expect(event.detail).toMatchObject({ seriousBreach: true, refunds: null });
    const notice = await prisma.notice.findFirstOrThrow({ where: { recipientUserId: userId, title: "Your account has been closed" } });
    expect(notice.body).not.toContain(CLOSURE_REFUND_NOTE);
  });

  it("refuses a closure that does not say whether it is for a breach", async () => {
    const { userId } = await person("unsaid");
    await expect(accounts.close(operator, userId, { reason: "other" })).rejects.toThrow("seriousBreach");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).accountStatus).not.toBe("closed");
  });

  it("skips a disputed or withdrawn payment", async () => {
    const { userId, invoice } = await person("skipped", { balanceCents: 1000 });
    const disputed = await pack(userId, "disputed", { status: "credited", credits: 1000, daysAgo: 2 });
    await prisma.stripeDispute.create({
      data: {
        stripeDisputeId: `dp_${P}skipped`,
        stripeChargeId: `ch_${P}skipped`,
        stripePaymentIntentId: disputed.stripePaymentIntentId,
        kind: "credit_topup",
        creditTopUpId: disputed.id,
        status: "open",
        reason: "fraudulent",
        openedAt: new Date(),
        amountCents: 1000,
        currency: "usd",
      },
    });
    await prisma.contractWithdrawal.create({
      data: {
        userId,
        contract: "artist_pro",
        subjectId: invoice.id,
        contractLabel: "Artist Pro (monthly)",
        statementName: "Test",
        labelsVersion: "test",
        withdrawnAt: new Date(),
        currency: "usd",
        paidCents: 1499,
        refundCents: 1000,
        refundStatus: "refunded",
      },
    });
    expect(await planClosureRefunds(userId)).toBe(0);
    await prisma.stripeDispute.deleteMany({ where: { stripeDisputeId: `dp_${P}skipped` } });
    await prisma.contractWithdrawal.deleteMany({ where: { userId } });
  });

  it("still closes when Stripe fails, and the retention job finishes the refund", async () => {
    const { userId } = await person("retry", { daysIn: 5 });
    gateway.createRefund.mockRejectedValueOnce(Object.assign(new Error("Stripe down for x@y.test"), { type: "StripeAPIError", code: "api_error" }));
    await accounts.close(operator, userId, { reason: "other", seriousBreach: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).accountStatus).toBe("closed");
    const event = await prisma.adminAuditEvent.findFirstOrThrow({ where: { actorUserId: operator.userId, targetUserId: userId, action: "account.closed" } });
    expect(event.detail).toMatchObject({ refunds: { planned: 1, refunded: 0, pending: 1 } });

    // Suites share the database, so another suite's retention pass may retry
    // it first: assert the end state, not who retried it.
    await runBillingRetention(lifecycle);
    const [row] = await refundsOf(userId);
    expect(row).toMatchObject({ refundStatus: "refunded", refundLastError: null });
    expect(row.refundAttempts).toBeGreaterThanOrEqual(2);
  });
});
