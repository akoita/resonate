import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSOLE_MIN_HEIGHT,
  CONSOLE_MIN_WIDTH,
  DEFAULT_CONSOLE_LAYOUT,
  PLAYER_CONSOLE_LAYOUT_KEY,
  clampConsolePosition,
  clampConsoleRect,
  getStoredConsoleLayout,
  initialFloatingRect,
  nudgeConsoleRect,
  parseConsoleLayout,
  resizeConsoleRect,
  saveConsoleLayout,
  serializeConsoleLayout,
  snapDockFor,
  subscribeConsoleLayout,
  type StageBounds,
} from "./playerConsoleLayout";

const stage: StageBounds = { width: 1200, height: 800, bottomClearance: 110 };

describe("parseConsoleLayout", () => {
  it("falls back to docked right for missing or corrupted values", () => {
    expect(parseConsoleLayout(null)).toEqual(DEFAULT_CONSOLE_LAYOUT);
    expect(parseConsoleLayout("not json")).toEqual(DEFAULT_CONSOLE_LAYOUT);
    expect(parseConsoleLayout("42")).toEqual(DEFAULT_CONSOLE_LAYOUT);
    expect(parseConsoleLayout(JSON.stringify({ dock: "top", minimized: "yes" }))).toEqual(DEFAULT_CONSOLE_LAYOUT);
  });

  it("round-trips a saved layout", () => {
    const layout = {
      dock: "floating" as const,
      minimized: true,
      floating: { x: 40, y: 60, width: 360, height: 500 },
    };
    expect(parseConsoleLayout(serializeConsoleLayout(layout))).toEqual(layout);
  });

  it("docks a floating layout that has no position to float at", () => {
    expect(parseConsoleLayout(JSON.stringify({ dock: "floating", floating: { x: 1 } })).dock).toBe("right");
  });

  it("keeps the remembered floating spot while docked", () => {
    const parsed = parseConsoleLayout(JSON.stringify({ dock: "left", floating: { x: 10, y: 20, width: 400, height: 500 } }));
    expect(parsed).toEqual({ dock: "left", minimized: false, floating: { x: 10, y: 20, width: 400, height: 500 } });
  });
});

describe("clampConsoleRect", () => {
  it("leaves a panel that fits alone", () => {
    expect(clampConsoleRect({ x: 100, y: 50, width: 400, height: 500 }, stage)).toEqual({ x: 100, y: 50, width: 400, height: 500 });
  });

  it("pulls an off-stage panel back inside and above the player bar", () => {
    const rect = clampConsoleRect({ x: 1100, y: 600, width: 400, height: 500 }, stage);
    expect(rect.x + rect.width).toBeLessThanOrEqual(stage.width - 8);
    expect(rect.y + rect.height).toBeLessThanOrEqual(stage.height - stage.bottomClearance);
    expect(rect.y).toBeGreaterThanOrEqual(8);
  });

  it("shrinks a panel larger than the stage, but not below the minimum", () => {
    const rect = clampConsoleRect({ x: 0, y: 0, width: 5000, height: 5000 }, { width: 900, height: 700, bottomClearance: 110 });
    expect(rect.width).toBe(900 - 16);
    expect(rect.height).toBe(700 - 110 - 8);
    const tiny = clampConsoleRect({ x: 0, y: 0, width: 10, height: 10 }, stage);
    expect(tiny.width).toBe(CONSOLE_MIN_WIDTH);
    expect(tiny.height).toBe(CONSOLE_MIN_HEIGHT);
  });
});

describe("clampConsolePosition", () => {
  it("lets a minimized header sit lower than the full panel could", () => {
    const { y } = clampConsolePosition(20, 2000, { width: 400, height: 60 }, stage);
    expect(y).toBe(stage.height - stage.bottomClearance - 60);
  });
});

describe("resizeConsoleRect", () => {
  it("grows from the top-left corner within the stage", () => {
    const rect = resizeConsoleRect({ x: 800, y: 100, width: 300, height: 300 }, 800, 2000, stage);
    expect(rect).toEqual({ x: 800, y: 100, width: 1200 - 8 - 800, height: 800 - 110 - 100 });
  });

  it("does not shrink below the minimum", () => {
    expect(resizeConsoleRect({ x: 10, y: 10, width: 400, height: 400 }, 50, 50, stage)).toMatchObject({
      width: CONSOLE_MIN_WIDTH,
      height: CONSOLE_MIN_HEIGHT,
    });
  });
});

describe("initialFloatingRect", () => {
  const docked = { x: 760, y: 12, width: 420, height: 678 };

  it("floats just inside the dock it leaves, at a comfortable height", () => {
    const rect = initialFloatingRect(DEFAULT_CONSOLE_LAYOUT, docked, stage);
    expect(rect).toEqual({ x: 712, y: 60, width: 420, height: 620 });
  });

  it("returns to the remembered spot", () => {
    const layout = { ...DEFAULT_CONSOLE_LAYOUT, floating: { x: 30, y: 40, width: 350, height: 400 } };
    expect(initialFloatingRect(layout, docked, stage)).toEqual({ x: 30, y: 40, width: 350, height: 400 });
  });
});

describe("snapDockFor and nudgeConsoleRect", () => {
  it("docks only near a side edge", () => {
    expect(snapDockFor(10, 1200)).toBe("left");
    expect(snapDockFor(1190, 1200)).toBe("right");
    expect(snapDockFor(600, 1200)).toBeNull();
  });

  it("moves by small or large steps and stays on stage", () => {
    const rect = { x: 100, y: 100, width: 400, height: 400 };
    expect(nudgeConsoleRect(rect, "ArrowRight", false, stage)).toMatchObject({ x: 116, y: 100 });
    expect(nudgeConsoleRect(rect, "ArrowUp", true, stage)).toMatchObject({ x: 100, y: 36 });
    expect(nudgeConsoleRect(rect, "ArrowLeft", true, stage)).toMatchObject({ x: 36 });
    expect(nudgeConsoleRect({ ...rect, x: 8 }, "ArrowLeft", false, stage)).toMatchObject({ x: 8 });
    expect(nudgeConsoleRect(rect, "Enter", false, stage)).toBeNull();
  });
});

describe("device storage", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    saveConsoleLayout(DEFAULT_CONSOLE_LAYOUT);
    vi.unstubAllGlobals();
  });

  it("remembers a layout on this device and notifies readers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConsoleLayout(listener);
    const layout = { dock: "left" as const, minimized: true, floating: null };
    saveConsoleLayout(layout);
    expect(store.get(PLAYER_CONSOLE_LAYOUT_KEY)).toBe(serializeConsoleLayout(layout));
    expect(getStoredConsoleLayout()).toEqual(layout);
    // Stable snapshot for useSyncExternalStore.
    expect(getStoredConsoleLayout()).toBe(getStoredConsoleLayout());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("clears the stored value when reset to the default", () => {
    saveConsoleLayout({ dock: "left", minimized: false, floating: null });
    saveConsoleLayout(DEFAULT_CONSOLE_LAYOUT);
    expect(store.has(PLAYER_CONSOLE_LAYOUT_KEY)).toBe(false);
    expect(getStoredConsoleLayout()).toEqual(DEFAULT_CONSOLE_LAYOUT);
  });

  it("still applies the layout for this visit when storage refuses it", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {},
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const layout = { dock: "left" as const, minimized: false, floating: null };
    saveConsoleLayout(layout);
    expect(getStoredConsoleLayout()).toEqual(layout);
  });
});
