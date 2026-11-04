"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  CONSOLE_DRAG_THRESHOLD,
  DEFAULT_CONSOLE_LAYOUT,
  clampConsolePosition,
  clampConsoleRect,
  getServerConsoleLayout,
  getStoredConsoleLayout,
  initialFloatingRect,
  nudgeConsoleRect,
  resizeConsoleRect,
  saveConsoleLayout,
  snapDockFor,
  subscribeConsoleLayout,
  type ConsoleDock,
  type ConsoleLayout,
  type ConsoleRect,
  type StageBounds,
} from "../../lib/playerConsoleLayout";

/** Matches the phone breakpoint where the console stacks under the artwork. */
const COMPACT_QUERY = "(max-width: 767px)";
/** Height a console floats at when it has no remembered size. */
const DEFAULT_FLOATING_HEIGHT = 620;
/** Approximate height of a minimized console (its header row). */
const MINIMIZED_HEIGHT = 64;

function subscribeCompact(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(COMPACT_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function getCompact(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(COMPACT_QUERY).matches;
}

/** Controls inside the header keep their own click; pressing them never drags. */
const INTERACTIVE = "button, a, input, select, textarea, [role='menuitem']";

interface Options {
  stageRef: RefObject<HTMLElement | null>;
  consoleRef: RefObject<HTMLElement | null>;
  /** Immersive has no player bar to keep clear of. */
  immersive: boolean;
}

export interface PlayerConsoleLayoutState {
  layout: ConsoleLayout;
  /** Phone layout: the console stacks under the artwork, so only minimize applies. */
  compact: boolean;
  /** The dock the stage lays out for ("stacked" on phone). */
  dock: ConsoleDock | "stacked";
  minimized: boolean;
  /** Inline position and size while floating. */
  style: CSSProperties | undefined;
  /** The edge a drop would dock to right now, while dragging. */
  snapPreview: "left" | "right" | null;
  interaction: "move" | "resize" | null;
  setDock: (dock: ConsoleDock) => void;
  toggleMinimized: () => void;
  reset: () => void;
  onHeaderPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onMoveHandleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

/**
 * Dock, undock, move, resize and minimize for the /player console (#2569).
 *
 * Drags write straight to the panel's style, so a move never re-renders the
 * whole player at pointer rate; the result is committed, and remembered on
 * this device, on release.
 */
export function usePlayerConsoleLayout({ stageRef, consoleRef, immersive }: Options): PlayerConsoleLayoutState {
  const layout = useSyncExternalStore(subscribeConsoleLayout, getStoredConsoleLayout, getServerConsoleLayout);
  const compact = useSyncExternalStore(subscribeCompact, getCompact, () => false);
  const [bounds, setBounds] = useState<StageBounds | null>(null);
  const [snapPreview, setSnapPreview] = useState<"left" | "right" | null>(null);
  const [interaction, setInteraction] = useState<"move" | "resize" | null>(null);
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const measureBounds = useCallback((): StageBounds | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const stageRect = stage.getBoundingClientRect();
    let bottomClearance = 12;
    if (!immersive) {
      // Keep clear of the floating player bar where it overlaps the stage.
      const barRect = document.querySelector<HTMLElement>(".app-player")?.getBoundingClientRect();
      if (barRect && barRect.height > 0 && barRect.top < stageRect.bottom) {
        bottomClearance = Math.max(bottomClearance, Math.round(stageRect.bottom - barRect.top + 12));
      }
    }
    return { width: stage.clientWidth, height: stage.clientHeight, bottomClearance };
  }, [immersive, stageRef]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const next = measureBounds();
      setBounds((previous) =>
        previous &&
        next &&
        previous.width === next.width &&
        previous.height === next.height &&
        previous.bottomClearance === next.bottomClearance
          ? previous
          : next,
      );
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [measureBounds, stageRef]);

  const consoleRectInStage = useCallback((): ConsoleRect | null => {
    const stage = stageRef.current;
    const panel = consoleRef.current;
    if (!stage || !panel) return null;
    const stageRect = stage.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    return {
      x: Math.round(rect.left - stageRect.left),
      y: Math.round(rect.top - stageRect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }, [consoleRef, stageRef]);

  const commit = useCallback((next: ConsoleLayout) => {
    layoutRef.current = next;
    saveConsoleLayout(next);
  }, []);

  /** The floating rect a docked console takes when it undocks. */
  const undockedRect = useCallback(
    (current: ConsoleLayout, docked: ConsoleRect, stageBounds: StageBounds): ConsoleRect => {
      // A minimized console measures only its header; float at full height.
      const dockedRect = current.minimized ? { ...docked, height: DEFAULT_FLOATING_HEIGHT } : docked;
      return initialFloatingRect(current, dockedRect, stageBounds);
    },
    [],
  );

  const setDock = useCallback(
    (dock: ConsoleDock) => {
      const current = layoutRef.current;
      if (dock !== "floating") {
        commit({ ...current, dock });
        return;
      }
      if (current.dock === "floating") return;
      const stageBounds = measureBounds();
      const docked = consoleRectInStage();
      if (!stageBounds || !docked) return;
      commit({ ...current, dock: "floating", floating: undockedRect(current, docked, stageBounds) });
    },
    [commit, consoleRectInStage, measureBounds, undockedRect],
  );

  const toggleMinimized = useCallback(() => {
    const current = layoutRef.current;
    commit({ ...current, minimized: !current.minimized });
  }, [commit]);

  const reset = useCallback(() => commit(DEFAULT_CONSOLE_LAYOUT), [commit]);

  /* ---- Pointer drags ---------------------------------------------------- */

  const beginDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, kind: "move" | "resize") => {
      const panel = consoleRef.current;
      const stage = stageRef.current;
      const stageBounds = measureBounds();
      const start = consoleRectInStage();
      if (!panel || !stage || !stageBounds || !start) return;
      const target = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const stageRect = stage.getBoundingClientRect();
      // Where on the panel it was grabbed, so that point stays under the pointer.
      const grabX = startX - stageRect.left - start.x;
      const grabY = startY - stageRect.top - start.y;
      // What is on screen: a minimized console is just its header row.
      let visual = start;
      let resized: ConsoleRect | null = null;
      let dragging = false;
      let snap: "left" | "right" | null = null;

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!dragging) {
          if (Math.hypot(dx, dy) < CONSOLE_DRAG_THRESHOLD) return;
          dragging = true;
          setInteraction(kind);
          const current = layoutRef.current;
          if (kind === "move" && current.dock !== "floating") {
            // Pulling a docked console off its edge undocks it.
            const sized = undockedRect(current, start, stageBounds);
            const size = { width: sized.width, height: current.minimized ? start.height : sized.height };
            const position = clampConsolePosition(start.x + dx, start.y + dy, size, stageBounds);
            commit({ ...current, dock: "floating", floating: { ...sized, ...position } });
            visual = { ...size, ...position };
          }
        }
        moveEvent.preventDefault();
        if (kind === "move") {
          const pointerX = moveEvent.clientX - stageRect.left;
          const position = clampConsolePosition(
            pointerX - Math.min(grabX, visual.width - 24),
            moveEvent.clientY - stageRect.top - grabY,
            visual,
            stageBounds,
          );
          visual = { ...visual, ...position };
          panel.style.left = `${position.x}px`;
          panel.style.top = `${position.y}px`;
          const nextSnap = snapDockFor(pointerX, stageBounds.width);
          if (nextSnap !== snap) {
            snap = nextSnap;
            setSnapPreview(nextSnap);
          }
        } else {
          resized = resizeConsoleRect(start, start.width + dx, start.height + dy, stageBounds);
          panel.style.width = `${resized.width}px`;
          panel.style.height = `${resized.height}px`;
        }
      };

      const finish = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          // Capture can already be gone; there is nothing to undo.
        }
        setSnapPreview(null);
        setInteraction(null);
        if (!dragging) return;
        const current = layoutRef.current;
        if (kind === "resize") {
          if (resized) commit({ ...current, floating: resized });
          return;
        }
        if (endEvent.type === "pointerup" && snap) {
          commit({ ...current, dock: snap });
          return;
        }
        const floating = current.floating ?? visual;
        commit({ ...current, dock: "floating", floating: { ...floating, x: visual.x, y: visual.y } });
      };

      try {
        target.setPointerCapture(pointerId);
      } catch {
        // Synthetic pointers (tests) have nothing to capture.
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [commit, consoleRectInStage, consoleRef, measureBounds, stageRef, undockedRect],
  );

  const onHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (compact || event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (!target.closest("[data-console-move-handle]") && target.closest(INTERACTIVE)) return;
      beginDrag(event, "move");
    },
    [beginDrag, compact],
  );

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (compact || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      beginDrag(event, "resize");
    },
    [beginDrag, compact],
  );

  /** Arrow keys on the move handle: dock to a side, or nudge a floating console. */
  const onMoveHandleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (compact) return;
      const current = layoutRef.current;
      if (current.dock !== "floating") {
        const side = event.key === "ArrowLeft" ? "left" : event.key === "ArrowRight" ? "right" : null;
        if (!side) return;
        event.preventDefault();
        if (side !== current.dock) commit({ ...current, dock: side });
        return;
      }
      const stageBounds = measureBounds();
      if (!stageBounds || !current.floating) return;
      const next = nudgeConsoleRect(clampConsoleRect(current.floating, stageBounds), event.key, event.shiftKey, stageBounds);
      if (!next) return;
      event.preventDefault();
      commit({ ...current, floating: next });
    },
    [commit, compact, measureBounds],
  );

  const dock: ConsoleDock | "stacked" = compact ? "stacked" : layout.dock;

  let style: CSSProperties | undefined;
  if (dock === "floating" && layout.floating) {
    // Kept on stage at render time, so a window that shrinks for a moment
    // does not overwrite the remembered spot.
    let rect = layout.floating;
    if (bounds && layout.minimized) {
      // Only the header row shows, so it may sit lower than the full panel could.
      const width = clampConsoleRect(rect, bounds).width;
      rect = { ...rect, width, ...clampConsolePosition(rect.x, rect.y, { width, height: MINIMIZED_HEIGHT }, bounds) };
    } else if (bounds) {
      rect = clampConsoleRect(rect, bounds);
    }
    style = {
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: layout.minimized ? undefined : rect.height,
    };
  }

  return {
    layout,
    compact,
    dock,
    minimized: layout.minimized,
    style,
    snapPreview,
    interaction,
    setDock,
    toggleMinimized,
    reset,
    onHeaderPointerDown,
    onResizePointerDown,
    onMoveHandleKeyDown,
  };
}
