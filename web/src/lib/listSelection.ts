/**
 * Multi-select for track lists (queue, playlist), as a pure model.
 *
 * A plain click still plays a track, as it always has. Selection is reached
 * with the modifiers and keys every desktop file list uses:
 *
 * - Shift+click: select the range from the anchor to this row.
 * - Ctrl/Cmd+click: add or remove one row, and make it the new anchor.
 * - Ctrl/Cmd+Shift+click: add the range to what is already selected.
 * - ↑/↓ (Home/End): move to a row and select just it.
 * - Shift+↑/↓ (Home/End): extend the range from the anchor.
 * - Ctrl/Cmd+↑/↓: move without changing the selection; Ctrl/Cmd+Space toggles.
 * - Ctrl/Cmd+A: select every row. Esc: clear the selection.
 *
 * Rows are addressed by index. Callers clear the selection whenever the list
 * itself changes (see `useListSelection`), so an index never points at a
 * different track than the one that was selected.
 */

export interface ListSelection {
  /** Selected row indices. */
  selected: ReadonlySet<number>;
  /** Fixed end of a Shift range. */
  anchor: number | null;
  /** Row the keyboard is on. */
  focus: number | null;
}

export const EMPTY_SELECTION: ListSelection = { selected: new Set(), anchor: null, focus: null };

export interface ClickModifiers {
  shift: boolean;
  /** Ctrl on Windows/Linux, Cmd on macOS. */
  toggle: boolean;
}

export type ClickResult =
  | { kind: "select"; state: ListSelection }
  /** A plain click: the caller plays the row. Selection is cleared. */
  | { kind: "activate"; index: number; state: ListSelection };

function range(from: number, to: number): number[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

function clamp(index: number, count: number): number {
  return Math.min(Math.max(index, 0), count - 1);
}

export function modifiersOf(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): ClickModifiers {
  return { shift: event.shiftKey, toggle: event.ctrlKey || event.metaKey };
}

export function clickRow(state: ListSelection, index: number, mods: ClickModifiers): ClickResult {
  if (mods.shift) {
    const anchor = state.anchor ?? state.focus ?? index;
    const selected = new Set(mods.toggle ? state.selected : []);
    for (const row of range(anchor, index)) selected.add(row);
    return { kind: "select", state: { selected, anchor, focus: index } };
  }
  if (mods.toggle) {
    const selected = new Set(state.selected);
    if (selected.has(index)) selected.delete(index);
    else selected.add(index);
    return { kind: "select", state: { selected, anchor: index, focus: index } };
  }
  return { kind: "activate", index, state: { selected: new Set(), anchor: index, focus: index } };
}

export interface KeyInput {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export type KeyResult =
  | { kind: "ignored" }
  | { kind: "select"; state: ListSelection }
  /** Enter on a row: the caller plays it. */
  | { kind: "activate"; index: number; state: ListSelection }
  /** Delete/Backspace with rows selected: the caller removes them. */
  | { kind: "remove"; state: ListSelection };

/** Keyboard handling for a focused list of `count` rows. */
export function keyOnList(state: ListSelection, input: KeyInput, count: number): KeyResult {
  if (count <= 0) return { kind: "ignored" };
  const toggle = input.ctrlKey || input.metaKey;
  const focus = state.focus === null ? null : clamp(state.focus, count);

  if (toggle && !input.shiftKey && input.key.toLowerCase() === "a") {
    return {
      kind: "select",
      state: { selected: new Set(range(0, count - 1)), anchor: state.anchor ?? 0, focus: focus ?? 0 },
    };
  }

  if (input.key === "Escape") {
    if (state.selected.size === 0) return { kind: "ignored" };
    return { kind: "select", state: { ...state, selected: new Set() } };
  }

  if (input.key === "Enter") {
    if (focus === null) return { kind: "ignored" };
    return { kind: "activate", index: focus, state: { selected: new Set(), anchor: focus, focus } };
  }

  if (input.key === " " && toggle) {
    if (focus === null) return { kind: "ignored" };
    const selected = new Set(state.selected);
    if (selected.has(focus)) selected.delete(focus);
    else selected.add(focus);
    return { kind: "select", state: { selected, anchor: focus, focus } };
  }

  if (input.key === "Delete" || input.key === "Backspace") {
    if (state.selected.size === 0) return { kind: "ignored" };
    return { kind: "remove", state };
  }

  let target: number | null = null;
  switch (input.key) {
    case "ArrowDown": target = focus === null ? 0 : clamp(focus + 1, count); break;
    case "ArrowUp": target = focus === null ? count - 1 : clamp(focus - 1, count); break;
    case "Home": target = 0; break;
    case "End": target = count - 1; break;
    default: return { kind: "ignored" };
  }

  if (input.shiftKey) {
    const anchor = state.anchor ?? focus ?? target;
    const selected = new Set(toggle ? state.selected : []);
    for (const row of range(anchor, target)) selected.add(row);
    return { kind: "select", state: { selected, anchor, focus: target } };
  }
  if (toggle) {
    return { kind: "select", state: { ...state, focus: target } };
  }
  return { kind: "select", state: { selected: new Set([target]), anchor: target, focus: target } };
}

/** Selected indices, in list order. */
export function selectedIndices(state: ListSelection): number[] {
  return [...state.selected].sort((a, b) => a - b);
}
