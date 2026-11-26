import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEBAR_LAYOUT,
  SIDEBAR_FIRST_PAINT_SCRIPT,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  parseSidebarLayout,
  sidebarLayoutForDrag,
  sidebarLayoutForKey,
} from "./sidebarLayout";

describe("parseSidebarLayout", () => {
  it("falls back to the natural width for anything unreadable", () => {
    expect(parseSidebarLayout(null)).toEqual(DEFAULT_SIDEBAR_LAYOUT);
    expect(parseSidebarLayout("{")).toEqual(DEFAULT_SIDEBAR_LAYOUT);
    expect(parseSidebarLayout('"rail"')).toEqual(DEFAULT_SIDEBAR_LAYOUT);
  });

  it("keeps a stored width within the limits", () => {
    expect(parseSidebarLayout('{"width":9999,"collapsed":false}')).toEqual({ width: SIDEBAR_MAX_WIDTH, collapsed: false });
    expect(parseSidebarLayout('{"width":10,"collapsed":true}')).toEqual({ width: SIDEBAR_MIN_WIDTH, collapsed: true });
  });
});

describe("sidebarLayoutForDrag", () => {
  it("folds to icons past the fold point and keeps the last width", () => {
    expect(sidebarLayoutForDrag(90, { width: 260, collapsed: false })).toEqual({ width: 260, collapsed: true });
  });

  it("opens a folded sidebar when dragged out again", () => {
    expect(sidebarLayoutForDrag(250, { width: 260, collapsed: true })).toEqual({ width: 250, collapsed: false });
  });

  it("clamps between the fold point and the minimum", () => {
    expect(sidebarLayoutForDrag(170, DEFAULT_SIDEBAR_LAYOUT)).toEqual({ width: SIDEBAR_MIN_WIDTH, collapsed: false });
    expect(clampSidebarWidth(1000)).toBe(SIDEBAR_MAX_WIDTH);
  });
});

describe("sidebarLayoutForKey", () => {
  it("toggles the fold with Enter and Space", () => {
    expect(sidebarLayoutForKey("Enter", DEFAULT_SIDEBAR_LAYOUT, 260)).toEqual({ width: null, collapsed: true });
    expect(sidebarLayoutForKey(" ", { width: 240, collapsed: true }, 72)).toEqual({ width: 240, collapsed: false });
  });

  it("steps the width with the arrow keys and folds below the minimum", () => {
    expect(sidebarLayoutForKey("ArrowRight", DEFAULT_SIDEBAR_LAYOUT, 260)).toEqual({ width: 276, collapsed: false });
    expect(sidebarLayoutForKey("ArrowLeft", DEFAULT_SIDEBAR_LAYOUT, SIDEBAR_MIN_WIDTH + 4)).toEqual({ width: null, collapsed: true });
    expect(sidebarLayoutForKey("ArrowRight", { width: 230, collapsed: true }, 72)).toEqual({ width: 230, collapsed: false });
  });

  it("ignores other keys", () => {
    expect(sidebarLayoutForKey("a", DEFAULT_SIDEBAR_LAYOUT, 260)).toBeNull();
  });
});

describe("SIDEBAR_FIRST_PAINT_SCRIPT", () => {
  function run(stored: string | null) {
    const attributes = new Map<string, string>();
    const properties = new Map<string, string>();
    const documentElement = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      style: { setProperty: (name: string, value: string) => properties.set(name, value) },
    };
    const localStorage = { getItem: () => stored };
    new Function("localStorage", "document", SIDEBAR_FIRST_PAINT_SCRIPT)(localStorage, { documentElement });
    return { attributes, properties };
  }

  it("applies a stored layout before first paint, within the limits", () => {
    const { attributes, properties } = run(JSON.stringify({ width: 999, collapsed: true }));
    expect(attributes.get("data-sidebar")).toBe("rail");
    expect(properties.get("--sidebar-width")).toBe(`${SIDEBAR_MAX_WIDTH}px`);
  });

  it("does nothing without a stored layout or with a broken one", () => {
    expect(run(null).attributes.size).toBe(0);
    expect(run("{").properties.size).toBe(0);
  });
});
