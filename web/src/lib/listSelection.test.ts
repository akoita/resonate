import { describe, expect, it } from "vitest";
import { EMPTY_SELECTION, clickRow, keyOnList, selectedIndices, type ListSelection } from "./listSelection";

const plain = { shift: false, toggle: false };
const shift = { shift: true, toggle: false };
const toggle = { shift: false, toggle: true };
const key = (k: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
  key: k, shiftKey: false, ctrlKey: false, metaKey: false, ...mods,
});
const sel = (state: ListSelection) => selectedIndices(state);

describe("clickRow", () => {
  it("plays on a plain click and clears the selection", () => {
    const start = { selected: new Set([1, 2]), anchor: 1, focus: 2 };
    const result = clickRow(start, 4, plain);
    expect(result.kind).toBe("activate");
    expect(sel(result.state)).toEqual([]);
    expect(result.state.anchor).toBe(4);
  });

  it("selects a range with Shift from the last clicked row", () => {
    const afterPlay = clickRow(EMPTY_SELECTION, 2, plain).state;
    const result = clickRow(afterPlay, 5, shift);
    expect(result.kind).toBe("select");
    expect(sel(result.state)).toEqual([2, 3, 4, 5]);
    // Shift again re-pivots on the same anchor.
    expect(sel(clickRow(result.state, 0, shift).state)).toEqual([0, 1, 2]);
  });

  it("toggles single rows with Ctrl/Cmd and moves the anchor", () => {
    let state = clickRow(EMPTY_SELECTION, 1, toggle).state;
    state = clickRow(state, 3, toggle).state;
    expect(sel(state)).toEqual([1, 3]);
    state = clickRow(state, 1, toggle).state;
    expect(sel(state)).toEqual([3]);
    expect(state.anchor).toBe(1);
  });

  it("adds a range to the selection with Ctrl/Cmd+Shift", () => {
    const state = clickRow(clickRow(EMPTY_SELECTION, 0, toggle).state, 4, toggle).state;
    const result = clickRow(state, 6, { shift: true, toggle: true });
    expect(sel(result.state)).toEqual([0, 4, 5, 6]);
  });
});

describe("keyOnList", () => {
  it("moves and selects one row with the arrows, starting at the top", () => {
    const first = keyOnList(EMPTY_SELECTION, key("ArrowDown"), 5);
    expect(first.kind).toBe("select");
    if (first.kind !== "select") return;
    expect(sel(first.state)).toEqual([0]);
    const second = keyOnList(first.state, key("ArrowDown"), 5);
    if (second.kind !== "select") throw new Error("expected select");
    expect(sel(second.state)).toEqual([1]);
  });

  it("extends from the anchor with Shift+arrows and clamps at the ends", () => {
    let state: ListSelection = { selected: new Set([3]), anchor: 3, focus: 3 };
    for (let step = 0; step < 3; step += 1) {
      const next = keyOnList(state, key("ArrowDown", { shiftKey: true }), 5);
      if (next.kind !== "select") throw new Error("expected select");
      state = next.state;
    }
    expect(sel(state)).toEqual([3, 4]);
    const up = keyOnList(state, key("ArrowUp", { shiftKey: true }), 5);
    if (up.kind !== "select") throw new Error("expected select");
    expect(sel(up.state)).toEqual([3]);
  });

  it("extends to the end with Shift+End", () => {
    const result = keyOnList({ selected: new Set([1]), anchor: 1, focus: 1 }, key("End", { shiftKey: true }), 4);
    if (result.kind !== "select") throw new Error("expected select");
    expect(sel(result.state)).toEqual([1, 2, 3]);
  });

  it("selects all with Ctrl+A or Cmd+A", () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      const result = keyOnList(EMPTY_SELECTION, key("a", mod), 3);
      if (result.kind !== "select") throw new Error("expected select");
      expect(sel(result.state)).toEqual([0, 1, 2]);
    }
  });

  it("clears with Escape, and lets Escape through when nothing is selected", () => {
    const cleared = keyOnList({ selected: new Set([0, 1]), anchor: 0, focus: 1 }, key("Escape"), 3);
    if (cleared.kind !== "select") throw new Error("expected select");
    expect(sel(cleared.state)).toEqual([]);
    expect(cleared.state.focus).toBe(1);
    expect(keyOnList(EMPTY_SELECTION, key("Escape"), 3).kind).toBe("ignored");
  });

  it("plays the keyboard row on Enter", () => {
    const result = keyOnList({ selected: new Set(), anchor: 2, focus: 2 }, key("Enter"), 3);
    expect(result).toMatchObject({ kind: "activate", index: 2 });
  });

  it("moves without selecting on Ctrl+arrow, then toggles with Ctrl+Space", () => {
    const moved = keyOnList({ selected: new Set([0]), anchor: 0, focus: 0 }, key("ArrowDown", { ctrlKey: true }), 3);
    if (moved.kind !== "select") throw new Error("expected select");
    expect(sel(moved.state)).toEqual([0]);
    const toggled = keyOnList(moved.state, key(" ", { ctrlKey: true }), 3);
    if (toggled.kind !== "select") throw new Error("expected select");
    expect(sel(toggled.state)).toEqual([0, 1]);
  });

  it("asks to remove the selection on Delete, and ignores it with nothing selected", () => {
    expect(keyOnList({ selected: new Set([1]), anchor: 1, focus: 1 }, key("Delete"), 3).kind).toBe("remove");
    expect(keyOnList(EMPTY_SELECTION, key("Backspace"), 3).kind).toBe("ignored");
  });

  it("ignores other keys and empty lists", () => {
    expect(keyOnList(EMPTY_SELECTION, key("x"), 3).kind).toBe("ignored");
    expect(keyOnList(EMPTY_SELECTION, key("ArrowDown"), 0).kind).toBe("ignored");
  });
});
