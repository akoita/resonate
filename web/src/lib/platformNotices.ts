import {
  getPlatformNotices,
  markPlatformNoticeRead,
  type PlatformNotice,
  type PlatformNoticeList,
  type PlatformNoticeCategory,
} from "./api";

/**
 * #2146: the browser's one view of the signed-in person's platform notices.
 *
 * Two surfaces read it — the notification bell and the shell banner for
 * policy/terms/incident broadcasts — and dismissing the banner is marking the
 * notice read, so both must update together. Module-scoped for the same reason
 * `accountClosureState.ts` is: the readers sit in different trees.
 */
export type PlatformNoticesState = {
  /** The session token the notices were loaded for; null when signed out. */
  token: string | null;
  notices: PlatformNotice[];
  unreadCount: number;
};

const EMPTY: PlatformNoticesState = { token: null, notices: [], unreadCount: 0 };

type Listener = (state: PlatformNoticesState) => void;

let state: PlatformNoticesState = { ...EMPTY };
const listeners = new Set<Listener>();

function publish(next: PlatformNoticesState) {
  state = next;
  for (const listener of listeners) listener(state);
}

export function getPlatformNoticesState(): PlatformNoticesState {
  return state;
}

export function subscribeToPlatformNotices(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Signing out drops the notices so the next account never sees this one's. */
export function resetPlatformNotices() {
  publish({ ...EMPTY });
}

const NOTICE_KINDS: readonly string[] = ["broadcast", "targeted"];
const NOTICE_CATEGORIES: readonly string[] = ["policy", "terms", "incident", "moderation", "account", "refund", "purchase"];

function asNotice(value: unknown): PlatformNotice | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.title !== "string" || typeof raw.body !== "string") return null;
  if (typeof raw.kind !== "string" || !NOTICE_KINDS.includes(raw.kind)) return null;
  if (typeof raw.category !== "string" || !NOTICE_CATEGORIES.includes(raw.category)) return null;
  const text = (field: unknown) => (typeof field === "string" ? field : null);
  return {
    id: raw.id,
    kind: raw.kind as PlatformNotice["kind"],
    category: raw.category as PlatformNoticeCategory,
    title: raw.title,
    body: raw.body,
    link: text(raw.link),
    effectiveAt: text(raw.effectiveAt),
    createdAt: text(raw.createdAt) ?? "",
    readAt: text(raw.readAt),
  };
}

/**
 * The notices response is untrusted input to a surface that renders on every
 * page: anything that is not the expected `{ notices: [...] }` shape (an
 * array, an error body, a half-migrated payload) yields null, and malformed
 * entries are dropped, so a bad answer can never throw during render.
 */
export function normalizePlatformNoticeList(value: unknown): PlatformNoticeList | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.notices)) return null;
  const notices = raw.notices.map(asNotice).filter((notice): notice is PlatformNotice => notice !== null);
  const unreadCount =
    typeof raw.unreadCount === "number" && Number.isFinite(raw.unreadCount) && raw.unreadCount >= 0
      ? Math.floor(raw.unreadCount)
      : notices.filter((notice) => !notice.readAt).length;
  return { notices, unreadCount };
}

/** Load the person's notices. A failed or malformed load keeps what is already shown. */
export async function loadPlatformNotices(token: string | null | undefined) {
  if (!token) {
    resetPlatformNotices();
    return state;
  }
  try {
    const list = normalizePlatformNoticeList(await getPlatformNotices(token));
    if (list) publish({ token, notices: list.notices, unreadCount: list.unreadCount });
  } catch {
    // Keep the previous list; the next poll or bell open retries.
  }
  return state;
}

/**
 * Mark a notice read (dismissing its banner). Optimistic: the banner hides
 * at once; a failed request restores the previous state so nothing is lost.
 */
export async function readPlatformNotice(token: string, noticeId: string) {
  const previous = state;
  const target = previous.notices.find((notice) => notice.id === noticeId);
  if (!target || target.readAt) return;
  const readAt = new Date().toISOString();
  publish({
    ...previous,
    notices: previous.notices.map((notice) => (notice.id === noticeId ? { ...notice, readAt } : notice)),
    unreadCount: Math.max(0, previous.unreadCount - 1),
  });
  try {
    await markPlatformNoticeRead(token, noticeId);
  } catch (error) {
    if (state.token === previous.token) publish(previous);
    throw error;
  }
}

/** Categories that also raise a dismissible banner at the top of the app. */
export const BANNER_NOTICE_CATEGORIES: readonly PlatformNoticeCategory[] = ["policy", "terms", "incident"];

/** The newest unread broadcast that warrants a banner, if any. */
export function selectBannerNotice(notices: readonly PlatformNotice[]): PlatformNotice | null {
  if (!Array.isArray(notices)) return null;
  return (
    notices.find(
      (notice) =>
        notice.kind === "broadcast" && !notice.readAt && BANNER_NOTICE_CATEGORIES.includes(notice.category),
    ) ?? null
  );
}

export const NOTICE_CATEGORY_LABELS: Record<PlatformNoticeCategory, string> = {
  policy: "Policy",
  terms: "Terms",
  incident: "Incident",
  moderation: "Moderation",
  account: "Account",
  refund: "Refund",
  purchase: "Purchase",
};

/** "Takes effect 1 Nov 2026", or null without a valid effective date. */
export function formatNoticeEffectiveDate(effectiveAt: string | null | undefined): string | null {
  if (!effectiveAt) return null;
  const date = new Date(effectiveAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Takes effect ${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}
