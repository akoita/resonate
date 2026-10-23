import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * `false` in server-rendered HTML and until the client has hydrated, `true`
 * afterwards (and `true` straight away for a component that only renders on the
 * client, e.g. after a client-side navigation).
 *
 * Use it for markup that must exist exactly once in the live document. React
 * streams a statically prerendered page into a hidden `<div hidden id="S:n">`
 * segment and only moves it into place after a reveal throttle (up to ~300ms
 * after first paint). When hydration finishes inside that window React renders
 * the boundary on the client instead, so for a short while the server copy and
 * the client copy are both in the DOM. A unique `id` rendered unconditionally
 * on the server is therefore briefly duplicated (#2254 follow-up).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
