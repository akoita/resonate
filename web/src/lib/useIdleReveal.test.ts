import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Mirrors the minimal hook runtime used by useImmersiveMode.test.tsx: this
 * project drives lib hooks directly rather than through a DOM renderer. */
const hookRuntime = vi.hoisted(() => {
  type Effect = () => void | (() => void);
  type EffectSlot = { cleanup?: () => void; deps?: readonly unknown[]; pending?: Effect };

  const state: unknown[] = [];
  const refs: { current: unknown }[] = [];
  const effects: EffectSlot[] = [];
  let stateCursor = 0;
  let refCursor = 0;
  let effectCursor = 0;

  const depsChanged = (previous?: readonly unknown[], next?: readonly unknown[]) =>
    !previous || !next ||
    previous.length !== next.length ||
    previous.some((value, index) => !Object.is(value, next[index]));

  return {
    beginRender() {
      stateCursor = 0;
      refCursor = 0;
      effectCursor = 0;
    },
    useState<T>(initial: T) {
      const index = stateCursor++;
      if (state.length <= index) state[index] = initial;
      const setState = (next: T | ((current: T) => T)) => {
        const current = state[index] as T;
        state[index] = typeof next === "function"
          ? (next as (value: T) => T)(current)
          : next;
      };
      return [state[index] as T, setState] as const;
    },
    useRef<T>(initial: T) {
      const index = refCursor++;
      if (refs.length <= index) refs[index] = { current: initial };
      return refs[index] as { current: T };
    },
    useEffect(effect: Effect, deps?: readonly unknown[]) {
      const index = effectCursor++;
      const slot = effects[index] ?? {};
      if (depsChanged(slot.deps, deps)) {
        slot.cleanup?.();
        slot.deps = deps;
        slot.pending = effect;
      }
      effects[index] = slot;
    },
    flushEffects() {
      for (const slot of effects) {
        if (!slot.pending) continue;
        const pending = slot.pending;
        slot.pending = undefined;
        slot.cleanup = pending() ?? undefined;
      }
    },
    reset() {
      for (const slot of effects) slot.cleanup?.();
      state.length = 0;
      refs.length = 0;
      effects.length = 0;
      stateCursor = 0;
      refCursor = 0;
      effectCursor = 0;
    },
  };
});

vi.mock("react", () => ({
  useEffect: hookRuntime.useEffect,
  useState: hookRuntime.useState,
  useRef: hookRuntime.useRef,
}));

import { useIdleReveal } from "./useIdleReveal";

function HookHarness(enabled: boolean, delayMs?: number) {
  hookRuntime.beginRender();
  const result = useIdleReveal(enabled, delayMs);
  hookRuntime.flushEffects();
  return result;
}

describe("useIdleReveal", () => {
  let fakeWindow: EventTarget;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeWindow = new EventTarget();
    vi.stubGlobal("window", fakeWindow);
  });

  afterEach(() => {
    hookRuntime.reset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("stays active until the idle delay elapses", () => {
    expect(HookHarness(true, 1000)).toBe(false);

    vi.advanceTimersByTime(999);
    expect(HookHarness(true, 1000)).toBe(false);

    vi.advanceTimersByTime(1);
    expect(HookHarness(true, 1000)).toBe(true);
  });

  it("wakes on pointer movement and restarts the countdown", () => {
    HookHarness(true, 1000);
    vi.advanceTimersByTime(1000);
    expect(HookHarness(true, 1000)).toBe(true);

    fakeWindow.dispatchEvent(new Event("pointermove"));
    expect(HookHarness(true, 1000)).toBe(false);

    vi.advanceTimersByTime(999);
    expect(HookHarness(true, 1000)).toBe(false);

    vi.advanceTimersByTime(1);
    expect(HookHarness(true, 1000)).toBe(true);
  });

  it("wakes on keyboard input", () => {
    HookHarness(true, 1000);
    vi.advanceTimersByTime(1000);
    expect(HookHarness(true, 1000)).toBe(true);

    fakeWindow.dispatchEvent(new Event("keydown"));
    expect(HookHarness(true, 1000)).toBe(false);
  });

  it("never reports idle while disabled", () => {
    expect(HookHarness(false, 1000)).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(HookHarness(false, 1000)).toBe(false);
  });

  it("does not carry a stale idle state back into the next session", () => {
    HookHarness(true, 1000);
    vi.advanceTimersByTime(1000);
    expect(HookHarness(true, 1000)).toBe(true);

    // Leaving immersive tears the listeners down and reports not-idle.
    expect(HookHarness(false, 1000)).toBe(false);

    // Re-entering starts fresh rather than resuming mid-fade.
    expect(HookHarness(true, 1000)).toBe(false);
  });

  it("stops listening once disabled", () => {
    HookHarness(true, 1000);
    HookHarness(false, 1000);

    fakeWindow.dispatchEvent(new Event("pointermove"));
    vi.advanceTimersByTime(5000);

    expect(HookHarness(false, 1000)).toBe(false);
  });
});
