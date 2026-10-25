/**
 * The generation-credit packs on sale (#1422, `docs/rfc/business-model.md`
 * Layer 2b, `docs/rfc/artist-pro.md` §7): $5 (the minimum), $10 (the default)
 * and $25. ADR-BM-6 revenue line 2 (creator tools, metered generation),
 * Phase 2; Stripe test mode only until the RFC §8 gates clear.
 *
 * The catalogue is server-side: a checkout names a pack id, never an amount,
 * and fulfilment credits the catalogue's credits only when Stripe reports the
 * catalogue's price. Credits are USD cents at the sell price, so a pack buys
 * credits equal to its price before tax; the artist share of every fan
 * transaction (ADR-BM-4) is untouched.
 *
 * Each pack's Stripe price id comes from the environment
 * (`STRIPE_PRICE_CREDITS_5`, `_10`, `_25`); none has a source-code default.
 * Buying credits is available only when billing is (`BillingConfig`) and all
 * three are set.
 */

export type CreditPackId = "credits_5" | "credits_10" | "credits_25";

export type CreditPack = {
  readonly id: CreditPackId;
  /** The price before tax, in USD cents. */
  readonly priceCents: number;
  /** Generation credits the pack buys, in USD cents. */
  readonly creditsCents: number;
  readonly label: string;
  /** The environment variable naming its Stripe price. */
  readonly priceEnv: string;
};

export const CREDIT_PACKS: readonly CreditPack[] = Object.freeze([
  { id: "credits_5", priceCents: 500, creditsCents: 500, label: "$5 credit pack", priceEnv: "STRIPE_PRICE_CREDITS_5" },
  { id: "credits_10", priceCents: 1000, creditsCents: 1000, label: "$10 credit pack", priceEnv: "STRIPE_PRICE_CREDITS_10" },
  { id: "credits_25", priceCents: 2500, creditsCents: 2500, label: "$25 credit pack", priceEnv: "STRIPE_PRICE_CREDITS_25" },
] as const);

export const CREDIT_PACK_IDS: readonly CreditPackId[] = CREDIT_PACKS.map((pack) => pack.id);

/** The pack the checkout suggests (the RFC's default). Consent is never pre-selected. */
export const DEFAULT_CREDIT_PACK_ID: CreditPackId = "credits_10";

export const CREDIT_PACK_CURRENCY = "usd";

export function findCreditPack(id: unknown): CreditPack | null {
  return CREDIT_PACKS.find((pack) => pack.id === id) ?? null;
}

/** "$10.00" from 1000. */
export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
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
