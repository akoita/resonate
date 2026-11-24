"use client";

import { useEffect, useRef, useState } from "react";

import { registerVisibleInterval } from "@/lib/visibleInterval";

/** Fallback refetch cadence while Home stays open and visible. */
export const POPULARITY_REFRESH_INTERVAL_MS = 15 * 60_000;
/** Returning to the tab refetches only when the rails are at least this old. */
export const POPULARITY_STALE_AFTER_MS = 5 * 60_000;
/** The warehouse rebuilds the popularity snapshot about hourly. */
export const POPULARITY_SNAPSHOT_PERIOD_MS = 60 * 60_000;
/** Time the hourly rebuild and export take before the new snapshot is served. */
export const POPULARITY_SNAPSHOT_GRACE_MS = 3 * 60_000;
/** While the next snapshot is overdue, look again this often. */
export const POPULARITY_OVERDUE_RETRY_MS = 2 * 60_000;
/** A snapshot this old means the rebuild is down: fall back to the interval. */
export const POPULARITY_OVERDUE_GIVE_UP_MS = 3 * POPULARITY_SNAPSHOT_PERIOD_MS;

/**
 * How long to wait before fetching the rails again so that they pick up the
 * next hourly snapshot as soon as it is served, given when the current one was
 * computed. Every open tab aims at the same moment, so two windows stop
 * disagreeing for up to a whole interval after each rebuild. `null` when there
 * is no usable timestamp or the rebuild looks down.
 */
export function nextSnapshotCheckDelay(computedAt: string | null | undefined, now: number): number | null {
  if (!computedAt) return null;
  const computedMs = Date.parse(computedAt);
  if (!Number.isFinite(computedMs)) return null;
  const age = now - computedMs;
  if (age < 0 || age >= POPULARITY_OVERDUE_GIVE_UP_MS) return null;
  const dueIn = POPULARITY_SNAPSHOT_PERIOD_MS + POPULARITY_SNAPSHOT_GRACE_MS - age;
  return dueIn > 0 ? dueIn : POPULARITY_OVERDUE_RETRY_MS;
}

export interface PopularityRefreshScheduler {
  /** Call on every interval tick. */
  onInterval(): void;
  /** Call when the next snapshot should be served. */
  onSnapshotDue(): void;
  /** Call on every `visibilitychange`. */
  onVisibilityChange(): void;
}

/**
 * Decides when Home's chart rails are fetched again: on each interval tick
 * and when a new snapshot is due, while the tab is visible; and when the
 * listener returns to a tab whose rails are stale or that missed a snapshot.
 * Kept free of React and the DOM so the rules are unit-testable.
 */
export function createPopularityRefreshScheduler(options: {
  now: () => number;
  isVisible: () => boolean;
  onRefresh: () => void;
  staleAfterMs?: number;
}): PopularityRefreshScheduler {
  const staleAfterMs = options.staleAfterMs ?? POPULARITY_STALE_AFTER_MS;
  let lastRefreshAt = options.now();
  let snapshotMissed = false;
  const refresh = () => {
    lastRefreshAt = options.now();
    snapshotMissed = false;
    options.onRefresh();
  };
  return {
    onInterval() {
      if (options.isVisible()) refresh();
    },
    onSnapshotDue() {
      if (options.isVisible()) refresh();
      else snapshotMissed = true;
    },
    onVisibilityChange() {
      if (!options.isVisible()) return;
      if (snapshotMissed || options.now() - lastRefreshAt >= staleAfterMs) refresh();
    },
  };
}

/**
 * A counter that advances when Home's chart rails should be fetched again.
 * Without it, a tab opened before the hourly snapshot keeps showing the
 * previous ranking, so two windows open side by side can disagree.
 *
 * `snapshotComputedAt` is the `computedAt` of the rails last shown; the hook
 * refetches right after the next hourly snapshot should be served.
 */
export function usePopularityRefreshTick(
  snapshotComputedAt: string | null = null,
  intervalMs = POPULARITY_REFRESH_INTERVAL_MS,
): number {
  const [tick, setTick] = useState(0);
  const schedulerRef = useRef<PopularityRefreshScheduler | null>(null);

  useEffect(() => {
    const scheduler = createPopularityRefreshScheduler({
      now: () => Date.now(),
      isVisible: () => document.visibilityState === "visible",
      onRefresh: () => setTick((value) => value + 1),
    });
    schedulerRef.current = scheduler;
    // Paused while hidden; returning to the tab refetches only when stale or
    // a snapshot was missed, which the scheduler decides, so the helper must
    // not run on show.
    const stopInterval = registerVisibleInterval(() => scheduler.onInterval(), intervalMs, {
      runOnVisible: false,
    });
    const onVisibility = () => scheduler.onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", onVisibility);
      schedulerRef.current = null;
    };
  }, [intervalMs]);

  useEffect(() => {
    // Re-armed after every fetch (tick), so an overdue snapshot is retried.
    const delay = nextSnapshotCheckDelay(snapshotComputedAt, Date.now());
    if (delay === null) return;
    const timer = window.setTimeout(() => schedulerRef.current?.onSnapshotDue(), delay);
    return () => window.clearTimeout(timer);
  }, [snapshotComputedAt, tick]);

  return tick;
}
