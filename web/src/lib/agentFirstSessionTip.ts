/**
 * The one-time AI DJ hint after the first finished session (#2327). Pure apart from the
 * browser's own storage, which can be missing or refuse access (private modes, blocked
 * cookies, quota): every access is guarded, and a failure never breaks the page.
 *
 * Dismissal lives in this browser only (localStorage). The server never learns that a listener
 * saw or dismissed a tip.
 */

export const FIRST_SESSION_TIP_STORAGE_KEY = "resonate.dj.firstSessionTipDismissed";

/** The example the tip suggests; the parser reads it fully (see `agentFirstSessionTip.test.ts`). */
export const FIRST_SESSION_TIP_EXAMPLE = "Afrobeats, chill";

/**
 * Whether the tip should stay hidden. When storage cannot be read, the answer is "dismissed":
 * a tip that cannot be remembered would otherwise come back on every visit.
 */
export function isFirstSessionTipDismissed(): boolean {
    try {
        return globalThis.localStorage.getItem(FIRST_SESSION_TIP_STORAGE_KEY) !== null;
    } catch {
        return true;
    }
}

/** Remember that the tip is gone. A storage failure is ignored: the caller hides it for this view anyway. */
export function dismissFirstSessionTip(): void {
    try {
        globalThis.localStorage.setItem(FIRST_SESSION_TIP_STORAGE_KEY, "1");
    } catch {
        // Nothing to do: the tip stays hidden for this page view only.
    }
}
