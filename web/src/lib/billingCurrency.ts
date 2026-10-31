/**
 * The currency Artist Pro and credit packs are priced in (#2496).
 *
 * The rule, in one place: a buyer whose billing address is in the EU VAT area
 * pays in euros with VAT included; everyone else pays in US dollars with any
 * applicable tax added at checkout. The browser's time zone only picks the
 * starting choice; the person can always change it, and Stripe computes the tax
 * from the billing address typed at checkout. Credits themselves stay in USD at
 * face value, so a EUR 10 and a USD 10 pack both buy $10.00 of credits.
 */

export type BillingCurrency = "usd" | "eur";

export const BILLING_CURRENCY_STORAGE_KEY = "resonate.billingCurrency";

/**
 * IANA time zones of the EU VAT territory (the 27 member states, without the
 * parts that sit outside the VAT area) plus Monaco, which is in the French VAT
 * area. Deliberately absent: Atlantic/Canary and Africa/Ceuta (Spain, outside
 * the VAT area), Europe/Mariehamn (Åland), Europe/Busingen (Büsingen) and the
 * French overseas zones.
 */
export const EU_VAT_TIME_ZONES: readonly string[] = [
  "Europe/Vienna",
  "Europe/Brussels",
  "Europe/Sofia",
  "Europe/Zagreb",
  "Asia/Nicosia",
  "Asia/Famagusta",
  "Europe/Nicosia",
  "Europe/Prague",
  "Europe/Copenhagen",
  "Europe/Tallinn",
  "Europe/Helsinki",
  "Europe/Paris",
  "Europe/Monaco",
  "Europe/Berlin",
  "Europe/Athens",
  "Europe/Budapest",
  "Europe/Dublin",
  "Europe/Rome",
  "Europe/Riga",
  "Europe/Vilnius",
  "Europe/Luxembourg",
  "Europe/Malta",
  "Europe/Amsterdam",
  "Europe/Warsaw",
  "Europe/Lisbon",
  "Atlantic/Madeira",
  "Atlantic/Azores",
  "Europe/Bucharest",
  "Europe/Bratislava",
  "Europe/Ljubljana",
  "Europe/Madrid",
  "Europe/Stockholm",
];

const EU_VAT_TIME_ZONE_SET: ReadonlySet<string> = new Set(EU_VAT_TIME_ZONES);

export function isBillingCurrency(value: unknown): value is BillingCurrency {
  return value === "usd" || value === "eur";
}

export function isEuVatTimeZone(timeZone: string | null | undefined): boolean {
  return Boolean(timeZone) && EU_VAT_TIME_ZONE_SET.has(timeZone as string);
}

/** The browser's IANA time zone, or null where it cannot be read. */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** "$14.99" / "€14.99": cents with two decimals. */
export function formatMoney(cents: number, currency: BillingCurrency): string {
  const symbol = currency === "eur" ? "€" : "$";
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

/** "€10" for whole amounts, "€14.99" otherwise: for short labels such as a pack name. */
export function formatWholeMoney(cents: number, currency: BillingCurrency): string {
  return cents % 100 === 0 ? formatMoney(cents, currency).replace(/\.00$/, "") : formatMoney(cents, currency);
}

/** How tax is handled in the currency, in the words used across the app. */
export function taxLabel(currency: BillingCurrency): string {
  return currency === "eur" ? "VAT included" : "plus any applicable tax";
}

/** The sentence under the prices: currency, tax and where the exact amount appears. */
export function priceNote(currency: BillingCurrency): string {
  return currency === "eur"
    ? "Prices are in euros, VAT included. Stripe’s secure checkout page shows the exact amount before you pay."
    : "Prices are in US dollars, plus any applicable tax. Stripe’s secure checkout page shows the exact amount before you pay.";
}

/** The starting currency: euros only when the server offers them and the device is in the EU VAT area. */
export function defaultBillingCurrency(
  offered: readonly BillingCurrency[],
  timeZone: string | null | undefined = browserTimeZone(),
): BillingCurrency {
  return offered.includes("eur") && isEuVatTimeZone(timeZone) ? "eur" : "usd";
}

/** The person's explicit choice when the server offers it, else the default. */
export function resolveBillingCurrency(
  offered: readonly BillingCurrency[],
  preference: BillingCurrency | null | undefined,
  timeZone: string | null | undefined = browserTimeZone(),
): BillingCurrency {
  if (preference && offered.includes(preference)) return preference;
  return defaultBillingCurrency(offered, timeZone);
}

/** The saved choice, or null (automatic). Safe where storage is missing or blocked. */
export function readStoredBillingCurrency(storage?: Pick<Storage, "getItem">): BillingCurrency | null {
  try {
    const store = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    const value = store?.getItem(BILLING_CURRENCY_STORAGE_KEY);
    return isBillingCurrency(value) ? value : null;
  } catch {
    return null;
  }
}

/** Remember the person's choice in this browser. Silently skipped where storage is blocked. */
export function writeStoredBillingCurrency(currency: BillingCurrency, storage?: Pick<Storage, "setItem">): void {
  try {
    const store = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    store?.setItem(BILLING_CURRENCY_STORAGE_KEY, currency);
  } catch {
    // Private windows and blocked storage still render; the choice just is not remembered.
  }
}
