/**
 * Rate-limit windows, in the unit `@nestjs/throttler` actually uses.
 *
 * **`ttl` is milliseconds, and has been since v5.** The v4 API took seconds,
 * most examples online still do, and nothing fails when you pass `60` — the
 * guard runs, the decorator is present, and the route genuinely rejects the
 * eleventh request, just within the same 60 *milliseconds* rather than the same
 * minute. That is how every limit in this codebase came to be a thousand times
 * shorter than it read (#1790), unnoticed through code review, because a rate
 * limit that never engages looks exactly like one that is never exceeded.
 *
 * Call sites use `seconds(...)` or `minutes(...)` instead of a bare number so
 * the unit is stated where the value is written, and so a future major version
 * that changes it again has one place to change.
 *
 * Verify against the installed version rather than the docs: in
 * `@nestjs/throttler@6`, `ThrottlerStorageService.increment` opens with
 * `const ttlMilliseconds = ttl` and passes it to `setTimeout`.
 */
export function seconds(count: number): number {
  return count * 1_000;
}

export function minutes(count: number): number {
  return seconds(count) * 60;
}

export function hours(count: number): number {
  return minutes(count) * 60;
}

/**
 * The global backstop, applied by `APP_GUARD` to every route without its own
 * `@Throttle`.
 *
 * Deliberately generous, for two reasons. It is tracked per IP, and IP is a
 * poor proxy for a person: carrier-grade NAT, offices and schools put many
 * people behind one address, so a limit sized for one person produces refusals
 * that look like an outage to everybody sharing it. And it guards every route
 * at once, including the dozens a single page of this app calls on load — real
 * browsing generates hundreds of requests a minute without anything being
 * wrong.
 *
 * It exists to stop a runaway client or a crude scraper, not to protect any
 * particular endpoint. Endpoints that need real protection carry their own
 * `@Throttle`, sized for what they cost and what they expose, and the
 * authenticated ones should track per user rather than per IP — see
 * `PrivacyController.exportPersonalData`.
 *
 * The old value read as 100/minute but was never in force, so there is no
 * operational history to preserve here: fixing the unit turns an inert control
 * into a live one, and a live one has to be sized for real traffic rather than
 * inherited from a line that never ran.
 */
export const GLOBAL_RATE_LIMIT = { limit: 1_200, ttl: minutes(1) } as const;

/**
 * Starting a listening or AI DJ session, per listener. A start resolves a
 * seed, records a budget and plans the first picks, so it costs far more than
 * a page load; six a minute is more than anyone restarting by hand needs.
 * Each start route has its own window of this size.
 */
export const SESSION_START_LIMIT = { limit: 6, ttl: minutes(1) } as const;

/**
 * Tracker for routes that should count per signed-in person rather than per
 * address: a household or office behind one NAT would otherwise share one
 * person's budget, and somebody holding a stolen token could rotate addresses
 * to lift the limit.
 *
 * `req.user` is set by `UserAwareThrottlerGuard`, which verifies the bearer
 * token before any tracker runs. Without it the global guard would run before
 * the route's `AuthGuard("jwt")`, and every "per user" limit would silently
 * be per address. A request with no valid token falls back to its address;
 * the route's own `AuthGuard` then rejects it anyway.
 *
 * The prefixes keep a user id and an address from ever sharing a bucket.
 */
export function trackByUser(req: Record<string, any>): string {
  const userId = req.user?.userId;
  if (typeof userId === "string" && userId.length > 0) {
    return `user:${userId}`;
  }
  return `ip:${req.ip}`;
}
