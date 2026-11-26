/**
 * The width of the left navigation, and whether it is folded to icons,
 * remembered per device.
 *
 * Only wide screens (1280px and up) honour it: tablets always show the icon
 * rail and phones the slide-in drawer. A listener who never touches the edge
 * keeps the sidebar's natural width; nothing is stored for them.
 *
 * The root layout's first-paint script (app/layout.tsx) applies the stored
 * value before React hydrates, so a resized or folded sidebar does not jump
 * on load. Keep `SIDEBAR_LAYOUT_KEY` and the attribute names in sync with it.
 */

export interface SidebarLayout {
  /** Chosen width in px, or null for the natural width. */
  width: number | null;
  /** Folded to the icon rail. */
  collapsed: boolean;
}

export const SIDEBAR_LAYOUT_KEY = "resonate.sidebar.v1";
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 340;
export const SIDEBAR_RAIL_WIDTH = 72;
/** Dragging the edge narrower than this folds the sidebar to icons. */
export const SIDEBAR_FOLD_BELOW = 150;
/** One arrow-key step on the resize handle. */
export const SIDEBAR_KEY_STEP = 16;
/** Wide screens honour the stored layout; narrower ones use the rail or drawer. */
export const SIDEBAR_WIDE_QUERY = "(min-width: 1280px)";

export const DEFAULT_SIDEBAR_LAYOUT: SidebarLayout = Object.freeze({ width: null, collapsed: false }) as SidebarLayout;

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)));
}

export function parseSidebarLayout(raw: string | null | undefined): SidebarLayout {
  if (!raw) return DEFAULT_SIDEBAR_LAYOUT;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_SIDEBAR_LAYOUT;
    const record = value as Record<string, unknown>;
    const width =
      typeof record.width === "number" && Number.isFinite(record.width) ? clampSidebarWidth(record.width) : null;
    return { width, collapsed: record.collapsed === true };
  } catch {
    return DEFAULT_SIDEBAR_LAYOUT;
  }
}

export function isDefaultSidebarLayout(layout: SidebarLayout): boolean {
  return layout.width === null && !layout.collapsed;
}

/**
 * Where a drag of the edge lands: past the fold point the sidebar folds to
 * icons (keeping the last width for when it opens again); otherwise it takes
 * the pointer's width within the limits.
 */
export function sidebarLayoutForDrag(pointerWidth: number, previous: SidebarLayout): SidebarLayout {
  if (pointerWidth < SIDEBAR_FOLD_BELOW) return { width: previous.width, collapsed: true };
  return { width: clampSidebarWidth(pointerWidth), collapsed: false };
}

/** One key press on the resize handle, or null for keys it ignores. */
export function sidebarLayoutForKey(
  key: string,
  layout: SidebarLayout,
  currentWidth: number,
): SidebarLayout | null {
  switch (key) {
    case "Enter":
    case " ":
      return { ...layout, collapsed: !layout.collapsed };
    case "ArrowLeft":
      if (layout.collapsed) return null;
      if (currentWidth - SIDEBAR_KEY_STEP < SIDEBAR_MIN_WIDTH) return { ...layout, collapsed: true };
      return { width: clampSidebarWidth(currentWidth - SIDEBAR_KEY_STEP), collapsed: false };
    case "ArrowRight":
      if (layout.collapsed) return { ...layout, collapsed: false };
      return { width: clampSidebarWidth(currentWidth + SIDEBAR_KEY_STEP), collapsed: false };
    case "Home":
      return { width: SIDEBAR_MIN_WIDTH, collapsed: false };
    case "End":
      return { width: SIDEBAR_MAX_WIDTH, collapsed: false };
    default:
      return null;
  }
}

/* ---- Device storage and the document attributes -------------------------- */

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedLayout: SidebarLayout = DEFAULT_SIDEBAR_LAYOUT;

function readRaw(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(SIDEBAR_LAYOUT_KEY);
  } catch {
    return null;
  }
}

export function getStoredSidebarLayout(): SidebarLayout {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedLayout = parseSidebarLayout(raw);
  }
  return cachedLayout;
}

export function getServerSidebarLayout(): SidebarLayout {
  return DEFAULT_SIDEBAR_LAYOUT;
}

/**
 * Mirror a layout onto <html>: `data-sidebar="rail"` folds it and
 * `--sidebar-width` sizes it. CSS applies both only on wide screens.
 */
export function applySidebarLayout(layout: SidebarLayout): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (layout.collapsed) root.setAttribute("data-sidebar", "rail");
  else root.removeAttribute("data-sidebar");
  if (layout.width !== null) root.style.setProperty("--sidebar-width", `${layout.width}px`);
  else root.style.removeProperty("--sidebar-width");
}

export function saveSidebarLayout(layout: SidebarLayout): void {
  try {
    if (isDefaultSidebarLayout(layout)) window.localStorage.removeItem(SIDEBAR_LAYOUT_KEY);
    else window.localStorage.setItem(SIDEBAR_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Private mode or a full quota: the layout still applies for this visit.
  }
  cachedRaw = readRaw();
  cachedLayout = cachedRaw === null && !isDefaultSidebarLayout(layout) ? layout : parseSidebarLayout(cachedRaw);
  applySidebarLayout(cachedLayout);
  listeners.forEach((listener) => listener());
}

export function subscribeSidebarLayout(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SIDEBAR_LAYOUT_KEY) return;
    applySidebarLayout(getStoredSidebarLayout());
    listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/**
 * The first-paint script: the same rules as `applySidebarLayout`, written
 * out by hand because it runs before any bundle loads.
 */
export const SIDEBAR_FIRST_PAINT_SCRIPT =
  `try{var s=JSON.parse(localStorage.getItem("${SIDEBAR_LAYOUT_KEY}")||"null");` +
  `if(s&&s.collapsed===true)document.documentElement.setAttribute("data-sidebar","rail");` +
  `if(s&&typeof s.width==="number"&&isFinite(s.width))document.documentElement.style.setProperty("--sidebar-width",Math.min(${SIDEBAR_MAX_WIDTH},Math.max(${SIDEBAR_MIN_WIDTH},Math.round(s.width)))+"px")}catch(e){}`;
