/**
 * Artist Pro monthly generation allowance bucket (#2408), against Postgres.
 *
 * Covered: the grant on a paid invoice (through the Stripe webhook, once per
 * invoice), invoices that grant nothing, spend order across the two buckets,
 * the zero-balance block, refunds back to the bucket each debit came from,
 * expiry at period end (computed, not carried over), the subscription gate,
 * annual plans (twelve monthly slices), a plan change, concurrent debits, parity
 * with the metered-action registry, the withdrawal helper and the Usage &
 * Billing summary values. Stripe is a fake gateway: nothing here calls Stripe.
 */
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import { BillingConfig } from "../modules/billing/billing_config";
import { CreditPackConfig } from "../modules/billing/credit_packs";
import { CreditTopUpService } from "../modules/billing/credit_topup.service";
import type { StripeEvent, StripeGateway, StripeInvoice, StripeSubscription } from "../modules/billing/stripe_gateway";
import { StripeWebhookService } from "../modules/billing/stripe_webhook.service";
import { addUtcMonthsClamped, monthlySlices } from "../modules/credits/allowance";
import { GenerationAllowanceService } from "../modules/credits/allowance.service";
import {
  GenerationCreditsService,
  InsufficientCreditsException,
} from "../modules/credits/generation-credits.service";
import { METERED_ACTIONS, METERED_ACTION_KINDS, unitCostCents } from "../modules/credits/metered-actions";
import { EntitlementsService } from "../modules/entitlements/entitlements.service";
import type { GenerationService } from "../modules/generation/generation.service";
import type { RemixProjectService } from "../modules/remix/remix-project.service";
import { NoticeService } from "../modules/notifications/notice.service";
import { PurchaseConsentService } from "../modules/purchase_consent/purchase_consent.service";
import { EventBus } from "../modules/shared/event_bus";
import { UsageService } from "../modules/usage/usage.service";

const P = `allowance_${Date.now()}_`;
const DAY = 24 * 60 * 60 * 1000;
const sec = (date: Date) => Math.floor(date.getTime() / 1000);
/** Stripe timestamps are whole seconds. */
const at = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);

const credits = new GenerationCreditsService();
// No ConfigService and no env override in the test environment: the $3.00 default.
const allowance = new GenerationAllowanceService({ get: () => undefined } as any);

/** The webhook needs a credit-pack handler (#2492); these tests only exercise subscription events. */
function topUpsFor(config: BillingConfig, gateway: StripeGateway | null) {
  const notices = new NoticeService(new EventBus(), new AuditService());
  return new CreditTopUpService(config, new PurchaseConsentService(notices), notices, gateway, new CreditPackConfig({}));
}

const users: string[] = [];
let seq = 0;

async function newUser(tag: string): Promise<string> {
  const id = `${P}${tag}_${++seq}`;
  await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
  users.push(id);
  return id;
}

async function subscribe(
  userId: string,
  opts: {
    status?: "active" | "canceled" | "past_due";
    start?: Date;
    end?: Date;
    interval?: "month" | "year";
    cancelAtPeriodEnd?: boolean;
  } = {},
) {
  const start = opts.start ?? at(Date.now() - 5 * DAY);
  const end = opts.end ?? at(start.getTime() + 30 * DAY);
  return prisma.subscription.create({
    data: {
      userId,
      stripeCustomerId: `cus_${userId}`,
      stripeSubscriptionId: `sub_${userId}`,
      interval: opts.interval ?? "month",
      status: opts.status ?? "active",
      currentPeriodStart: start,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false,
    },
  });
}

function paidInvoice(
  id: string,
  stripeSubscriptionId: string,
  start: Date,
  end: Date,
  reason = "subscription_cycle",
  extraLines: unknown[] = [],
): StripeInvoice {
  return {
    id,
    object: "invoice",
    amount_paid: 1499,
    billing_reason: reason,
    parent: { type: "subscription_details", subscription_details: { subscription: stripeSubscriptionId } },
    lines: {
      data: [
        ...extraLines,
        {
          period: { start: sec(start), end: sec(end) },
          parent: { type: "subscription_item_details", subscription_item_details: { proration: false } },
        },
      ],
    },
  } as unknown as StripeInvoice;
}

async function seedGrant(
  userId: string,
  subscriptionId: string,
  opts: { periodStart: Date; expiresAt: Date; amountCents?: number; consumedCents?: number; invoice?: string },
) {
  return prisma.generationAllowanceGrant.create({
    data: {
      userId,
      subscriptionId,
      stripeInvoiceId: opts.invoice ?? `in_${userId}_${++seq}`,
      amountCents: opts.amountCents ?? 300,
      consumedCents: opts.consumedCents ?? 0,
      periodStart: opts.periodStart,
      expiresAt: opts.expiresAt,
    },
  });
}

async function grants(userId: string) {
  return prisma.generationAllowanceGrant.findMany({ where: { userId }, orderBy: { periodStart: "asc" } });
}

async function balance(userId: string) {
  return (await prisma.generationCreditAccount.findUnique({ where: { userId } }))?.balanceCents ?? 0;
}

/** A Pro subscriber with this month's $3.00 granted from a paid invoice, plus `boughtCents`. */
async function proUser(tag: string, boughtCents = 0) {
  const userId = await newUser(tag);
  const start = at(Date.now() - 5 * DAY);
  const end = at(start.getTime() + 30 * DAY);
  const sub = await subscribe(userId, { start, end });
  expect(await allowance.grantForInvoice(paidInvoice(`in_${userId}`, `sub_${userId}`, start, end))).toBe("granted");
  if (boughtCents > 0) await credits.grant(userId, boughtCents, "test_bought");
  return { userId, sub, start, end };
}

afterAll(async () => {
  await prisma.generationJobOutcome.deleteMany({ where: { userId: { in: users } } });
  await prisma.generationCreditTransaction.deleteMany({ where: { userId: { in: users } } });
  await prisma.generationAllowanceGrant.deleteMany({ where: { userId: { in: users } } });
  await prisma.generationCreditAccount.deleteMany({ where: { userId: { in: users } } });
  await prisma.subscription.deleteMany({ where: { userId: { in: users } } });
  await prisma.stripeEvent.deleteMany({ where: { eventId: { startsWith: `evt_${P}` } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

describe("Generation allowance (integration, #2408)", () => {
  describe("grant", () => {
    it("credits $3.00 for the paid month once per invoice, through the invoice.paid webhook", async () => {
      const userId = await newUser("webhook");
      const start = at(Date.now() - DAY);
      const end = at(start.getTime() + 30 * DAY);
      await subscribe(userId, { start, end });
      const subId = `sub_${userId}`;
      const remote: StripeSubscription = {
        id: subId,
        object: "subscription",
        customer: `cus_${userId}`,
        status: "active",
        cancel_at_period_end: false,
        cancel_at: null,
        metadata: {},
        items: {
          data: [{ current_period_start: sec(start), current_period_end: sec(end), price: { recurring: { interval: "month" } } }],
        },
      } as unknown as StripeSubscription;
      const gateway = {
        createCustomer: jest.fn(),
        createCheckoutSession: jest.fn(),
        createPortalSession: jest.fn(),
        retrieveSubscription: jest.fn(async () => remote),
        constructEvent: jest.fn(),
      } as unknown as StripeGateway;
      const config = new BillingConfig({
        STRIPE_SECRET_KEY: "sk_test_allowance",
        STRIPE_WEBHOOK_SECRET: "whsec_allowance",
        STRIPE_PRICE_ARTIST_PRO_MONTHLY: "price_month",
        STRIPE_PRICE_ARTIST_PRO_ANNUAL: "price_year",
        FRONTEND_URL: "https://app.example.test",
      });
      const webhooks = new StripeWebhookService(config, gateway, topUpsFor(config, gateway), allowance);
      const invoice = paidInvoice(`in_${userId}`, subId, start, end, "subscription_create");
      const event = (id: string) =>
        ({ id, object: "event", type: "invoice.paid", created: sec(new Date()), livemode: false, data: { object: invoice } }) as unknown as StripeEvent;

      expect(await webhooks.handle(event(`evt_${P}${userId}_1`))).toMatchObject({ outcome: "applied" });
      // A second delivery of the same event, and a different event for the same invoice.
      expect(await webhooks.handle(event(`evt_${P}${userId}_1`))).toMatchObject({ duplicate: true });
      await webhooks.handle(event(`evt_${P}${userId}_2`));
      expect(await allowance.grantForInvoice(invoice)).toBe("duplicate");

      const rows = await grants(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ amountCents: 300, consumedCents: 0, sliceIndex: 0, periodStart: start, expiresAt: end });
      const status = await allowance.getStatus(userId);
      expect(status).toMatchObject({ remainingCents: 300, grantedCents: 300, spentCents: 0, expiresAt: end });
    });

    it("a payment_failed event grants nothing", async () => {
      const userId = await newUser("failed");
      await subscribe(userId);
      const webhooks = new StripeWebhookService(new BillingConfig({}), null, topUpsFor(new BillingConfig({}), null), allowance);
      const invoice = paidInvoice(`in_${userId}`, `sub_${userId}`, at(Date.now()), at(Date.now() + 30 * DAY));
      await webhooks.handle({
        id: `evt_${P}${userId}`,
        object: "event",
        type: "invoice.payment_failed",
        created: sec(new Date()),
        livemode: false,
        data: { object: invoice },
      } as unknown as StripeEvent);
      expect(await grants(userId)).toHaveLength(0);
    });

    it("grants nothing for an invoice that opens no period, an unknown subscription, or a second invoice for the same month", async () => {
      const userId = await newUser("skips");
      const start = at(Date.now() - DAY);
      const end = at(start.getTime() + 30 * DAY);
      await subscribe(userId, { start, end });
      const subId = `sub_${userId}`;
      expect(await allowance.grantForInvoice(paidInvoice(`in_${userId}_m`, subId, start, end, "manual"))).toBe(
        "skipped_not_period_opening",
      );
      const proration = {
        period: { start: sec(start), end: sec(end) },
        parent: { type: "subscription_item_details", subscription_item_details: { proration: true } },
      };
      const prorationOnly = {
        ...paidInvoice(`in_${userId}_p`, subId, start, end, "subscription_update"),
        lines: { data: [proration] },
      } as unknown as StripeInvoice;
      expect(await allowance.grantForInvoice(prorationOnly)).toBe("skipped_not_period_opening");
      expect(await allowance.grantForInvoice(paidInvoice(`in_${userId}_u`, `sub_${P}nobody`, start, end))).toBe(
        "skipped_unknown_subscription",
      );
      expect(await allowance.grantForInvoice(paidInvoice(`in_${userId}_a`, subId, start, end))).toBe("granted");
      expect(await allowance.grantForInvoice(paidInvoice(`in_${userId}_b`, subId, start, end))).toBe("duplicate");
      expect(await grants(userId)).toHaveLength(1);

      const off = new GenerationAllowanceService({ get: () => "0" } as any);
      expect(off.monthlyAllowanceCents).toBe(0);
      expect(await off.grantForInvoice(paidInvoice(`in_${userId}_c`, subId, end, at(end.getTime() + 30 * DAY)))).toBe(
        "disabled",
      );
    });
  });

  describe("spend order", () => {
    it("spends the allowance before bought credits, then the balance, and blocks at zero", async () => {
      const { userId } = await proUser("order", 50);

      expect(await credits.debit(userId, 290, "lyria_generation", `${userId}_a`, "lyria")).toBe(50);
      // 10¢ left in the allowance: it pays first, the balance pays the other 20¢.
      expect(await credits.debit(userId, 30, "remix_draft", `${userId}_b`, "remix_draft")).toBe(30);
      const [grant] = await grants(userId);
      expect(grant.consumedCents).toBe(300);
      expect(await balance(userId)).toBe(30);

      const ledger = await prisma.generationCreditTransaction.findMany({
        where: { userId, type: "debit" },
        orderBy: { createdAt: "asc" },
      });
      expect(ledger.map((row) => [row.amountCents, row.allowanceCents, row.balanceAfterCents])).toEqual([
        [290, 290, 50],
        [30, 10, 30],
      ]);
      expect(ledger.every((row) => row.allowanceGrantId === grant.id)).toBe(true);

      // 40¢ asked, 30¢ spendable: blocked, nothing moves.
      const blocked = credits.debit(userId, 40, "lyria_generation", `${userId}_c`, "lyria");
      await expect(blocked).rejects.toBeInstanceOf(InsufficientCreditsException);
      await expect(credits.debit(userId, 40, "lyria_generation", `${userId}_d`, "lyria")).rejects.toMatchObject({
        balanceCents: 30,
        requiredCents: 40,
      });
      expect(await balance(userId)).toBe(30);
      expect((await grants(userId))[0].consumedCents).toBe(300);

      expect(await credits.debit(userId, 30, "lyria_generation", `${userId}_e`, "lyria")).toBe(0);
      await expect(credits.debit(userId, 10, "lyria_generation", `${userId}_f`, "lyria")).rejects.toBeInstanceOf(
        InsufficientCreditsException,
      );
    });

    it("leaves the zero-balance block unchanged for a person without an allowance", async () => {
      const userId = await newUser("free");
      await expect(credits.debit(userId, 10, "lyria_generation", `${userId}_a`, "lyria")).rejects.toMatchObject({
        balanceCents: 0,
      });
      await credits.grant(userId, 10, "test_bought");
      expect(await credits.debit(userId, 10, "lyria_generation", `${userId}_b`, "lyria")).toBe(0);
      const debit = await prisma.generationCreditTransaction.findFirstOrThrow({ where: { userId, type: "debit" } });
      expect(debit).toMatchObject({ amountCents: 10, allowanceCents: 0, allowanceGrantId: null });
    });

    it("an allowance-only subscriber with no bought credits can generate", async () => {
      const { userId } = await proUser("allowance_only");
      expect(await credits.debit(userId, 10, "remix_part", `${userId}_a`, "remix_draft")).toBe(0);
      expect((await grants(userId))[0].consumedCents).toBe(10);
      const view = await credits.getBalance(userId);
      expect(view).toMatchObject({ balanceCents: 0, spendableCents: 290 });
      expect(view.recentTransactions[0]).toMatchObject({ type: "debit", amountCents: 10, allowanceCents: 10 });
    });

    it("never spends more than both buckets hold under concurrent debits", async () => {
      const userId = await newUser("race");
      const sub = await subscribe(userId);
      await seedGrant(userId, sub.id, {
        periodStart: at(Date.now() - DAY),
        expiresAt: at(Date.now() + 20 * DAY),
        amountCents: 30,
      });
      await credits.grant(userId, 20, "test_bought");

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) => credits.debit(userId, 10, "lyria_generation", `${userId}_${index}`, "lyria")),
      );
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(5);
      expect(rejected).toHaveLength(3);
      for (const result of rejected) {
        expect((result as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientCreditsException);
      }
      expect((await grants(userId))[0].consumedCents).toBe(30);
      expect(await balance(userId)).toBe(0);
      const sums = await prisma.generationCreditTransaction.aggregate({
        where: { userId, type: "debit" },
        _sum: { amountCents: true, allowanceCents: true },
      });
      expect(sums._sum).toEqual({ amountCents: 50, allowanceCents: 30 });
    });

    it("parity: every metered action in the registry spends the allowance first", async () => {
      const { userId } = await proUser("parity", 100);
      for (const kind of METERED_ACTION_KINDS) {
        for (const reason of METERED_ACTIONS[kind].ledgerReasons) {
          const cost = unitCostCents(kind, 10);
          const jobId = `${userId}_${reason}`;
          await credits.debit(userId, cost, reason, jobId, kind);
          const row = await prisma.generationCreditTransaction.findFirstOrThrow({ where: { userId, jobId, type: "debit" } });
          expect({ reason, allowanceCents: row.allowanceCents }).toEqual({ reason, allowanceCents: cost });
        }
      }
      expect(await balance(userId)).toBe(100);
    });
  });

  describe("refunds", () => {
    it("restore each debit to the bucket it came from, once", async () => {
      const { userId } = await proUser("refund", 100);

      await credits.debit(userId, 10, "lyria_generation", `${userId}_a`, "lyria");
      expect(await credits.refund(userId, 10, "job_failed_refund", `${userId}_a`)).toBe(100);
      expect((await grants(userId))[0].consumedCents).toBe(0);

      await credits.debit(userId, 295, "lyria_generation", `${userId}_b`, "lyria");
      // 5¢ from the allowance, 5¢ from the balance.
      await credits.debit(userId, 10, "remix_draft", `${userId}_c`, "remix_draft");
      expect(await balance(userId)).toBe(95);
      expect(await credits.refund(userId, 10, "remix_draft_failed_refund", `${userId}_c`)).toBe(100);
      expect((await grants(userId))[0].consumedCents).toBe(295);
      const refund = await prisma.generationCreditTransaction.findFirstOrThrow({
        where: { userId, jobId: `${userId}_c`, type: "refund" },
      });
      expect(refund).toMatchObject({ amountCents: 10, allowanceCents: 5, balanceAfterCents: 100 });

      // A second refund for the same job is a no-op.
      expect(await credits.refund(userId, 10, "remix_draft_failed_refund", `${userId}_c`)).toBe(100);
      expect((await grants(userId))[0].consumedCents).toBe(295);
      expect(await prisma.generationCreditTransaction.count({ where: { userId, type: "refund" } })).toBe(2);
    });

    it("a refund to a month that has ended lapses with it instead of becoming bought credit", async () => {
      const { userId } = await proUser("refund_lapsed", 20);
      await credits.debit(userId, 10, "lyria_generation", `${userId}_a`, "lyria");
      const [grant] = await grants(userId);
      await prisma.generationAllowanceGrant.update({
        where: { id: grant.id },
        data: { periodStart: at(Date.now() - 31 * DAY), expiresAt: at(Date.now() - DAY) },
      });
      expect(await credits.refund(userId, 10, "job_failed_refund", `${userId}_a`)).toBe(20);
      expect((await grants(userId))[0].consumedCents).toBe(0);
      expect((await credits.getBalance(userId)).spendableCents).toBe(20);
    });
  });

  describe("expiry", () => {
    it("unused allowance expires at period end and is not carried over", async () => {
      const userId = await newUser("expiry");
      const sub = await subscribe(userId);
      const previousEnd = at(Date.now() - 10 * DAY);
      await seedGrant(userId, sub.id, {
        periodStart: at(previousEnd.getTime() - 30 * DAY),
        expiresAt: previousEnd,
        consumedCents: 120,
      });
      const liveEnd = at(Date.now() + 20 * DAY);
      const live = await seedGrant(userId, sub.id, { periodStart: previousEnd, expiresAt: liveEnd });

      expect(await allowance.getStatus(userId)).toEqual({
        remainingCents: 300,
        grantedCents: 300,
        spentCents: 0,
        periodStart: previousEnd,
        expiresAt: liveEnd,
        previousExpiredCents: 180,
        previousEndedAt: previousEnd,
      });
      await credits.debit(userId, 10, "lyria_generation", `${userId}_a`, "lyria");
      const debit = await prisma.generationCreditTransaction.findFirstOrThrow({ where: { userId, type: "debit" } });
      expect(debit.allowanceGrantId).toBe(live.id);
    });

    it("once the month has ended nothing is spendable until the next paid invoice", async () => {
      const userId = await newUser("ended");
      const sub = await subscribe(userId);
      const ended = at(Date.now() - DAY);
      await seedGrant(userId, sub.id, { periodStart: at(ended.getTime() - 30 * DAY), expiresAt: ended, consumedCents: 50 });
      await expect(credits.debit(userId, 10, "lyria_generation", `${userId}_a`, "lyria")).rejects.toMatchObject({
        balanceCents: 0,
      });
      expect(await allowance.getStatus(userId)).toMatchObject({
        remainingCents: 0,
        grantedCents: 0,
        expiresAt: null,
        previousExpiredCents: 250,
        previousEndedAt: ended,
      });
      expect(await allowance.getStatus(await newUser("never"))).toBeNull();
    });

    it("stops when the subscription no longer gives Pro", async () => {
      const userId = await newUser("canceled");
      const sub = await subscribe(userId, { status: "canceled" });
      await seedGrant(userId, sub.id, { periodStart: at(Date.now() - DAY), expiresAt: at(Date.now() + 20 * DAY) });
      await credits.grant(userId, 10, "test_bought");
      await credits.debit(userId, 10, "lyria_generation", `${userId}_a`, "lyria");
      expect((await grants(userId))[0].consumedCents).toBe(0);
      expect(await balance(userId)).toBe(0);
      expect((await credits.getBalance(userId)).allowance).toMatchObject({ remainingCents: 0, expiresAt: null });
    });
  });

  describe("annual plans", () => {
    it("grants twelve monthly slices, each spendable only in its own month", async () => {
      const userId = await newUser("annual");
      const start = at(addUtcMonthsClamped(new Date(), -3).getTime() - DAY);
      const end = addUtcMonthsClamped(start, 12);
      await subscribe(userId, { start, end, interval: "year" });
      expect(
        await allowance.grantForInvoice(paidInvoice(`in_${userId}`, `sub_${userId}`, start, end, "subscription_create")),
      ).toBe("granted");
      const rows = await grants(userId);
      const slices = monthlySlices(start, end);
      expect(rows.map((row) => [row.sliceIndex, row.periodStart, row.expiresAt, row.amountCents])).toEqual(
        slices.map((slice) => [slice.sliceIndex, slice.periodStart, slice.expiresAt, 300]),
      );

      // Month 4 of the year (slice 3) is live; slice 2 lapsed unused.
      expect(await allowance.getStatus(userId)).toMatchObject({
        remainingCents: 300,
        periodStart: slices[3].periodStart,
        expiresAt: slices[4].periodStart,
        previousExpiredCents: 300,
        previousEndedAt: slices[3].periodStart,
      });
      await credits.debit(userId, 300, "lyria_generation", `${userId}_a`, "lyria");
      // Next month's slice is not spendable yet.
      await expect(credits.debit(userId, 10, "lyria_generation", `${userId}_b`, "lyria")).rejects.toBeInstanceOf(
        InsufficientCreditsException,
      );
      expect((await grants(userId)).map((row) => row.consumedCents)).toEqual([0, 0, 0, 300, 0, 0, 0, 0, 0, 0, 0, 0]);
      // A redelivered annual invoice grants nothing more.
      expect(await allowance.grantForInvoice(paidInvoice(`in_${userId}`, `sub_${userId}`, start, end))).toBe("duplicate");
      // The withdrawal helper counts the whole paid year.
      expect(await allowance.spentInBillingPeriodCents((await grants(userId))[0].subscriptionId, start, end)).toBe(300);
    });

    it("a switch from monthly to annual closes the monthly allowance and opens the annual one", async () => {
      const userId = await newUser("switch");
      const monthStart = at(Date.now() - 10 * DAY);
      const monthEnd = at(monthStart.getTime() + 30 * DAY);
      await subscribe(userId, { start: monthStart, end: monthEnd });
      await allowance.grantForInvoice(paidInvoice(`in_${userId}_m`, `sub_${userId}`, monthStart, monthEnd));
      await credits.debit(userId, 100, "lyria_generation", `${userId}_a`, "lyria");

      const switchedAt = at(Date.now() - 60 * 60 * 1000);
      const yearEnd = addUtcMonthsClamped(switchedAt, 12);
      const proration = {
        period: { start: sec(switchedAt), end: sec(monthEnd) },
        parent: { type: "subscription_item_details", subscription_item_details: { proration: true } },
      };
      expect(
        await allowance.grantForInvoice(
          paidInvoice(`in_${userId}_y`, `sub_${userId}`, switchedAt, yearEnd, "subscription_update", [proration]),
        ),
      ).toBe("granted");
      expect(await allowance.getStatus(userId)).toMatchObject({
        remainingCents: 300,
        periodStart: switchedAt,
        previousExpiredCents: 200,
        previousEndedAt: switchedAt,
      });
    });
  });

  describe("withdrawal refund helper", () => {
    it("reports the allowance already spent this billing period, net of refunds", async () => {
      const { userId, sub } = await proUser("withdrawal", 0);
      await seedGrant(userId, sub.id, {
        periodStart: at(Date.now() - 70 * DAY),
        expiresAt: at(Date.now() - 40 * DAY),
        consumedCents: 250,
      });
      await credits.debit(userId, 30, "lyria_generation", `${userId}_a`, "lyria");
      await credits.debit(userId, 20, "lyria_generation", `${userId}_b`, "lyria");
      await credits.refund(userId, 20, "job_failed_refund", `${userId}_b`);
      expect(await allowance.spentThisBillingPeriodCents(userId)).toBe(30);
      expect(await allowance.spentThisBillingPeriodCents(await newUser("no_sub"))).toBe(0);
    });
  });

  describe("Usage & Billing summary", () => {
    const peek = { remaining: 10, limit: 10, windowMs: 60 * 60 * 1000, resetsAt: null };
    const usage = new UsageService(
      credits,
      { getGenerationRateLimitStatus: () => peek } as unknown as GenerationService,
      { getGenerationRateLimitStatus: () => peek } as unknown as RemixProjectService,
      new EntitlementsService(),
      allowance,
    );

    it("reports the allowance remaining, granted and its reset date next to the bought balance", async () => {
      const { userId, end } = await proUser("summary", 40);
      await credits.debit(userId, 60, "lyria_generation", `${userId}_a`, "lyria");
      const summary = await usage.getSummary(userId);
      expect(summary.credits).toMatchObject({ balanceCents: 40, spendableCents: 280 });
      expect(summary.credits.allowance).toMatchObject({
        remainingCents: 240,
        grantedCents: 300,
        spentCents: 60,
        expiresAt: end,
      });
      expect(summary.plan).toMatchObject({ tier: "pro", source: "stripe_subscription", monthlyAllowanceCents: 300 });
      // Spend by action still counts the whole charge.
      const lyria = summary.breakdown.items.find((item) => item.kind === "lyria");
      expect(lyria).toMatchObject({ charges: 1, spentCents: 60 });
    });

    it("reports no allowance for the free plan", async () => {
      const userId = await newUser("summary_free");
      const summary = await usage.getSummary(userId);
      expect(summary.credits.allowance).toBeNull();
      expect(summary.credits.spendableCents).toBe(0);
      expect(summary.plan).toMatchObject({ tier: "free", monthlyAllowanceCents: null });
    });
  });
});
