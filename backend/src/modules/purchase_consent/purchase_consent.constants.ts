/**
 * Immediate-delivery consent for consumer digital purchases (#1776).
 *
 * Under Directive 2011/83/EU a consumer can withdraw from a distance purchase
 * within 14 days. For digital content that is not on a tangible medium the
 * right ends only if the consumer gave prior express consent to delivery
 * starting during the period, acknowledged that this ends the right, and the
 * trader confirmed that agreement on a durable medium (art. 16(m), art. 8(7)).
 * Checkout collects the first two before the purchase is initiated; the
 * confirmation is a platform notice (also emailed to a confirmed contact
 * address).
 *
 * Scope decided by the owner (docs/features/purchase_consent.md): human
 * checkout surfaces only. Machine-to-machine x402 / MCP purchases and Shows
 * pledges are out of scope. Flagged for legal review.
 */

/**
 * Purchases before this instant predate the consent step and are delivered as
 * before: grandfathered, so a buyer keeps the re-downloads and licences they
 * already had. Only a purchase at or after it needs a consent or the 14 days.
 */
export const PURCHASE_CONSENT_EFFECTIVE_AT = new Date("2026-10-25T00:00:00Z");

/** The withdrawal period; a held delivery is released this long after the purchase. */
export const WITHDRAWAL_PERIOD_DAYS = 14;
export const WITHDRAWAL_PERIOD_MS = WITHDRAWAL_PERIOD_DAYS * 24 * 60 * 60 * 1000;

/**
 * How long before a purchase an unlinked consent can still apply to it. A
 * consent recorded at checkout minutes before the payment qualifies; one
 * recorded last week for a purchase that never happened does not.
 */
export const CONSENT_PRE_PURCHASE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How long a consent authorizes a not-yet-minted on-chain mint. */
export const MINT_CONSENT_VALIDITY_MS = 24 * 60 * 60 * 1000;

/** Identifies the wording below. Bump it whenever any sentence changes. */
export const CONSENT_TEXT_VERSION = "2026-10-24.draft-1";

/** The wording is a draft until a lawyer qualified in the operator's jurisdiction has signed it off. */
export const CONSENT_REVIEW_STATUS = "for_legal_review_before_production";

export const PURCHASE_CONSENT_SURFACES = {
  /** Marketplace stem and licence purchase (on-chain buy or browser x402 checkout). */
  stem_purchase: { deliveryKind: "off_chain", holdAllowed: true },
  /** Paid Punchline moment collect. */
  punchline_collect: { deliveryKind: "off_chain", holdAllowed: true },
  /** Generation-credit pack (#1422): recorded by `POST /billing/credits/checkout` before the Stripe Checkout Session. */
  credit_topup: { deliveryKind: "off_chain", holdAllowed: true },
  /** An on-chain collectible mint, which cannot be undone: consent is required, waiting is not offered. */
  collectible_mint: { deliveryKind: "on_chain_mint", holdAllowed: false },
  /**
   * An Artist Pro subscription (#2407): a service that starts at once, with no
   * hold. Recorded only by `POST /billing/subscription/checkout`, before the
   * Stripe Checkout Session is created, with {@link SUBSCRIPTION_CONSENT_WORDING}.
   */
  subscription: { deliveryKind: "service", holdAllowed: false },
} as const;

export type PurchaseConsentSurface = keyof typeof PURCHASE_CONSENT_SURFACES;
export const PURCHASE_CONSENT_SURFACE_NAMES = Object.keys(PURCHASE_CONSENT_SURFACES) as PurchaseConsentSurface[];

export function isPurchaseConsentSurface(value: unknown): value is PurchaseConsentSurface {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PURCHASE_CONSENT_SURFACES, value);
}

/** Licence tiers a stem purchase can carry (mirrors the `LicenseType` enum). */
export const PURCHASE_CONSENT_LICENSE_TYPES = [
  "personal",
  "remix",
  "commercial",
  "sync",
  "sample",
  "broadcast",
] as const;

/**
 * The sentences the checkout shows. Served by `GET /purchase-consents/wording`
 * so the web never carries its own copy: what the buyer saw is exactly what
 * `textVersion` names.
 */
export const PURCHASE_CONSENT_WORDING = {
  version: CONSENT_TEXT_VERSION,
  reviewStatus: CONSENT_REVIEW_STATUS,
  heading: "Delivery and your right to withdraw",
  intro:
    "You can withdraw from a digital purchase within 14 days. That right ends once we start delivering the content during those 14 days, if you ask us to and confirm you understand.",
  deliverNow: {
    label: "Deliver now",
    description: "Delivery starts as soon as your payment is confirmed.",
    acknowledgement:
      "I ask for delivery to begin now, before the 14-day withdrawal period ends, and I understand that once delivery begins I lose my right to withdraw from this purchase.",
  },
  wait: {
    label: "Wait 14 days",
    description:
      "Keep your right to withdraw. We hold delivery until 14 days after your purchase, then it is released to you automatically.",
  },
  mint: {
    explanation:
      "Minting is recorded on a blockchain and cannot be undone, so it starts delivery immediately. To buy this you must ask for immediate delivery and accept that you lose your right to withdraw.",
  },
  confirmation:
    "We record your choice and send you a confirmation in your notices (and by email if you have confirmed a contact address).",
} as const;

export type PurchaseConsentWording = typeof PURCHASE_CONSENT_WORDING;

/** Platform notice category used for the durable confirmation. Always emailed when a contact address is confirmed. */
export const PURCHASE_CONSENT_NOTICE_CATEGORY = "purchase" as const;
export const PURCHASE_CONSENT_NOTICE_ACTOR = { userId: "system:purchase-consent" } as const;

/**
 * The subscription start wording (#2407, `docs/rfc/artist-pro.md` §6). A
 * subscription is a service, not content: asking for it to start during the 14
 * days does not end the right to withdraw, it makes the person pay for the
 * time used if they withdraw (Directive 2011/83/EU art. 7(3), 14(3)). Versioned
 * on its own, because its sentences differ from the delivery wording above.
 * Served by `GET /billing/subscription` so the web never carries its own copy.
 * A draft until legal review (RFC §8).
 */
export const SUBSCRIPTION_CONSENT_TEXT_VERSION = "2026-10-25.subscription-draft-1";

export const SUBSCRIPTION_CONSENT_WORDING = {
  version: SUBSCRIPTION_CONSENT_TEXT_VERSION,
  reviewStatus: CONSENT_REVIEW_STATUS,
  heading: "Your subscription starts now",
  intro:
    "You can withdraw from a subscription within 14 days of subscribing. If you ask for Artist Pro to start straight away, you can still withdraw during those 14 days, but you pay for the time you used.",
  acknowledgement:
    "I ask for my Artist Pro subscription to start now, before the 14-day withdrawal period ends. I understand that if I withdraw within those 14 days, I am refunded only for the unused time, less the value of any monthly generation allowance I have already used.",
  cancellation:
    "You can cancel at any time from Manage billing. Artist Pro then stays on until the end of the period you paid for.",
  confirmation:
    "We record your choice and send you a confirmation in your notices and to your confirmed contact address.",
} as const;

export type SubscriptionConsentWording = typeof SUBSCRIPTION_CONSENT_WORDING;
