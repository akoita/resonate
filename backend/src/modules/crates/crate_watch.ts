import type { CrateCandidateFacts, CrateFilters } from "./crate.types";
import { failedFilters, isExcludedAsFullyAi } from "./crate_selection";

/**
 * Crate watching, the pure core (#1967): which watch requests are valid, which
 * newly playable tracks fit a watching crate, how many notifications a person
 * may still receive, and the notification copy.
 *
 * Pure: the caller loads the facts, the crates and the notification counts;
 * nothing here reads a database or the clock (callers pass `now`). The service
 * (`crate_watch.service.ts`) does the loading and writing.
 *
 * Watching only NOTIFIES. Nothing here buys, quotes or reserves anything;
 * `"auto_buy"` is a reserved mode name that no code path accepts yet.
 *
 * Business model: ADR-BM-6 Line 3 (marketplace take-rate), phase 2: a match
 * leads the DJ to a quoted purchase they approve (ADR-TE-1). No fee change.
 */

/** Watch modes the API accepts today. */
export const CRATE_WATCH_MODES = ["off", "notify"] as const;
export type CrateWatchMode = (typeof CRATE_WATCH_MODES)[number];

/** Reserved for a later slice; accepted by the DTO, refused by validation. */
export const CRATE_WATCH_RESERVED_MODES = ["auto_buy"] as const;

/** Every mode name the DTO lets through, so a reserved one gets its own code. */
export const CRATE_WATCH_DTO_MODES = [...CRATE_WATCH_MODES, ...CRATE_WATCH_RESERVED_MODES] as const;

/** Watching stops by itself after this many days unless the DJ picks another. */
export const CRATE_WATCH_DEFAULT_DAYS = 90;
export const CRATE_WATCH_MIN_DAYS = 1;
export const CRATE_WATCH_MAX_DAYS = 365;

/** Most watching crates one newly playable track is evaluated against. */
export const CRATE_WATCH_MAX_CRATES_PER_EVENT = 500;

/** Most match notifications one person receives per rolling 24 hours. */
export const CRATE_WATCH_NOTIFICATIONS_PER_DAY = 20;
export const CRATE_WATCH_NOTIFICATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Most matches `GET /crates/:id` lists. */
export const CRATE_WATCH_RECENT_MATCHES_LIMIT = 20;

/** The notification type the web renders with a link to the crate. */
export const CRATE_WATCH_NOTIFICATION_TYPE = "crate_watch_match" as const;

/** Fixed codes for 400 and 409 responses; never echo the input. */
export const CRATE_WATCH_ERROR_CODES = {
  invalidWatch: "invalid_watch",
  invalidMode: "invalid_watch_mode",
  modeUnavailable: "watch_mode_unavailable",
  invalidExpiry: "invalid_watch_expiry",
  crateNotSaved: "crate_not_saved",
} as const;

export type CrateWatchRequestError =
  | typeof CRATE_WATCH_ERROR_CODES.invalidWatch
  | typeof CRATE_WATCH_ERROR_CODES.invalidMode
  | typeof CRATE_WATCH_ERROR_CODES.modeUnavailable
  | typeof CRATE_WATCH_ERROR_CODES.invalidExpiry;

export type CrateWatchRequest =
  | { ok: true; mode: CrateWatchMode; expiresInDays: number }
  | { ok: false; code: CrateWatchRequestError };

/**
 * Validates the `watch` member of `PATCH /crates/:id`. `expiresInDays` is a
 * whole number from 1 to 365 and defaults to 90; it is ignored for `"off"`.
 * `"auto_buy"` is reserved and refused with `watch_mode_unavailable`.
 */
export function parseWatchRequest(input: unknown): CrateWatchRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, code: CRATE_WATCH_ERROR_CODES.invalidWatch };
  }
  const { mode, expiresInDays } = input as { mode?: unknown; expiresInDays?: unknown };
  if (typeof mode === "string" && (CRATE_WATCH_RESERVED_MODES as readonly string[]).includes(mode)) {
    return { ok: false, code: CRATE_WATCH_ERROR_CODES.modeUnavailable };
  }
  if (typeof mode !== "string" || !(CRATE_WATCH_MODES as readonly string[]).includes(mode)) {
    return { ok: false, code: CRATE_WATCH_ERROR_CODES.invalidMode };
  }
  if (expiresInDays === undefined || expiresInDays === null) {
    return { ok: true, mode: mode as CrateWatchMode, expiresInDays: CRATE_WATCH_DEFAULT_DAYS };
  }
  if (
    typeof expiresInDays !== "number"
    || !Number.isInteger(expiresInDays)
    || expiresInDays < CRATE_WATCH_MIN_DAYS
    || expiresInDays > CRATE_WATCH_MAX_DAYS
  ) {
    return { ok: false, code: CRATE_WATCH_ERROR_CODES.invalidExpiry };
  }
  return { ok: true, mode: mode as CrateWatchMode, expiresInDays };
}

/** When watching started now ends: `days` whole days later. */
export function watchExpiresAt(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Whether a crate with this stored watch state is watching at `now`. */
export function isWatching(
  crate: { watchMode: string; watchExpiresAt: Date | null },
  now: Date,
): boolean {
  return (
    crate.watchMode === "notify"
    && crate.watchExpiresAt !== null
    && crate.watchExpiresAt.getTime() > now.getTime()
  );
}

/** Why a newly playable track did or did not match a watching crate. */
export type CrateWatchVerdict =
  | "match"
  | "own_track"
  | "already_in_crate"
  | "fully_ai"
  | "filters";

/**
 * Whether one newly playable track fits one watching crate.
 *
 * - The crate owner's own releases never notify them (`own_track`).
 * - A track already in the crate is not news (`already_in_crate`).
 * - Fully AI recordings are excluded unless the crate allows them (`fully_ai`).
 * - Otherwise the track matches when it fails no filter. `count` and
 *   `maxTotalUsd` constrain a whole crate, not one track, and
 *   {@link failedFilters} does not evaluate them. Unknown facts never pass: a
 *   track with no measured tempo fails a BPM filter.
 */
export function evaluateWatchMatch(input: {
  facts: CrateCandidateFacts;
  filters: CrateFilters;
  crateTrackIds: ReadonlySet<string>;
  /** The crate owner's user id. */
  crateUserId: string;
  /** The user id of the track's artist, when the artist has an account. */
  artistUserId: string | null;
}): CrateWatchVerdict {
  if (input.artistUserId !== null && input.artistUserId === input.crateUserId) return "own_track";
  if (input.crateTrackIds.has(input.facts.trackId)) return "already_in_crate";
  if (isExcludedAsFullyAi(input.facts, input.filters)) return "fully_ai";
  if (failedFilters(input.facts, input.filters).length > 0) return "filters";
  return "match";
}

/** How many more match notifications a person may receive in the window. */
export function notificationsRemaining(sentInWindow: number): number {
  return Math.max(0, CRATE_WATCH_NOTIFICATIONS_PER_DAY - Math.max(0, Math.floor(sentInWindow)));
}

/** The start of the rolling window that ends at `now`. */
export function notificationWindowStart(now: Date): Date {
  return new Date(now.getTime() - CRATE_WATCH_NOTIFICATION_WINDOW_MS);
}

/** `YYYY-MM` of a date in UTC: the month the crate summary counts. */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** The UTC start and (exclusive) end of the month containing `date`. */
export function monthBounds(date: Date): { start: Date; end: Date } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
  };
}

/**
 * The notification copy. The crate and track titles are shown as typed (the
 * crate title is the DJ's own; the track title is public catalog data); a
 * missing crate title reads "your crate", a missing artist is left out.
 */
export function watchNotificationCopy(input: {
  crateTitle: string | null;
  trackTitle: string;
  artistName: string | null;
}): { title: string; message: string } {
  const crateTitle = input.crateTitle?.trim();
  const artist = input.artistName?.trim();
  return {
    title: `New match for ${crateTitle ? crateTitle : "your crate"}`,
    message: `${input.trackTitle}${artist ? ` by ${artist}` : ""} fits your crate filters.`,
  };
}
