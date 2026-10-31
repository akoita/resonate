/**
 * The generation-credit packs on sale (#1422, `docs/rfc/business-model.md`
 * Layer 2b, `docs/rfc/artist-pro.md` §7): $5 (the minimum), $10 (the default)
 * and $25, or €5, €10 and €25 with VAT included for EU buyers (#2496,
 * `billing_currency.ts`). ADR-BM-6 revenue line 2 (creator tools, metered
 * generation), Phase 2; Stripe test mode only until the RFC §8 gates clear.
 *
 * The catalogue is server-side: a checkout names a pack id and a currency,
 * never an amount, and fulfilment credits the catalogue's credits only when
 * Stripe reports the catalogue's price in that currency. Credits are USD cents
 * at the sell price, and a pack buys credits at face value: €10 and $10 both
 * buy 1,000 credit cents. VAT on an EU sale comes out of the margin; the
 * artist share of every fan transaction (ADR-BM-4) is untouched.
 *
 * Each pack's Stripe price id comes from the environment
 * (`STRIPE_PRICE_CREDITS_5`, `_10`, `_25`); none has a source-code default.
 * One Stripe price carries both currencies (EUR as a tax-inclusive currency
 * option). Buying credits is available only when billing is (`BillingConfig`)
 * and all three are set.
 */

import { TAX_INCLUSIVE, formatWholeMoney, type BillingCurrency } from "./billing_currency";

export type CreditPackId = "credits_5" | "credits_10" | "credits_25";

export type CreditPack = {
  readonly id: CreditPackId;
  /** The price in each currency, in cents: before tax in USD, VAT included in EUR. */
  readonly prices: Readonly<Record<BillingCurrency, number>>;
  /** Generation credits the pack buys, in USD cents. */
  readonly creditsCents: number;
  /** The environment variable naming its Stripe price. */
  readonly priceEnv: string;
};

export const CREDIT_PACKS: readonly CreditPack[] = Object.freeze([
  { id: "credits_5", prices: { usd: 500, eur: 500 }, creditsCents: 500, priceEnv: "STRIPE_PRICE_CREDITS_5" },
  { id: "credits_10", prices: { usd: 1000, eur: 1000 }, creditsCents: 1000, priceEnv: "STRIPE_PRICE_CREDITS_10" },
  { id: "credits_25", prices: { usd: 2500, eur: 2500 }, creditsCents: 2500, priceEnv: "STRIPE_PRICE_CREDITS_25" },
] as const);

export const CREDIT_PACK_IDS: readonly CreditPackId[] = CREDIT_PACKS.map((pack) => pack.id);

/** The pack the checkout suggests (the RFC's default). Consent is never pre-selected. */
export const DEFAULT_CREDIT_PACK_ID: CreditPackId = "credits_10";

export function findCreditPack(id: unknown): CreditPack | null {
  return CREDIT_PACKS.find((pack) => pack.id === id) ?? null;
}

/** "$10 credit pack" or "€10 credit pack". */
export function creditPackLabel(pack: CreditPack, currency: BillingCurrency): string {
  return `${formatWholeMoney(pack.prices[currency], currency)} credit pack`;
}

/** "$10.00" from 1000: credits are USD cents, whatever currency bought them. */
export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** The part of a completed Checkout Session the price check reads. */
export type PaidAmount = {
  currency: string | null | undefined;
  amount_subtotal: number | null | undefined;
  amount_total?: number | null;
  total_details?: { amount_tax?: number | null; amount_discount?: number | null } | null;
};

/**
 * The currency a completed checkout paid the pack's catalogue price in, or
 * null when it did not (the purchase then waits for review).
 *
 * USD prices exclude tax, so the subtotal must equal the price. EUR prices
 * include VAT; Stripe reports that VAT inside `amount_subtotal`, but the check
 * also accepts a subtotal that excludes it, provided subtotal plus tax and the
 * total both equal the price (no discount). Either way the buyer paid exactly
 * the pack's EUR price.
 */
export function paidCurrency(pack: CreditPack, paid: PaidAmount): BillingCurrency | null {
  const currency = (paid.currency ?? "").toLowerCase();
  if (currency !== "usd" && currency !== "eur") return null;
  const price = pack.prices[currency];
  const subtotal = paid.amount_subtotal;
  if (typeof subtotal !== "number") return null;
  if (subtotal === price) return currency;
  if (!TAX_INCLUSIVE[currency]) return null;
  const tax = paid.total_details?.amount_tax ?? 0;
  const discount = paid.total_details?.amount_discount ?? 0;
  return discount === 0 && subtotal + tax === price && paid.amount_total === price ? currency : null;
}

/** The Stripe price of each pack, from the environment. */
export class CreditPackConfig {
  readonly prices: Readonly<Record<CreditPackId, string>>;
  /** Names of pack price variables that are unset. */
  readonly missing: readonly string[];

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const prices = {} as Record<CreditPackId, string>;
    const missing: string[] = [];
    for (const pack of CREDIT_PACKS) {
      const value = (env[pack.priceEnv] ?? "").trim();
      prices[pack.id] = value;
      if (!value) missing.push(pack.priceEnv);
    }
    this.prices = Object.freeze(prices);
    this.missing = Object.freeze(missing);
  }

  isConfigured(): boolean {
    return this.missing.length === 0;
  }

  priceFor(id: CreditPackId): string {
    return this.prices[id];
  }
}
