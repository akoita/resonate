"use client";

import { useRef, useState, type ReactNode } from "react";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import type { PlayerConsoleLayoutState } from "./usePlayerConsoleLayout";

function Glyph({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** A window frame with the panel drawn where it would sit. */
function DockGlyph({ side }: { side: "left" | "right" | "floating" | "reset" }) {
  return (
    <Glyph>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      {side === "left" && <rect x="5" y="6" width="5" height="12" rx="1" fill="currentColor" stroke="none" />}
      {side === "right" && <rect x="14" y="6" width="5" height="12" rx="1" fill="currentColor" stroke="none" />}
      {side === "reset" && <path d="M14 6h5v12h-5" />}
      {side === "floating" && <rect x="9" y="8" width="8" height="7" rx="1" fill="currentColor" stroke="none" />}
    </Glyph>
  );
}

export function MoveGripIcon() {
  return (
    <Glyph size={14}>
      <circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

const DOCK_LABEL = {
  right: "docked to the right",
  left: "docked to the left",
  floating: "floating",
} as const;

/**
 * The move handle that opens the console header: drag it (or the header) to
 * move the console, or focus it and use the arrow keys.
 */
export function PlayerConsoleMoveHandle({ layout }: { layout: PlayerConsoleLayoutState }) {
  if (layout.compact) return null;
  const floating = layout.dock === "floating";
  return (
    <button
      type="button"
      className="console-move-handle"
      data-console-move-handle=""
      onKeyDown={layout.onMoveHandleKeyDown}
      aria-label={`Move player console, ${DOCK_LABEL[layout.layout.dock]}`}
      aria-describedby="console-move-help"
      title={floating ? "Drag to move. Drop on a side edge to dock." : "Drag to undock and move"}
    >
      <MoveGripIcon />
      <span id="console-move-help" className="visually-hidden">
        {floating
          ? "Use the arrow keys to move the console; hold Shift for larger steps."
          : "Use the left and right arrow keys to dock the console to that side."}
      </span>
    </button>
  );
}

/** Layout menu and minimize/restore, at the end of the console header. */
export function PlayerConsoleLayoutButtons({
  layout,
  bodyId,
}: {
  layout: PlayerConsoleLayoutState;
  bodyId: string;
}) {
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const current = layout.layout.dock;

  const items: ContextMenuItem[] = [
    { label: "Dock left", icon: <DockGlyph side="left" />, onClick: () => layout.setDock("left"), disabled: current === "left" },
    { label: "Dock right", icon: <DockGlyph side="right" />, onClick: () => layout.setDock("right"), disabled: current === "right" },
    { label: "Undock (float)", icon: <DockGlyph side="floating" />, onClick: () => layout.setDock("floating"), disabled: current === "floating" },
    { label: "", onClick: () => {}, separator: true },
    { label: "Reset layout", icon: <DockGlyph side="reset" />, onClick: layout.reset },
  ];

  const openMenu = () => {
    const rect = menuButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Open below the button, inside the viewport; the menu is ~200px wide.
    setMenu({ x: Math.max(8, Math.min(rect.right - 200, window.innerWidth - 216)), y: rect.bottom + 6 });
  };

  const minimized = layout.minimized;

  return (
    <>
      {!layout.compact && (
        <button
          ref={menuButtonRef}
          type="button"
          className="console-icon-btn"
          // The menu closes on any outside mousedown; keep that from
          // reopening it in the click that follows.
          onMouseDown={(event) => {
            if (menu) event.stopPropagation();
          }}
          onClick={() => (menu ? setMenu(null) : openMenu())}
          aria-label="Console layout"
          aria-haspopup="menu"
          aria-expanded={Boolean(menu)}
          title="Dock, undock or reset the console"
        >
          <DockGlyph side={current} />
        </button>
      )}
      <button
        type="button"
        className="console-icon-btn"
        onClick={layout.toggleMinimized}
        aria-label={minimized ? "Restore player console" : "Minimize player console"}
        aria-expanded={!minimized}
        aria-controls={bodyId}
        title={minimized ? "Restore" : "Minimize"}
      >
        {minimized ? (
          <Glyph>
            <rect x="5" y="5" width="14" height="14" rx="2" />
          </Glyph>
        ) : (
          <Glyph>
            <line x1="6" y1="17" x2="18" y2="17" />
          </Glyph>
        )}
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={items}
          onClose={() => setMenu(null)}
          openerRef={menuButtonRef}
          ariaLabel="Console layout"
        />
      )}
    </>
  );
}

/** The outline of the dock a drop would snap to, shown while dragging. */
export function PlayerConsoleDockPreview({ side }: { side: "left" | "right" | null }) {
  if (!side) return null;
  return <div className={`console-dock-preview console-dock-preview--${side}`} aria-hidden="true" />;
}
