/**
 * The in-app withdrawal function (#2594) against a real Postgres, with a fake
 * Stripe gateway. Covers: what is offered and when it stops being offered,
 * the two-step flow's server half (statement in, one record, acknowledgement
 * notice with the statement and the UTC time), the Artist Pro refund less the
 * days used with the subscription cancelled, the held credit pack refunded in
 * full and never released, retries by the retention job, and idempotency.
 */
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import { BillingConfig } from "../modules/billing/billing_config";
import { ContractWithdrawalService, maskEmail } from "../modules/billing/contract_withdrawal.service";
import type { StripeGateway } from "../modules/billing/stripe_gateway";
import { SubscriptionLifecycleService } from "../modules/billing/subscription_lifecycle.service";
import { WITHDRAWAL_LABELS } from "../modules/billing/withdrawal_labels";
import { proratedRefundCents } from "../modules/billing/withdrawal_refunds";
import { releaseHeldTopUp } from "../modules/credits/top_up_ledger";
import { NoticeService } from "../modules/notifications/notice.service";
import { EventBus } from "../modules/shared/event_bus";

const P = `withdraw_${Date.now()}_`;
const U = { pro: `${P}pro`, late: `${P}late`, pack: `${P}pack`, retry: `${P}retry` };
const USERS = Object.values(U);
const DAY = 24 * 60 * 60 * 1000;

const config = new BillingConfig({
  STRIPE_SECRET_KEY: "sk_test_integration",
  STRIPE_WEBHOOK_SECRET: "whsec_integration",
  STRIPE_PRICE_ARTIST_PRO_MONTHLY: "price_month",
  STRIPE_PRICE_ARTIST_PRO_ANNUAL: "price_year",
  FRONTEND_URL: "https://app.example.test",
});
const gateway = {
  retrieveSubscription: jest.fn(async (id: string) => ({ id, status: "active" })),
  cancelSubscription: jest.fn(async (id: string) => ({ id, status: "canceled" })),
  createRefund: jest.fn(async () => ({ id: `re_${P}${Math.random()}`, status: "succeeded" })),
  findPaymentIntentForInvoice: jest.fn(async (invoice: string) => `pi_for_${invoice}`),
} as unknown as jest.Mocked<StripeGateway>;
const notices = new NoticeService(new EventBus(), new AuditService());
const lifecycle = new SubscriptionLifecycleService(config, gateway);
const service = new ContractWithdrawalService(notices, lifecycle, gateway);

async function subscribe(userId: string, paidDaysAgo: number) {
  const now = Date.now();
  const periodStart = new Date(now - paidDaysAgo * DAY);
  const sub = await prisma.subscription.create({
    data: {
      userId,
      stripeCustomerId: `cus_${userId}`,
      stripeSubscriptionId: `sub_${userId}`,
      interval: "month",
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: new Date(periodStart.getTime() + 30 * DAY),
    },
  });
  const invoice = await prisma.subscriptionInvoice.create({
    data: {
      subscriptionId: sub.id,
      stripeInvoiceId: `in_${userId}`,
      stripeSubscriptionId: `sub_${userId}`,
      currency: "usd",
      amountPaidCents: 1500,
      billingReason: "subscription_create",
      interval: "month",
      periodStart,
      periodEnd: new Date(periodStart.getTime() + 30 * DAY),
      paidAt: periodStart,
    },
  });
  return { sub, invoice };
}

async function heldPack(userId: string, key: string) {
  return prisma.creditTopUp.create({
    data: {
      id: `${P}${key}`,
      userId,
      packId: "credits_10",
      priceCents: 1000,
      amountTotalCents: 1000,
      creditsCents: 1000,
      stripeCheckoutSessionId: `cs_${P}${key}`,
      stripePaymentIntentId: `pi_${P}${key}`,
      delivery: "wait",
      status: "held",
      paidAt: new Date(Date.now() - DAY),
      heldUntil: new Date(Date.now() + 13 * DAY),
    },
  });
}

describe("proratedRefundCents", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const end = new Date("2026-01-31T00:00:00Z");
  it("refunds the price less the days used, rounding the used part down", () => {
    expect(proratedRefundCents({ paidCents: 1500, periodStart: start, periodEnd: end, at: start })).toBe(1500);
    expect(proratedRefundCents({ paidCents: 1500, periodStart: start, periodEnd: end, at: new Date("2026-01-04T00:00:00Z") })).toBe(1350);
    expect(proratedRefundCents({ paidCents: 1499, periodStart: start, periodEnd: end, at: new Date("2026-01-02T00:00:00Z") })).toBe(1450);
    expect(proratedRefundCents({ paidCents: 1500, periodStart: start, periodEnd: end, at: end })).toBe(0);
    expect(proratedRefundCents({ paidCents: 0, periodStart: start, periodEnd: end, at: start })).toBe(0);
    // The larger of time passed and allowance used: half the allowance used on day 3 keeps half the price.
    const at = new Date("2026-01-04T00:00:00Z");
    expect(proratedRefundCents({ paidCents: 1500, periodStart: start, periodEnd: end, at, allowance: { grantedCents: 300, consumedCents: 150 } })).toBe(750);
    expect(proratedRefundCents({ paidCents: 1500, periodStart: start, periodEnd: end, at, allowance: { grantedCents: 300, consumedCents: 10 } })).toBe(1350);
    expect(proratedRefundCents({ paidCents: 1500, periodStart: start, periodEnd: end, at, allowance: { grantedCents: 0, consumedCents: 0 } })).toBe(1350);
  });

  it("masks the confirmation address", () => {
    expect(maskEmail("someone@example.com")).toBe("s•••@example.com");
    expect(maskEmail("bad")).toBe("•••");
  });
});

describe("Withdrawal from contract (integration, #2594)", () => {
  beforeAll(async () => {
    for (const id of USERS) await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
  });

  afterAll(async () => {
    await prisma.contractWithdrawal.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.subscriptionInvoice.deleteMany({ where: { subscription: { userId: { in: USERS } } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.creditTopUp.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.generationCreditTransaction.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.generationCreditAccount.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.notice.deleteMany({ where: { recipientUserId: { in: USERS } } });
    await prisma.contactEmail.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  });

  it("withdraws from Artist Pro within 14 days: ends it, refunds the unused days, acknowledges once", async () => {
    const { invoice } = await subscribe(U.pro, 3);
    await prisma.contactEmail.create({
      data: { userId: U.pro, address: "pro@example.test", addressNormalized: "pro@example.test", status: "confirmed" },
    });

    const state = await service.getState(U.pro);
    expect(state.labels).toEqual(WITHDRAWAL_LABELS);
    expect(state.confirmationEmail).toBe("p•••@example.test");
    expect(state.contracts).toHaveLength(1);
    expect(state.contracts[0]).toMatchObject({ contract: "artist_pro", subjectId: invoice.id, label: "Artist Pro (monthly)", paidCents: 1500 });
    expect(state.contracts[0].refundCents).toBeGreaterThanOrEqual(1349);
    expect(state.contracts[0].refundCents).toBeLessThanOrEqual(1350);

    const before = Date.now();
    const result = await service.withdraw(U.pro, { contract: "artist_pro", subjectId: invoice.id, name: "  Ada   Lovelace " });
    expect(result).toMatchObject({ contract: "artist_pro", refundStatus: "refunded", label: "Artist Pro (monthly)" });

    const row = await prisma.contractWithdrawal.findFirstOrThrow({ where: { userId: U.pro } });
    expect(row).toMatchObject({ statementName: "Ada Lovelace", refundAttempts: 1, labelsVersion: WITHDRAWAL_LABELS.version });
    expect(row.withdrawnAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(gateway.findPaymentIntentForInvoice).toHaveBeenCalledWith(`in_${U.pro}`);
    expect(gateway.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentId: `pi_for_in_${U.pro}`, amountCents: row.refundCents }),
      `resonate-withdrawal-${row.id}`,
    );
    expect(gateway.cancelSubscription).toHaveBeenCalledWith(`sub_${U.pro}`, expect.any(String));
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId: U.pro } });
    expect(sub).toMatchObject({ status: "canceled", endReason: "contract_withdrawal" });
    expect(sub.endConfirmedAt).not.toBeNull();

    const notice = await prisma.notice.findFirstOrThrow({ where: { recipientUserId: U.pro } });
    expect(notice).toMatchObject({ category: "purchase", title: "Withdrawal received" });
    expect(notice.body).toContain('"I, Ada Lovelace, withdraw from my contract for Artist Pro (monthly)."');
    expect(notice.body).toContain(`Received on ${row.withdrawnAt.toISOString().slice(0, 10)} at ${row.withdrawnAt.toISOString().slice(11, 19)} UTC.`);

    // Pressing again records nothing more and refunds nothing more.
    const refunds = gateway.createRefund.mock.calls.length;
    const again = await service.withdraw(U.pro, { contract: "artist_pro", subjectId: invoice.id, name: "Ada Lovelace" });
    expect(again.id).toBe(row.id);
    expect(gateway.createRefund.mock.calls.length).toBe(refunds);
    expect(await prisma.notice.count({ where: { recipientUserId: U.pro } })).toBe(1);
    expect((await service.getState(U.pro)).contracts).toEqual([]);
  });

  it("stops offering Artist Pro after 14 days, and refuses a withdrawal for it", async () => {
    const { invoice } = await subscribe(U.late, 15);
    expect((await service.getState(U.late)).contracts).toEqual([]);
    await expect(
      service.withdraw(U.late, { contract: "artist_pro", subjectId: invoice.id, name: "Late" }),
    ).rejects.toMatchObject({ response: { code: "withdrawal_not_available" } });
    // Someone else's contract is never available either.
    await expect(
      service.withdraw(U.pack, { contract: "artist_pro", subjectId: invoice.id, name: "Other" }),
    ).rejects.toMatchObject({ response: { code: "withdrawal_not_available" } });
  });

  it("withdraws from a held credit pack: full refund, and the hold never releases it", async () => {
    const pack = await heldPack(U.pack, "pack");
    const state = await service.getState(U.pack);
    expect(state.confirmationEmail).toBeNull();
    expect(state.contracts).toEqual([
      expect.objectContaining({ contract: "credit_topup", subjectId: pack.id, label: "$10 credit pack", refundCents: 1000 }),
    ]);

    const result = await service.withdraw(U.pack, { contract: "credit_topup", subjectId: pack.id, name: "Grace Hopper" });
    expect(result).toMatchObject({ refundStatus: "refunded", refundCents: 1000 });
    const call = gateway.createRefund.mock.calls.at(-1);
    expect(call?.[0]).toEqual(expect.objectContaining({ paymentIntentId: `pi_${P}pack` }));
    expect(call?.[0]).not.toHaveProperty("amountCents");

    // The hold ending (or "Deliver now") cannot credit a withdrawn pack.
    expect(await releaseHeldTopUp(pack.id, "hold_elapsed")).toBeNull();
    expect((await prisma.creditTopUp.findUniqueOrThrow({ where: { id: pack.id } })).status).toBe("held");
    expect((await service.getState(U.pack)).withdrawals).toEqual([
      expect.objectContaining({ contract: "credit_topup", refundStatus: "refunded" }),
    ]);
  });

  it("records the withdrawal when Stripe fails, and the retention job retries the refund", async () => {
    const pack = await heldPack(U.retry, "retry");
    gateway.createRefund.mockRejectedValueOnce(Object.assign(new Error("Stripe is down"), { type: "StripeConnectionError" }));
    const result = await service.withdraw(U.retry, { contract: "credit_topup", subjectId: pack.id, name: "Retry" });
    expect(result.refundStatus).toBe("failed");
    expect(await prisma.contractWithdrawal.findFirstOrThrow({ where: { userId: U.retry } })).toMatchObject({
      refundAttempts: 1,
      refundLastError: "stripeconnectionerror",
    });

    // Suites share the database, so another suite's retention pass may retry
    // it first: assert the end state, not who retried it.
    await lifecycle.reconcile();
    const retried = await prisma.contractWithdrawal.findFirstOrThrow({ where: { userId: U.retry } });
    expect(retried).toMatchObject({ refundStatus: "refunded", refundLastError: null });
    expect(retried.refundAttempts).toBeGreaterThanOrEqual(2);
  });
});
