/**
 * #2147: how the browser words an operator account restriction.
 *
 * Pure (no imports from `./api`) because `api.ts` uses it to turn the server's
 * 403 into a message every mutating screen can show as is.
 */
export type AccountRestrictionCode = "account_suspended" | "account_closed";

export const ACCOUNT_RESTRICTION_CODES: readonly AccountRestrictionCode[] = ["account_suspended", "account_closed"];

export function isAccountRestrictionCode(value: unknown): value is AccountRestrictionCode {
  return typeof value === "string" && (ACCOUNT_RESTRICTION_CODES as readonly string[]).includes(value);
}

/** "12 Nov 2026", or null for a missing or invalid date. */
export function formatRestrictionDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const STILL_WORKS = "You can still sign in, claim refunds, read your notices and export your data.";

/**
 * A plain sentence for the 403 body `{ code, until? }`, or null when the body
 * is not an account-restriction error.
 */
export function accountRestrictionMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const { code, until } = payload as { code?: unknown; until?: unknown };
  if (!isAccountRestrictionCode(code)) return null;
  if (code === "account_closed") {
    return `This account has been closed, so it can no longer make changes. ${STILL_WORKS}`;
  }
  const end = formatRestrictionDate(typeof until === "string" ? until : null);
  return end
    ? `This account is suspended until ${end}, so it can't make changes right now. ${STILL_WORKS}`
    : `This account is suspended, so it can't make changes right now. ${STILL_WORKS}`;
}
