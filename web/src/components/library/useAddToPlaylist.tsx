"use client";

import { useCallback } from "react";
import type { LocalTrack } from "../../lib/localLibrary";
import { useUIStore } from "../../lib/uiStore";
import { useToast } from "../ui/Toast";

/**
 * Opens the app-wide "Add to Playlist" picker (the `AddToPlaylistModal` that
 * `AppShell` renders from `uiStore`) for a set of tracks. One picker for every
 * surface — catalog cards, library selection, library artist page — so the
 * flow and its toasts read the same everywhere.
 *
 * `emptyMessage` is shown instead of opening an empty picker.
 */
export function useAddToPlaylist() {
  const setTracksToAddToPlaylist = useUIStore((state) => state.setTracksToAddToPlaylist);
  const { addToast } = useToast();

  const openAddToPlaylist = useCallback(
    (tracks: LocalTrack[], emptyMessage = "There are no playable tracks to add yet.") => {
      if (tracks.length === 0) {
        addToast({ type: "info", title: "No tracks yet", message: emptyMessage });
        return;
      }
      setTracksToAddToPlaylist(tracks);
    },
    [addToast, setTracksToAddToPlaylist],
  );

  return { openAddToPlaylist };
}
