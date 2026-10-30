import {
  ApiRequestError,
  type ContactEmailCategory,
  type PlatformNoticeCategory,
} from "./api";

/**
 * #2169: the wording and small rules behind the "Email notices" settings
 * section and the two pages an email links to. Kept apart from the components
 * so the words people read can be asserted without rendering anything.
 */

/** The longest address the server accepts. */
export const CONTACT_EMAIL_MAX_LENGTH = 254;

export const CONTACT_EMAIL_PROMISE = "Used only for platform notices. Never for marketing.";

/** What each category covers, in the words a person would use. */
export const EMAIL_CATEGORY_DESCRIPTIONS: Record<PlatformNoticeCategory, string> = {
  policy: "Changes to our policies.",
  terms: "Changes to the terms you agreed to.",
  incident: "Outages and security incidents.",
  moderation: "Action taken on something you posted or uploaded.",
  account: "Decisions about your account, and the reasons for them.",
  refund: "Refunds that are waiting for you.",
  purchase: "Confirmations of the delivery choice you made when you bought something.",
};

/** Why a locked category cannot be switched off. Only required ones need one. */
export const EMAIL_REQUIRED_REASONS: Partial<Record<PlatformNoticeCategory, string>> = {
  terms: "Required: we are obliged to tell you about changes to the terms.",
  account: "Required: you are entitled to know why we acted on your account.",
  purchase: "Required: we must confirm in writing that you asked for immediate delivery.",
};

/** Categories a person cannot switch off: they are emailed to every confirmed address. */
export function isEmailRequiredCategory(category: PlatformNoticeCategory): boolean {
  return category in EMAIL_REQUIRED_REASONS;
}

const FALLBACK_REQUIRED_REASON = "Required: we have to send you this one.";

export function requiredReason(category: PlatformNoticeCategory): string {
  return EMAIL_REQUIRED_REASONS[category] ?? FALLBACK_REQUIRED_REASON;
}

/** The `token` query parameter of an email link, or null when absent, empty or repeated. */
export function tokenFromSearchParams(
  searchParams: { [key: string]: string | string[] | undefined },
): string | null {
  const value = searchParams.token;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A friendly problem with what was typed, or null when it looks like an address. */
export function validateContactEmailInput(input: string): string | null {
  const value = input.trim();
  if (!value) return "Enter your email address.";
  if (value.length > CONTACT_EMAIL_MAX_LENGTH) return "That address is too long.";
  if (!EMAIL_SHAPE.test(value)) return "That does not look like an email address.";
  return null;
}

/**
 * The opt-out list to send after one toggle: every optional category that
 * ends up off. Required categories never appear in it (the server rejects
 * them).
 */
export function optOutsAfterToggle(
  categories: readonly ContactEmailCategory[],
  category: PlatformNoticeCategory,
  enabled: boolean,
): PlatformNoticeCategory[] {
  return categories
    .filter((entry) => !entry.required)
    .filter((entry) => (entry.category === category ? !enabled : !entry.enabled))
    .map((entry) => entry.category);
}

export const CONTACT_EMAIL_ERROR_MESSAGES = {
  email_unavailable: "Email notices are not available right now. Notices still reach you in the app.",
  email_send_failed:
    "The mail server refused that address. Check it, then try again or use Resend.",
  invalid_or_expired:
    "This confirmation link has expired or was already used. Ask for a new one in Settings.",
  invalid: "This unsubscribe link is not valid. You can change your email notices in Settings.",
} as const;

export const GENERIC_CONTACT_EMAIL_ERROR = "Something went wrong. Please try again.";

function errorCode(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  const details = error.details;
  if (details && typeof details === "object" && "code" in details) {
    const code = (details as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

/** The error code the server attached to a failed call, if it sent one. */
export function contactEmailErrorCode(error: unknown): string | null {
  return errorCode(error);
}

/**
 * A sentence for a failed call. Known codes get their own words; a rate limit
 * keeps the client's friendly "a bit too quickly" message; a stale resend
 * (409) says what happened; anything else is a plain retry prompt rather than
 * an "API 500:" line.
 */
export function describeContactEmailError(error: unknown): string {
  const code = errorCode(error);
  if (code === "email_rate_limited" && error instanceof ApiRequestError) {
    // Confirmation emails are limited per account (one a minute, five a day).
    const retryAfter = (error.details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    const minutes = typeof retryAfter === "number" && retryAfter > 0 ? Math.ceil(retryAfter / 60) : null;
    return minutes === null
      ? "You've asked for several confirmation emails. Please wait before asking again."
      : `You've asked for several confirmation emails. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  if (code && code in CONTACT_EMAIL_ERROR_MESSAGES) {
    return CONTACT_EMAIL_ERROR_MESSAGES[code as keyof typeof CONTACT_EMAIL_ERROR_MESSAGES];
  }
  if (error instanceof ApiRequestError) {
    if (error.status === 429) return error.message;
    if (error.status === 409) {
      return "That address is no longer waiting for confirmation. Refresh to see where it stands.";
    }
    if (error.status === 403 && error.message && !error.message.startsWith("API ")) {
      // A suspended or closed account's own explanation (#2147).
      return error.message;
    }
  }
  return GENERIC_CONTACT_EMAIL_ERROR;
}
