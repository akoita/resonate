"use client";

import { useCallback, useMemo } from "react";
import { usePlayer } from "./playerContext";
import { useToast } from "../components/ui/Toast";
import { useUIStore } from "./uiStore";
import { describeQueueResult, type QueueFeedbackMode } from "./queueFeedback";
import type { LocalTrack } from "./localLibrary";
import type { ContextMenuItem } from "../components/ui/ContextMenu";
import type { ActionMenuItem } from "../components/ui/TrackActionMenu";
import { AddToQueueIcon, PlayNextIcon, RepeatIcon } from "../components/ui/MenuIcons";

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
  const setTrackForRepeats = useUIStore((state) => state.setTrackForRepeats);

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
      { label: "Play Next", icon: <PlayNextIcon />, onClick: () => queue(tracks, "next") },
      { label: "Add to Queue", icon: <AddToQueueIcon />, onClick: () => queue(tracks, "queue") },
      // Repeats are per track, so the entry only appears for a single track.
      ...(Array.isArray(tracks) ? [] : [{ label: "Set Repeats…", icon: <RepeatIcon />, onClick: () => setTrackForRepeats(tracks) }]),
    ],
    [queue, setTrackForRepeats],
  );

  /** Entries for the ⋮ overflow menu used on release and browse rows. */
  const actionMenuItems = useCallback(
    (tracks: LocalTrack | LocalTrack[]): ActionMenuItem[] => [
      { label: "Play next", icon: <PlayNextIcon />, onClick: () => queue(tracks, "next") },
      { label: "Add to queue", icon: <AddToQueueIcon />, onClick: () => queue(tracks, "queue") },
      ...(Array.isArray(tracks) ? [] : [{ label: "Set repeats…", icon: <RepeatIcon />, onClick: () => setTrackForRepeats(tracks) }]),
    ],
    [queue, setTrackForRepeats],
  );

  return useMemo(
    () => ({ queue, contextMenuItems, actionMenuItems }),
    [queue, contextMenuItems, actionMenuItems],
  );
}
