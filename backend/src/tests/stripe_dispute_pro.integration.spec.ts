/**
 * Card disputes over Artist Pro invoices (#2596, second half) against a real
 * Postgres. The subscription and its paid invoices are seeded directly; the
 * `charge.dispute.*` events go through the real webhook service, with a fake
 * gateway that maps a payment intent to the invoice it paid.
 */
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import { BillingConfig } from "../modules/billing/billing_config";
import { BillingService } from "../modules/billing/billing.service";
import { CreditPackConfig } from "../modules/billing/credit_packs";
import { CreditTopUpService } from "../modules/billing/credit_topup.service";
import { StripeDisputeService, disputeHoldUntilFrom } from "../modules/billing/stripe_dispute.service";
import type { StripeEvent, StripeGateway } from "../modules/billing/stripe_gateway";
import { StripeWebhookService } from "../modules/billing/stripe_webhook.service";
import { SubscriptionPlanService } from "../modules/entitlements/subscription_plan";
import { NoticeService } from "../modules/notifications/notice.service";
import { PurchaseConsentService } from "../modules/purchase_consent/purchase_consent.service";
import { EventBus } from "../modules/shared/event_bus";

const P = `prodispute_${Date.now()}_`;
const U = { lost: `${P}lost`, won: `${P}won`, two: `${P}two`, late: `${P}late` };
const USERS = Object.values(U);
const DAY = 24 * 60 * 60 * 1000;
const sec = (date: Date) => Math.floor(date.getTime() / 1000);

const NOW = new Date();
const periodStart = new Date(NOW.getTime() - 5 * DAY);
const periodEnd = new Date(NOW.getTime() + 25 * DAY);

/** pi → in, as Stripe's invoice payments would answer; a missing entry paid no invoice. */
const invoiceByPaymentIntent = new Map<string, string>();
const gateway = {
  findInvoiceIdForPaymentIntent: jest.fn(async (pi: string) => invoiceByPaymentIntent.get(pi) ?? null),
} as unknown as StripeGateway;

const config = new BillingConfig({});
const notices = new NoticeService(new EventBus(), new AuditService());
const topUps = new CreditTopUpService(config, new PurchaseConsentService(notices), notices, null, new CreditPackConfig({}));
const disputes = new StripeDisputeService(notices, gateway);
// The webhook itself has no gateway here: dispute events never re-read a subscription.
const webhooks = new StripeWebhookService(config, null, topUps, disputes);
const plans = new SubscriptionPlanService();

let seq = 0;
function event(type: string, object: unknown, created: Date = new Date()): StripeEvent {
  return { id: `evt_${P}${++seq}`, object: "event", type, created: sec(created), livemode: false, data: { object } } as unknown as StripeEvent;
}

/** One active monthly subscription with a paid invoice for the current period. */
async function subscribe(userId: string, invoiceKeys: string[] = ["cur"]) {
  const sub = await prisma.subscription.create({
    data: {
      userId,
      stripeCustomerId: `cus_${userId}`,
      stripeSubscriptionId: `sub_${userId}`,
      interval: "month",
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
  });
  for (const key of invoiceKeys) {
    const prev = key === "prev";
    await prisma.subscriptionInvoice.create({
      data: {
        subscriptionId: sub.id,
        stripeInvoiceId: `in_${userId}_${key}`,
        stripeSubscriptionId: `sub_${userId}`,
        currency: "usd",
        amountPaidCents: 1499,
        interval: "month",
        periodStart: prev ? new Date(periodStart.getTime() - 30 * DAY) : periodStart,
        periodEnd: prev ? periodStart : periodEnd,
        paidAt: prev ? new Date(periodStart.getTime() - 30 * DAY) : periodStart,
      },
    });
    invoiceByPaymentIntent.set(`pi_${userId}_${key}`, `in_${userId}_${key}`);
  }
  return sub;
}

function dispute(userId: string, status: string, key = "cur") {
  return {
    id: `dp_${userId}_${key}`,
    object: "dispute",
    amount: 1499,
    currency: "usd",
    charge: `ch_${userId}_${key}`,
    payment_intent: `pi_${userId}_${key}`,
    reason: "fraudulent",
    status,
    created: sec(new Date()),
    balance_transactions: status.startsWith("warning") ? [] : [{ amount: -1499, fee: 1500, net: -2999 }],
  };
}

const plan = async (userId: string) => (await plans.resolvePlan(userId)).plan;
const holdOf = async (userId: string) =>
  (await prisma.subscription.findUniqueOrThrow({ where: { userId } })).disputeHoldUntil;
const titles = async (userId: string) =>
  (await prisma.notice.findMany({ where: { recipientUserId: userId }, orderBy: { createdAt: "asc" } })).map((n) => n.title);

describe("disputeHoldUntilFrom", () => {
  it("keeps the latest period end among open or lost disputes", () => {
    const a = new Date("2026-01-01T00:00:00Z");
    const b = new Date("2026-02-01T00:00:00Z");
    expect(disputeHoldUntilFrom([])).toBeNull();
    expect(disputeHoldUntilFrom([{ status: "won", periodEnd: b }, { status: "inquiry", periodEnd: b }])).toBeNull();
    expect(disputeHoldUntilFrom([{ status: "open", periodEnd: a }, { status: "lost", periodEnd: b }])).toEqual(b);
    expect(disputeHoldUntilFrom([{ status: "open", periodEnd: a }, { status: "won", periodEnd: b }])).toEqual(a);
  });
});

describe("Card disputes over Artist Pro invoices (integration, #2596)", () => {
  beforeAll(async () => {
    for (const id of USERS) await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
  });

  afterAll(async () => {
    await prisma.stripeEvent.deleteMany({ where: { eventId: { startsWith: `evt_${P}` } } });
    await prisma.stripeDispute.deleteMany({ where: { stripeDisputeId: { startsWith: `dp_${P}` } } });
    await prisma.subscriptionInvoice.deleteMany({ where: { subscription: { userId: { in: USERS } } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.notice.deleteMany({ where: { recipientUserId: { in: USERS } } });
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  });

  it("pauses Pro for the disputed period while open and keeps it off when lost, once", async () => {
    await subscribe(U.lost);
    expect(await plan(U.lost)).toBe("pro");

    const opened = await webhooks.handle(event("charge.dispute.created", dispute(U.lost, "needs_response")));
    expect(opened).toMatchObject({ outcome: "pro_opened" });
    expect(await plan(U.lost)).toBe("free");
    expect((await holdOf(U.lost))?.getTime()).toBe(periodEnd.getTime());
    const row = await prisma.stripeDispute.findUniqueOrThrow({ where: { stripeDisputeId: `dp_${U.lost}_cur` } });
    expect(row).toMatchObject({ kind: "subscription_invoice", status: "open", creditTopUpId: null });
    expect(row.subscriptionInvoiceId).toBeTruthy();

    // A replayed open event changes nothing and tells nobody twice.
    expect(await webhooks.handle(event("charge.dispute.updated", dispute(U.lost, "under_review")))).toMatchObject({
      outcome: "skipped_open",
    });

    const lost = await webhooks.handle(event("charge.dispute.closed", dispute(U.lost, "lost")));
    expect(lost).toMatchObject({ outcome: "pro_lost" });
    expect(await plan(U.lost)).toBe("free");
    expect((await holdOf(U.lost))?.getTime()).toBe(periodEnd.getTime());
    // Lost is final: a late `created` never lifts the hold.
    await webhooks.handle(event("charge.dispute.created", dispute(U.lost, "needs_response")));
    expect(await plan(U.lost)).toBe("free");

    // Once the disputed period has ended, the next paid period grants Pro again.
    const later = new Date(periodEnd.getTime() + DAY);
    await prisma.subscription.update({
      where: { userId: U.lost },
      data: { currentPeriodStart: periodEnd, currentPeriodEnd: new Date(periodEnd.getTime() + 30 * DAY) },
    });
    expect((await plans.resolvePlan(U.lost, later)).plan).toBe("pro");

    expect(await titles(U.lost)).toEqual([
      "Payment disputed: Artist Pro paused",
      "Payment dispute closed: Artist Pro removed for that period",
    ]);
  });

  it("restores Pro when the dispute is won, and shows the hold in Usage & Billing meanwhile", async () => {
    await subscribe(U.won);
    await webhooks.handle(event("charge.dispute.created", dispute(U.won, "needs_response")));
    const billing = new BillingService(config, new PurchaseConsentService(notices));
    const state = await billing.getState(U.won);
    expect(state.subscription?.disputeHoldUntil).toBe(periodEnd.toISOString());
    expect(state.plan.plan).toBe("free");

    const won = await webhooks.handle(event("charge.dispute.closed", dispute(U.won, "won")));
    expect(won).toMatchObject({ outcome: "pro_won" });
    expect(await holdOf(U.won)).toBeNull();
    expect(await plan(U.won)).toBe("pro");
    expect((await billing.getState(U.won)).subscription?.disputeHoldUntil).toBeNull();
    expect(await titles(U.won)).toEqual(["Payment disputed: Artist Pro paused", "Payment dispute closed: Artist Pro restored"]);
  });

  it("keeps the hold while another dispute of the same subscription is still open", async () => {
    await subscribe(U.two, ["prev", "cur"]);
    await webhooks.handle(event("charge.dispute.created", dispute(U.two, "needs_response", "prev")));
    // The previous period has already ended: its hold does not reach today.
    expect(await plan(U.two)).toBe("pro");
    await webhooks.handle(event("charge.dispute.created", dispute(U.two, "needs_response", "cur")));
    expect(await plan(U.two)).toBe("free");
    await webhooks.handle(event("charge.dispute.closed", dispute(U.two, "won", "prev")));
    expect(await plan(U.two)).toBe("free");
    expect((await holdOf(U.two))?.getTime()).toBe(periodEnd.getTime());
    await webhooks.handle(event("charge.dispute.closed", dispute(U.two, "won", "cur")));
    expect(await plan(U.two)).toBe("pro");
  });

  it("pauses nothing for an inquiry, and ties a dispute to its invoice once Stripe can name it", async () => {
    await subscribe(U.late);
    const pi = `pi_${U.late}_cur`;
    const stripeInvoice = invoiceByPaymentIntent.get(pi) as string;
    invoiceByPaymentIntent.delete(pi);

    expect(await webhooks.handle(event("charge.dispute.created", dispute(U.late, "warning_needs_response")))).toMatchObject({
      outcome: "recorded_inquiry",
    });
    invoiceByPaymentIntent.set(pi, stripeInvoice);
    // Still an inquiry once tied: nothing paused.
    await webhooks.handle(event("charge.dispute.updated", dispute(U.late, "warning_under_review")));
    expect(await plan(U.late)).toBe("pro");
    expect(await prisma.stripeDispute.findUniqueOrThrow({ where: { stripeDisputeId: `dp_${U.late}_cur` } })).toMatchObject({
      kind: "subscription_invoice",
      status: "inquiry",
    });
    expect(await webhooks.handle(event("charge.dispute.updated", dispute(U.late, "needs_response")))).toMatchObject({
      outcome: "pro_opened",
    });
    expect(await plan(U.late)).toBe("free");
  });
});
