"use client";

import { useEffect, useRef, type RefObject } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePlayer } from "../../lib/playerContext";
import { formatDuration } from "../../lib/metadataExtractor";
import { startQueueRowDrag } from "../../lib/queueDrag";
import { useUIStore } from "../../lib/uiStore";
import { usePlayerConsoleLayout } from "./usePlayerConsoleLayout";
import { PlayerConsoleDockPreview, PlayerConsoleLayoutButtons, PlayerConsoleMoveHandle } from "./PlayerConsoleLayoutControls";
import { QueueDropLanes, useQueueDragActive } from "./QueueDropLanes";
import { ListeningControls } from "./ListeningControls";
import type { LocalTrack } from "../../lib/localLibrary";

const DOCK_BODY_ID = "session-dock-body";

function minutesLeft(queue: LocalTrack[], fromIndex: number): number {
  const seconds = queue.slice(Math.max(0, fromIndex)).reduce((sum, track) => sum + (track.duration ?? 0), 0);
  return Math.round(seconds / 60);
}

function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="m21 3-7 7" />
      <path d="m3 21 7-7" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true" focusable="false">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/** The queue as compact rows: play on click, remove, drag onto a playlist. */
export function SessionQueueList({ onPlayed }: { onPlayed?: () => void }) {
  const { queue, currentIndex, playQueue, removeFromQueue } = usePlayer();
  const listRef = useRef<HTMLOListElement>(null);

  // Keep the playing row in view as the queue advances.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>("[aria-current='true']");
    row?.scrollIntoView({ block: "nearest" });
  }, [currentIndex]);

  if (queue.length === 0) {
    return <p className="session-queue-empty">Drag a track, a release or a playlist here, or press play anywhere, to start a session.</p>;
  }

  return (
    <ol ref={listRef} className="session-queue" aria-label="Queue">
      {queue.map((track, index) => {
        const current = index === currentIndex;
        return (
          <li
            key={`${track.id}-${index}`}
            className={`session-queue__row ${current ? "is-current" : ""} ${index < currentIndex ? "is-played" : ""}`}
            aria-current={current ? "true" : undefined}
            draggable
            onDragStart={(event) => startQueueRowDrag(event.dataTransfer, track)}
          >
            <button
              type="button"
              className="session-queue__play"
              onClick={() => {
                void playQueue(queue, index, { navigation: true });
                onPlayed?.();
              }}
              aria-label={`${current ? "Playing" : "Play"} ${track.title}${track.artist ? ` by ${track.artist}` : ""}`}
            >
              <span className="session-queue__title">{track.title}</span>
              <span className="session-queue__artist">{track.artist || "Unknown artist"}</span>
            </button>
            <span className="session-queue__time">{formatDuration(track.duration)}</span>
            <button
              type="button"
              className="session-queue__remove"
              onClick={() => removeFromQueue(index)}
              aria-label={`Remove ${track.title} from queue`}
              title="Remove from queue"
            >
              <RemoveIcon />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function NowPlaying({ compact = false }: { compact?: boolean }) {
  const { currentTrack, artworkUrl, progress } = usePlayer();
  if (!currentTrack) return null;
  return (
    <div className={`session-now ${compact ? "session-now--compact" : ""}`}>
      <span className="session-now__art" style={{ ["--progress" as string]: `${Math.max(0, Math.min(100, progress || 0))}%` }}>
        {artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artworkUrl} alt="" />
        ) : (
          <span className="session-now__art-empty" aria-hidden="true">♪</span>
        )}
      </span>
      <span className="session-now__text">
        <strong>{currentTrack.title}</strong>
        <span>{currentTrack.artist || "Unknown artist"}</span>
      </span>
    </div>
  );
}

function QueuePlace() {
  const { queue, currentIndex } = usePlayer();
  if (queue.length === 0) return null;
  const left = minutesLeft(queue, currentIndex);
  return (
    <span className="session-place">
      {currentIndex + 1} / {queue.length}
      {left > 0 ? ` · ${left} min` : ""}
    </span>
  );
}

/**
 * The Session Dock: now playing and the queue on every page but /player
 * (which has the full console). It shares the console's layout on this
 * device: docked left or right, floating, or folded into a capsule above the
 * player bar. While something queueable is dragged it opens drop lanes, even
 * when the queue is empty.
 */
export function SessionDock({ stageRef }: { stageRef: RefObject<HTMLElement | null> }) {
  const pathname = usePathname();
  const dockRef = useRef<HTMLElement>(null);
  const { currentTrack, queue } = usePlayer();
  const dragging = useQueueDragActive();
  const layout = usePlayerConsoleLayout({ stageRef, consoleRef: dockRef, immersive: false });

  const onPlayerPage = pathname === "/player";
  const hasSession = Boolean(currentTrack) || queue.length > 0;
  if (onPlayerPage || layout.compact || (!hasSession && !dragging)) return null;

  const minimized = layout.minimized;
  // A folded dock is a capsule: it keeps its floating spot but not its size.
  const style =
    layout.dock === "floating" && layout.style
      ? minimized
        ? { left: layout.style.left, top: layout.style.top }
        : layout.style
      : undefined;

  return (
    <>
      <PlayerConsoleDockPreview side={layout.snapPreview} />
      <aside
        ref={dockRef}
        id="session-dock"
        aria-label="Session"
        className={[
          "session-dock",
          `session-dock--${layout.dock}`,
          minimized ? "is-minimized" : "",
          dragging ? "is-drop-target" : "",
          layout.interaction === "move" ? "is-moving" : "",
          layout.interaction === "resize" ? "is-resizing" : "",
        ].filter(Boolean).join(" ")}
        style={style}
      >
        <div className="session-dock__head" onPointerDown={layout.onHeaderPointerDown}>
          <PlayerConsoleMoveHandle layout={layout} />
          {minimized ? <NowPlaying compact /> : <span className="session-dock__label">Session</span>}
          {minimized ? <QueuePlace /> : null}
          <span className="session-dock__actions">
            {!minimized ? (
              <Link href="/player" className="console-icon-btn" aria-label="Open the full player" title="Open the full player">
                <ExpandIcon />
              </Link>
            ) : null}
            <PlayerConsoleLayoutButtons layout={layout} bodyId={DOCK_BODY_ID} />
          </span>
        </div>
        {minimized ? (
          <QueueDropLanes className="queue-drop-lanes--capsule" />
        ) : (
          <div className="session-dock__body" id={DOCK_BODY_ID}>
            <NowPlaying />
            <QueueDropLanes />
            <div className="session-dock__queue-head">
              <span>Up next</span>
              <QueuePlace />
            </div>
            <SessionQueueList />
            <div className="session-dock__listening">
              <ListeningControls key={currentTrack?.id} />
            </div>
          </div>
        )}
        {layout.dock === "floating" && !minimized ? (
          <div
            className="console-resize-handle"
            onPointerDown={layout.onResizePointerDown}
            aria-hidden="true"
            title="Drag to resize"
          />
        ) : null}
      </aside>
    </>
  );
}

/**
 * Phones: the player bar is the folded dock. Its queue button slides this
 * sheet up with now playing and the queue; tapping outside, the close button
 * or Escape slides it away.
 */
export function SessionSheet() {
  const open = useUIStore((state) => state.isSessionSheetOpen);
  const setOpen = useUIStore((state) => state.setSessionSheetOpen);
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="session-sheet"
      aria-label="Session"
      onClose={() => setOpen(false)}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      {open ? (
        <div className="session-sheet__panel">
          <div className="session-sheet__head">
            <span className="session-sheet__grab" aria-hidden="true" />
            <span className="session-dock__label">Session</span>
            <QueuePlace />
            <button type="button" className="console-icon-btn" onClick={() => setOpen(false)} aria-label="Close session">
              <RemoveIcon />
            </button>
          </div>
          <NowPlaying />
          <div className="session-dock__queue-head">
            <span>Up next</span>
            <Link href="/player" className="session-sheet__full" onClick={() => setOpen(false)}>
              Full player
            </Link>
          </div>
          <SessionQueueList />
        </div>
      ) : null}
    </dialog>
  );
}
