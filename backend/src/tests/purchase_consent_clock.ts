/**
 * Test clock for #1776. The delivery gate grandfathers purchases before
 * `PURCHASE_CONSENT_EFFECTIVE_AT`, so a spec that exercises a held delivery
 * needs "now" after it. Fakes only `Date` (never timers), never earlier than
 * the real clock, so database defaults and the real timeouts are unaffected.
 */
import { PURCHASE_CONSENT_EFFECTIVE_AT } from "../modules/purchase_consent/purchase_consent.constants";

const KEEP_REAL = [
  "hrtime",
  "nextTick",
  "performance",
  "queueMicrotask",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "setImmediate",
  "clearImmediate",
  "setInterval",
  "clearInterval",
  "setTimeout",
  "clearTimeout",
] as const;

/** The first instant a purchase can be subject to the consent step, or now if later. */
export function afterConsentCutover(): Date {
  return new Date(Math.max(Date.now(), PURCHASE_CONSENT_EFFECTIVE_AT.getTime() + 30 * 60_000));
}

/** Make `new Date()` / `Date.now()` return a time after the cutover. Call `jest.useRealTimers()` to undo. */
export function useClockAfterConsentCutover(): Date {
  const now = afterConsentCutover();
  jest.useFakeTimers({ now, doNotFake: [...KEEP_REAL] });
  return now;
}
