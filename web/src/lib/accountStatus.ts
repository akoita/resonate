import { getOwnAccountStatus, type AccountStatusReason, type OwnAccountStatus } from "./api";
import { formatRestrictionDate } from "./accountRestriction";

/**
 * #2147: the browser's one view of whether the signed-in account is restricted.
 *
 * Module-scoped for the same reason `platformNotices.ts` is: the banner in the
 * shell and the screens that change their copy (the account-deletion notice)
 * sit in different trees.
 */
export type AccountStatusState = {
  /** The session token the answer belongs to; null when signed out. */
  token: string | null;
  status: OwnAccountStatus | null;
};

const EMPTY: AccountStatusState = { token: null, status: null };

type Listener = (state: AccountStatusState) => void;

let state: AccountStatusState = { ...EMPTY };
const listeners = new Set<Listener>();

function publish(next: AccountStatusState) {
  state = next;
  for (const listener of listeners) listener(state);
}

export function getAccountStatusState(): AccountStatusState {
  return state;
}

export function subscribeToAccountStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetAccountStatus() {
  publish({ ...EMPTY });
}

const STATUSES: readonly string[] = ["active", "suspended", "closed"];

/** The status response is untrusted input to a surface rendered on every page: anything unexpected is null. */
export function normalizeOwnAccountStatus(value: unknown): OwnAccountStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.status !== "string" || !STATUSES.includes(raw.status)) return null;
  const text = (field: unknown) => (typeof field === "string" ? field : null);
  return {
    status: raw.status as OwnAccountStatus["status"],
    reason: text(raw.reason) as AccountStatusReason | null,
    until: text(raw.until),
    changedAt: text(raw.changedAt),
    erasureScheduledFor: text(raw.erasureScheduledFor),
  };
}

/** Load the person's own state. A failed or malformed load keeps what is already known. */
export async function loadAccountStatus(token: string | null | undefined) {
  if (!token) {
    resetAccountStatus();
    return state;
  }
  try {
    const status = normalizeOwnAccountStatus(await getOwnAccountStatus(token));
    if (status) publish({ token, status });
  } catch {
    // Keep the previous answer; the next poll retries.
  }
  return state;
}

export const ACCOUNT_REASON_LABELS: Record<AccountStatusReason, string> = {
  terms_violation: "a violation of the terms of service",
  fraud: "suspected fraud",
  abuse: "abusive behaviour",
  rights_infringement: "a rights infringement",
  other: "another reason covered by the terms of service",
};

export type AccountBannerCopy = { title: string; body: string };

/** The banner's words, or null for an active account (no banner). */
export function describeAccountBanner(status: OwnAccountStatus | null): AccountBannerCopy | null {
  if (!status || status.status === "active") return null;
  const reason = status.reason ? ` because of ${ACCOUNT_REASON_LABELS[status.reason]}` : "";
  const stillWorks = "You can still sign in, claim refunds, read your notices, and export or delete your data.";
  if (status.status === "closed") {
    const erasure = formatRestrictionDate(status.erasureScheduledFor);
    return {
      title: "Your account has been closed",
      body:
        `It was closed${reason}, so it can no longer make changes. ` +
        (erasure ? `Your personal data will be erased on ${erasure}. ` : "") +
        stillWorks,
    };
  }
  const end = formatRestrictionDate(status.until);
  return {
    title: end ? `Your account is suspended until ${end}` : "Your account is suspended",
    body: `It was suspended${reason}, so you can't make changes right now. ${stillWorks}`,
  };
}
