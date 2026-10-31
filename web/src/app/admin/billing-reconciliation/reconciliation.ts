import { ApiRequestError, type BillingReconciliationSection } from "../../../lib/api";

/** #2497: pure helpers for the monthly billing reconciliation page. */

/** How many months the picker offers, counting the current one. */
export const RECONCILIATION_MONTH_COUNT = 36;

export type ReconciliationMonthOption = {
  /** `YYYY-MM` (UTC). */
  value: string;
  label: string;
  /** The month has not ended yet, so its totals can still change. */
  inProgress: boolean;
};

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toMonth(year: number, monthIndex: number) {
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}`;
}

/** The UTC month `now` falls in, as `YYYY-MM`. */
export function currentUtcMonth(now: Date = new Date()) {
  return toMonth(now.getUTCFullYear(), now.getUTCMonth());
}

/** The UTC month before `now`'s: the usual month to reconcile. */
export function previousUtcMonth(now: Date = new Date()) {
  return shiftMonth(currentUtcMonth(now), -1);
}

/** `YYYY-MM` moved by a whole number of months (negative goes back). */
export function shiftMonth(month: string, delta: number) {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + delta;
  return toMonth(year + Math.floor(index / 12), ((index % 12) + 12) % 12);
}

/** "September 2026". Falls back to the raw value for anything that is not `YYYY-MM`. */
export function formatMonthLabel(month: string) {
  if (!MONTH_PATTERN.test(month)) return month;
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** Months from the current one back, newest first; future months are never offered. */
export function reconciliationMonthOptions(
  now: Date = new Date(),
  count: number = RECONCILIATION_MONTH_COUNT,
): ReconciliationMonthOption[] {
  const current = currentUtcMonth(now);
  return Array.from({ length: count }, (_, offset) => {
    const value = shiftMonth(current, -offset);
    return {
      value,
      label: offset === 0 ? `${formatMonthLabel(value)} (in progress)` : formatMonthLabel(value),
      inProgress: offset === 0,
    };
  });
}

const FRACTION_DIGITS = new Map<string, number>();

function currencyFractionDigits(currency: string) {
  const cached = FRACTION_DIGITS.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  FRACTION_DIGITS.set(currency, digits);
  return digits;
}

/**
 * An amount in the currency's minor units (cents, or yen for JPY) as money:
 * `1234` USD is "$12.34". An unknown currency code is shown beside the number.
 */
export function formatMoneyMinor(minor: number, currency: string) {
  const code = currency.trim().toUpperCase();
  const digits = currencyFractionDigits(code);
  const value = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${code}`;
  }
}

/** An amount of generation credits in credit cents, as dollars: `1250` is "$12.50". */
export function formatCreditCents(cents: number) {
  return formatMoneyMinor(cents, "USD");
}

/** A long id shortened for a table cell: "cs_test_a1B2…x9Yz". The full value belongs in `title`. */
export function shortenReference(id: string) {
  const value = id.trim();
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

/** Plain label for a report section. */
export const SECTION_LABELS: Record<BillingReconciliationSection, string> = {
  control_totals: "Control totals",
  held_purchases: "Held purchases",
  credit_balance: "Credit balance",
  allowance: "Artist Pro allowance",
  purchases: "Credit pack purchases",
  refunds: "Credit pack refunds",
  needs_review: "Needs review",
  subscription_invoices: "Subscription invoices",
};

export function csvFileName(month: string, section: BillingReconciliationSection) {
  return `billing-reconciliation-${month}-${section}.csv`;
}

export function jsonFileName(month: string) {
  return `billing-reconciliation-${month}.json`;
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  invalid_month: "That is not a valid month. Pick one from the list.",
  month_in_future: "That month has not started yet. Pick the current month or an earlier one.",
  section_required: "Pick a section to download.",
};

/** A person-readable message for a failed report request or download. */
export function reconciliationErrorMessage(reason: unknown) {
  if (reason instanceof ApiRequestError) {
    if (reason.status === 403) {
      return "Your account does not have access to the billing reconciliation report. It is for operators and administrators.";
    }
    if (reason.status === 400) {
      const code = (reason.details as { code?: unknown } | undefined)?.code;
      if (typeof code === "string" && ERROR_CODE_MESSAGES[code]) return ERROR_CODE_MESSAGES[code];
    }
  }
  return reason instanceof Error ? reason.message : "Something went wrong. Please try again.";
}

/** Hand a blob to the browser as a file download. */
export function saveBlobAsFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Give the browser a tick to start the download before the URL is released.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** "2026-09-04 12:30 UTC" for a timestamp; anything unreadable is shown as received. */
export function formatUtcTimestamp(value: string | null | undefined) {
  if (!value) return "—";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return `${time.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** "2026-09-04" for a timestamp. */
export function formatUtcDate(value: string | null | undefined) {
  if (!value) return "—";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return time.toISOString().slice(0, 10);
}

/** A machine code as words: "top_up_refund" is "top up refund". */
export function humanizeCode(code: string | null | undefined) {
  return code ? code.replace(/[_:]/g, " ") : "—";
}
