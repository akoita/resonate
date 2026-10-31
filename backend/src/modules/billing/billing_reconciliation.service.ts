import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { TOP_UP_REASON } from "../credits/top_up_ledger";
import {
  BillingReconciliationReport,
  ChargedTotals,
  CountCents,
  CurrencyControlTotals,
  InvoiceRow,
  KNOWN_GRANT_REASONS,
  LabelledTotal,
  PurchaseRow,
  REPORT_VERSION,
  RefundRow,
  SAFE_REASON_SQL,
  ledgerReasonLabel,
  parseReportMonth,
} from "./billing_reconciliation";

/** Earlier than any row: "from the beginning of the ledger". */
const EPOCH = new Date(0);

const num = (value: unknown): number => (value === null || value === undefined ? 0 : Number(value));

interface LedgerGroupRow {
  type: string;
  key: string;
  count: bigint;
  amount: bigint | null;
  allowance: bigint | null;
}

/**
 * Builds the monthly billing reconciliation report (#2497); the shape and the
 * rules are documented in `billing_reconciliation.ts`. Read-only. Every total
 * is derived from timestamps and append-only rows, so two runs for a past
 * month give identical totals.
 */
@Injectable()
export class BillingReconciliationService {
  async build(month: string, now: Date = new Date()): Promise<BillingReconciliationReport> {
    const period = parseReportMonth(month, now);
    const { start, end } = period;
    const range = { gte: start, lt: end };

    const [purchaseRows, needsReviewRows, refundRows, invoiceRows] = await Promise.all([
      prisma.creditTopUp.findMany({
        where: { paidAt: range, status: { not: "needs_review" } },
        orderBy: [{ paidAt: "asc" }, { id: "asc" }],
      }),
      prisma.creditTopUp.findMany({
        where: { paidAt: range, status: "needs_review" },
        orderBy: [{ paidAt: "asc" }, { id: "asc" }],
      }),
      prisma.creditTopUpRefund.findMany({
        where: { createdAt: range },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          creditTopUp: { select: { userId: true, currency: true, stripePaymentIntentId: true } },
        },
      }),
      prisma.subscriptionInvoice.findMany({
        where: { paidAt: range },
        orderBy: [{ paidAt: "asc" }, { id: "asc" }],
        include: { subscription: { select: { userId: true } } },
      }),
    ]);

    const toPurchaseRow = (p: (typeof purchaseRows)[number]): PurchaseRow => ({
      creditTopUpId: p.id,
      accountId: p.userId,
      stripeCheckoutSessionId: p.stripeCheckoutSessionId,
      stripePaymentIntentId: p.stripePaymentIntentId,
      packId: p.packId,
      currency: p.currency,
      priceCents: p.priceCents,
      amountTotalCents: p.amountTotalCents,
      creditsCents: p.creditsCents,
      delivery: p.delivery,
      paidAt: p.paidAt.toISOString(),
      creditedAt: p.creditedAt ? p.creditedAt.toISOString() : null,
      creditedInMonthCents: p.creditedAt && p.creditedAt >= start && p.creditedAt < end ? p.creditedCents : 0,
      currentStatus: p.status,
    });
    const purchases = purchaseRows.map(toPurchaseRow);
    const needsReview = needsReviewRows.map(toPurchaseRow);
    const refunds: RefundRow[] = refundRows.map((r) => ({
      refundId: r.id,
      creditTopUpId: r.creditTopUpId,
      accountId: r.creditTopUp.userId,
      stripePaymentIntentId: r.creditTopUp.stripePaymentIntentId,
      currency: r.creditTopUp.currency,
      amountCents: r.amountCents,
      withdrawnCreditsCents: r.withdrawnCreditsCents,
      reversedCents: r.reversedCents,
      spentNotReversedCents: r.statusBefore === "credited" ? r.withdrawnCreditsCents - r.reversedCents : 0,
      heldReductionCents: r.statusBefore === "held" ? r.withdrawnCreditsCents : 0,
      statusBefore: r.statusBefore,
      refundedAt: r.createdAt.toISOString(),
      backfilled: r.backfilled,
    }));
    const subscriptionInvoices: InvoiceRow[] = invoiceRows.map((i) => ({
      stripeInvoiceId: i.stripeInvoiceId,
      subscriptionId: i.subscriptionId,
      accountId: i.subscription.userId,
      stripeSubscriptionId: i.stripeSubscriptionId,
      currency: i.currency,
      amountPaidCents: i.amountPaidCents,
      amountExcludingTaxCents: i.amountExcludingTaxCents,
      billingReason: i.billingReason,
      interval: i.interval,
      periodStart: i.periodStart.toISOString(),
      periodEnd: i.periodEnd.toISOString(),
      paidAt: i.paidAt.toISOString(),
    }));

    const [heldOpening, heldClosing, heldFlows, creditBalance, allowance, integrity] = await Promise.all([
      this.heldTotals(EPOCH, start),
      this.heldTotals(EPOCH, end),
      this.heldTotals(start, end),
      this.creditBalance(start, end),
      this.allowance(start, end, now),
      this.integrity(),
    ]);
    const heldOpeningCents = heldOpening.purchased - heldOpening.withdrawn - heldOpening.credited;
    const heldClosingCents = heldClosing.purchased - heldClosing.withdrawn - heldClosing.credited;
    const heldComputed = heldOpeningCents + heldFlows.purchased - heldFlows.credited - heldFlows.withdrawn;

    return {
      reportVersion: REPORT_VERSION,
      month: period.month,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      complete: period.complete,
      generatedAt: now.toISOString(),
      creditPacks: { purchases, refunds, needsReview },
      heldPurchases: {
        unit: "credit_cents",
        openingCents: heldOpeningCents,
        purchasedCents: heldFlows.purchased,
        creditedCents: heldFlows.credited,
        refundWithdrawnCents: heldFlows.withdrawn,
        closingCents: heldClosingCents,
        computedClosingCents: heldComputed,
        balanced: heldComputed === heldClosingCents,
      },
      creditBalance,
      allowance,
      subscriptionInvoices,
      controlTotals: this.controlTotals(purchases, needsReview, refunds, subscriptionInvoices),
      integrity,
    };
  }

  /**
   * Packs paid, held-refund withdrawals and top-up ledger grants over
   * `[from, to)`. Held = purchased - withdrawn - credited at an instant.
   * Needs-review packs are never credited, so they are out of the roll-forward.
   */
  private async heldTotals(from: Date, to: Date): Promise<{ purchased: number; withdrawn: number; credited: number }> {
    const rows = await prisma.$queryRaw<Array<{ purchased: bigint; withdrawn: bigint; credited: bigint }>>`
      SELECT
        (SELECT COALESCE(SUM(p."creditsCents"), 0) FROM "CreditTopUp" p
          WHERE p."status" <> 'needs_review' AND p."paidAt" >= ${from} AND p."paidAt" < ${to})::bigint AS purchased,
        (SELECT COALESCE(SUM(r."withdrawnCreditsCents"), 0) FROM "CreditTopUpRefund" r
          JOIN "CreditTopUp" p ON p."id" = r."creditTopUpId"
          WHERE p."status" <> 'needs_review' AND r."statusBefore" = 'held'
            AND r."createdAt" >= ${from} AND r."createdAt" < ${to})::bigint AS withdrawn,
        (SELECT COALESCE(SUM(t."amountCents"), 0) FROM "GenerationCreditTransaction" t
          WHERE t."type" = 'grant' AND t."reason" = ${TOP_UP_REASON}
            AND t."createdAt" >= ${from} AND t."createdAt" < ${to}
            AND EXISTS (SELECT 1 FROM "CreditTopUp" p
              WHERE p."stripePaymentIntentId" = t."paymentRef" AND p."status" <> 'needs_review'))::bigint AS credited`;
    const row = rows[0];
    return { purchased: num(row?.purchased), withdrawn: num(row?.withdrawn), credited: num(row?.credited) };
  }

  /**
   * Signed sum of the ledger's effect on the pooled bought and free balance
   * over `[from, to)`. The Artist Pro allowance bucket is excluded:
   * `allowanceCents` is the part of a debit or job refund that moved through
   * it. Mirrors `top_up_ledger.ts` and `generation-credits.service.ts`.
   */
  private async signedLedger(from: Date, to: Date | null): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT COALESCE(SUM(CASE t."type"
          WHEN 'grant' THEN t."amountCents"
          WHEN 'debit' THEN -(t."amountCents" - t."allowanceCents")
          WHEN 'refund' THEN t."amountCents" - t."allowanceCents"
          WHEN 'reversal' THEN -t."amountCents"
          ELSE 0 END), 0)::bigint AS total
      FROM "GenerationCreditTransaction" t
      WHERE t."createdAt" >= ${from} AND (${to}::timestamp IS NULL OR t."createdAt" < ${to})`;
    return num(rows[0]?.total);
  }

  private async creditBalance(start: Date, end: Date): Promise<BillingReconciliationReport["creditBalance"]> {
    const [opening, closing, groups] = await Promise.all([
      this.signedLedger(EPOCH, start),
      this.signedLedger(EPOCH, end),
      prisma.$queryRaw<LedgerGroupRow[]>`
        SELECT t."type" AS "type",
               CASE WHEN t."type" = 'grant'
                      THEN CASE WHEN t."reason" = ANY(${[...KNOWN_GRANT_REASONS]}::text[]) THEN t."reason" ELSE '' END
                    WHEN t."reason" ~ ${SAFE_REASON_SQL} THEN t."reason"
                    ELSE '' END AS "key",
               COUNT(*)::bigint AS "count",
               SUM(t."amountCents")::bigint AS "amount",
               SUM(t."allowanceCents")::bigint AS "allowance"
        FROM "GenerationCreditTransaction" t
        WHERE t."createdAt" >= ${start} AND t."createdAt" < ${end}
        GROUP BY 1, 2`,
    ]);

    const grants = new Map<string, LabelledTotal>();
    const spends = new Map<string, LabelledTotal>();
    const jobRefunds = new Map<string, LabelledTotal>();
    const reversals: CountCents = { count: 0, cents: 0 };
    let unclassified = 0;
    const add = (map: Map<string, LabelledTotal>, label: string, count: number, cents: number) => {
      const entry = map.get(label) ?? { label, count: 0, cents: 0 };
      entry.count += count;
      entry.cents += cents;
      map.set(label, entry);
    };
    for (const g of groups) {
      const count = num(g.count);
      const amount = num(g.amount);
      const balancePart = amount - num(g.allowance);
      const label = ledgerReasonLabel(g.type, g.key);
      if (g.type === "grant") add(grants, label, count, amount);
      else if (g.type === "debit") add(spends, label, count, balancePart);
      else if (g.type === "refund") add(jobRefunds, label, count, balancePart);
      else if (g.type === "reversal") {
        reversals.count += count;
        reversals.cents += amount;
      } else unclassified += count;
    }
    const sorted = (map: Map<string, LabelledTotal>) => [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
    const totalOf = (items: LabelledTotal[]): CountCents => ({
      count: items.reduce((sum, i) => sum + i.count, 0),
      cents: items.reduce((sum, i) => sum + i.cents, 0),
    });
    const grantList = sorted(grants);
    const spendList = sorted(spends);
    const refundList = sorted(jobRefunds);
    const grantTotal = totalOf(grantList).cents;
    const topUpGrantsCents = grantList.find((g) => g.label === "top_up")?.cents ?? 0;
    const spendTotal = totalOf(spendList);
    const refundTotal = totalOf(refundList);
    const computed = opening + grantTotal - spendTotal.cents + refundTotal.cents - reversals.cents;

    return {
      unit: "credit_cents",
      openingCents: opening,
      grants: grantList,
      topUpGrantsCents,
      freeGrantsCents: grantTotal - topUpGrantsCents,
      spends: spendTotal,
      spendsByReason: spendList,
      jobRefunds: refundTotal,
      jobRefundsByReason: refundList,
      topUpRefundReversals: reversals,
      unclassified: { count: unclassified },
      closingCents: closing,
      computedClosingCents: computed,
      balanced: computed === closing && unclassified === 0,
    };
  }

  private async allowance(start: Date, end: Date, now: Date): Promise<BillingReconciliationReport["allowance"]> {
    const [granted, moved, lapsed] = await Promise.all([
      prisma.generationAllowanceGrant.aggregate({
        where: { periodStart: { gte: start, lt: end } },
        _count: { _all: true },
        _sum: { amountCents: true },
      }),
      prisma.$queryRaw<Array<{ used: bigint; returned: bigint }>>`
        SELECT
          COALESCE(SUM(CASE WHEN t."type" = 'debit' THEN t."allowanceCents" ELSE 0 END), 0)::bigint AS used,
          COALESCE(SUM(CASE WHEN t."type" = 'refund' THEN t."allowanceCents" ELSE 0 END), 0)::bigint AS returned
        FROM "GenerationCreditTransaction" t
        WHERE t."createdAt" >= ${start} AND t."createdAt" < ${end}`,
      prisma.$queryRaw<Array<{ lapsed: bigint }>>`
        SELECT COALESCE(SUM(g."amountCents" - g."consumedCents"), 0)::bigint AS lapsed
        FROM "GenerationAllowanceGrant" g
        WHERE g."expiresAt" >= ${start} AND g."expiresAt" < ${end} AND g."expiresAt" <= ${now}`,
    ]);
    return {
      unit: "credit_cents",
      note: "Part of the subscription; expires and has no cash value. Never a liability.",
      grantedCount: granted._count._all,
      grantedCents: granted._sum.amountCents ?? 0,
      usedCents: num(moved[0]?.used),
      returnedCents: num(moved[0]?.returned),
      lapsedCents: num(lapsed[0]?.lapsed),
    };
  }

  /** Point in time, not month-bound: the whole ledger against the account balances. */
  private async integrity(): Promise<BillingReconciliationReport["integrity"]> {
    const [ledger, accounts] = await Promise.all([
      this.signedLedger(EPOCH, null),
      prisma.generationCreditAccount.aggregate({ _sum: { balanceCents: true } }),
    ]);
    const accountsBalance = accounts._sum.balanceCents ?? 0;
    return { ledgerBalanceNowCents: ledger, accountsBalanceNowCents: accountsBalance, matches: ledger === accountsBalance };
  }

  private controlTotals(
    purchases: PurchaseRow[],
    needsReview: PurchaseRow[],
    refunds: RefundRow[],
    invoices: InvoiceRow[],
  ): CurrencyControlTotals[] {
    const byCurrency = new Map<string, CurrencyControlTotals>();
    const empty = (): ChargedTotals => ({ count: 0, priceCents: 0, chargedCents: 0, chargedUnknownCount: 0 });
    const entry = (currency: string): CurrencyControlTotals => {
      const key = currency.toLowerCase();
      let e = byCurrency.get(key);
      if (!e) {
        e = {
          currency: key,
          creditPackPurchases: empty(),
          creditPackRefunds: { count: 0, amountCents: 0 },
          needsReview: empty(),
          subscriptionInvoices: { count: 0, amountPaidCents: 0 },
          netCollectedCents: 0,
        };
        byCurrency.set(key, e);
      }
      return e;
    };
    const addPurchase = (target: ChargedTotals, p: PurchaseRow) => {
      target.count += 1;
      target.priceCents += p.priceCents;
      target.chargedCents += p.amountTotalCents ?? p.priceCents;
      if (p.amountTotalCents === null) target.chargedUnknownCount += 1;
    };
    for (const p of purchases) addPurchase(entry(p.currency).creditPackPurchases, p);
    for (const p of needsReview) addPurchase(entry(p.currency).needsReview, p);
    for (const r of refunds) {
      const e = entry(r.currency);
      e.creditPackRefunds.count += 1;
      e.creditPackRefunds.amountCents += r.amountCents;
    }
    for (const i of invoices) {
      const e = entry(i.currency);
      e.subscriptionInvoices.count += 1;
      e.subscriptionInvoices.amountPaidCents += i.amountPaidCents;
    }
    for (const e of byCurrency.values()) {
      e.netCollectedCents =
        e.creditPackPurchases.chargedCents +
        e.needsReview.chargedCents +
        e.subscriptionInvoices.amountPaidCents -
        e.creditPackRefunds.amountCents;
    }
    return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  }
}
