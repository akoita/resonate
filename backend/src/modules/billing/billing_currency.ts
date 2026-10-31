/**
 * The currencies Artist Pro and credit packs are sold in (#2496,
 * `docs/rfc/artist-pro.md` §9 decision #3). ADR-BM-6 revenue line 2, Phase 2.
 *
 * **The rule.** A buyer whose billing address is in the EU VAT area pays in
 * EUR, with VAT included in the price shown; everyone else pays in USD, with
 * any tax added at checkout. The buyer states where their billing address is
 * (the app preselects it from the browser's time zone), the checkout request
 * names the currency, and Checkout charges exactly that currency. Stripe Tax
 * still taxes by the billing address Checkout collects: an EUR price stays the
 * same total whatever its tax share, a USD price gets the tax on top.
 *
 * EUR is offered only when `STRIPE_EUR_PRICES=true`, which says the Stripe
 * prices carry their EUR currency option (tax-inclusive). Until then every
 * checkout is USD, because Checkout refuses a currency a price does not have.
 *
 * The amounts here are what the app shows. Stripe's prices are what is
 * charged, and fulfilment of a credit pack checks them against this catalogue.
 */

export type BillingCurrency = "usd" | "eur";
export const BILLING_CURRENCIES: readonly BillingCurrency[] = ["usd", "eur"] as const;
export const DEFAULT_BILLING_CURRENCY: BillingCurrency = "usd";

/** Whether the price shown includes tax (EUR, VAT included) or excludes it (USD). */
export const TAX_INCLUSIVE: Readonly<Record<BillingCurrency, boolean>> = Object.freeze({ usd: false, eur: true });

const SYMBOL: Readonly<Record<BillingCurrency, string>> = Object.freeze({ usd: "$", eur: "€" });

export function isBillingCurrency(value: unknown): value is BillingCurrency {
  return value === "usd" || value === "eur";
}

/** "$10.00" or "€10.00" from 1000; an unexpected currency reads "10.00 GBP". */
export function formatMoney(cents: number, currency: string): string {
  const amount = (cents / 100).toFixed(2);
  const code = currency.toLowerCase();
  return isBillingCurrency(code) ? `${SYMBOL[code]}${amount}` : `${amount} ${currency.toUpperCase()}`;
}

/** "$10" or "€10" from 1000 (whole amounts only, for labels). */
export function formatWholeMoney(cents: number, currency: BillingCurrency): string {
  return `${SYMBOL[currency]}${cents / 100}`;
}

/** How a price's tax reads after the amount: "VAT included" or "before any tax". */
export function taxPhrase(currency: string): string {
  return currency.toLowerCase() === "eur" ? "VAT included" : "before any tax";
}
