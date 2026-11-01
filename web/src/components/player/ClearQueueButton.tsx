"use client";
import { useState } from "react";
import { usePlayer } from "../../lib/playerContext";
import type { LocalTrack } from "../../lib/localLibrary";
import type { QueueSource } from "../../lib/listeningSession";
import { canUndoQueueClear, clearQueueIndices } from "../../lib/playerQueue";

/** Same 17px box and stroke as the other Queue Manifest chips. */
function ClearQueueIcon() {
  return <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="3" y1="6" x2="13" y2="6" /><line x1="3" y1="12" x2="11" y2="12" /><line x1="3" y1="18" x2="9" y2="18" />
    <line x1="15" y1="13" x2="21" y2="19" /><line x1="21" y1="13" x2="15" y2="19" />
  </svg>;
}

interface ClearedQueue {
  tracks: LocalTrack[];
  currentIndex: number;
  source: QueueSource;
  keptTrackId: string | null;
  removedCount: number;
}

export interface ClearQueueButtonViewProps {
  /** Tracks Clear queue would take out (everything but the playing track). */
  clearableCount: number;
  /** Tracks the last clear took out, while Undo still applies. */
  undoCount: number | null;
  onClear: () => void;
  onUndo: () => void;
}

/**
 * Clear queue chip for the Queue Manifest. It is a fragment so it shares the
 * chip row with Save queue / View playlist, and its Undo line wraps below.
 */
export function ClearQueueButtonView({ clearableCount, undoCount, onClear, onUndo }: ClearQueueButtonViewProps) {
  return <>
    {clearableCount > 0 && (
      <button
        type="button"
        className="player-action-chip player-action-chip--available"
        onClick={onClear}
        title="Remove every track except the one playing"
      >
        <ClearQueueIcon />Clear queue
      </button>
    )}
    {undoCount !== null && (
      <p className="lc-status queue-clear-status" role="status">
        Cleared {undoCount} {undoCount === 1 ? "track" : "tracks"} from the queue.{" "}
        <button type="button" className="queue-clear-undo" onClick={onUndo}>Undo</button>
      </p>
    )}
  </>;
}

export function ClearQueueButton() {
  const { queue, currentIndex, queueSource, finiteRepeat, clearFiniteRepeat, removeQueueTracks, restoreQueue } = usePlayer();
  const [cleared, setCleared] = useState<ClearedQueue | null>(null);
  const kept = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;
  const clearableCount = queue.length - (kept ? 1 : 0);
  // Any change after the clear (new tracks, a new play) retires the snapshot.
  const undoable = cleared && canUndoQueueClear(cleared.keptTrackId, queue) ? cleared : null;

  return <ClearQueueButtonView
    clearableCount={clearableCount}
    undoCount={undoable ? undoable.removedCount : null}
    onClear={() => {
      setCleared({
        tracks: [...queue],
        currentIndex,
        source: queueSource,
        keptTrackId: kept?.id ?? null,
        removedCount: clearableCount,
      });
      // Clearing the queue cancels a queue repeat plan; a track repeat stays.
      if (finiteRepeat?.target === "queue") clearFiniteRepeat();
      removeQueueTracks(clearQueueIndices(queue.length, kept ? currentIndex : -1));
    }}
    onUndo={() => {
      if (!undoable) return;
      restoreQueue(undoable.tracks, undoable.currentIndex, undoable.source);
      setCleared(null);
    }}
  />;
}
