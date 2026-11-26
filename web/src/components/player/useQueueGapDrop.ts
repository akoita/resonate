"use client";

import { useState, type DragEvent as ReactDragEvent } from "react";
import { usePlayer } from "../../lib/playerContext";
import { canQueueDrag, draggedQueueRowIndex, queueGapForPointer } from "../../lib/queueDrag";
import { useToast } from "../ui/Toast";
import { droppedTracks } from "./QueueDropLanes";

const acceptsDrag = (types: DataTransfer["types"]) =>
  draggedQueueRowIndex(types) !== null || canQueueDrag(types);

/**
 * Drop targets between queue rows: drag a row to reorder it, or drop anything
 * queueable between two rows to insert it there. Spread `listProps` on the
 * list and `rowProps(index)` on each row (which needs `data-queue-index`), and
 * mark the gap with `dropGap` (0 = before the first row, length = after the last).
 */
export function useQueueGapDrop(queueLength: number) {
  const { moveInQueue, insertTracksAt } = usePlayer();
  const { addToast } = useToast();
  const [dropGap, setDropGap] = useState<number | null>(null);

  const onDrop = async (event: ReactDragEvent<HTMLElement>) => {
    setDropGap(null);
    if (!acceptsDrag(event.dataTransfer.types)) return;
    event.preventDefault();
    event.stopPropagation();
    // Work the gap out from the drop itself, not from the last dragover.
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-queue-index]");
    let gap = queueLength;
    if (row) {
      const rect = row.getBoundingClientRect();
      gap = queueGapForPointer(Number(row.dataset.queueIndex), event.clientY, rect.top, rect.height);
    }
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
        addToast({ type: "success", title: "Added to the queue", message: count === 1 ? result.added[0].title : `${count} tracks` });
      }
    } catch {
      addToast({ type: "error", title: "Couldn't queue that", message: "Check your connection and try again." });
    }
  };

  const listProps = {
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      // Below the last row: the end of the queue.
      if (event.target !== event.currentTarget || !acceptsDrag(event.dataTransfer.types)) return;
      event.preventDefault();
      if (dropGap !== queueLength) setDropGap(queueLength);
    },
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => {
      // Some engines leave relatedTarget empty, so check the pointer too.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const inside = event.clientX > rect.left && event.clientX < rect.right && event.clientY > rect.top && event.clientY < rect.bottom;
      if (!inside) setDropGap(null);
    },
    onDragEnd: () => setDropGap(null),
    onDrop: (event: ReactDragEvent<HTMLElement>) => void onDrop(event),
  };

  const rowProps = (index: number) => ({
    "data-queue-index": index,
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      if (!acceptsDrag(event.dataTransfer.types)) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      const gap = queueGapForPointer(index, event.clientY, rect.top, rect.height);
      event.dataTransfer.dropEffect = draggedQueueRowIndex(event.dataTransfer.types) !== null ? "move" : "copy";
      if (gap !== dropGap) setDropGap(gap);
    },
  });

  /** Class names for a row: the line before it, or after the last row. */
  const rowDropClass = (index: number) =>
    dropGap === index ? "is-drop-before" : dropGap === queueLength && index === queueLength - 1 ? "is-drop-after" : "";

  return { dropGap, listProps, rowProps, rowDropClass };
}
