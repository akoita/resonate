/**
 * The only place the Stripe SDK is used (#2407). Everything else talks to the
 * narrow {@link StripeGateway} interface, so tests inject a fake and never call
 * Stripe.
 *
 * The API version is pinned here, explicitly: an account default or an SDK
 * upgrade never changes the shape of the objects the webhook handler reads.
 * Upgrading it is a reviewed change (re-read the subscription and invoice
 * fields in `subscription_state.ts`).
 */

import Stripe from "stripe";
import type { BillingConfig } from "./billing_config";

/** Pinned Stripe API version (matches the `stripe@23.0.0` SDK types). */
export const STRIPE_API_VERSION = "2026-09-30.endive" as const;

/** Nest injection token for the gateway (null when billing is unavailable). */
export const STRIPE_GATEWAY = Symbol("STRIPE_GATEWAY");

export type StripeEvent = Stripe.Event;
export type StripeSubscription = Stripe.Subscription;
export type StripeInvoice = Stripe.Invoice;
export type StripeCheckoutSession = Stripe.Checkout.Session;
export type StripeCharge = Stripe.Charge;

export interface StripeGateway {
  createCustomer(
    params: { email: string; metadata: Record<string, string> },
    idempotencyKey: string,
  ): Promise<{ id: string }>;
  createCheckoutSession(
    params: Stripe.Checkout.SessionCreateParams,
    idempotencyKey: string,
  ): Promise<{ id: string; url: string | null }>;
  createPortalSession(params: { customer: string; return_url: string }): Promise<{ url: string }>;
  retrieveSubscription(id: string): Promise<StripeSubscription>;
  /**
   * Cancel now, with no proration credit and no final invoice (#2430). Only
   * called for a subscription that is not already canceled.
   */
  cancelSubscription(id: string, idempotencyKey: string): Promise<StripeSubscription>;
  /**
   * Pause or resume collection, or set `cancel_at_period_end` (#2430). Setting
   * a state is idempotent, so no idempotency key: a reused key would replay an
   * earlier, opposite answer.
   */
  updateSubscription(
    id: string,
    params: Pick<Stripe.SubscriptionUpdateParams, "pause_collection" | "cancel_at_period_end">,
  ): Promise<StripeSubscription>;
  /** Update the customer's billing email (#2430). */
  updateCustomerEmail(id: string, email: string): Promise<void>;
  /** Verifies the `Stripe-Signature` header over the raw body; throws when it does not match. */
  constructEvent(rawBody: Buffer, signature: string, secret: string): StripeEvent;
}

/** The real gateway, over the official SDK. Only built when billing is available. */
export function createStripeGateway(config: BillingConfig): StripeGateway | null {
  if (!config.isAvailable()) return null;
  const stripe = new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: "resonate" },
  });
  return {
    async createCustomer(params, idempotencyKey) {
      const customer = await stripe.customers.create(params, { idempotencyKey });
      return { id: customer.id };
    },
    async createCheckoutSession(params, idempotencyKey) {
      const session = await stripe.checkout.sessions.create(params, { idempotencyKey });
      return { id: session.id, url: session.url };
    },
    async createPortalSession(params) {
      const session = await stripe.billingPortal.sessions.create(params);
      return { url: session.url };
    },
    retrieveSubscription(id) {
      return stripe.subscriptions.retrieve(id);
    },
    cancelSubscription(id, idempotencyKey) {
      return stripe.subscriptions.cancel(id, { prorate: false, invoice_now: false }, { idempotencyKey });
    },
    updateSubscription(id, params) {
      return stripe.subscriptions.update(id, params);
    },
    async updateCustomerEmail(id, email) {
      await stripe.customers.update(id, { email });
    },
    constructEvent(rawBody, signature, secret) {
      return stripe.webhooks.constructEvent(rawBody, signature, secret);
    },
  };
}
