/**
 * Artist Pro automatic-renewal notices (#2597) against a real Postgres: the
 * acknowledgement on the first paid invoice (through the webhook), the yearly
 * plan's pre-renewal reminder (15 to 45 days ahead), a monthly plan's yearly
 * reminder, the price-change notice window, and that a rerun sends nothing
 * twice.
 */
import { prisma } from "../db/prisma";
import { AuditService } from "../modules/audit/audit.service";
import { BillingConfig } from "../modules/billing/billing_config";
import { runBillingRetention } from "../modules/billing/billing_retention";
import { CreditPackConfig } from "../modules/billing/credit_packs";
import { CreditTopUpService } from "../modules/billing/credit_topup.service";
import { RenewalNoticeService, renewalPrice } from "../modules/billing/renewal_notices.service";
import { StripeDisputeService } from "../modules/billing/stripe_dispute.service";
import type { StripeEvent, StripeGateway } from "../modules/billing/stripe_gateway";
import { StripeWebhookService } from "../modules/billing/stripe_webhook.service";
import { SubscriptionLifecycleService } from "../modules/billing/subscription_lifecycle.service";
import { NoticeService } from "../modules/notifications/notice.service";
import { PurchaseConsentService } from "../modules/purchase_consent/purchase_consent.service";
import { EventBus } from "../modules/shared/event_bus";

const P = `renewal_${Date.now()}_`;
const U = { start: `${P}start`, annual: `${P}annual`, far: `${P}far`, monthly: `${P}monthly`, eur: `${P}eur`, ending: `${P}ending` };
const USERS = Object.values(U);
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();
const sec = (date: Date) => Math.floor(date.getTime() / 1000);

const notices = new NoticeService(new EventBus(), new AuditService());
const renewals = new RenewalNoticeService(notices);
const config = new BillingConfig({});

async function subscription(
  userId: string,
  options: { interval: "month" | "year"; periodEnd: Date; firstPaidAt?: Date; currency?: string; cancelAtPeriodEnd?: boolean },
) {
  const sub = await prisma.subscription.create({
    data: {
      userId,
      stripeCustomerId: `cus_${userId}`,
      stripeSubscriptionId: `sub_${userId}`,
      interval: options.interval,
      status: "active",
      currentPeriodEnd: options.periodEnd,
      cancelAtPeriodEnd: options.cancelAtPeriodEnd ?? false,
    },
  });
  if (options.firstPaidAt) {
    await prisma.subscriptionInvoice.create({
      data: {
        subscriptionId: sub.id,
        stripeInvoiceId: `in_${userId}`,
        stripeSubscriptionId: `sub_${userId}`,
        currency: options.currency ?? "usd",
        amountPaidCents: 1499,
        interval: options.interval,
        periodStart: options.firstPaidAt,
        periodEnd: new Date(options.firstPaidAt.getTime() + 30 * DAY),
        paidAt: options.firstPaidAt,
      },
    });
  }
  return sub;
}

const noticesOf = (userId: string) => prisma.notice.findMany({ where: { recipientUserId: userId }, orderBy: { createdAt: "asc" } });

describe("Artist Pro renewal notices (integration, #2597)", () => {
  beforeAll(async () => {
    for (const id of USERS) await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
  });

  afterAll(async () => {
    await prisma.stripeEvent.deleteMany({ where: { eventId: { startsWith: `evt_${P}` } } });
    await prisma.generationAllowanceGrant.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.subscriptionInvoice.deleteMany({ where: { subscription: { userId: { in: USERS } } } });
    await prisma.subscription.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.notice.deleteMany({ where: { recipientUserId: { in: USERS } } });
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  });

  it("states the renewal price with its tax wording", () => {
    expect(renewalPrice("month", "usd")).toBe("$14.99 before any tax");
    expect(renewalPrice("year", "eur")).toBe("€149.90 VAT included");
    expect(renewalPrice("month", "xyz")).toBe("the price shown at checkout");
  });

  it("acknowledges the first paid invoice with the renewal terms and how to cancel, once", async () => {
    const periodStart = new Date(NOW.getTime() - DAY);
    const periodEnd = new Date(periodStart.getTime() + 30 * DAY);
    const stripeSub = {
      id: `sub_${U.start}`,
      object: "subscription",
      customer: `cus_${U.start}`,
      status: "active",
      metadata: { userId: U.start },
      items: { data: [{ price: { recurring: { interval: "month" } }, current_period_start: sec(periodStart), current_period_end: sec(periodEnd) }] },
    };
    const gateway = { retrieveSubscription: jest.fn(async () => stripeSub) } as unknown as StripeGateway;
    const topUps = new CreditTopUpService(config, new PurchaseConsentService(notices), notices, null, new CreditPackConfig({}));
    const webhooks = new StripeWebhookService(config, gateway, topUps, new StripeDisputeService(notices), undefined, renewals);
    const invoice = {
      id: `in_${U.start}`,
      object: "invoice",
      currency: "usd",
      amount_paid: 1499,
      billing_reason: "subscription_create",
      parent: { type: "subscription_details", subscription_details: { subscription: `sub_${U.start}` } },
      lines: { data: [{ period: { start: sec(periodStart), end: sec(periodEnd) }, parent: { type: "subscription_item_details", subscription_item_details: { proration: false } } }] },
      status_transitions: { paid_at: sec(periodStart) },
    };
    const event = (id: string) =>
      ({ id: `evt_${P}${id}`, object: "event", type: "invoice.paid", created: sec(NOW), livemode: false, data: { object: invoice } }) as unknown as StripeEvent;

    await webhooks.handle(event("a"));
    await webhooks.handle(event("b"));
    const sent = await noticesOf(U.start);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ category: "purchase", title: "Artist Pro started: how renewal works" });
    expect(sent[0].body).toContain("Artist Pro renews automatically every month at $14.99 before any tax until you cancel.");
    expect(sent[0].body).toContain("Manage billing");
    expect(sent[0].body).toContain("Your next charge is on");

    // A renewal invoice is not a start.
    expect(await renewals.onSubscriptionStarted({ ...invoice, id: `in_${U.start}_2`, billing_reason: "subscription_cycle" } as any)).toBe(false);
  });

  it("reminds a yearly plan 15 to 45 days before renewal, and a monthly plan on its anniversary, once each", async () => {
    await subscription(U.annual, { interval: "year", periodEnd: new Date(NOW.getTime() + 40 * DAY), firstPaidAt: new Date(NOW.getTime() - 325 * DAY), currency: "eur" });
    await subscription(U.far, { interval: "year", periodEnd: new Date(NOW.getTime() + 60 * DAY) });
    await subscription(U.ending, { interval: "year", periodEnd: new Date(NOW.getTime() + 20 * DAY), cancelAtPeriodEnd: true });
    await subscription(U.monthly, { interval: "month", periodEnd: new Date(NOW.getTime() + 10 * DAY), firstPaidAt: new Date(NOW.getTime() - 368 * DAY) });

    const first = await runBillingRetention(new SubscriptionLifecycleService(config, null), NOW, renewals);
    expect(first.renewalReminders?.annualRenewal).toBeGreaterThanOrEqual(1);
    expect(first.renewalReminders?.yearly).toBeGreaterThanOrEqual(1);

    const [annual] = await noticesOf(U.annual);
    expect(annual).toMatchObject({ category: "purchase", title: "Your Artist Pro renews soon" });
    expect(annual.body).toContain("you will be charged €149.90 VAT included then");
    expect(annual.body).toContain("Manage billing");
    const [monthly] = await noticesOf(U.monthly);
    expect(monthly).toMatchObject({ title: "Your Artist Pro subscription: yearly reminder" });
    expect(monthly.body).toContain("every month at $14.99 before any tax");
    expect(await noticesOf(U.far)).toEqual([]);
    expect(await noticesOf(U.ending)).toEqual([]);

    await renewals.sendDueReminders(NOW);
    expect(await noticesOf(U.annual)).toHaveLength(1);
    expect(await noticesOf(U.monthly)).toHaveLength(1);
  });

  it("sends a price-change notice only 7 to 30 days ahead, to that interval and currency, once", async () => {
    await subscription(U.eur, { interval: "month", periodEnd: new Date(NOW.getTime() + 10 * DAY), firstPaidAt: new Date(NOW.getTime() - 20 * DAY), currency: "eur" });
    const base = { interval: "month" as const, currency: "eur", newPriceCents: 1699 };
    await expect(renewals.sendPriceChangeNotices({ ...base, effectiveAt: new Date(NOW.getTime() + 6 * DAY) }, NOW)).rejects.toThrow("7 to 30 days");
    await expect(renewals.sendPriceChangeNotices({ ...base, effectiveAt: new Date(NOW.getTime() + 31 * DAY) }, NOW)).rejects.toThrow("7 to 30 days");

    const effectiveAt = new Date(NOW.getTime() + 20 * DAY);
    const result = await renewals.sendPriceChangeNotices({ ...base, effectiveAt }, NOW);
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const [notice] = await noticesOf(U.eur);
    expect(notice).toMatchObject({ category: "purchase", title: "Artist Pro price change" });
    expect(notice.body).toContain("at €16.99 VAT included instead of €14.99 VAT included");
    // The USD monthly subscriber is not told about a EUR price.
    expect((await noticesOf(U.monthly)).map((n) => n.title)).not.toContain("Artist Pro price change");

    await renewals.sendPriceChangeNotices({ ...base, effectiveAt }, NOW);
    expect(await noticesOf(U.eur)).toHaveLength(1);
  });
});
