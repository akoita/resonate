import { SetMetadata } from "@nestjs/common";

export const ALLOW_WHILE_SUSPENDED_KEY = "allowWhileSuspended";

/**
 * Marks a mutating handler (or a whole controller) that a suspended or closed
 * account may still call (#2147).
 *
 * Suspension is enforced centrally by `AccountStatusInterceptor`, which refuses
 * every POST/PUT/PATCH/DELETE from a restricted account except the routes
 * carrying this decorator. The allowlist is therefore opt-in and visible at the
 * handler, and `account_status_allowlist.spec.ts` pins the exact set of routes
 * that carry it. Add it only where blocking the route would trap a person's
 * money or their rights over their own data (sign-in, refund claims, data
 * export and erasure, reading notices), or where it is plain listening: playback
 * and DJ-session routes (#2167). Listening harms no one, but a play from a
 * restricted account is never counted (see `AccountStandingService.isRestricted`).
 */
export const AllowWhileSuspended = () => SetMetadata(ALLOW_WHILE_SUSPENDED_KEY, true);
