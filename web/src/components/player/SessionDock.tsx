"use client";

import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePlayer } from "../../lib/playerContext";
import { formatDuration } from "../../lib/metadataExtractor";
import { canQueueDrag, draggedQueueRowIndex, queueGapForPointer, startQueueRowDrag } from "../../lib/queueDrag";
import { useToast } from "../ui/Toast";
import { useUIStore } from "../../lib/uiStore";
import { setConsoleMinimized } from "../../lib/playerConsoleLayout";
import { GlobalPlaylistPanel } from "../layout/GlobalPlaylistPanel";
import { usePlayerConsoleLayout } from "./usePlayerConsoleLayout";
import { PlayerConsoleDockPreview, PlayerConsoleLayoutButtons, PlayerConsoleMoveHandle } from "./PlayerConsoleLayoutControls";
import { QueueDropLanes, droppedTracks, useQueueDragActive } from "./QueueDropLanes";
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

/**
 * The queue as compact rows: play on click, remove, drag onto a playlist,
 * drag up or down to reorder (Alt + arrow keys do the same), and drop
 * anything queueable between two rows to put it exactly there.
 */
export function SessionQueueList({ onPlayed }: { onPlayed?: () => void }) {
  const { queue, currentIndex, playQueue, removeFromQueue, moveInQueue, insertTracksAt } = usePlayer();
  const { addToast } = useToast();
  const listRef = useRef<HTMLOListElement>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const focusTrackId = useRef<string | null>(null);

  // Keep the playing row in view as the queue advances.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>("[aria-current='true']");
    row?.scrollIntoView({ block: "nearest" });
  }, [currentIndex]);

  // After a keyboard move, keep focus on the row that moved.
  useEffect(() => {
    const id = focusTrackId.current;
    if (!id) return;
    focusTrackId.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(id)}"] .session-queue__play`)
      ?.focus();
  }, [queue]);

  const acceptsDrag = (types: DataTransfer["types"]) =>
    draggedQueueRowIndex(types) !== null || canQueueDrag(types);

  const onRowDragOver = (event: ReactDragEvent<HTMLLIElement>, index: number) => {
    if (!acceptsDrag(event.dataTransfer.types)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const gap = queueGapForPointer(index, event.clientY, rect.top, rect.height);
    event.dataTransfer.dropEffect = draggedQueueRowIndex(event.dataTransfer.types) !== null ? "move" : "copy";
    if (gap !== dropGap) setDropGap(gap);
  };

  const onDrop = async (event: ReactDragEvent<HTMLOListElement>) => {
    setDropGap(null);
    if (!acceptsDrag(event.dataTransfer.types)) return;
    // Work the gap out from the drop itself, not from the last dragover.
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-queue-index]");
    let gap = queue.length;
    if (row) {
      const rect = row.getBoundingClientRect();
      gap = queueGapForPointer(Number(row.dataset.queueIndex), event.clientY, rect.top, rect.height);
    }
    event.preventDefault();
    event.stopPropagation();
    const from = draggedQueueRowIndex(event.dataTransfer.types);
    if (from !== null) {
      moveInQueue(from, gap);
      return;
    }
    try {
      const tracks = await droppedTracks(event.dataTransfer);
      if (tracks.length === 0) {
        addToast({ type: "info", title: "Nothing to queue", message: "There are no playable tracks in what you dropped." });
        return;
      }
      const result = insertTracksAt(tracks, gap);
      const count = result.added.length;
      if (count > 0) {
        addToast({
          type: "success",
          title: "Added to the queue",
          message: count === 1 ? result.added[0].title : `${count} tracks`,
        });
      }
    } catch {
      addToast({ type: "error", title: "Couldn't queue that", message: "Check your connection and try again." });
    }
  };

  const moveByKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number, track: LocalTrack) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const up = event.key === "ArrowUp";
    if ((up && index === 0) || (!up && index === queue.length - 1)) return;
    focusTrackId.current = track.id;
    moveInQueue(index, up ? index - 1 : index + 2);
    setAnnouncement(`${track.title} moved to position ${up ? index : index + 2} of ${queue.length}`);
  };

  if (queue.length === 0) {
    return <p className="session-queue-empty">Drag a track, a release or a playlist here, or press play anywhere, to start a session.</p>;
  }

  return (
    <>
      <ol
        ref={listRef}
        className={`session-queue ${dropGap !== null ? "is-drop-target" : ""}`}
        aria-label="Queue"
        aria-describedby="session-queue-help"
        onDragOver={(event) => {
          // Below the last row: the end of the queue.
          if (event.target !== event.currentTarget || !acceptsDrag(event.dataTransfer.types)) return;
          event.preventDefault();
          if (dropGap !== queue.length) setDropGap(queue.length);
        }}
        onDragLeave={(event) => {
          // Some engines leave relatedTarget empty, so check the pointer too.
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const inside = event.clientX > rect.left && event.clientX < rect.right && event.clientY > rect.top && event.clientY < rect.bottom;
          if (!inside) setDropGap(null);
        }}
        onDragEnd={() => setDropGap(null)}
        onDrop={(event) => void onDrop(event)}
      >
        {queue.map((track, index) => {
          const current = index === currentIndex;
          return (
            <li
              key={`${track.id}-${index}`}
              data-track-id={track.id}
              data-queue-index={index}
              className={[
                "session-queue__row",
                current ? "is-current" : "",
                index < currentIndex ? "is-played" : "",
                dropGap === index ? "is-drop-before" : "",
                dropGap === queue.length && index === queue.length - 1 ? "is-drop-after" : "",
              ].filter(Boolean).join(" ")}
              aria-current={current ? "true" : undefined}
              draggable
              onDragStart={(event) => startQueueRowDrag(event.dataTransfer, track, index)}
              onDragOver={(event) => onRowDragOver(event, index)}
            >
              <button
                type="button"
                className="session-queue__play"
                onClick={() => {
                  void playQueue(queue, index, { navigation: true });
                  onPlayed?.();
                }}
                onKeyDown={(event) => moveByKey(event, index, track)}
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
      <span id="session-queue-help" className="visually-hidden">
        Drag a row to reorder, or press Alt with the up or down arrow on a track to move it.
      </span>
      <span className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
    </>
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
  const playlistsOpen = useUIStore((state) => state.isPlaylistPanelOpen);
  const openPlaylists = useUIStore((state) => state.openPlaylistPanel);
  const closePlaylists = useUIStore((state) => state.closePlaylistPanel);
  const setDockAvailable = useUIStore((state) => state.setDockAvailable);

  const onPlayerPage = pathname === "/player";
  const available = !onPlayerPage && !layout.compact;
  const hasSession = Boolean(currentTrack) || queue.length > 0;

  useEffect(() => {
    setDockAvailable(available);
  }, [available, setDockAvailable]);
  useEffect(() => () => setDockAvailable(false), [setDockAvailable]);

  // Opening the playlists (top bar, Ctrl+J) unfolds a folded dock.
  useEffect(() => {
    if (available && playlistsOpen) setConsoleMinimized(false);
  }, [available, playlistsOpen]);

  if (!available || (!hasSession && !dragging && !playlistsOpen)) return null;

  const minimized = layout.minimized;
  const tab: "session" | "playlists" = playlistsOpen ? "playlists" : "session";
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
          {minimized ? (
            <NowPlaying compact />
          ) : (
            <div className="session-dock__tabs" role="tablist" aria-label="Dock">
              <button
                type="button"
                role="tab"
                id="session-dock-tab-session"
                aria-selected={tab === "session"}
                aria-controls={DOCK_BODY_ID}
                className="session-dock__tab"
                onClick={closePlaylists}
                // Spring-loaded: dragging a track over the tab opens the queue
                // so it can be dropped at an exact spot.
                onDragEnter={(event) => {
                  if (canQueueDrag(event.dataTransfer.types)) closePlaylists();
                }}
              >
                Session
              </button>
              <button
                type="button"
                role="tab"
                id="session-dock-tab-playlists"
                aria-selected={tab === "playlists"}
                aria-controls={DOCK_BODY_ID}
                className="session-dock__tab"
                onClick={openPlaylists}
                // Dragging something over the tab opens the playlists to drop it on one.
                onDragEnter={(event) => {
                  if (draggedQueueRowIndex(event.dataTransfer.types) !== null || canQueueDrag(event.dataTransfer.types)) openPlaylists();
                }}
              >
                Playlists
              </button>
            </div>
          )}
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
          <div
            className={`session-dock__body session-dock__body--${tab}`}
            id={DOCK_BODY_ID}
            role="tabpanel"
            aria-labelledby={tab === "session" ? "session-dock-tab-session" : "session-dock-tab-playlists"}
          >
            <QueueDropLanes />
            {tab === "session" ? (
              <>
                <NowPlaying />
                <div className="session-dock__queue-head">
                  <span>Up next</span>
                  <QueuePlace />
                </div>
                <SessionQueueList />
                {hasSession ? (
                  <div className="session-dock__listening">
                    <ListeningControls key={currentTrack?.id} />
                  </div>
                ) : null}
              </>
            ) : (
              <GlobalPlaylistPanel variant="embedded" isOpen onClose={closePlaylists} />
            )}
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
      // Land focus on the sheet itself, not on its close button, so a tap
      // does not open with a focus ring on "close". Tab still reaches it.
      dialog.querySelector<HTMLElement>(".session-sheet__panel")?.focus({ preventScroll: true });
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
        <div className="session-sheet__panel" tabIndex={-1}>
          <div className="session-sheet__head">
            <span className="session-sheet__grab" aria-hidden="true" />
            <span className="session-sheet__title">Session</span>
            <QueuePlace />
            <button type="button" className="session-sheet__close" onClick={() => setOpen(false)} aria-label="Close session">
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
