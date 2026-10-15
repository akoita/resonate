import {
  getPlatformNotices,
  markPlatformNoticeRead,
  type PlatformNotice,
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

/** Load the person's notices. A failed load keeps what is already shown. */
export async function loadPlatformNotices(token: string | null | undefined) {
  if (!token) {
    resetPlatformNotices();
    return state;
  }
  try {
    const list = await getPlatformNotices(token);
    publish({ token, notices: list.notices, unreadCount: list.unreadCount });
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
};

/** "Takes effect 1 Nov 2026", or null without a valid effective date. */
export function formatNoticeEffectiveDate(effectiveAt: string | null | undefined): string | null {
  if (!effectiveAt) return null;
  const date = new Date(effectiveAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Takes effect ${date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}
