/**
 * Monthly billing reconciliation report (#2497) against a real Postgres.
 *
 * The report reads every account, so the suite seeds a far-past month no other
 * suite uses (June 1993, opening state in May 1993, later activity in July
 * 1993) with explicit timestamps, and cleans up only the rows it created.
 */
import { prisma } from "../db/prisma";
import { REPORT_SECTIONS, sectionToCsv } from "../modules/billing/billing_reconciliation";
import { BillingReconciliationService } from "../modules/billing/billing_reconciliation.service";

const P = `billrec_${Date.now()}_`;
const U = {
  buyer: `${P}buyer`,
  waiter: `${P}waiter`,
  member: `${P}member`,
  euro: `${P}euro`,
  proMonthly: `${P}pro_monthly`,
  proAnnual: `${P}pro_annual`,
};
const USER_IDS = Object.values(U);

const at = (month: number, day: number, hour = 12) => new Date(Date.UTC(1993, month - 1, day, hour));
const NOW = new Date("1994-01-01T00:00:00.000Z");
const service = new BillingReconciliationService();

const topUpIds: string[] = [];
const subscriptionIds: string[] = [];

async function purchase(data: {
  id: string;
  userId: string;
  currency?: string;
  priceCents: number;
  amountTotalCents?: number | null;
  creditsCents: number;
  delivery: string;
  status: string;
  paidAt: Date;
  creditedAt?: Date | null;
  creditedCents?: number;
}) {
  const id = `${P}${data.id}`;
  topUpIds.push(id);
  await prisma.creditTopUp.create({
    data: {
      id,
      userId: data.userId,
      packId: "pack_test",
      priceCents: data.priceCents,
      currency: data.currency ?? "usd",
      creditsCents: data.creditsCents,
      stripeCheckoutSessionId: `cs_${id}`,
      stripePaymentIntentId: `pi_${id}`,
      delivery: data.delivery,
      status: data.status,
      amountTotalCents: data.amountTotalCents ?? null,
      paidAt: data.paidAt,
      creditedAt: data.creditedAt ?? null,
      creditedCents: data.creditedCents ?? 0,
    },
  });
  return id;
}

async function ledger(
  userId: string,
  type: "grant" | "debit" | "refund" | "reversal",
  amountCents: number,
  reason: string,
  createdAt: Date,
  extra: { allowanceCents?: number; paymentRef?: string } = {},
) {
  await prisma.generationCreditTransaction.create({
    data: {
      userId,
      type,
      amountCents,
      reason,
      createdAt,
      balanceAfterCents: 0,
      allowanceCents: extra.allowanceCents ?? 0,
      paymentRef: extra.paymentRef ?? null,
    },
  });
}

async function refund(topUpId: string, cumulative: number, amount: number, withdrawn: number, reversed: number, statusBefore: string, createdAt: Date) {
  return prisma.creditTopUpRefund.create({
    data: {
      creditTopUpId: topUpId,
      cumulativeRefundedAmountCents: cumulative,
      amountCents: amount,
      withdrawnCreditsCents: withdrawn,
      reversedCents: reversed,
      statusBefore,
      createdAt,
    },
  });
}

const stable = (report: Awaited<ReturnType<typeof service.build>>) => {
  const { generatedAt: _generatedAt, integrity: _integrity, ...rest } = report;
  return rest;
};

let PA1: string;
let PB1: string;
let PA2: string;
let PB2: string;
let PD1: string;

beforeAll(async () => {
  for (const id of USER_IDS) await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });

  // --- May 1993: opening state
  PA1 = await purchase({ id: "pa1", userId: U.buyer, priceCents: 1000, creditsCents: 1000, delivery: "deliver_now", status: "credited", paidAt: at(5, 5), creditedAt: at(5, 5), creditedCents: 1000 });
  await ledger(U.buyer, "grant", 1000, "top_up", at(5, 5), { paymentRef: `pi_${PA1}` });
  // A "wait" pack paid in May, still held at the start of June, released in June.
  PB1 = await purchase({ id: "pb1", userId: U.waiter, priceCents: 2000, creditsCents: 2000, delivery: "wait", status: "credited", paidAt: at(5, 20), creditedAt: at(6, 3), creditedCents: 2000 });
  await ledger(U.member, "grant", 100, "signup_starter", at(5, 2));
  await ledger(U.member, "grant", 300, "Gift for Alice Example", at(5, 3));
  await ledger(U.buyer, "debit", 200, "generation.clip", at(5, 10));

  // --- June 1993: the month under test
  PA2 = await purchase({ id: "pa2", userId: U.buyer, priceCents: 500, amountTotalCents: 600, creditsCents: 500, delivery: "deliver_now", status: "credited", paidAt: at(6, 4), creditedAt: at(6, 4), creditedCents: 500 });
  await ledger(U.buyer, "grant", 500, "top_up", at(6, 4), { paymentRef: `pi_${PA2}` });
  await refund(PA2, 200, 200, 200, 150, "credited", at(6, 10));
  await ledger(U.buyer, "reversal", 150, "top_up_refund", at(6, 10), { paymentRef: `pi_${PA2}` });
  // The May pack is released in June.
  await ledger(U.waiter, "grant", 2000, "top_up", at(6, 3), { paymentRef: `pi_${PB1}` });
  // A "wait" pack paid in June, partly refunded while held, still held at the end.
  PB2 = await purchase({ id: "pb2", userId: U.waiter, priceCents: 800, creditsCents: 800, delivery: "wait", status: "held", paidAt: at(6, 20) });
  await refund(PB2, 100, 100, 80, 0, "held", at(6, 22));
  // A pack that needs review (second currency), never credited.
  PD1 = await purchase({ id: "pd1", userId: U.euro, currency: "eur", priceCents: 1000, amountTotalCents: 1200, creditsCents: 1000, delivery: "deliver_now", status: "needs_review", paidAt: at(6, 8) });
  // Spends, a job refund and free grants.
  await ledger(U.buyer, "debit", 100, "generation.clip", at(6, 12));
  await ledger(U.member, "debit", 80, "generation.lyria", at(6, 13), { allowanceCents: 30 });
  await ledger(U.member, "debit", 10, "Weird Reason With Spaces", at(6, 13, 13));
  await ledger(U.member, "refund", 40, "job_failed", at(6, 14), { allowanceCents: 10 });
  await ledger(U.member, "grant", 500, "Credit request top-up", at(6, 15));
  await ledger(U.member, "grant", 250, "Gift for Alice Example", at(6, 16));
  await ledger(U.euro, "grant", 100, "signup_starter", at(6, 17));

  // Artist Pro: subscriptions, allowance grants, invoices.
  const monthly = await prisma.subscription.create({ data: { userId: U.proMonthly, stripeCustomerId: `${P}cus_m`, stripeSubscriptionId: `${P}sub_m`, interval: "month", status: "active" } });
  const annual = await prisma.subscription.create({ data: { userId: U.proAnnual, stripeCustomerId: `${P}cus_a`, stripeSubscriptionId: `${P}sub_a`, interval: "year", status: "active" } });
  subscriptionIds.push(monthly.id, annual.id);
  await prisma.generationAllowanceGrant.create({ data: { userId: U.proMonthly, subscriptionId: monthly.id, stripeInvoiceId: `${P}in_may`, amountCents: 300, consumedCents: 100, periodStart: at(5, 1, 0), expiresAt: at(6, 1, 0) } });
  await prisma.generationAllowanceGrant.create({ data: { userId: U.proMonthly, subscriptionId: monthly.id, stripeInvoiceId: `${P}in_jun`, amountCents: 400, consumedCents: 80, periodStart: at(6, 1, 0), expiresAt: at(7, 1, 0) } });
  await prisma.subscriptionInvoice.create({ data: { subscriptionId: monthly.id, stripeInvoiceId: `${P}in_jun`, stripeSubscriptionId: `${P}sub_m`, currency: "usd", amountPaidCents: 1200, amountExcludingTaxCents: 1000, billingReason: "subscription_cycle", interval: "month", periodStart: at(6, 1, 0), periodEnd: at(7, 1, 0), paidAt: at(6, 1, 1) } });
  await prisma.subscriptionInvoice.create({ data: { subscriptionId: annual.id, stripeInvoiceId: `${P}in_annual`, stripeSubscriptionId: `${P}sub_a`, currency: "eur", amountPaidCents: 12000, amountExcludingTaxCents: null, billingReason: "subscription_create", interval: "year", periodStart: at(6, 15), periodEnd: new Date(Date.UTC(1994, 5, 15, 12)), paidAt: at(6, 15, 1) } });
});

afterAll(async () => {
  await prisma.generationCreditTransaction.deleteMany({ where: { userId: { in: USER_IDS } } });
  await prisma.creditTopUpRefund.deleteMany({ where: { creditTopUpId: { in: topUpIds } } });
  await prisma.creditTopUp.deleteMany({ where: { id: { in: topUpIds } } });
  await prisma.generationAllowanceGrant.deleteMany({ where: { userId: { in: USER_IDS } } });
  await prisma.subscriptionInvoice.deleteMany({ where: { subscriptionId: { in: subscriptionIds } } });
  await prisma.subscription.deleteMany({ where: { id: { in: subscriptionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: USER_IDS } } });
  await prisma.$disconnect();
});

describe("BillingReconciliationService (integration)", () => {
  let juneBeforeJuly: ReturnType<typeof stable>;

  it("reports June 1993 with exact, balanced roll-forwards", async () => {
    const report = await service.build("1993-06", NOW);
    juneBeforeJuly = stable(report);

    expect(report).toMatchObject({
      reportVersion: "billing-reconciliation/v1",
      month: "1993-06",
      periodStart: "1993-06-01T00:00:00.000Z",
      periodEnd: "1993-07-01T00:00:00.000Z",
      complete: true,
      generatedAt: NOW.toISOString(),
    });

    expect(report.heldPurchases).toEqual({
      unit: "credit_cents",
      openingCents: 2000,
      purchasedCents: 1300,
      creditedCents: 2500,
      refundWithdrawnCents: 80,
      closingCents: 720,
      computedClosingCents: 720,
      balanced: true,
    });

    const b = report.creditBalance;
    expect(b.openingCents).toBe(1200);
    expect(b.grants).toEqual([
      { label: "credit_request", count: 1, cents: 500 },
      { label: "operator_grant", count: 1, cents: 250 },
      { label: "signup_starter", count: 1, cents: 100 },
      { label: "top_up", count: 2, cents: 2500 },
    ]);
    expect(b.topUpGrantsCents).toBe(2500);
    expect(b.freeGrantsCents).toBe(850);
    expect(b.spends).toEqual({ count: 3, cents: 160 });
    expect(b.spendsByReason).toEqual([
      { label: "generation.clip", count: 1, cents: 100 },
      { label: "generation.lyria", count: 1, cents: 50 },
      { label: "other", count: 1, cents: 10 },
    ].sort((x, y) => x.label.localeCompare(y.label)));
    expect(b.jobRefunds).toEqual({ count: 1, cents: 30 });
    expect(b.jobRefundsByReason).toEqual([{ label: "job_failed", count: 1, cents: 30 }]);
    expect(b.topUpRefundReversals).toEqual({ count: 1, cents: 150 });
    expect(b.unclassified).toEqual({ count: 0 });
    expect(b.closingCents).toBe(4270);
    expect(b.computedClosingCents).toBe(4270);
    expect(b.balanced).toBe(true);

    expect(report.allowance).toMatchObject({
      unit: "credit_cents",
      grantedCount: 1,
      grantedCents: 400,
      usedCents: 30,
      returnedCents: 10,
      lapsedCents: 200,
    });
    expect(report.allowance.note).toContain("Never a liability");

    expect(report.integrity).toEqual({
      ledgerBalanceNowCents: expect.any(Number),
      accountsBalanceNowCents: expect.any(Number),
      matches: expect.any(Boolean),
    });
  });

  it("lists purchases, needs-review packs and refunds with their values", async () => {
    const report = await service.build("1993-06", NOW);

    expect(report.creditPacks.purchases.map((p) => p.creditTopUpId)).toEqual([PA2, PB2]);
    expect(report.creditPacks.purchases[0]).toEqual({
      creditTopUpId: PA2,
      accountId: U.buyer,
      stripeCheckoutSessionId: `cs_${PA2}`,
      stripePaymentIntentId: `pi_${PA2}`,
      packId: "pack_test",
      currency: "usd",
      priceCents: 500,
      amountTotalCents: 600,
      creditsCents: 500,
      delivery: "deliver_now",
      paidAt: at(6, 4).toISOString(),
      creditedAt: at(6, 4).toISOString(),
      creditedInMonthCents: 500,
      currentStatus: "credited",
    });
    expect(report.creditPacks.purchases[1]).toMatchObject({
      creditTopUpId: PB2,
      amountTotalCents: null,
      creditedAt: null,
      creditedInMonthCents: 0,
      currentStatus: "held",
    });

    expect(report.creditPacks.needsReview).toHaveLength(1);
    expect(report.creditPacks.needsReview[0]).toMatchObject({ creditTopUpId: PD1, currency: "eur", priceCents: 1000, amountTotalCents: 1200, currentStatus: "needs_review" });

    expect(report.creditPacks.refunds).toHaveLength(2);
    expect(report.creditPacks.refunds[0]).toMatchObject({
      creditTopUpId: PA2,
      accountId: U.buyer,
      stripePaymentIntentId: `pi_${PA2}`,
      currency: "usd",
      amountCents: 200,
      withdrawnCreditsCents: 200,
      reversedCents: 150,
      spentNotReversedCents: 50,
      heldReductionCents: 0,
      statusBefore: "credited",
      refundedAt: at(6, 10).toISOString(),
      backfilled: false,
    });
    expect(report.creditPacks.refunds[1]).toMatchObject({
      creditTopUpId: PB2,
      amountCents: 100,
      withdrawnCreditsCents: 80,
      reversedCents: 0,
      spentNotReversedCents: 0,
      heldReductionCents: 80,
      statusBefore: "held",
    });
  });

  it("gives control totals per currency and lists invoices with service periods", async () => {
    const report = await service.build("1993-06", NOW);
    expect(report.controlTotals).toEqual([
      {
        currency: "eur",
        creditPackPurchases: { count: 0, priceCents: 0, chargedCents: 0, chargedUnknownCount: 0 },
        creditPackRefunds: { count: 0, amountCents: 0 },
        needsReview: { count: 1, priceCents: 1000, chargedCents: 1200, chargedUnknownCount: 0 },
        subscriptionInvoices: { count: 1, amountPaidCents: 12000 },
        netCollectedCents: 13200,
      },
      {
        currency: "usd",
        creditPackPurchases: { count: 2, priceCents: 1300, chargedCents: 1400, chargedUnknownCount: 1 },
        creditPackRefunds: { count: 2, amountCents: 300 },
        needsReview: { count: 0, priceCents: 0, chargedCents: 0, chargedUnknownCount: 0 },
        subscriptionInvoices: { count: 1, amountPaidCents: 1200 },
        netCollectedCents: 2300,
      },
    ]);

    expect(report.subscriptionInvoices).toEqual([
      {
        stripeInvoiceId: `${P}in_jun`,
        subscriptionId: expect.any(String),
        accountId: U.proMonthly,
        stripeSubscriptionId: `${P}sub_m`,
        currency: "usd",
        amountPaidCents: 1200,
        amountExcludingTaxCents: 1000,
        billingReason: "subscription_cycle",
        interval: "month",
        periodStart: at(6, 1, 0).toISOString(),
        periodEnd: at(7, 1, 0).toISOString(),
        paidAt: at(6, 1, 1).toISOString(),
      },
      {
        stripeInvoiceId: `${P}in_annual`,
        subscriptionId: expect.any(String),
        accountId: U.proAnnual,
        stripeSubscriptionId: `${P}sub_a`,
        currency: "eur",
        amountPaidCents: 12000,
        amountExcludingTaxCents: null,
        billingReason: "subscription_create",
        interval: "year",
        periodStart: at(6, 15).toISOString(),
        periodEnd: new Date(Date.UTC(1994, 5, 15, 12)).toISOString(),
        paidAt: at(6, 15, 1).toISOString(),
      },
    ]);
  });

  it("reports May with the pack still held at its end", async () => {
    const may = await service.build("1993-05", NOW);
    expect(may.heldPurchases).toMatchObject({ openingCents: 0, purchasedCents: 3000, creditedCents: 1000, closingCents: 2000, balanced: true });
    expect(may.creditBalance).toMatchObject({ openingCents: 0, closingCents: 1200, balanced: true });
  });

  it("never leaks operator-typed text or contact details", async () => {
    const report = await service.build("1993-06", NOW);
    const everything = [JSON.stringify(report), ...REPORT_SECTIONS.map((s) => sectionToCsv(report, s))].join("\n");
    expect(everything).not.toMatch(/alice/i);
    expect(everything).not.toMatch(/Weird Reason/);
    expect(everything).not.toContain("@test.resonate");
  });

  it("is identical on every run and unaffected by later months", async () => {
    const again = await service.build("1993-06", NOW);
    expect(stable(again)).toEqual(juneBeforeJuly);

    // July activity: a further refund of the June pack, a spend, a grant, a new pack, an invoice.
    await refund(PA2, 300, 100, 100, 100, "credited", at(7, 5));
    await ledger(U.buyer, "reversal", 100, "top_up_refund", at(7, 5), { paymentRef: `pi_${PA2}` });
    await ledger(U.buyer, "debit", 50, "generation.clip", at(7, 6));
    await ledger(U.member, "grant", 70, "Gift for Alice Example", at(7, 7));
    await purchase({ id: "pa3", userId: U.buyer, priceCents: 300, amountTotalCents: 330, creditsCents: 300, delivery: "deliver_now", status: "credited", paidAt: at(7, 8), creditedAt: at(7, 8), creditedCents: 300 });
    await ledger(U.buyer, "grant", 300, "top_up", at(7, 8), { paymentRef: `pi_${P}pa3` });

    const afterJuly = await service.build("1993-06", NOW);
    expect(stable(afterJuly)).toEqual(juneBeforeJuly);

    const july = await service.build("1993-07", NOW);
    expect(july.creditBalance.openingCents).toBe(4270);
    expect(july.creditBalance.balanced).toBe(true);
    expect(july.creditBalance.topUpRefundReversals).toEqual({ count: 1, cents: 100 });
    expect(july.heldPurchases).toMatchObject({ openingCents: 720, closingCents: 720, balanced: true });
    expect(july.controlTotals.find((t) => t.currency === "usd")).toMatchObject({
      creditPackPurchases: { count: 1, chargedCents: 330 },
      creditPackRefunds: { count: 1, amountCents: 100 },
      netCollectedCents: 230,
    });
  });

  it("refuses a bad or future month", async () => {
    await expect(service.build("1993-6", NOW)).rejects.toMatchObject({ response: { code: "invalid_month" } });
    await expect(service.build("2999-01", NOW)).rejects.toMatchObject({ response: { code: "month_in_future" } });
  });
});
