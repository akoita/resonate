/**
 * Card disputes over credit packs (#2596) against a real Postgres.
 *
 * Purchases are seeded directly; the `charge.dispute.*` events go through the
 * real webhook service. The reconciliation check uses a far-past month no
 * other suite uses (March 1987) and moves this suite's own ledger rows there.
 */
import { ConflictException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import { BillingConfig } from "../modules/billing/billing_config";
import { sectionToCsv } from "../modules/billing/billing_reconciliation";
import { BillingReconciliationService } from "../modules/billing/billing_reconciliation.service";
import { CreditPackConfig } from "../modules/billing/credit_packs";
import { CreditTopUpService } from "../modules/billing/credit_topup.service";
import {
  StripeDisputeService,
  disputeMoney,
  disputeStateFrom,
  disputedCreditsShare,
} from "../modules/billing/stripe_dispute.service";
import type { StripeEvent } from "../modules/billing/stripe_gateway";
import { StripeWebhookService } from "../modules/billing/stripe_webhook.service";
import { GenerationCreditsService } from "../modules/credits/generation-credits.service";
import { creditTopUpInTx, releaseDueTopUpHolds } from "../modules/credits/top_up_ledger";
import { NoticeService } from "../modules/notifications/notice.service";
import { CONSENT_TEXT_VERSION } from "../modules/purchase_consent/purchase_consent.constants";
import { PurchaseConsentService } from "../modules/purchase_consent/purchase_consent.service";
import { EventBus } from "../modules/shared/event_bus";

const P = `dispute_${Date.now()}_`;
const U = {
  spender: `${P}spender`,
  winner: `${P}winner`,
  waiter: `${P}waiter`,
  late: `${P}late`,
  partial: `${P}partial`,
  asker: `${P}asker`,
};
const USERS = Object.values(U);
const DAY = 24 * 60 * 60 * 1000;
const at = (day: number, hour = 12) => new Date(Date.UTC(1987, 2, day, hour));
const sec = (date: Date) => Math.floor(date.getTime() / 1000);

const config = new BillingConfig({});
const notices = new NoticeService(new EventBus(), new AuditService());
const topUps = new CreditTopUpService(config, new PurchaseConsentService(notices), notices, null, new CreditPackConfig({}));
const webhooks = new StripeWebhookService(config, null, topUps, new StripeDisputeService(notices));
const credits = new GenerationCreditsService();

let seq = 0;
function event(type: string, object: unknown, created: Date): StripeEvent {
  return { id: `evt_${P}${++seq}`, object: "event", type, created: sec(created), livemode: false, data: { object } } as unknown as StripeEvent;
}

/** Seed one paid pack; a credited one also gets its ledger grant. */
async function pack(key: string, userId: string, status: "credited" | "held", creditsCents = 1000) {
  const id = `${P}${key}`;
  await prisma.creditTopUp.create({
    data: {
      id,
      userId,
      packId: "credits_10",
      priceCents: creditsCents,
      amountTotalCents: creditsCents,
      creditsCents,
      stripeCheckoutSessionId: `cs_${id}`,
      stripePaymentIntentId: `pi_${id}`,
      delivery: status === "credited" ? "deliver_now" : "wait",
      status,
      paidAt: at(2),
      heldUntil: status === "held" ? new Date(Date.now() + 10 * DAY) : null,
      creditedAt: status === "credited" ? at(2) : null,
      creditedCents: status === "credited" ? creditsCents : 0,
    },
  });
  if (status === "credited") {
    await prisma.$transaction((tx) => creditTopUpInTx(tx, { userId, amountCents: creditsCents, paymentRef: `pi_${id}` }));
  }
  return id;
}

function dispute(packId: string, status: string, options: { amount?: number; fee?: number; reinstated?: boolean; created?: Date } = {}) {
  const amount = options.amount ?? 1000;
  const fee = options.fee ?? 1500;
  return {
    id: `dp_${packId}`,
    object: "dispute",
    amount,
    currency: "usd",
    charge: `ch_${packId}`,
    payment_intent: `pi_${packId}`,
    reason: "product_not_received",
    status,
    created: sec(options.created ?? at(5)),
    balance_transactions:
      status.startsWith("warning") || status === "prevented"
        ? []
        : [
            { amount: -amount, fee, net: -amount - fee },
            ...(options.reinstated ? [{ amount, fee: -fee, net: amount + fee }] : []),
          ],
  };
}

async function balance(userId: string) {
  return (await prisma.generationCreditAccount.findUnique({ where: { userId } }))?.balanceCents ?? 0;
}
const row = (packId: string) => prisma.stripeDispute.findUniqueOrThrow({ where: { stripeDisputeId: `dp_${packId}` } });
const noticeTitles = async (userId: string) =>
  (await prisma.notice.findMany({ where: { recipientUserId: userId }, orderBy: { createdAt: "asc" } })).map((n) => n.title);

describe("dispute helpers", () => {
  it("maps Stripe statuses to a state, treating an unknown one as open", () => {
    expect(disputeStateFrom("needs_response")).toBe("open");
    expect(disputeStateFrom("under_review")).toBe("open");
    expect(disputeStateFrom("something_new")).toBe("open");
    expect(disputeStateFrom("warning_needs_response")).toBe("inquiry");
    expect(disputeStateFrom("warning_closed")).toBe("won");
    expect(disputeStateFrom("prevented")).toBe("won");
    expect(disputeStateFrom("won")).toBe("won");
    expect(disputeStateFrom("lost")).toBe("lost");
  });

  it("reads money from balance transactions and shares credits by the disputed amount", () => {
    expect(disputeMoney({ balance_transactions: [{ amount: -1000, fee: 1500 }, { amount: 1000, fee: -1500 }] as any })).toEqual({
      withdrawnCents: 1000,
      reinstatedCents: 1000,
      feeCents: 0,
    });
    expect(disputeMoney({ balance_transactions: undefined as any })).toEqual({ withdrawnCents: 0, reinstatedCents: 0, feeCents: 0 });
    expect(disputedCreditsShare({ creditsCents: 1000, disputedCents: 1000, chargedCents: 1000 })).toBe(1000);
    expect(disputedCreditsShare({ creditsCents: 1000, disputedCents: 1210, chargedCents: 1210 })).toBe(1000);
    expect(disputedCreditsShare({ creditsCents: 1000, disputedCents: 400, chargedCents: 1000 })).toBe(400);
    expect(disputedCreditsShare({ creditsCents: 1000, disputedCents: 0, chargedCents: 1000 })).toBe(0);
  });
});

describe("Card disputes over credit packs (integration, #2596)", () => {
  beforeAll(async () => {
    for (const id of USERS) await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
  });

  afterAll(async () => {
    await prisma.stripeEvent.deleteMany({ where: { eventId: { startsWith: `evt_${P}` } } });
    await prisma.stripeDispute.deleteMany({ where: { stripeDisputeId: { startsWith: `dp_${P}` } } });
    await prisma.creditTopUp.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.generationCreditTransaction.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.generationCreditAccount.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.purchaseConsent.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.notice.deleteMany({ where: { recipientUserId: { in: USERS } } });
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  });

  it("pauses only the unspent credits while open and keeps them out when lost, once", async () => {
    const id = await pack("spent", U.spender, "credited");
    await credits.debit(U.spender, 700, "spend", undefined, "remix_draft");
    expect(await balance(U.spender)).toBe(300);

    const opened = await webhooks.handle(event("charge.dispute.created", dispute(id, "needs_response"), at(5)));
    expect(opened).toMatchObject({ outcome: "credits_opened" });
    expect(await balance(U.spender)).toBe(0);
    expect(await row(id)).toMatchObject({
      kind: "credit_topup",
      status: "open",
      statusBefore: "credited",
      disputedCreditsCents: 1000,
      heldCents: 300,
      withdrawnCents: 1000,
      feeCents: 1500,
      reason: "product_not_received",
    });
    const hold = await prisma.generationCreditTransaction.findFirstOrThrow({ where: { userId: U.spender, type: "reversal" } });
    expect(hold).toMatchObject({ amountCents: 300, reason: "top_up_dispute_hold", paymentRef: `pi_${id}`, balanceAfterCents: 0 });

    // Replays and later events of the same open dispute pause nothing more.
    await webhooks.handle(event("charge.dispute.created", dispute(id, "needs_response"), at(5)));
    await webhooks.handle(event("charge.dispute.funds_withdrawn", dispute(id, "needs_response"), at(5)));
    await webhooks.handle(event("charge.dispute.updated", dispute(id, "under_review"), at(6)));
    expect(await prisma.generationCreditTransaction.count({ where: { userId: U.spender, type: "reversal" } })).toBe(1);

    const lost = await webhooks.handle(event("charge.dispute.closed", dispute(id, "lost"), at(20)));
    expect(lost).toMatchObject({ outcome: "credits_lost" });
    expect(await balance(U.spender)).toBe(0);
    const closed = await row(id);
    expect(closed).toMatchObject({ status: "lost", heldCents: 300, releasedCents: 0 });
    expect(closed.closedAt?.toISOString()).toBe(at(20).toISOString());

    // A lost dispute is final: a late "created" or a "won" changes nothing.
    await webhooks.handle(event("charge.dispute.created", dispute(id, "needs_response"), at(21)));
    await webhooks.handle(event("charge.dispute.closed", dispute(id, "won"), at(22)));
    expect(await row(id)).toMatchObject({ status: "lost", releasedCents: 0 });
    expect(await balance(U.spender)).toBe(0);
    expect(await prisma.generationCreditTransaction.count({ where: { userId: U.spender, reason: "top_up_dispute_release" } })).toBe(0);

    expect(await noticeTitles(U.spender)).toEqual(["Payment disputed: credits paused", "Payment dispute closed: credits removed"]);
    const notice = await prisma.notice.findFirstOrThrow({ where: { recipientUserId: U.spender, title: "Payment disputed: credits paused" } });
    expect(notice.category).toBe("refund");
    expect(notice.body).toContain("$3.00 of credits from that purchase are paused");
    expect(notice.body).toContain("$7.00 had already been used");
    expect(notice.body).toContain("a refund through us is faster for you");
    const state = await topUps.getState(U.spender);
    expect(state.purchases[0].dispute).toEqual({ status: "lost", pausedCents: 300 });
  });

  it("gives the paused credits back when the dispute is won, once", async () => {
    const id = await pack("won", U.winner, "credited");
    await webhooks.handle(event("charge.dispute.created", dispute(id, "needs_response"), at(6)));
    expect(await balance(U.winner)).toBe(0);
    expect((await topUps.getState(U.winner)).purchases[0].dispute).toEqual({ status: "open", pausedCents: 1000 });

    const won = await webhooks.handle(event("charge.dispute.closed", dispute(id, "won", { reinstated: true }), at(25)));
    expect(won).toMatchObject({ outcome: "credits_won" });
    await webhooks.handle(event("charge.dispute.funds_reinstated", dispute(id, "won", { reinstated: true }), at(25, 13)));
    expect(await balance(U.winner)).toBe(1000);
    const closed = await row(id);
    expect(closed).toMatchObject({ status: "won", heldCents: 1000, releasedCents: 1000, reinstatedCents: 1000, feeCents: 0 });
    expect(closed.fundsReinstatedAt?.toISOString()).toBe(at(25).toISOString());
    expect(await prisma.generationCreditTransaction.count({ where: { userId: U.winner, reason: "top_up_dispute_release" } })).toBe(1);
    expect(await noticeTitles(U.winner)).toEqual(["Payment disputed: credits paused", "Payment dispute closed: credits restored"]);
    expect((await topUps.getState(U.winner)).purchases[0].dispute).toBeNull();
  });

  it("keeps a held purchase on hold while disputed, then releases it without the lost share", async () => {
    const lostId = await pack("held_lost", U.waiter, "held");
    const wonId = await pack("held_won", U.waiter, "held", 500);
    await webhooks.handle(event("charge.dispute.created", dispute(lostId, "needs_response"), at(7)));
    await webhooks.handle(event("charge.dispute.created", dispute(wonId, "needs_response", { amount: 500 }), at(7)));
    expect(await balance(U.waiter)).toBe(0);
    expect(await row(lostId)).toMatchObject({ status: "open", statusBefore: "held", heldCents: 0, disputedCreditsCents: 1000 });

    // Neither the lazy release nor "deliver now" moves a disputed purchase.
    const later = new Date(Date.now() + 15 * DAY);
    expect(await releaseDueTopUpHolds(U.waiter, later)).toBe(0);
    const refused = await topUps
      .deliverHeldNow(U.waiter, lostId, { acknowledgedWaiver: true, textVersion: CONSENT_TEXT_VERSION } as any)
      .catch((e) => e);
    expect(refused).toBeInstanceOf(ConflictException);
    expect(refused.getResponse()).toMatchObject({ code: "credit_purchase_disputed" });
    expect(await prisma.purchaseConsent.count({ where: { userId: U.waiter } })).toBe(0);

    await webhooks.handle(event("charge.dispute.closed", dispute(lostId, "lost"), at(21)));
    await webhooks.handle(event("charge.dispute.closed", dispute(wonId, "won", { amount: 500, reinstated: true }), at(21)));
    expect((await topUps.getState(U.waiter, new Date())).heldCents).toBe(500);
    // After the hold ends, only the purchase whose payment stands is credited.
    expect(await releaseDueTopUpHolds(U.waiter, later)).toBe(500);
    expect(await balance(U.waiter)).toBe(500);
    expect(await prisma.creditTopUp.findUniqueOrThrow({ where: { id: lostId } })).toMatchObject({ status: "credited", creditedCents: 0 });
    const lostNotice = await prisma.notice.findFirstOrThrow({
      where: { recipientUserId: U.waiter, title: "Payment dispute closed: credits removed" },
    });
    expect(lostNotice.body).toContain("$10.00 of held credits will not be added");
  });

  it("applies a lost dispute that arrives without its created event", async () => {
    const id = await pack("late", U.late, "credited");
    const outcome = await webhooks.handle(event("charge.dispute.closed", dispute(id, "lost"), at(22)));
    expect(outcome).toMatchObject({ outcome: "credits_lost" });
    expect(await balance(U.late)).toBe(0);
    expect(await row(id)).toMatchObject({ status: "lost", heldCents: 1000 });
    await webhooks.handle(event("charge.dispute.created", dispute(id, "needs_response"), at(23)));
    expect(await prisma.generationCreditTransaction.count({ where: { userId: U.late, type: "reversal" } })).toBe(1);
    expect(await noticeTitles(U.late)).toEqual(["Payment dispute closed: credits removed"]);
  });

  it("pauses the disputed share of a partly disputed payment", async () => {
    const id = await pack("partial", U.partial, "credited");
    await webhooks.handle(event("charge.dispute.created", dispute(id, "needs_response", { amount: 400 }), at(8)));
    expect(await balance(U.partial)).toBe(600);
    expect(await row(id)).toMatchObject({ disputedCreditsCents: 400, heldCents: 400 });
  });

  it("pauses nothing for a bank inquiry until it becomes a dispute, and tells nobody when it just closes", async () => {
    const id = await pack("inquiry", U.asker, "credited");
    const asked = await webhooks.handle(event("charge.dispute.created", dispute(id, "warning_needs_response"), at(9)));
    expect(asked).toMatchObject({ outcome: "skipped_inquiry" });
    expect(await balance(U.asker)).toBe(1000);
    await webhooks.handle(event("charge.dispute.closed", dispute(id, "warning_closed"), at(10)));
    expect(await row(id)).toMatchObject({ status: "won", heldCents: 0, releasedCents: 0, holdAppliedAt: null });
    expect(await balance(U.asker)).toBe(1000);
    expect(await noticeTitles(U.asker)).toEqual([]);
  });

  it("records a dispute over another payment without touching credits", async () => {
    const other = { ...dispute(`${P}other`, "needs_response", { amount: 900 }), payment_intent: `pi_${P}not_a_pack` };
    const outcome = await webhooks.handle(event("charge.dispute.created", other, at(11)));
    expect(outcome).toMatchObject({ outcome: "recorded_open" });
    expect(await row(`${P}other`)).toMatchObject({ kind: "other", creditTopUpId: null, status: "open", heldCents: 0, withdrawnCents: 900 });
  });

  it("ties out in the monthly reconciliation report", async () => {
    // The service stamps ledger rows with the real time; move this suite's rows into its month.
    await prisma.generationCreditTransaction.updateMany({ where: { userId: { in: USERS } }, data: { createdAt: at(26) } });
    const report = await new BillingReconciliationService().build("1987-03", new Date("1988-01-01T00:00:00.000Z"));

    expect(report.disputes.map((d) => d.stripeDisputeId).sort()).toEqual(
      ["spent", "won", "held_lost", "held_won", "late", "partial", "inquiry", "other"].map((k) => `dp_${P}${k}`).sort(),
    );
    const spent = report.disputes.find((d) => d.stripeDisputeId === `dp_${P}spent`);
    expect(spent).toMatchObject({
      kind: "credit_topup",
      accountId: U.spender,
      amountCents: 1000,
      withdrawnCents: 1000,
      feeCents: 1500,
      heldCreditsCents: 300,
      releasedCreditsCents: 0,
      currentStatus: "lost",
    });
    expect(report.disputes.find((d) => d.kind === "other")).toMatchObject({ accountId: null, creditTopUpId: null });

    // Balance: 5 credited packs of $10 granted; $7 spent; holds 300 + 1000 + 1000 + 400; 1000 given back; 500 released from hold.
    expect(report.creditBalance).toMatchObject({
      openingCents: 0,
      topUpGrantsCents: 5500,
      freeGrantsCents: 0,
      disputeHolds: { count: 4, cents: 2700 },
      disputeReleases: { count: 1, cents: 1000 },
      topUpRefundReversals: { count: 0, cents: 0 },
      closingCents: 5500 - 700 - 2700 + 1000,
      balanced: true,
    });
    // Held: two packs bought on hold (1500); the lost one is withdrawn (1000), the other credited (500).
    expect(report.heldPurchases).toMatchObject({
      purchasedCents: 6500,
      creditedCents: 5500,
      disputeWithdrawnCents: 1000,
      closingCents: 0,
      balanced: true,
    });
    const usd = report.controlTotals.find((t) => t.currency === "usd");
    // Withdrawn: spent, won, held_lost, late (1000 each), held_won 500, partial 400, other 900; the inquiry moved nothing.
    expect(usd?.disputesOpened).toEqual({ count: 8, withdrawnCents: 5800, feeCents: 1500 * 5 });
    expect(usd?.disputesReinstated).toEqual({ count: 2, amountCents: 1500 });
    expect(usd?.netCollectedCents).toBe(6500 - 5800 + 1500);

    const csv = sectionToCsv(report, "disputes").split("\r\n").filter(Boolean);
    expect(csv).toHaveLength(9);
    expect(csv[0].split(",")).toContain("fundsReinstatedAt");
    expect(sectionToCsv(report, "credit_balance")).toContain("dispute_holds,4,2700");
    expect(sectionToCsv(report, "held_purchases")).toContain("dispute_withdrawn,,1000");
    expect(JSON.stringify(report.disputes)).not.toContain("@");
  });
});
