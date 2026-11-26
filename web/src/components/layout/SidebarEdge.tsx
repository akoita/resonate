"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDE_QUERY,
  applySidebarLayout,
  getServerSidebarLayout,
  getStoredSidebarLayout,
  saveSidebarLayout,
  sidebarLayoutForDrag,
  sidebarLayoutForKey,
  subscribeSidebarLayout,
  type SidebarLayout,
} from "../../lib/sidebarLayout";

const TABLET_QUERY = "(min-width: 768px) and (max-width: 1279px)";

function subscribeMedia(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const wide = window.matchMedia(SIDEBAR_WIDE_QUERY);
  const tablet = window.matchMedia(TABLET_QUERY);
  wide.addEventListener("change", listener);
  tablet.addEventListener("change", listener);
  return () => {
    wide.removeEventListener("change", listener);
    tablet.removeEventListener("change", listener);
  };
}

function mediaSnapshot(): "wide" | "tablet" | "phone" {
  if (typeof window === "undefined" || !window.matchMedia) return "wide";
  if (window.matchMedia(SIDEBAR_WIDE_QUERY).matches) return "wide";
  return window.matchMedia(TABLET_QUERY).matches ? "tablet" : "phone";
}

/**
 * The sidebar's layout on this device, and whether it shows as the icon rail
 * right now (folded on a wide screen, or any tablet).
 */
export function useSidebarLayout() {
  const layout = useSyncExternalStore(subscribeSidebarLayout, getStoredSidebarLayout, getServerSidebarLayout);
  const media = useSyncExternalStore(subscribeMedia, mediaSnapshot, () => "wide" as const);
  const rail = media === "tablet" || (media === "wide" && layout.collapsed);
  return { layout, media, rail };
}

/**
 * Names every icon in the rail with a tooltip. The link text is still there
 * for screen readers (visually hidden), so only sighted pointer users needed
 * this.
 */
export function useRailTooltips(sidebarRef: RefObject<HTMLElement | null>, rail: boolean) {
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const links = Array.from(sidebar.querySelectorAll<HTMLElement>(".sidebar-link"));
    for (const link of links) {
      const name = link.querySelector(".link-text")?.textContent?.trim();
      if (!name) continue;
      if (rail) link.setAttribute("title", name);
      else if (link.getAttribute("title") === name) link.removeAttribute("title");
    }
  });
}

function ChevronIcon({ pointsRight }: { pointsRight: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
      {pointsRight ? <path d="m13 10 2 2-2 2" /> : <path d="m16 10-2 2 2 2" />}
    </svg>
  );
}

function currentWidthOf(sidebar: HTMLElement | null): number {
  return sidebar ? Math.round(sidebar.getBoundingClientRect().width) : SIDEBAR_MIN_WIDTH;
}

/** Fold or open the sidebar: the visible control for what the edge also does. */
export function SidebarFoldButton({ layout }: { layout: SidebarLayout }) {
  const folded = layout.collapsed;
  return (
    <button
      type="button"
      className="sidebar-fold-btn"
      onClick={() => saveSidebarLayout({ ...layout, collapsed: !folded })}
      aria-label={folded ? "Expand sidebar" : "Collapse sidebar to icons"}
      aria-expanded={!folded}
      aria-controls="primary-navigation"
      title={folded ? "Expand sidebar" : "Collapse sidebar"}
    >
      <ChevronIcon pointsRight={folded} />
    </button>
  );
}

/**
 * The draggable right edge of the sidebar (wide screens only). Drag to size
 * it, past the fold point to fold it to icons; double-click, Enter or Space
 * to fold or open it; arrow keys, Home and End to size it.
 */
export function SidebarResizeEdge({
  sidebarRef,
  layout,
}: {
  sidebarRef: RefObject<HTMLElement | null>;
  layout: SidebarLayout;
}) {
  const [dragging, setDragging] = useState(false);
  // The natural width, measured once mounted, for screen readers' value.
  const [naturalWidth, setNaturalWidth] = useState(SIDEBAR_MIN_WIDTH);
  const layoutRef = useRef(layout);
  useEffect(() => {
    if (layout.width === null && !layout.collapsed) setNaturalWidth(currentWidthOf(sidebarRef.current));
  }, [layout.collapsed, layout.width, sidebarRef]);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const currentWidth = useCallback(() => currentWidthOf(sidebarRef.current), [sidebarRef]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const left = sidebar.getBoundingClientRect().left;
    const start = layoutRef.current;
    let next = start;
    setDragging(true);
    document.documentElement.classList.add("is-resizing-sidebar");
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // Synthetic pointers have nothing to capture.
    }
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      next = sidebarLayoutForDrag(moveEvent.clientX - left, start);
      // Preview on the document only; one write when the drag ends.
      applySidebarLayout(next);
    };
    const finish = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.documentElement.classList.remove("is-resizing-sidebar");
      setDragging(false);
      if (endEvent.type === "pointercancel") {
        applySidebarLayout(start);
        return;
      }
      saveSidebarLayout(next);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = sidebarLayoutForKey(event.key, layoutRef.current, currentWidth());
    if (!next) return;
    event.preventDefault();
    saveSidebarLayout(next);
  };

  const width = layout.collapsed ? SIDEBAR_MIN_WIDTH : layout.width ?? naturalWidth;

  return (
    <div
      className={`sidebar-resize-edge ${dragging ? "is-dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-controls="primary-navigation"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width))}
      aria-valuetext={layout.collapsed ? "Collapsed to icons" : `${width} pixels wide`}
      aria-describedby="sidebar-resize-help"
      tabIndex={0}
      title="Drag to resize. Double-click to collapse or expand."
      onPointerDown={onPointerDown}
      onDoubleClick={() => saveSidebarLayout({ ...layoutRef.current, collapsed: !layoutRef.current.collapsed })}
      onKeyDown={onKeyDown}
    >
      <span id="sidebar-resize-help" className="visually-hidden">
        Use the left and right arrow keys to resize. Press Enter to collapse or expand the sidebar.
      </span>
    </div>
  );
}
