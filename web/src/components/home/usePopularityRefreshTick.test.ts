import { describe, expect, it } from "vitest";
import {
  POPULARITY_STALE_AFTER_MS,
  createPopularityRefreshScheduler,
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
});
