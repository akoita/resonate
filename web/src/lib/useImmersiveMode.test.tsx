import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookRuntime = vi.hoisted(() => {
  type Effect = () => void | (() => void);
  type EffectSlot = {
    cleanup?: () => void;
    deps?: readonly unknown[];
    pending?: Effect;
  };

  const state: unknown[] = [];
  const effects: EffectSlot[] = [];
  let stateCursor = 0;
  let effectCursor = 0;

  const depsChanged = (previous?: readonly unknown[], next?: readonly unknown[]) =>
    !previous || !next ||
    previous.length !== next.length ||
    previous.some((value, index) => !Object.is(value, next[index]));

  return {
    beginRender() {
      stateCursor = 0;
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
      effects.length = 0;
      stateCursor = 0;
      effectCursor = 0;
    },
  };
});

vi.mock("react", () => ({
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
  useEffect: hookRuntime.useEffect,
  useState: hookRuntime.useState,
}));

import { useImmersiveMode } from "./useImmersiveMode";

class FakeDocument extends EventTarget {
  fullscreenElement: Element | null = null;
  exitFullscreen = vi.fn(async () => {
    this.fullscreenElement = null;
    this.dispatchEvent(new Event("fullscreenchange"));
  });
}

function HookHarness(element: HTMLElement | null) {
  hookRuntime.beginRender();
  const result = useImmersiveMode({ current: element } as RefObject<HTMLElement | null>);
  hookRuntime.flushEffects();
  return result;
}

function escapeEvent() {
  const event = new Event("keydown");
  Object.defineProperty(event, "key", { value: "Escape" });
  return event;
}

describe("useImmersiveMode", () => {
  let fakeDocument: FakeDocument;

  beforeEach(() => {
    fakeDocument = new FakeDocument();
    vi.stubGlobal("document", fakeDocument);
  });

  afterEach(() => {
    hookRuntime.reset();
    vi.unstubAllGlobals();
  });

  it("enters native fullscreen and follows browser fullscreen exits", async () => {
    const element = {
      requestFullscreen: vi.fn(async () => {
        fakeDocument.fullscreenElement = element as unknown as Element;
        fakeDocument.dispatchEvent(new Event("fullscreenchange"));
      }),
    } as unknown as HTMLElement;

    let immersive = HookHarness(element);
    await immersive.enter();
    immersive = HookHarness(element);

    expect(element.requestFullscreen).toHaveBeenCalledOnce();
    expect(immersive).toMatchObject({ active: true, fullscreen: true, fallback: false });

    fakeDocument.fullscreenElement = null;
    fakeDocument.dispatchEvent(new Event("fullscreenchange"));
    immersive = HookHarness(element);

    expect(immersive).toMatchObject({ active: false, fullscreen: false, fallback: false });
  });

  it("uses the in-page fallback when fullscreen is unavailable and exits it on Escape", async () => {
    const element = {} as HTMLElement;

    let immersive = HookHarness(element);
    await immersive.enter();
    immersive = HookHarness(element);

    expect(immersive).toMatchObject({ active: true, fullscreen: false, fallback: true });

    fakeDocument.dispatchEvent(escapeEvent());
    immersive = HookHarness(element);

    expect(immersive).toMatchObject({ active: false, fullscreen: false, fallback: false });
  });

  it("falls back when the browser rejects a fullscreen request", async () => {
    const element = {
      requestFullscreen: vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError")),
    } as unknown as HTMLElement;

    let immersive = HookHarness(element);
    await immersive.enter();
    immersive = HookHarness(element);

    expect(immersive).toMatchObject({ active: true, fullscreen: false, fallback: true });
  });

  it("toggles both native fullscreen and fallback modes", async () => {
    const element = {
      requestFullscreen: vi.fn(async () => {
        fakeDocument.fullscreenElement = element as unknown as Element;
        fakeDocument.dispatchEvent(new Event("fullscreenchange"));
      }),
    } as unknown as HTMLElement;

    let immersive = HookHarness(element);
    await immersive.toggle();
    immersive = HookHarness(element);
    expect(immersive.fullscreen).toBe(true);

    await immersive.toggle();
    immersive = HookHarness(element);
    expect(fakeDocument.exitFullscreen).toHaveBeenCalledOnce();
    expect(immersive.active).toBe(false);
  });

  it("does not require document while rendering on the server", () => {
    hookRuntime.reset();
    vi.unstubAllGlobals();

    expect(() => HookHarness(null)).not.toThrow();
    expect(HookHarness(null).active).toBe(false);
  });
});
