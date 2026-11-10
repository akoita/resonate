"use client";

import { useEffect } from "react";
import { startIdleAnimationGuard } from "../../lib/idleAnimationGuard";
import { whenPageSettled } from "../../lib/pageSettle";

/** Decorative loops wait for the page to settle after loading. */
function settle(onSettled: () => void) {
  let live = true;
  void whenPageSettled().then(() => {
    if (live) onSettled();
  });
  return () => {
    live = false;
  };
}

/**
 * Holds decorative infinite animations still while they are off-screen, the
 * tab is hidden, nobody has touched the page for a while (#2436), or the page
 * is still loading. Mounted once in the root layout; renders nothing.
 */
export function IdleAnimationGuard() {
  useEffect(() => startIdleAnimationGuard({ settle }), []);
  return null;
}
