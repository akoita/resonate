import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerVisibleInterval, type VisibilityTarget } from "./visibleInterval";

function fakeVisibility(initial: DocumentVisibilityState = "visible") {
  let state = initial;
  const listeners = new Set<EventListener>();
  const target = {
    get visibilityState() {
      return state;
    },
    addEventListener: (_type: string, listener: EventListener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: EventListener) => listeners.delete(listener),
  } as unknown as VisibilityTarget;
  const set = (next: DocumentVisibilityState) => {
    state = next;
    listeners.forEach((listener) => listener(new Event("visibilitychange")));
  };
  return { target, set, listeners };
}

describe("registerVisibleInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks at the visible cadence and does not run on registration", () => {
    const { target } = fakeVisibility();
    const callback = vi.fn();
    const cleanup = registerVisibleInterval(callback, 1000, { visibilityTarget: target });

    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(callback).toHaveBeenCalledTimes(3);
    cleanup();
  });

  it("pauses while hidden and catches up once when visible again", () => {
    const visibility = fakeVisibility();
    const callback = vi.fn();
    const cleanup = registerVisibleInterval(callback, 1000, { visibilityTarget: visibility.target });

    visibility.set("hidden");
    vi.advanceTimersByTime(60_000);
    expect(callback).not.toHaveBeenCalled();

    visibility.set("visible");
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("backs off to the hidden cadence when one is given", () => {
    const visibility = fakeVisibility("hidden");
    const callback = vi.fn();
    const cleanup = registerVisibleInterval(callback, 1000, {
      hiddenIntervalMs: 10_000,
      visibilityTarget: visibility.target,
    });

    vi.advanceTimersByTime(25_000);
    expect(callback).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("can resume without an immediate catch-up run", () => {
    const visibility = fakeVisibility();
    const callback = vi.fn();
    const cleanup = registerVisibleInterval(callback, 1000, {
      runOnVisible: false,
      visibilityTarget: visibility.target,
    });

    visibility.set("hidden");
    visibility.set("visible");
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("stops ticking and listening after cleanup", () => {
    const visibility = fakeVisibility();
    const callback = vi.fn();
    const cleanup = registerVisibleInterval(callback, 1000, { visibilityTarget: visibility.target });

    cleanup();
    expect(visibility.listeners.size).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(callback).not.toHaveBeenCalled();
  });
});
