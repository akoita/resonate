"use client";

import { useEffect } from "react";
import { startIdleAnimationGuard } from "../../lib/idleAnimationGuard";

/**
 * Holds decorative infinite animations still while they are off-screen or the
 * tab is hidden (#2436). Mounted once in the root layout; renders nothing.
 */
export function IdleAnimationGuard() {
  useEffect(() => startIdleAnimationGuard(), []);
  return null;
}
