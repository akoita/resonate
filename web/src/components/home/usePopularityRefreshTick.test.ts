import { describe, expect, it } from "vitest";
import {
  POPULARITY_OVERDUE_GIVE_UP_MS,
  POPULARITY_OVERDUE_RETRY_MS,
  POPULARITY_SNAPSHOT_GRACE_MS,
  POPULARITY_SNAPSHOT_PERIOD_MS,
  POPULARITY_STALE_AFTER_MS,
  createPopularityRefreshScheduler,
  nextSnapshotCheckDelay,
} from "./usePopularityRefreshTick";

function setup() {
  const state = { now: 0, visible: true, refreshes: 0 };
  const scheduler = createPopularityRefreshScheduler({
    now: () => state.now,
    isVisible: () => state.visible,
    onRefresh: () => {
      state.refreshes += 1;
    },
  });
  return { state, scheduler };
}

describe("popularity rail refresh scheduler", () => {
  it("refreshes on the interval while the tab is visible", () => {
    const { state, scheduler } = setup();
    scheduler.onInterval();
    expect(state.refreshes).toBe(1);
  });

  it("does not refresh on the interval while the tab is hidden", () => {
    const { state, scheduler } = setup();
    state.visible = false;
    scheduler.onInterval();
    expect(state.refreshes).toBe(0);
  });

  it("refreshes on return only when the rails are stale", () => {
    const { state, scheduler } = setup();
    state.now = 60_000;
    scheduler.onVisibilityChange();
    expect(state.refreshes).toBe(0);

    state.now = POPULARITY_STALE_AFTER_MS;
    scheduler.onVisibilityChange();
    expect(state.refreshes).toBe(1);

    // The return refresh resets staleness.
    state.now = POPULARITY_STALE_AFTER_MS + 60_000;
    scheduler.onVisibilityChange();
    expect(state.refreshes).toBe(1);
  });

  it("ignores becoming hidden", () => {
    const { state, scheduler } = setup();
    state.visible = false;
    state.now = POPULARITY_STALE_AFTER_MS * 2;
    scheduler.onVisibilityChange();
    expect(state.refreshes).toBe(0);
  });

  it("refreshes when a snapshot is due while visible", () => {
    const { state, scheduler } = setup();
    scheduler.onSnapshotDue();
    expect(state.refreshes).toBe(1);
  });

  it("refreshes on return when a snapshot came due while hidden, however recent the rails", () => {
    const { state, scheduler } = setup();
    state.visible = false;
    scheduler.onSnapshotDue();
    expect(state.refreshes).toBe(0);
    state.visible = true;
    state.now = 60_000;
    scheduler.onVisibilityChange();
    expect(state.refreshes).toBe(1);
  });
});

describe("next snapshot check", () => {
  const computedAt = "2026-11-24T01:25:39.000Z";
  const computedMs = Date.parse(computedAt);

  it("aims just after the next hourly snapshot is served", () => {
    expect(nextSnapshotCheckDelay(computedAt, computedMs + 10 * 60_000)).toBe(
      POPULARITY_SNAPSHOT_PERIOD_MS + POPULARITY_SNAPSHOT_GRACE_MS - 10 * 60_000,
    );
  });

  it("retries shortly while the next snapshot is overdue", () => {
    expect(nextSnapshotCheckDelay(computedAt, computedMs + 70 * 60_000)).toBe(POPULARITY_OVERDUE_RETRY_MS);
  });

  it("gives up when the rebuild looks down, or without a timestamp", () => {
    expect(nextSnapshotCheckDelay(computedAt, computedMs + POPULARITY_OVERDUE_GIVE_UP_MS)).toBeNull();
    expect(nextSnapshotCheckDelay(null, computedMs)).toBeNull();
    expect(nextSnapshotCheckDelay("not a date", computedMs)).toBeNull();
    expect(nextSnapshotCheckDelay(computedAt, computedMs - 1)).toBeNull();
  });
});
