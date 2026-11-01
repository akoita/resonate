"use client";

import { useCallback, useEffect, useId, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import {
  EMPTY_SELECTION,
  clickRow,
  keyOnList,
  modifiersOf,
  selectedIndices,
  type ListSelection,
} from "./listSelection";

interface Options {
  /** Number of rows in the list. */
  count: number;
  /**
   * Changes whenever the rows change (added, removed, reordered). The
   * selection is cleared then, so an index never points at another track.
   */
  resetKey: string;
  /** The scrolling list element; rows carry `data-row-index`. */
  listRef: RefObject<HTMLElement | null>;
  /** Plain click or Enter on a row. */
  onActivate: (index: number) => void;
  /** Delete/Backspace with rows selected. */
  onRemove?: (indices: number[]) => void;
  /**
   * Menu key or Shift+F10 on the keyboard row: open its actions menu, the
   * same one the row's "⋯" button and a right-click open. Without it, the
   * keys keep their browser default.
   */
  onMenu?: (index: number) => void;
}

/**
 * Wires the pure selection model (`listSelection.ts`) to a rendered list.
 * Spread `rowProps(i)` on each row and `listProps` on the list.
 */
export function useListSelection({ count, resetKey, listRef, onActivate, onRemove, onMenu }: Options) {
  const [state, setState] = useState<ListSelection>(EMPTY_SELECTION);
  const idPrefix = useId().replace(/:/g, "");
  const rowId = (index: number) => `${idPrefix}-row-${index}`;
  const [seenResetKey, setSeenResetKey] = useState(resetKey);

  if (seenResetKey !== resetKey) {
    setSeenResetKey(resetKey);
    // Adjusting state during render is React's sanctioned way to reset on a
    // prop change; it avoids a frame where the stale selection is painted.
    const focus = state.focus === null || count === 0 ? null : Math.min(state.focus, count - 1);
    if (state.selected.size > 0 || state.focus !== focus) setState({ selected: new Set(), anchor: focus, focus });
  }

  // Keep the keyboard row in view as it moves.
  useEffect(() => {
    if (state.focus === null) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${state.focus}"]`);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [state.focus, listRef]);

  const clear = useCallback(() => setState((current) => ({ ...current, selected: new Set() })), []);

  const onRowClick = useCallback((event: MouseEvent, index: number) => {
    const result = clickRow(state, index, modifiersOf(event));
    setState(result.state);
    // The list takes the keyboard after a click, so Shift+↓ continues from here.
    listRef.current?.focus({ preventScroll: true });
    if (result.kind === "activate") onActivate(index);
  }, [state, onActivate, listRef]);

  const onListKeyDown = useCallback((event: KeyboardEvent) => {
    // Keys typed into a control inside a row (a button, an input) are theirs.
    if (event.target !== event.currentTarget) return;
    const result = keyOnList(state, event, count);
    if (result.kind === "ignored") return;
    if (result.kind === "menu" && !onMenu) return;
    event.preventDefault();
    event.stopPropagation();
    setState(result.state);
    if (result.kind === "activate") onActivate(result.index);
    if (result.kind === "remove") onRemove?.(selectedIndices(result.state));
    if (result.kind === "menu") onMenu?.(result.index);
  }, [state, count, onActivate, onRemove, onMenu]);

  /**
   * Right-click: keep a multi-row selection when the row is part of it, so
   * the menu acts on all of them; otherwise the menu is for this row alone.
   */
  const contextTargets = useCallback((index: number): number[] => {
    if (state.selected.has(index) && state.selected.size > 1) return selectedIndices(state);
    setState({ selected: new Set(), anchor: index, focus: index });
    return [index];
  }, [state]);

  const rowProps = (index: number) => ({
    "data-row-index": index,
    role: "option" as const,
    "aria-selected": state.selected.has(index),
    id: rowId(index),
    onClick: (event: MouseEvent) => onRowClick(event, index),
    // Shift+click would otherwise also select the text between the rows.
    onMouseDown: (event: MouseEvent) => { if (event.shiftKey) event.preventDefault(); },
  });

  const listProps = {
    role: "listbox" as const,
    "aria-multiselectable": true,
    "aria-activedescendant": state.focus === null ? undefined : rowId(state.focus),
    onKeyDown: onListKeyDown,
  };

  return {
    selection: state,
    selected: selectedIndices(state),
    isSelected: (index: number) => state.selected.has(index),
    isFocused: (index: number) => state.focus === index,
    clear,
    contextTargets,
    rowProps,
    listProps,
  };
}
