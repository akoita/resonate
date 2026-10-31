/**
 * Buying generation-credit packs through Stripe Checkout, in test mode
 * (#1422, Artist Pro slice 4, `docs/rfc/artist-pro.md` §7). ADR-BM-6 revenue
 * line 2 (creator tools, metered generation), Phase 2. Credits are a
 * cost-plus-margin tool balance; no fan→artist payout is touched (ADR-BM-4).
 *
 * - **Checkout** (`startCheckout`): 503 when billing is off; a confirmed
 *   contact address is required (it becomes the Stripe billing email); the
 *   buyer's `credit_topup` delivery choice (#1776) is recorded BEFORE the
 *   one-time Checkout Session is created for the pack's catalogue price, in
 *   the currency the buyer was shown (#2496: USD, or EUR with VAT included
 *   for the EU; `billing_currency.ts`). The Stripe customer is the person's
 *   one customer (shared with the subscription).
 * - **Fulfilment** (`fulfilFromCheckout`, from the webhook): one
 *   `CreditTopUp` per Checkout Session (unique session and payment intent
 *   ids), so a replayed or duplicated event credits once. The pack is
 *   credited only when Stripe reports its catalogue price in USD or EUR
 *   (`paidCurrency`), at face value in either; anything else waits for
 *   review. The row records the currency actually paid. "Deliver now"
 *   credits the ledger at once (`top_up`, with the payment intent id); "wait"
 *   holds the credits for 14 days, released lazily on the next balance read
 *   or debit (`credits/top_up_ledger.ts`) or earlier on request
 *   (`deliverHeldNow`). A `purchase` notice confirms it.
 * - **Refunds** (`reverseFromRefund`, `charge.refunded`): the refunded share of
 *   the credits (refunded over charged, in the charge's currency) is withdrawn, taking back only what is unspent: the balance
 *   never goes negative.
 *
 * Logs carry ids only: never an email, a card detail or a payload.
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "crypto";
import { Prisma, type CreditTopUp } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { releaseDueTopUpHolds, releaseHeldTopUp, creditTopUpInTx, reverseTopUpInTx } from "../credits/top_up_ledger";
import { NoticeService } from "../notifications/notice.service";
import {
  PURCHASE_CONSENT_NOTICE_CATEGORY,
  PURCHASE_CONSENT_WORDING,
  WITHDRAWAL_PERIOD_MS,
  type PurchaseConsentWording,
} from "../purchase_consent/purchase_consent.constants";
import { linkConsentToPurchase } from "../purchase_consent/purchase_consent_delivery";
import { PurchaseConsentService } from "../purchase_consent/purchase_consent.service";
import { writeStructuredLog } from "../shared/structured_logging";
import { BillingConfig } from "./billing_config";
import {
  DEFAULT_BILLING_CURRENCY,
  formatMoney,
  isBillingCurrency,
  taxPhrase,
  type BillingCurrency,
} from "./billing_currency";
import {
  CREDIT_PACKS,
  CreditPackConfig,
  DEFAULT_CREDIT_PACK_ID,
  creditPackLabel,
  findCreditPack,
  formatUsd,
  paidCurrency,
  type CreditPack,
  type CreditPackId,
} from "./credit_packs";
import type { DeliverHeldCreditsDto, StartCreditCheckoutDto } from "./credit_topup.dto";
import { STRIPE_GATEWAY, type StripeCharge, type StripeCheckoutSession, type StripeGateway } from "./stripe_gateway";

export const CREDIT_TOPUP_PURPOSE = "credit_topup";
export const CREDIT_TOPUP_NOTICE_ACTOR = { userId: "system:credit-topup" } as const;
export const CREDIT_TOPUP_NOTICE_LINK = "/settings?section=usage";
const PURCHASE_LIST_LIMIT = 10;
const MAX_REFUND_ATTEMPTS = 3;

export const CREDIT_TOPUP_ERROR_CODES = {
  unavailable: "billing_unavailable",
  contactEmailRequired: "contact_email_required",
  unknownPack: "unknown_credit_pack",
  currencyUnavailable: "currency_unavailable",
  notHeld: "credit_purchase_not_held",
  notFound: "credit_purchase_not_found",
} as const;

export type CreditTopUpStatus = "held" | "credited" | "refunded" | "needs_review";

export type CreditPackView = {
  id: CreditPackId;
  /** The price in each currency, in cents: before tax in USD, VAT included in EUR. */
  prices: Record<BillingCurrency, number>;
  /** Credits at face value, in USD cents, whichever currency pays. */
  creditsCents: number;
  isDefault: boolean;
};

export type CreditPurchaseView = {
  id: string;
  packId: string;
  label: string;
  /** What was paid for the pack, in cents of `currency`. */
  priceCents: number;
  currency: string;
  creditsCents: number;
  delivery: string;
  status: string;
  heldUntil: string | null;
  creditedAt: string | null;
  creditedCents: number;
  refundedCreditsCents: number;
  reversedCents: number;
  /** The Stripe payment intent id, also on the Stripe receipt. */
  receiptRef: string | null;
  checkoutSessionId: string;
  paidAt: string;
};

export type CreditTopUpState = {
  /** Whether buying credits works on this deployment. */
  available: boolean;
  testMode: boolean;
  contactEmailConfirmed: boolean;
  /** The currencies checkout offers (#2496): USD, plus EUR once enabled. */
  currencies: BillingCurrency[];
  packs: CreditPackView[];
  defaultPackId: CreditPackId;
  /** Credits bought but held for the 14-day withdrawal period. */
  heldCents: number;
  purchases: CreditPurchaseView[];
  /** The #1776 delivery wording: what the buyer is shown before paying. */
  consent: PurchaseConsentWording;
};

export type FulfilOutcome =
  | "credited"
  | "held"
  | "needs_review"
  | "duplicate_checkout_session"
  | "pending_payment"
  | "ignored_not_credit_topup"
  | "ignored_unknown_pack"
  | "ignored_unknown_user";

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: CREDIT_TOPUP_ERROR_CODES.unavailable,
    message: "Buying credits is not available on this server yet.",
  });
}

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown>) {
  writeStructuredLog({ level, event, message: event, ...fields });
}

/** The pack's label in the currency it was bought in. */
function purchaseLabel(packId: string, currency: string): string {
  const pack = findCreditPack(packId);
  if (!pack) return packId;
  return creditPackLabel(pack, isBillingCurrency(currency) ? currency : DEFAULT_BILLING_CURRENCY);
}

function toPurchaseView(row: CreditTopUp): CreditPurchaseView {
  return {
    id: row.id,
    packId: row.packId,
    label: purchaseLabel(row.packId, row.currency),
    priceCents: row.priceCents,
    currency: row.currency,
    creditsCents: row.creditsCents,
    delivery: row.delivery,
    status: row.status,
    heldUntil: row.heldUntil?.toISOString() ?? null,
    creditedAt: row.creditedAt?.toISOString() ?? null,
    creditedCents: row.creditedCents,
    refundedCreditsCents: row.refundedCreditsCents,
    reversedCents: row.reversedCents,
    receiptRef: row.stripePaymentIntentId,
    checkoutSessionId: row.stripeCheckoutSessionId,
    paidAt: row.paidAt.toISOString(),
  };
}

function utcMinute(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 16);
}

/**
 * The refunded share of a pack's credits: proportional to the money refunded,
 * all of it for a full refund.
 */
export function refundedCreditsShare(input: {
  creditsCents: number;
  amountRefunded: number;
  amountCharged: number;
  fullyRefunded: boolean;
}): number {
  if (input.fullyRefunded) return input.creditsCents;
  if (input.amountCharged <= 0 || input.amountRefunded <= 0) return 0;
  const share = Math.floor((input.creditsCents * input.amountRefunded) / input.amountCharged);
  return Math.min(input.creditsCents, Math.max(0, share));
}

@Injectable()
export class CreditTopUpService {
  private readonly packs: CreditPackConfig;

  constructor(
    private readonly config: BillingConfig,
    private readonly consents: PurchaseConsentService,
    private readonly notices: NoticeService,
    @Optional() @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway | null = null,
    @Optional() packs?: CreditPackConfig,
  ) {
    this.packs = packs ?? new CreditPackConfig();
  }

  /** Billing is configured and every pack has a Stripe price. */
  isAvailable(): boolean {
    return Boolean(this.gateway) && this.config.isAvailable() && this.packs.isConfigured();
  }

  /**
   * Where Checkout sends the person back: Settings → Usage & Billing. Stripe
   * fills in `{CHECKOUT_SESSION_ID}`, so the page knows which purchase to wait for.
   */
  private returnUrl(result: "success" | "cancel"): string {
    const base = `${this.config.frontendUrl}/settings?section=usage&credits=${result}`;
    return result === "success" ? `${base}&credits_session={CHECKOUT_SESSION_ID}` : base;
  }

  async getState(userId: string, now: Date = new Date()): Promise<CreditTopUpState> {
    await releaseDueTopUpHolds(userId, now);
    const [contact, purchases, held] = await Promise.all([
      prisma.contactEmail.findUnique({ where: { userId }, select: { status: true } }),
      prisma.creditTopUp.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: PURCHASE_LIST_LIMIT }),
      prisma.creditTopUp.findMany({
        where: { userId, status: "held" },
        select: { creditsCents: true, refundedCreditsCents: true },
      }),
    ]);
    return {
      available: this.isAvailable(),
      testMode: this.config.testMode,
      contactEmailConfirmed: contact?.status === "confirmed",
      currencies: [...this.config.currencies],
      packs: CREDIT_PACKS.map((pack) => ({
        id: pack.id,
        prices: { ...pack.prices },
        creditsCents: pack.creditsCents,
        isDefault: pack.id === DEFAULT_CREDIT_PACK_ID,
      })),
      defaultPackId: DEFAULT_CREDIT_PACK_ID,
      heldCents: held.reduce((sum, row) => sum + Math.max(0, row.creditsCents - row.refundedCreditsCents), 0),
      purchases: purchases.map(toPurchaseView),
      consent: PURCHASE_CONSENT_WORDING,
    };
  }

  async startCheckout(userId: string, input: StartCreditCheckoutDto): Promise<{ url: string }> {
    if (!this.isAvailable()) throw unavailable();
    const gateway = this.gateway as StripeGateway;

    // The server catalogue decides the price; nothing else in the body is read.
    const pack = findCreditPack(input.packId);
    if (!pack) {
      throw new BadRequestException({ code: CREDIT_TOPUP_ERROR_CODES.unknownPack, message: "Unknown credit pack." });
    }
    const currency = input.currency ?? DEFAULT_BILLING_CURRENCY;
    if (!this.config.currencies.includes(currency)) {
      throw new ConflictException({
        code: CREDIT_TOPUP_ERROR_CODES.currencyUnavailable,
        message: "Prices in this currency are not available on this server yet.",
      });
    }

    const contact = await prisma.contactEmail.findUnique({
      where: { userId },
      select: { status: true, address: true },
    });
    if (!contact || contact.status !== "confirmed") {
      throw new ConflictException({
        code: CREDIT_TOPUP_ERROR_CODES.contactEmailRequired,
        message: "Confirm a contact email in Settings before buying credits: it receives your receipts.",
      });
    }

    // 1. The delivery choice, before anything exists at Stripe. `record`
    //    checks the wording version and the acknowledgement before writing.
    const choice = input.consent;
    const consent = await this.consents.record(userId, {
      surface: "credit_topup",
      subjectId: pack.id,
      subjectLabel: creditPackLabel(pack, currency),
      consented: choice.choice === "deliver_now",
      acknowledgedWaiver: choice.acknowledgedWaiver,
      textVersion: choice.textVersion,
    });

    // 2. The person's one Stripe customer.
    const existing = await prisma.subscription.findUnique({ where: { userId }, select: { stripeCustomerId: true } });
    const customerId = existing?.stripeCustomerId ?? (await this.createCustomer(gateway, userId, contact.address));

    // 3. The one-time Checkout Session for the pack's price, in the currency shown.
    const metadata = { purpose: CREDIT_TOPUP_PURPOSE, userId, packId: pack.id, consentId: consent.id };
    const session = await gateway.createCheckoutSession(
      {
        mode: "payment",
        currency,
        customer: customerId,
        client_reference_id: userId,
        line_items: [{ price: this.packs.priceFor(pack.id), quantity: 1 }],
        success_url: this.returnUrl("success"),
        cancel_url: this.returnUrl("cancel"),
        metadata,
        payment_intent_data: { metadata },
        ...(this.config.automaticTax
          ? { automatic_tax: { enabled: true }, customer_update: { address: "auto" as const } }
          : {}),
      },
      `resonate-credits-checkout-${consent.id}`,
    );
    if (!session.url) throw unavailable();

    try {
      await this.consents.link(userId, consent.id, { purchaseRef: session.id });
    } catch (error) {
      // Best effort: the consent is recorded either way and Stripe metadata names it.
      log("warn", "billing.credits_consent_link_failed", {
        consentId: consent.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return { url: session.url };
  }

  /**
   * `checkout.session.completed` / `checkout.session.async_payment_succeeded`
   * for a one-time session. Exactly once per Checkout Session.
   */
  async fulfilFromCheckout(session: StripeCheckoutSession, paidAt: Date): Promise<FulfilOutcome> {
    const metadata = session.metadata ?? {};
    if (session.mode !== "payment" || metadata.purpose !== CREDIT_TOPUP_PURPOSE) return "ignored_not_credit_topup";
    if (session.payment_status !== "paid") return "pending_payment";

    const pack = findCreditPack(metadata.packId);
    if (!pack) {
      log("error", "billing.credits_unknown_pack", { checkoutSessionId: session.id });
      return "ignored_unknown_pack";
    }
    const userId = metadata.userId || session.client_reference_id || "";
    const user = userId
      ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, erasedAt: true } })
      : null;
    if (!user || user.erasedAt) {
      log("error", "billing.credits_unknown_user", { checkoutSessionId: session.id });
      return "ignored_unknown_user";
    }
    if (await prisma.creditTopUp.findUnique({ where: { stripeCheckoutSessionId: session.id }, select: { id: true } })) {
      return "duplicate_checkout_session";
    }

    const paymentIntentId = idOf(session.payment_intent);
    const consent = metadata.consentId
      ? await prisma.purchaseConsent.findFirst({
          where: { id: metadata.consentId, userId, surface: "credit_topup", subjectId: pack.id },
          select: { id: true, consented: true, acknowledgedWaiver: true },
        })
      : null;
    // No recorded consent counts as "wait" (#1776): delivery is held.
    const deliverNow = Boolean(consent?.consented && consent.acknowledgedWaiver);
    // The catalogue price in USD or EUR; anything else is recorded as Stripe reported it, for review.
    const paid = paidCurrency(pack, session);
    const currency = paid ?? ((session.currency ?? "").toLowerCase() || DEFAULT_BILLING_CURRENCY);
    const priceCents = paid ? pack.prices[paid] : Math.max(0, Math.floor(session.amount_subtotal ?? 0));

    const status: CreditTopUpStatus = !paid ? "needs_review" : deliverNow ? "credited" : "held";
    let row: CreditTopUp;
    try {
      row = await prisma.$transaction(async (tx) => {
        const created = await tx.creditTopUp.create({
          data: {
            userId,
            packId: pack.id,
            priceCents,
            currency,
            creditsCents: pack.creditsCents,
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: paymentIntentId,
            consentId: consent?.id ?? null,
            delivery: deliverNow ? "deliver_now" : "wait",
            status,
            heldUntil: status === "held" ? new Date(paidAt.getTime() + WITHDRAWAL_PERIOD_MS) : null,
            creditedAt: status === "credited" ? paidAt : null,
            releaseBasis: status === "credited" ? "consent" : null,
            creditedCents: status === "credited" ? pack.creditsCents : 0,
            amountTotalCents: typeof session.amount_total === "number" ? session.amount_total : null,
            paidAt,
          },
        });
        if (status === "credited") {
          await creditTopUpInTx(tx, { userId, amountCents: pack.creditsCents, paymentRef: paymentIntentId });
        }
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return "duplicate_checkout_session";
      throw error;
    }

    if (status === "needs_review") {
      log("error", "billing.credits_amount_mismatch", { creditTopUpId: row.id, checkoutSessionId: session.id });
    }
    if (consent) await linkConsentToPurchase(consent.id, { purchaseRef: session.id });
    await this.notifyPurchase(row, pack);
    return status;
  }

  /** `charge.refunded`: withdraw the refunded share of a pack, never below a zero balance. */
  async reverseFromRefund(charge: StripeCharge, refundedAt: Date = new Date()): Promise<string> {
    const paymentIntentId = idOf(charge.payment_intent);
    if (!paymentIntentId) return "ignored_no_payment_intent";

    for (let attempt = 0; attempt < MAX_REFUND_ATTEMPTS; attempt += 1) {
      const row = await prisma.creditTopUp.findUnique({ where: { stripePaymentIntentId: paymentIntentId } });
      if (!row) return "ignored_not_credit_topup";
      const amountRefunded = Math.max(0, Math.floor(charge.amount_refunded ?? 0));
      if (amountRefunded <= row.refundedAmountCents) return "skipped_refund_already_applied";
      const target = Math.max(
        row.refundedCreditsCents,
        refundedCreditsShare({
          creditsCents: row.creditsCents,
          amountRefunded,
          amountCharged: charge.amount ?? 0,
          fullyRefunded: Boolean(charge.refunded),
        }),
      );
      const delta = target - row.refundedCreditsCents;

      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.creditTopUp.updateMany({
          where: { id: row.id, refundedAmountCents: row.refundedAmountCents, status: row.status },
          data: {
            refundedAmountCents: amountRefunded,
            refundedCreditsCents: target,
            ...(target >= row.creditsCents && row.status !== "needs_review" ? { status: "refunded" } : {}),
          },
        });
        if (claimed.count !== 1) return null;
        // Only credits already in the balance are taken back; a held pack simply releases less.
        let reversedCents = 0;
        if (row.status === "credited" && delta > 0) {
          const reversal = await reverseTopUpInTx(tx, { userId: row.userId, wantedCents: delta, paymentRef: paymentIntentId });
          reversedCents = reversal.reversedCents;
          if (reversedCents > 0) {
            await tx.creditTopUp.update({
              where: { id: row.id },
              data: { reversedCents: { increment: reversedCents } },
            });
          }
        }
        // #2497: the dated, append-only record of this refund for the monthly reconciliation report.
        await tx.creditTopUpRefund.create({
          data: {
            creditTopUpId: row.id,
            cumulativeRefundedAmountCents: amountRefunded,
            amountCents: amountRefunded - row.refundedAmountCents,
            withdrawnCreditsCents: delta,
            reversedCents,
            statusBefore: row.status,
            createdAt: refundedAt,
          },
        });
        return { reversedCents };
      });
      if (!result) continue;

      log("info", "billing.credits_refund_applied", { creditTopUpId: row.id, withdrawnCents: delta, reversedCents: result.reversedCents });
      await this.notifyRefund(row, { amountRefunded, withdrawnCents: delta, reversedCents: result.reversedCents });
      return result.reversedCents < delta && row.status === "credited" ? "reversed_partially_spent" : "reversed";
    }
    throw new Error("Credit purchase changed concurrently; Stripe will retry the event");
  }

  /** Release a held purchase now, at the buyer's request (ends the right to withdraw for it). */
  async deliverHeldNow(userId: string, topUpId: string, input: DeliverHeldCreditsDto): Promise<CreditTopUpState> {
    const row = await prisma.creditTopUp.findFirst({ where: { id: topUpId, userId } });
    if (!row) {
      throw new NotFoundException({ code: CREDIT_TOPUP_ERROR_CODES.notFound, message: "Credit purchase not found." });
    }
    if (row.status !== "held") {
      throw new ConflictException({
        code: CREDIT_TOPUP_ERROR_CODES.notHeld,
        message: "These credits are not on hold any more.",
      });
    }
    const pack = findCreditPack(row.packId);
    const consent = await this.consents.record(userId, {
      surface: "credit_topup",
      subjectId: row.packId,
      subjectLabel: pack ? purchaseLabel(row.packId, row.currency) : row.packId,
      consented: true,
      acknowledgedWaiver: input.acknowledgedWaiver,
      textVersion: input.textVersion,
    });
    await linkConsentToPurchase(consent.id, { purchaseRef: row.stripeCheckoutSessionId });
    const released = await releaseHeldTopUp(row.id, "deliver_now_later");
    if (released === null) {
      throw new ConflictException({
        code: CREDIT_TOPUP_ERROR_CODES.notHeld,
        message: "These credits are not on hold any more.",
      });
    }
    return this.getState(userId);
  }

  // -------------------------------------------------------------------------

  private async createCustomer(gateway: StripeGateway, userId: string, email: string): Promise<string> {
    // Same key as the subscription checkout's: one Stripe customer per person and address.
    const emailKey = createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
    const customer = await gateway.createCustomer(
      { email, metadata: { userId } },
      `resonate-customer-${userId}-${emailKey}`,
    );
    try {
      // The billing row holds the customer; no subscription exists until one is bought.
      await prisma.subscription.create({
        data: { userId, stripeCustomerId: customer.id, interval: "month", status: "incomplete" },
      });
      return customer.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const row = await prisma.subscription.findUnique({ where: { userId }, select: { stripeCustomerId: true } });
      if (!row) throw error;
      return row.stripeCustomerId;
    }
  }

  /** The `purchase` notice: amount, delivery choice and receipt reference. */
  private async notifyPurchase(row: CreditTopUp, pack: CreditPack): Promise<void> {
    const when = utcMinute(row.paidAt);
    const receipt = row.stripePaymentIntentId ? ` Receipt reference: ${row.stripePaymentIntentId}.` : "";
    const credits = formatUsd(row.creditsCents);
    const label = purchaseLabel(pack.id, row.currency);
    const paid = `${formatMoney(row.priceCents, row.currency)} (${taxPhrase(row.currency)})`;
    let title: string;
    let body: string;
    if (row.status === "credited") {
      title = `Credits bought: ${credits}`;
      body =
        `On ${when} UTC you bought the ${label} for ${paid}. ` +
        `You asked for immediate delivery, so ${credits} of generation credits are in your balance now and you ` +
        `gave up your right to withdraw for the credits you use. Bought credits do not expire.${receipt}`;
    } else if (row.status === "held") {
      const until = row.heldUntil ? utcMinute(row.heldUntil) : "14 days after your purchase";
      title = `Credits bought: ${credits}, on hold for 14 days`;
      body =
        `On ${when} UTC you bought the ${label} for ${paid}. ` +
        `You chose to keep your right to withdraw, so the ${credits} of credits are held until ${until} UTC and then ` +
        `added to your balance automatically. You can ask for them sooner from Usage & Billing, which ends your ` +
        `right to withdraw from this purchase. Bought credits do not expire.${receipt}`;
    } else {
      title = "Credit purchase received: under review";
      body =
        `On ${when} UTC we received your payment for the ${label}, but the amount did not match the pack, so ` +
        `no credits were added automatically. We will review it and add the credits or refund you.${receipt}`;
    }
    await this.sendNotice(row.userId, title, body, `credit-topup:${row.id}`);
  }

  private async notifyRefund(
    row: CreditTopUp,
    refund: { amountRefunded: number; withdrawnCents: number; reversedCents: number },
  ): Promise<void> {
    const label = findCreditPack(row.packId) ? purchaseLabel(row.packId, row.currency) : "credit pack";
    const spent = row.status === "credited" ? refund.withdrawnCents - refund.reversedCents : 0;
    const body =
      `Your payment for the ${label} was refunded (${formatMoney(refund.amountRefunded, row.currency)} in total). ` +
      (row.status === "credited"
        ? `${formatUsd(refund.reversedCents)} of credits were removed from your balance` +
          (spent > 0 ? `; ${formatUsd(spent)} had already been used and stays spent.` : ".")
        : row.status === "held"
          ? `${formatUsd(refund.withdrawnCents)} of held credits will not be added to your balance.`
          : "No credits had been added for it.") +
      (row.stripePaymentIntentId ? ` Receipt reference: ${row.stripePaymentIntentId}.` : "");
    await this.sendNotice(row.userId, "Credit purchase refunded", body, `credit-topup-refund:${row.id}:${refund.amountRefunded}`);
  }

  private async sendNotice(userId: string, title: string, body: string, dedupeKey: string): Promise<void> {
    try {
      await this.notices.sendTargeted(
        { userIds: [userId], category: PURCHASE_CONSENT_NOTICE_CATEGORY, title, body, link: CREDIT_TOPUP_NOTICE_LINK },
        CREDIT_TOPUP_NOTICE_ACTOR,
        { dedupeKey },
      );
    } catch (error) {
      // The purchase is recorded either way and shows in Usage & Billing.
      log("error", "billing.credits_notice_failed", {
        dedupeKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
