/**
 * Artist Pro automatic-renewal notices (#2597). ADR-BM-6 revenue line 2
 * (Artist Pro), Phase 2: compliance before live charging. No fee, split or
 * price change (ADR-BM-4 unaffected).
 *
 * US automatic-renewal rules (federal ROSCA, California's law as amended from
 * 2025-07-01, and similar state laws) expect, besides consent at checkout and
 * online cancellation (both already there):
 * - **an acknowledgement** repeating the renewal terms and how to cancel:
 *   {@link RenewalNoticeService.onSubscriptionStarted}, on the first paid
 *   invoice (`billing_reason = subscription_create`);
 * - **a reminder once a year** with the price, frequency and how to cancel:
 *   monthly plans get one on each anniversary of the start; for a yearly plan
 *   the pre-renewal reminder below is that yearly reminder;
 * - **an extra reminder 15 to 45 days before an annual renewal**;
 * - **7 to 30 days' notice before a price change**:
 *   {@link RenewalNoticeService.sendPriceChangeNotices}, run by the operator
 *   with `npm run billing:price-change-notice` before a new Stripe price is
 *   used.
 * The reminders run with the retention job (`billing_retention.ts`).
 *
 * Every notice is a `purchase` notice, which is always emailed to a confirmed
 * contact address, and carries a dedupe key, so a rerun sends nothing twice.
 * Logs carry counts and ids only.
 *
 * Not legal advice: which states apply is a question for the operator's lawyer.
 */

import { BadRequestException, Injectable } from "@nestjs/common";
import type { SubscriptionInterval } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { NoticeService } from "../notifications/notice.service";
import { writeStructuredLog } from "../shared/structured_logging";
import { ARTIST_PRO_PRICES } from "./billing.service";
import { formatMoney, isBillingCurrency, taxPhrase } from "./billing_currency";
import type { StripeInvoice } from "./stripe_gateway";
import { invoiceServicePeriod } from "./subscription_invoices";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The pre-renewal reminder window for a yearly plan, in days before the renewal. */
export const ANNUAL_REMINDER_MIN_DAYS = 15;
export const ANNUAL_REMINDER_MAX_DAYS = 45;
/** A monthly plan's yearly reminder goes out within this many days after each anniversary. */
export const YEARLY_REMINDER_WINDOW_DAYS = 14;
/** How far ahead a price-change notice must be sent. */
export const PRICE_CHANGE_MIN_DAYS = 7;
export const PRICE_CHANGE_MAX_DAYS = 30;
const YEAR_MS = 365 * DAY_MS;
const BATCH = 500;

export const RENEWAL_NOTICE_ACTOR = { userId: "system:artist-pro-renewal" } as const;
export const RENEWAL_NOTICE_LINK = "/settings?section=usage";

/** How to cancel, in every notice. */
export const HOW_TO_CANCEL =
  "You can cancel at any time in Settings, Usage & Billing, with Manage billing. Artist Pro then stays on until the end " +
  "of the period you paid for, and nothing more is charged.";

const INTERVAL_WORD: Record<SubscriptionInterval, string> = { month: "month", year: "year" };

function day(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** "$14.99 before any tax" / "€149.90 VAT included". */
export function renewalPrice(interval: SubscriptionInterval, currency: string, fallbackCents?: number): string {
  const cents = isBillingCurrency(currency) ? ARTIST_PRO_PRICES[interval][currency] : fallbackCents;
  return cents === undefined ? "the price shown at checkout" : `${formatMoney(cents, currency)} ${taxPhrase(currency)}`;
}

/** The renewal terms sentence shared by every notice. */
export function renewalTerms(interval: SubscriptionInterval, price: string): string {
  return `Artist Pro renews automatically every ${INTERVAL_WORD[interval]} at ${price} until you cancel.`;
}

export type ReminderResult = { annualRenewal: number; yearly: number };

@Injectable()
export class RenewalNoticeService {
  constructor(private readonly notices: NoticeService) {}

  private async send(userId: string, title: string, body: string, dedupeKey: string): Promise<boolean> {
    try {
      const result = await this.notices.sendTargeted(
        { userIds: [userId], category: "purchase", title, body, link: RENEWAL_NOTICE_LINK },
        RENEWAL_NOTICE_ACTOR,
        { dedupeKey },
      );
      return result.created > 0;
    } catch (error) {
      writeStructuredLog({
        level: "error",
        event: "billing.renewal_notice_failed",
        message: "billing.renewal_notice_failed",
        dedupeKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /** The acknowledgement, on the first paid invoice of a subscription. Never throws. */
  async onSubscriptionStarted(invoice: StripeInvoice): Promise<boolean> {
    if (invoice.billing_reason !== "subscription_create" || !invoice.id) return false;
    const subscriptionRef = invoice.parent?.subscription_details?.subscription;
    const stripeSubscriptionId = typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef?.id;
    if (!stripeSubscriptionId) return false;
    const subscription = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
      select: { userId: true, interval: true },
    });
    if (!subscription) return false;
    const currency = (invoice.currency ?? "").toLowerCase();
    const period = invoiceServicePeriod(invoice);
    const price = renewalPrice(subscription.interval, currency, invoice.amount_paid ?? undefined);
    const body =
      "Your Artist Pro subscription has started. " +
      renewalTerms(subscription.interval, price) +
      (period ? ` Your next charge is on ${day(period.periodEnd)}.` : "") +
      ` ${HOW_TO_CANCEL}` +
      " You can also withdraw within 14 days of subscribing: see the refund policy.";
    return this.send(subscription.userId, "Artist Pro started: how renewal works", body, `artist-pro-start:${invoice.id}`);
  }

  /** The reminders due at `now`. Run daily by the retention job; a rerun sends nothing twice. */
  async sendDueReminders(now: Date = new Date()): Promise<ReminderResult> {
    const result: ReminderResult = { annualRenewal: 0, yearly: 0 };

    // 1. Yearly plans renewing in 15 to 45 days (this is also their yearly reminder).
    const renewing = await prisma.subscription.findMany({
      where: {
        interval: "year",
        status: { in: ["active", "trialing"] },
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: { not: null },
        currentPeriodEnd: {
          gte: new Date(now.getTime() + ANNUAL_REMINDER_MIN_DAYS * DAY_MS),
          lte: new Date(now.getTime() + ANNUAL_REMINDER_MAX_DAYS * DAY_MS),
        },
      },
      select: { id: true, userId: true, currentPeriodEnd: true, invoices: { orderBy: { paidAt: "desc" }, take: 1, select: { currency: true } } },
      take: BATCH,
    });
    for (const sub of renewing) {
      const renewsOn = sub.currentPeriodEnd as Date;
      const price = renewalPrice("year", sub.invoices[0]?.currency ?? "usd");
      const body =
        `Your yearly Artist Pro subscription renews on ${day(renewsOn)}, and you will be charged ${price} then. ` +
        renewalTerms("year", price) +
        ` ${HOW_TO_CANCEL} Cancel before ${day(renewsOn)} if you do not want to renew.`;
      if (await this.send(sub.userId, "Your Artist Pro renews soon", body, `artist-pro-renewal:${sub.id}:${renewsOn.toISOString().slice(0, 10)}`)) {
        result.annualRenewal += 1;
      }
    }

    // 2. Monthly plans: one reminder on each anniversary of the start.
    const monthly = await prisma.subscription.findMany({
      where: {
        interval: "month",
        status: { in: ["active", "trialing", "past_due"] },
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: { not: null },
      },
      select: {
        id: true,
        userId: true,
        stripeSubscriptionId: true,
        invoices: { orderBy: { paidAt: "asc" }, take: 1, select: { paidAt: true, currency: true, stripeSubscriptionId: true } },
      },
      take: BATCH,
    });
    for (const sub of monthly) {
      const first = sub.invoices[0];
      if (!first || first.stripeSubscriptionId !== sub.stripeSubscriptionId) continue;
      const years = Math.floor((now.getTime() - first.paidAt.getTime()) / YEAR_MS);
      if (years < 1) continue;
      const anniversary = first.paidAt.getTime() + years * YEAR_MS;
      if (now.getTime() - anniversary > YEARLY_REMINDER_WINDOW_DAYS * DAY_MS) continue;
      const price = renewalPrice("month", first.currency);
      const body =
        `A yearly reminder: you have had Artist Pro since ${day(first.paidAt)}. ` +
        renewalTerms("month", price) +
        ` ${HOW_TO_CANCEL}`;
      if (await this.send(sub.userId, "Your Artist Pro subscription: yearly reminder", body, `artist-pro-yearly:${sub.id}:${years}`)) {
        result.yearly += 1;
      }
    }

    if (result.annualRenewal + result.yearly > 0) {
      writeStructuredLog({ level: "info", event: "billing.renewal_reminders_sent", message: "billing.renewal_reminders_sent", ...result });
    }
    return result;
  }

  /**
   * Tell every running subscriber of one interval and currency about a new
   * price, 7 to 30 days before it applies. Refuses a date outside that window.
   */
  async sendPriceChangeNotices(
    input: { interval: SubscriptionInterval; currency: string; newPriceCents: number; effectiveAt: Date },
    now: Date = new Date(),
  ): Promise<{ recipients: number; sent: number }> {
    const ahead = input.effectiveAt.getTime() - now.getTime();
    if (ahead < PRICE_CHANGE_MIN_DAYS * DAY_MS || ahead > PRICE_CHANGE_MAX_DAYS * DAY_MS) {
      throw new BadRequestException(
        `A price-change notice must be sent ${PRICE_CHANGE_MIN_DAYS} to ${PRICE_CHANGE_MAX_DAYS} days before the new price applies.`,
      );
    }
    if (!isBillingCurrency(input.currency)) throw new BadRequestException("Unknown currency");
    if (!Number.isInteger(input.newPriceCents) || input.newPriceCents <= 0) {
      throw new BadRequestException("The new price must be a positive whole number of cents");
    }
    const subscribers = await prisma.subscription.findMany({
      where: {
        interval: input.interval,
        status: { in: ["active", "trialing", "past_due"] },
        cancelAtPeriodEnd: false,
        stripeSubscriptionId: { not: null },
      },
      select: { id: true, userId: true, invoices: { orderBy: { paidAt: "desc" }, take: 1, select: { currency: true } } },
    });
    const recipients = subscribers.filter((s) => (s.invoices[0]?.currency ?? "usd") === input.currency);
    const oldPrice = renewalPrice(input.interval, input.currency);
    const newPrice = `${formatMoney(input.newPriceCents, input.currency)} ${taxPhrase(input.currency)}`;
    const effective = day(input.effectiveAt);
    let sent = 0;
    for (const sub of recipients) {
      const body =
        `The price of Artist Pro is changing. From ${effective}, your subscription renews every ${INTERVAL_WORD[input.interval]} ` +
        `at ${newPrice} instead of ${oldPrice}, starting with your first renewal on or after that date. ` +
        `${HOW_TO_CANCEL} If you do not want the new price, cancel before your next renewal on or after ${effective}.`;
      const key = `artist-pro-price-change:${input.interval}:${input.currency}:${input.effectiveAt.toISOString().slice(0, 10)}:${sub.id}`;
      if (await this.send(sub.userId, "Artist Pro price change", body, key)) sent += 1;
    }
    writeStructuredLog({
      level: "info",
      event: "billing.price_change_notices_sent",
      message: "billing.price_change_notices_sent",
      interval: input.interval,
      currency: input.currency,
      recipients: recipients.length,
      sent,
    });
    return { recipients: recipients.length, sent };
  }
}
