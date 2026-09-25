/**
 * Pure money helpers for the operator credit-request queue (#1885).
 * Grants are sent to the API as integer USD cents (1..10_000_000).
 */

export const MIN_GRANT_CENTS = 1;
export const MAX_GRANT_CENTS = 10_000_000;

/** Quick-grant presets: $1, $5, $10. */
export const QUICK_GRANT_CENTS = [100, 500, 1000] as const;

export const DEFAULT_GRANT_REASON = "Credit request top-up";

export type ParsedGrantAmount =
  | { ok: true; cents: number }
  | { ok: false; error: string };

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format integer cents as US dollars, e.g. 500 → "$5.00". */
export function formatUsdCents(cents: number) {
  return usdFormatter.format(cents / 100);
}

const RANGE_ERROR = `Grants must be between ${formatUsdCents(MIN_GRANT_CENTS)} and ${formatUsdCents(MAX_GRANT_CENTS)}.`;

/**
 * Parse an operator-typed dollar amount into integer cents without floating
 * point rounding. Accepts "5", "5.5", "12.50" and an optional leading "$".
 * Rejects commas on purpose: "1,50" is ambiguous between locales and a
 * mis-read would grant a hundred times the intended amount.
 */
export function parseDollarsToCents(input: string): ParsedGrantAmount {
  const trimmed = input.trim().replace(/^\$\s*/, "");
  if (!trimmed) return { ok: false, error: "Enter an amount to grant." };

  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    return { ok: false, error: "Enter a dollar amount like 5 or 12.50 (digits only, up to two decimals)." };
  }

  const whole = match[1].replace(/^0+(?=\d)/, "");
  // More than 6 whole-dollar digits is always above the $100,000.00 cap.
  if (whole.length > 6) return { ok: false, error: RANGE_ERROR };

  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = Number(whole) * 100 + Number(fraction);
  if (!Number.isSafeInteger(cents) || cents < MIN_GRANT_CENTS || cents > MAX_GRANT_CENTS) {
    return { ok: false, error: RANGE_ERROR };
  }
  return { ok: true, cents };
}
