/**
 * Artist Pro subscriptions through Stripe, in test mode (#2407,
 * `docs/rfc/artist-pro.md` §6). ADR-BM-6 revenue line 2 (Artist Pro), Phase 2.
 *
 * - `startCheckout`: a confirmed contact address is required (it becomes the
 *   Stripe billing email); the immediate-start consent is recorded on the
 *   `subscription` surface BEFORE the Checkout Session is created; the person
 *   gets one Stripe customer (metadata `userId`) that every later checkout
 *   reuses.
 * - `openPortal`: the Stripe Customer Portal for card updates, cancellation
 *   and invoices. Resonate never handles card data.
 * - `getState`: what Usage & Billing shows.
 *
 * Nothing here changes what anyone can do: the entitlement policy stays
 * `everyone` until the gates-on slice (#2409).
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
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { EntitlementsService } from "../entitlements/entitlements.service";
import type { PlanResolution } from "../entitlements/entitlements.policy";
import { pastDueGraceEndsAt } from "../entitlements/subscription_plan";
import {
  SUBSCRIPTION_CONSENT_WORDING,
  type SubscriptionConsentWording,
} from "../purchase_consent/purchase_consent.constants";
import { PurchaseConsentService } from "../purchase_consent/purchase_consent.service";
import { writeStructuredLog } from "../shared/structured_logging";
import { BillingConfig, type BillingInterval } from "./billing_config";
import type { StartSubscriptionCheckoutDto } from "./billing.dto";
import { STRIPE_GATEWAY, type StripeGateway } from "./stripe_gateway";
import { isLiveStatus } from "./subscription_state";

export const BILLING_ERROR_CODES = {
  unavailable: "billing_unavailable",
  contactEmailRequired: "contact_email_required",
  consentRequired: "subscription_consent_required",
  consentOutdated: "consent_text_outdated",
  alreadySubscribed: "already_subscribed",
  noBillingAccount: "no_billing_account",
} as const;

export const PLAN_LABELS: Readonly<Record<BillingInterval, string>> = {
  month: "Artist Pro (monthly)",
  year: "Artist Pro (yearly)",
};

export type BillingSubscriptionView = {
  status: string;
  interval: BillingInterval;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
  /** When Pro ends if the card is not updated (past due only). */
  graceEndsAt: string | null;
};

export type BillingState = {
  /** Whether subscribing works on this deployment. */
  available: boolean;
  /** True while only Stripe test keys are accepted (`BILLING_LIVE_MODE` false). */
  testMode: boolean;
  contactEmailConfirmed: boolean;
  /** A Stripe customer exists, so the Customer Portal can open. */
  hasBillingAccount: boolean;
  plan: PlanResolution;
  subscription: BillingSubscriptionView | null;
  consent: SubscriptionConsentWording;
};

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: BILLING_ERROR_CODES.unavailable,
    message: "Subscriptions are not available on this server yet.",
  });
}

@Injectable()
export class BillingService {
  private readonly entitlements: EntitlementsService;

  constructor(
    private readonly config: BillingConfig,
    private readonly consents: PurchaseConsentService,
    @Optional() @Inject(STRIPE_GATEWAY) private readonly gateway: StripeGateway | null = null,
    @Optional() entitlements?: EntitlementsService,
  ) {
    this.entitlements = entitlements ?? new EntitlementsService();
  }

  private available(): boolean {
    return Boolean(this.gateway) && this.config.isAvailable();
  }

  async getState(userId: string, now: Date = new Date()): Promise<BillingState> {
    const [row, contact, plan] = await Promise.all([
      prisma.subscription.findUnique({ where: { userId } }),
      prisma.contactEmail.findUnique({ where: { userId }, select: { status: true } }),
      this.entitlements.resolvePlan(userId, now),
    ]);
    const graceEnd = row ? pastDueGraceEndsAt(row) : null;
    return {
      available: this.available(),
      testMode: this.config.testMode,
      contactEmailConfirmed: contact?.status === "confirmed",
      hasBillingAccount: Boolean(row?.stripeCustomerId),
      plan,
      subscription:
        row && row.stripeSubscriptionId
          ? {
              status: row.status,
              interval: row.interval,
              currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
              cancelAtPeriodEnd: row.cancelAtPeriodEnd,
              pastDueSince: row.pastDueSince?.toISOString() ?? null,
              graceEndsAt: graceEnd?.toISOString() ?? null,
            }
          : null,
      consent: SUBSCRIPTION_CONSENT_WORDING,
    };
  }

  async startCheckout(userId: string, input: StartSubscriptionCheckoutDto): Promise<{ url: string }> {
    if (!this.available()) throw unavailable();
    const gateway = this.gateway as StripeGateway;

    const contact = await prisma.contactEmail.findUnique({
      where: { userId },
      select: { status: true, address: true },
    });
    if (!contact || contact.status !== "confirmed") {
      throw new ConflictException({
        code: BILLING_ERROR_CODES.contactEmailRequired,
        message: "Confirm a contact email in Settings before subscribing: it receives your receipts.",
      });
    }

    const existing = await prisma.subscription.findUnique({ where: { userId } });
    if (existing?.stripeSubscriptionId && isLiveStatus(existing.status)) {
      throw new ConflictException({
        code: BILLING_ERROR_CODES.alreadySubscribed,
        message: "You already have Artist Pro. Use Manage billing to change or cancel it.",
      });
    }

    if (input.textVersion !== SUBSCRIPTION_CONSENT_WORDING.version) {
      throw new ConflictException({
        code: BILLING_ERROR_CODES.consentOutdated,
        message: "The subscription terms changed. Reload them and confirm again.",
        currentVersion: SUBSCRIPTION_CONSENT_WORDING.version,
      });
    }
    if (input.acknowledgedImmediateStart !== true) {
      throw new BadRequestException({
        code: BILLING_ERROR_CODES.consentRequired,
        message: "Starting Artist Pro needs your explicit request for it to start now.",
      });
    }

    const interval = input.interval;
    // 1. The consent, before anything exists at Stripe.
    const consent = await this.consents.recordSubscriptionStart(userId, {
      subjectId: `artist_pro_${interval}`,
      subjectLabel: PLAN_LABELS[interval],
    });

    // 2. One Stripe customer per person, reused by every later checkout.
    const customerId = existing?.stripeCustomerId ?? (await this.createCustomer(gateway, userId, contact.address, interval));

    // 3. The Checkout Session.
    const session = await gateway.createCheckoutSession(
      {
        mode: "subscription",
        customer: customerId,
        client_reference_id: userId,
        line_items: [{ price: this.config.priceFor(interval), quantity: 1 }],
        success_url: this.config.returnUrl("success"),
        cancel_url: this.config.returnUrl("cancel"),
        metadata: { userId, consentId: consent.id, interval },
        subscription_data: { metadata: { userId, consentId: consent.id } },
        ...(this.config.automaticTax
          ? { automatic_tax: { enabled: true }, customer_update: { address: "auto" as const } }
          : {}),
      },
      `resonate-checkout-${consent.id}`,
    );
    if (!session.url) throw unavailable();

    try {
      await this.consents.link(userId, consent.id, { purchaseRef: session.id });
    } catch (error) {
      // Best effort: the consent is recorded either way and Stripe metadata names it.
      writeStructuredLog({
        level: "warn",
        event: "billing.consent_link_failed",
        message: "Could not link the subscription consent to its checkout session",
        consentId: consent.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return { url: session.url };
  }

  async openPortal(userId: string): Promise<{ url: string }> {
    if (!this.available()) throw unavailable();
    const row = await prisma.subscription.findUnique({ where: { userId }, select: { stripeCustomerId: true } });
    if (!row) {
      throw new NotFoundException({
        code: BILLING_ERROR_CODES.noBillingAccount,
        message: "You have no billing account yet.",
      });
    }
    const session = await (this.gateway as StripeGateway).createPortalSession({
      customer: row.stripeCustomerId,
      return_url: this.config.returnUrl("portal"),
    });
    return { url: session.url };
  }

  private async createCustomer(
    gateway: StripeGateway,
    userId: string,
    email: string,
    interval: BillingInterval,
  ): Promise<string> {
    // The key includes the address, so a changed address never reuses a stale request.
    const emailKey = createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
    const customer = await gateway.createCustomer(
      { email, metadata: { userId } },
      `resonate-customer-${userId}-${emailKey}`,
    );
    try {
      await prisma.subscription.create({
        data: { userId, stripeCustomerId: customer.id, interval, status: "incomplete" },
      });
      return customer.id;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      // A concurrent checkout stored the customer first: use that one.
      const row = await prisma.subscription.findUnique({ where: { userId }, select: { stripeCustomerId: true } });
      if (!row) throw error;
      return row.stripeCustomerId;
    }
  }
}
