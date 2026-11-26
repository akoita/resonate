"use client";

import { useCallback, useEffect, useState, type DragEvent as ReactDragEvent } from "react";
import { usePlayer } from "../../lib/playerContext";
import { useToast } from "../ui/Toast";
import { useQueueActions } from "../../lib/useQueueActions";
import { getTrack, listTracks, type LocalTrack } from "../../lib/localLibrary";
import {
  canQueueDrag,
  currentQueueDragOffer,
  resolveDroppedTracks,
  subscribeQueueDrag,
} from "../../lib/queueDrag";

export type QueueDropMode = "now" | "next" | "queue";

const LANES: ReadonlyArray<{ mode: QueueDropMode; label: string; hint: string }> = [
  { mode: "now", label: "Play now", hint: "Starts right away" },
  { mode: "next", label: "Up next", hint: "After this track" },
  { mode: "queue", label: "Later", hint: "End of the queue" },
];

/** Whether a drag the queue can take is in progress anywhere in the app. */
export function useQueueDragActive(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => subscribeQueueDrag(setActive), []);
  return active;
}

/** Read what was dropped: an in-memory offer first, then the JSON payload. */
export async function droppedTracks(dataTransfer: DataTransfer): Promise<LocalTrack[]> {
  const offer = currentQueueDragOffer();
  if (offer) return Array.from(await offer.resolve());
  const raw = dataTransfer.getData("application/json") || dataTransfer.getData("text/plain");
  return resolveDroppedTracks(raw, getTrack, listTracks);
}

/**
 * Three drop targets that appear while something queueable is dragged:
 * Play now, Up next (after the current track) and Later (end of the queue).
 * Every drag source also has a menu with the same choices, so nothing here is
 * the only way to queue a track.
 */
export function QueueDropLanes({ className = "" }: { className?: string }) {
  const active = useQueueDragActive();
  const { playTracksNext, playQueue, queue: currentQueue } = usePlayer();
  const { queue } = useQueueActions();
  const { addToast } = useToast();
  const [hover, setHover] = useState<QueueDropMode | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active) setHover(null);
  }, [active]);

  const playNow = useCallback(
    (tracks: LocalTrack[]) => {
      const wasEmpty = currentQueue.length === 0;
      const result = playTracksNext(tracks);
      const first = result.added[0] ?? tracks[0];
      const index = result.queue.findIndex((track) => track.id === first?.id);
      // An empty queue starts playing on its own.
      if (!wasEmpty && index >= 0) void playQueue(result.queue, index, { navigation: true });
      addToast({
        type: "success",
        title: "Playing now",
        message: tracks.length === 1 ? tracks[0].title : `${tracks.length} tracks, starting with ${tracks[0].title}`,
      });
    },
    [addToast, currentQueue.length, playQueue, playTracksNext],
  );

  const onDrop = async (event: ReactDragEvent<HTMLElement>, mode: QueueDropMode) => {
    if (!canQueueDrag(event.dataTransfer.types)) return;
    event.preventDefault();
    event.stopPropagation();
    setHover(null);
    setBusy(true);
    try {
      const tracks = await droppedTracks(event.dataTransfer);
      if (tracks.length === 0) {
        addToast({ type: "info", title: "Nothing to queue", message: "There are no playable tracks in what you dropped." });
        return;
      }
      if (mode === "now") playNow(tracks);
      else queue(tracks, mode);
    } catch {
      addToast({ type: "error", title: "Couldn't queue that", message: "Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  if (!active && !busy) return null;

  return (
    <div className={`queue-drop-lanes ${className}`} role="group" aria-label="Drop to queue" aria-busy={busy}>
      {LANES.map((lane) => (
        <div
          key={lane.mode}
          className={`queue-drop-lane ${hover === lane.mode ? "is-hover" : ""}`}
          data-lane={lane.mode}
          onDragEnter={(event) => {
            if (!canQueueDrag(event.dataTransfer.types)) return;
            event.preventDefault();
            setHover(lane.mode);
          }}
          onDragOver={(event) => {
            if (!canQueueDrag(event.dataTransfer.types)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            if (hover !== lane.mode) setHover(lane.mode);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setHover((current) => (current === lane.mode ? null : current));
          }}
          onDrop={(event) => void onDrop(event, lane.mode)}
        >
          <strong>{lane.label}</strong>
          <small>{busy ? "Adding…" : lane.hint}</small>
        </div>
      ))}
    </div>
  );
}
