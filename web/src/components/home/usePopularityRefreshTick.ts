"use client";

import { useEffect, useState } from "react";

/** The warehouse rebuilds the popularity snapshot about hourly. */
export const POPULARITY_REFRESH_INTERVAL_MS = 15 * 60_000;
/** Returning to the tab refetches only when the rails are at least this old. */
export const POPULARITY_STALE_AFTER_MS = 5 * 60_000;

export interface PopularityRefreshScheduler {
  /** Call on every interval tick. */
  onInterval(): void;
  /** Call on every `visibilitychange`. */
  onVisibilityChange(): void;
}

/**
 * Decides when Home's chart rails are fetched again: on each interval tick
 * while the tab is visible, and when the listener returns to a tab whose rails
 * are stale. Kept free of React and the DOM so the rules are unit-testable.
 */
export function createPopularityRefreshScheduler(options: {
  now: () => number;
  isVisible: () => boolean;
  onRefresh: () => void;
  staleAfterMs?: number;
}): PopularityRefreshScheduler {
  const staleAfterMs = options.staleAfterMs ?? POPULARITY_STALE_AFTER_MS;
  let lastRefreshAt = options.now();
  const refresh = () => {
    lastRefreshAt = options.now();
    options.onRefresh();
  };
  return {
    onInterval() {
      if (options.isVisible()) refresh();
    },
    onVisibilityChange() {
      if (options.isVisible() && options.now() - lastRefreshAt >= staleAfterMs) refresh();
    },
  };
}

/**
 * A counter that advances when Home's chart rails should be fetched again.
 * Without it, a tab opened before the hourly snapshot keeps showing the
 * previous ranking, so two windows open side by side can disagree.
 */
export function usePopularityRefreshTick(
  intervalMs = POPULARITY_REFRESH_INTERVAL_MS,
): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const scheduler = createPopularityRefreshScheduler({
      now: () => Date.now(),
      isVisible: () => document.visibilityState === "visible",
      onRefresh: () => setTick((value) => value + 1),
    });
    const timer = window.setInterval(() => scheduler.onInterval(), intervalMs);
    const onVisibility = () => scheduler.onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);

  return tick;
}
