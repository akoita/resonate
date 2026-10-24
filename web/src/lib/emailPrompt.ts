import type { ContactEmailState, PlatformNotice, PlatformNoticeCategory } from "./api";

/**
 * #2182: the optional invitation to add an email address for platform notices.
 *
 * Email stays optional (Resonate is wallet-first): nothing here ever blocks a
 * flow or is required for any role. A prompt is a small dismissible card that
 * appears only where an email would plainly help, only while the person has no
 * address on file, and never again once they have dismissed it. This module is
 * the rules and the words; `EmailPromptCard` renders them.
 *
 * Dismissals live in this browser (localStorage), per account and per
 * moment. The server has no preference field for them and never learns that a
 * prompt was shown or dismissed (beyond the consent-gated counts below).
 */

/** The moments a prompt can appear. */
export const EMAIL_PROMPT_CONTEXTS = [
  /** First session on Home: the optional step with the address form inline. */
  "onboarding",
  /** After a Shows pledge is confirmed. */
  "pledge",
  /** After an artist's first listing or sale. */
  "artist_listing",
  /** Unread account or refund notices that have waited a few days. */
  "stale_notices",
] as const;

export type EmailPromptContext = (typeof EMAIL_PROMPT_CONTEXTS)[number];

/** Where the full Email notices flow lives (double opt-in, categories). */
export const EMAIL_PROMPT_SETTINGS_HREF = "/settings?section=email";

/** How long an account or refund notice may sit unread before we suggest email. */
export const STALE_NOTICE_DAYS = 3;

/** The notices an email is genuinely useful for: ones a person may need to act on. */
export const STALE_NOTICE_CATEGORIES: readonly PlatformNoticeCategory[] = ["account", "refund"];

export type EmailPromptCopy = { heading: string; body: string };

export const EMAIL_PROMPT_COPY: Record<EmailPromptContext, EmailPromptCopy> = {
  onboarding: {
    heading: "Want important notices by email too?",
    body: "Refunds owed, account decisions, terms changes. It's optional: everything also stays in the app.",
  },
  pledge: {
    heading: "Get an email if a refund is ever owed to you",
    body: "If a show you backed does not go ahead, a refund can be waiting for you. Add an email and we will tell you. It's optional.",
  },
  artist_listing: {
    heading: "Want important account notices by email too?",
    body: "Decisions about your account or releases, and changes to the terms. It's optional: everything also stays in the app.",
  },
  stale_notices: {
    heading: "Missed a notice? Get these by email too",
    body: "You have account or refund notices you have not opened yet. We can also email them to you if you add an address. It's optional.",
  },
};

/** Said wherever an address is typed, so nobody has to open Settings to learn it. */
export const EMAIL_PROMPT_DISCLOSURE =
  "Adding an address links it to your account, and so to your wallet, in our records only. It is never shown publicly or put on-chain, only used for platform notices, never marketing, and you can remove it any time.";

export function emailPromptStorageKey(userId: string, context: EmailPromptContext): string {
  return `resonate.emailPrompt.dismissed.${userId}.${context}`;
}

/**
 * Whether this person has dismissed this prompt in this browser. When storage
 * cannot be read the answer is "dismissed": a prompt that cannot be remembered
 * would otherwise come back on every visit.
 */
export function isEmailPromptDismissed(userId: string, context: EmailPromptContext): boolean {
  try {
    return globalThis.localStorage.getItem(emailPromptStorageKey(userId, context)) !== null;
  } catch {
    return true;
  }
}

/** Remember the dismissal. A storage failure is ignored: the caller hides the card for this view anyway. */
export function dismissEmailPrompt(userId: string, context: EmailPromptContext): void {
  try {
    globalThis.localStorage.setItem(emailPromptStorageKey(userId, context), "1");
  } catch {
    // Nothing to do: the prompt stays hidden for this page view only.
  }
}

/**
 * A prompt shows only when email is configured on this deployment and the
 * person has no address on file yet. Someone who already added one (pending
 * confirmation included), or whose address was stopped (bounce, complaint) and
 * is explained in Settings, is not asked again.
 */
export function shouldShowEmailPrompt(input: {
  contact: Pick<ContactEmailState, "available" | "status"> | null;
  dismissed: boolean;
}): boolean {
  const { contact, dismissed } = input;
  if (dismissed || !contact) return false;
  return contact.available && contact.status === "none";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Unread account or refund notices older than `days`. */
export function selectStaleUnreadNotices(
  notices: readonly PlatformNotice[],
  nowMs: number,
  days: number = STALE_NOTICE_DAYS,
): PlatformNotice[] {
  return notices.filter((notice) => {
    if (notice.readAt) return false;
    if (!STALE_NOTICE_CATEGORIES.includes(notice.category)) return false;
    const created = Date.parse(notice.createdAt);
    if (Number.isNaN(created)) return false;
    return nowMs - created >= days * DAY_MS;
  });
}
