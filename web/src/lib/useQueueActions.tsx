"use client";

import { useCallback, useMemo } from "react";
import { usePlayer } from "./playerContext";
import { useToast } from "../components/ui/Toast";
import { describeQueueResult, type QueueFeedbackMode } from "./queueFeedback";
import type { LocalTrack } from "./localLibrary";
import type { ContextMenuItem } from "../components/ui/ContextMenu";
import type { ActionMenuItem } from "../components/ui/TrackActionMenu";

/**
 * Queueing, in one place, for every surface that lists a track.
 *
 * "Play next" and "Add to queue" were reachable from four screens and absent
 * from the rest, and each of those four hand-rolled its own toast wording. A
 * listener should be able to queue whatever they are looking at, wherever
 * they are looking at it, and be told the same thing each time.
 */
export function useQueueActions() {
  const { addTracksToQueue, playTracksNext } = usePlayer();
  const { addToast } = useToast();

  /** Queue one or more tracks and announce the outcome. */
  const queue = useCallback(
    (tracks: LocalTrack | LocalTrack[], mode: QueueFeedbackMode) => {
      const list = Array.isArray(tracks) ? tracks : [tracks];
      if (list.length === 0) return;
      const result = mode === "next" ? playTracksNext(list) : addTracksToQueue(list);
      addToast(describeQueueResult(result, mode));
    },
    [addTracksToQueue, playTracksNext, addToast],
  );

  /** Right-click / long-press menu entries. */
  const contextMenuItems = useCallback(
    (tracks: LocalTrack | LocalTrack[]): ContextMenuItem[] => [
      { label: "Play Next", icon: "⏭️", onClick: () => queue(tracks, "next") },
      { label: "Add to Queue", icon: "➕", onClick: () => queue(tracks, "queue") },
    ],
    [queue],
  );

  /** Entries for the ⋮ overflow menu used on release and browse rows. */
  const actionMenuItems = useCallback(
    (tracks: LocalTrack | LocalTrack[]): ActionMenuItem[] => [
      { label: "Play next", icon: <NextGlyph />, onClick: () => queue(tracks, "next") },
      { label: "Add to queue", icon: <QueueGlyph />, onClick: () => queue(tracks, "queue") },
    ],
    [queue],
  );

  return useMemo(
    () => ({ queue, contextMenuItems, actionMenuItems }),
    [queue, contextMenuItems, actionMenuItems],
  );
}

function QueueGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="14" y2="6" />
      <line x1="3" y1="12" x2="14" y2="12" />
      <line x1="3" y1="18" x2="10" y2="18" />
      <line x1="18" y1="11" x2="18" y2="21" />
      <line x1="13" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function NextGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="4 5 13 12 4 19 4 5" fill="currentColor" stroke="none" />
      <line x1="18" y1="6" x2="18" y2="18" />
    </svg>
  );
}
