/**
 * Small pure helpers for the Usage & Billing surface (#1422): reset-time and
 * window labels shared by the usage-limit meter and the Settings page.
 */

/**
 * Human-readable "resets in …" label from an ISO timestamp. Returns "—" when
 * there is no active window (`resetsAt` is null or unparseable), "resets now"
 * when the window has already lapsed, and otherwise a coarse relative span like
 * "resets in 42 min" or "resets in 2h 5min".
 *
 * @param resetsAt ISO timestamp, or null when the limiter is idle.
 * @param now      Reference time in ms (defaults to `Date.now()`); injectable
 *                 for deterministic tests.
 */
export function formatResetIn(resetsAt: string | null, now: number = Date.now()): string {
  if (!resetsAt) return "—";
  const target = new Date(resetsAt).getTime();
  if (Number.isNaN(target)) return "—";
  const deltaMs = target - now;
  if (deltaMs <= 0) return "resets now";
  const totalMinutes = Math.ceil(deltaMs / 60_000);
  if (totalMinutes < 60) return `resets in ${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `resets in ${days}d ${remHours}h` : `resets in ${days}d`;
  }
  return minutes > 0 ? `resets in ${hours}h ${minutes}min` : `resets in ${hours}h`;
}

/** "hour", "30 min", "6 h", "2 days" — the length of a usage-limit window. */
export function formatWindow(windowSeconds: number): string {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return "window";
  if (windowSeconds === 3600) return "hour";
  if (windowSeconds === 86_400) return "day";
  if (windowSeconds < 3600) return `${Math.round(windowSeconds / 60)} min`;
  if (windowSeconds < 86_400) return `${Math.round(windowSeconds / 3600)} h`;
  return `${Math.round(windowSeconds / 86_400)} days`;
}

/** Cents as dollars, e.g. 125 -> "$1.25". */
export function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return "—";
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}
