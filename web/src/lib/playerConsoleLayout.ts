/**
 * Where the Now Playing console sits on /player, remembered per device (#2569).
 *
 * The console docks to the right (the default) or left edge of the stage, or
 * floats anywhere on it, and can be minimized to its header row in any of
 * those places. The layout lives in this browser's localStorage only; the
 * server never learns it. Everything here is pure so the rules (what a saved
 * value may contain, how a floating panel is kept on stage, when a drop docks)
 * are testable without a DOM.
 */

export type ConsoleDock = "right" | "left" | "floating";

export interface ConsoleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConsoleLayout {
  dock: ConsoleDock;
  minimized: boolean;
  /**
   * The last floating position and size, kept while docked so undocking
   * returns the panel to where the listener last left it.
   */
  floating: ConsoleRect | null;
}

/** The stage the console moves within, in stage-relative pixels. */
export interface StageBounds {
  width: number;
  height: number;
  /** Room kept free at the bottom for the floating player bar. */
  bottomClearance: number;
}

export const PLAYER_CONSOLE_LAYOUT_KEY = "resonate.player.consoleLayout.v1";

export const DEFAULT_CONSOLE_LAYOUT: ConsoleLayout = Object.freeze({
  dock: "right",
  minimized: false,
  floating: null,
}) as ConsoleLayout;

export const CONSOLE_MIN_WIDTH = 300;
export const CONSOLE_MIN_HEIGHT = 240;
/** Gap kept between a floating console and the stage edges. */
export const CONSOLE_EDGE_GAP = 8;
/** A drop whose pointer lands this close to a side edge docks there. */
export const CONSOLE_SNAP_DISTANCE = 56;
/** Pointer travel before a press on the header becomes a drag. */
export const CONSOLE_DRAG_THRESHOLD = 5;

const DOCKS: readonly ConsoleDock[] = ["right", "left", "floating"];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseRect(value: unknown): ConsoleRect | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/**
 * Reads a stored layout. Anything missing, corrupted or from another shape
 * falls back field by field to the default, never to an error.
 */
export function parseConsoleLayout(raw: string | null | undefined): ConsoleLayout {
  if (!raw) return DEFAULT_CONSOLE_LAYOUT;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_CONSOLE_LAYOUT;
  }
  if (!value || typeof value !== "object") return DEFAULT_CONSOLE_LAYOUT;
  const record = value as Record<string, unknown>;
  const floating = parseRect(record.floating);
  let dock: ConsoleDock = DOCKS.includes(record.dock as ConsoleDock)
    ? (record.dock as ConsoleDock)
    : DEFAULT_CONSOLE_LAYOUT.dock;
  // Floating with no position to float at is not a layout; dock it instead.
  if (dock === "floating" && !floating) dock = DEFAULT_CONSOLE_LAYOUT.dock;
  return {
    dock,
    minimized: record.minimized === true,
    floating,
  };
}

export function serializeConsoleLayout(layout: ConsoleLayout): string {
  return JSON.stringify({
    dock: layout.dock,
    minimized: layout.minimized,
    floating: layout.floating,
  });
}

export function isDefaultConsoleLayout(layout: ConsoleLayout): boolean {
  return layout.dock === "right" && !layout.minimized && layout.floating === null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Keeps a floating console fully on stage and clear of the player bar. Size
 * gives way before position: a panel larger than the stage shrinks to fit
 * (down to the minimum), then moves back inside the edges.
 */
export function clampConsoleRect(rect: ConsoleRect, bounds: StageBounds): ConsoleRect {
  const maxWidth = Math.max(CONSOLE_MIN_WIDTH, bounds.width - CONSOLE_EDGE_GAP * 2);
  const usableBottom = bounds.height - Math.max(bounds.bottomClearance, CONSOLE_EDGE_GAP);
  const maxHeight = Math.max(CONSOLE_MIN_HEIGHT, usableBottom - CONSOLE_EDGE_GAP);
  const width = Math.round(clamp(rect.width, CONSOLE_MIN_WIDTH, maxWidth));
  const height = Math.round(clamp(rect.height, CONSOLE_MIN_HEIGHT, maxHeight));
  const x = Math.round(clamp(rect.x, CONSOLE_EDGE_GAP, bounds.width - CONSOLE_EDGE_GAP - width));
  const y = Math.round(clamp(rect.y, CONSOLE_EDGE_GAP, usableBottom - height));
  return { x, y, width, height };
}

/**
 * Keeps a panel of a given (visual) size on stage without resizing it: used
 * while dragging, where a minimized console is only its header row tall.
 */
export function clampConsolePosition(
  x: number,
  y: number,
  size: { width: number; height: number },
  bounds: StageBounds,
): { x: number; y: number } {
  const usableBottom = bounds.height - Math.max(bounds.bottomClearance, CONSOLE_EDGE_GAP);
  return {
    x: Math.round(clamp(x, CONSOLE_EDGE_GAP, bounds.width - CONSOLE_EDGE_GAP - size.width)),
    y: Math.round(clamp(y, CONSOLE_EDGE_GAP, usableBottom - size.height)),
  };
}

/**
 * Grows or shrinks a floating console from its fixed top-left corner,
 * within the stage and above the player bar.
 */
export function resizeConsoleRect(rect: ConsoleRect, width: number, height: number, bounds: StageBounds): ConsoleRect {
  const usableBottom = bounds.height - Math.max(bounds.bottomClearance, CONSOLE_EDGE_GAP);
  return {
    ...rect,
    width: Math.round(clamp(width, CONSOLE_MIN_WIDTH, bounds.width - CONSOLE_EDGE_GAP - rect.x)),
    height: Math.round(clamp(height, CONSOLE_MIN_HEIGHT, usableBottom - rect.y)),
  };
}

/**
 * Where a console just undocked should float: the last floating spot when
 * there is one, otherwise just inside the edge it was docked to, at its
 * docked width and a comfortable height.
 */
export function initialFloatingRect(
  layout: ConsoleLayout,
  dockedRect: ConsoleRect,
  bounds: StageBounds,
): ConsoleRect {
  if (layout.floating) return clampConsoleRect(layout.floating, bounds);
  const width = dockedRect.width;
  const height = Math.min(dockedRect.height, 620);
  const inset = 48;
  const x = layout.dock === "left" ? dockedRect.x + inset : dockedRect.x - inset;
  return clampConsoleRect({ x, y: dockedRect.y + inset, width, height }, bounds);
}

/** The side a drop at this pointer position docks to, if any. */
export function snapDockFor(pointerX: number, stageWidth: number): "left" | "right" | null {
  if (pointerX <= CONSOLE_SNAP_DISTANCE) return "left";
  if (pointerX >= stageWidth - CONSOLE_SNAP_DISTANCE) return "right";
  return null;
}

/** One keyboard nudge of a floating console. */
export function nudgeConsoleRect(
  rect: ConsoleRect,
  key: string,
  large: boolean,
  bounds: StageBounds,
): ConsoleRect | null {
  const step = large ? 64 : 16;
  const delta: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const move = delta[key];
  if (!move) return null;
  return clampConsoleRect({ ...rect, x: rect.x + move[0], y: rect.y + move[1] }, bounds);
}

/* ---- Device storage -----------------------------------------------------
 * A tiny external store so every reader (and other tabs, through the
 * `storage` event) sees one value, and the server render uses the default
 * without a hydration mismatch. */

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedLayout: ConsoleLayout = DEFAULT_CONSOLE_LAYOUT;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(): string | null {
  try {
    return storage()?.getItem(PLAYER_CONSOLE_LAYOUT_KEY) ?? null;
  } catch {
    return null;
  }
}

export function getStoredConsoleLayout(): ConsoleLayout {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedLayout = parseConsoleLayout(raw);
  }
  return cachedLayout;
}

export function getServerConsoleLayout(): ConsoleLayout {
  return DEFAULT_CONSOLE_LAYOUT;
}

export function saveConsoleLayout(layout: ConsoleLayout): void {
  const raw = serializeConsoleLayout(layout);
  try {
    const store = storage();
    if (isDefaultConsoleLayout(layout)) store?.removeItem(PLAYER_CONSOLE_LAYOUT_KEY);
    else store?.setItem(PLAYER_CONSOLE_LAYOUT_KEY, raw);
  } catch {
    // Private mode or a full quota: the layout still applies for this visit.
  }
  // Reflect the change even when storage refused it.
  cachedRaw = readRaw();
  cachedLayout = cachedRaw === null && !isDefaultConsoleLayout(layout) ? layout : parseConsoleLayout(cachedRaw);
  listeners.forEach((listener) => listener());
}

export function subscribeConsoleLayout(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === PLAYER_CONSOLE_LAYOUT_KEY) listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
