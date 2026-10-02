/**
 * Crate watching rules the page shows (#1967). Plain functions, so they are
 * unit tested without rendering. The server decides who may watch
 * (`entitlements.watch`) and what is in effect (`watch.mode`); nothing here
 * hard-codes either.
 */
import type { CrateEntitlementDecision, CrateWatch, CrateWatchMatch } from "./crates";

/** The lengths the page offers; the API accepts any whole number of days 1-365. */
export const WATCH_DURATIONS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "180 days" },
  { days: 365, label: "1 year" },
] as const;

export const DEFAULT_WATCH_DAYS = 90;

/** Most match notifications a person gets per day; every match still shows on the crate. */
export const WATCH_NOTIFICATIONS_PER_DAY = 20;

/** `Dec 31, 2026`, in UTC so the date does not move with the viewer's time zone. */
export function formatWatchDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * What the watch control shows. A draft crate cannot watch; a crate whose
 * `watch` entitlement is denied shows a plain Crate Pro note instead of the
 * control (turning watching off stays possible through `watch.mode`).
 */
export type WatchAvailability = "draft" | "denied" | "available";

export function watchAvailability(input: {
  status: string;
  watchEntitlement: CrateEntitlementDecision | undefined;
}): WatchAvailability {
  if (input.status !== "saved") return "draft";
  // A missing decision is treated as not allowed: never guess a permission.
  if (input.watchEntitlement?.allowed !== true) return "denied";
  return "available";
}

/** The one line that says what is happening now. */
export function watchStatusText(watch: CrateWatch): string {
  if (watch.mode === "notify") {
    const until = formatWatchDate(watch.expiresAt);
    return until ? `Watching until ${until}` : "Watching";
  }
  const ended = formatWatchDate(watch.expiresAt);
  return ended ? `Watching ended ${ended}` : "Not watching";
}

/** "3 new matches this month". */
export function watchSummaryText(summary: CrateWatch["summary"]): string {
  const { matches } = summary;
  if (matches <= 0) return "No new matches this month yet";
  return `${matches} new ${matches === 1 ? "match" : "matches"} this month`;
}

/** Explains matches that did not send a notification; null when all did. */
export function watchNotifiedNote(summary: CrateWatch["summary"]): string | null {
  if (summary.matches <= summary.notified) return null;
  return `${summary.notified} of ${summary.matches} sent a notification. You get at most ${WATCH_NOTIFICATIONS_PER_DAY} a day, and every match still shows here.`;
}

/** `Track by Artist`, or just the title when the artist is unknown. */
export function watchMatchLabel(match: Pick<CrateWatchMatch, "title" | "artistName">): string {
  const artist = match.artistName?.trim();
  return artist ? `${match.title} by ${artist}` : match.title;
}

/** Where a match leads: its release page, or nothing when that is unknown. */
export function watchMatchHref(match: Pick<CrateWatchMatch, "releaseId">): string | null {
  return match.releaseId ? `/release/${encodeURIComponent(match.releaseId)}` : null;
}
