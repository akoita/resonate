"use client";

import { useCallback, useState } from "react";
import type { Release } from "../../lib/api";
import { mapReleaseToLocalTracks } from "../../lib/catalogReleaseTracks";
import { saveTracksMetadata } from "../../lib/localLibrary";
import { useAddToPlaylist } from "../library/useAddToPlaylist";
import { useToast } from "../ui/Toast";
import type { CatalogCardAction } from "./CatalogReleaseCard";

/**
 * The "Add to playlist" and "Save to library" overlay actions of a
 * `CatalogReleaseCard`, shared by `/catalog` and the home catalog snapshot so
 * the same card offers the same actions wherever it appears.
 */
export function useCatalogReleaseActions() {
  const [savingReleaseId, setSavingReleaseId] = useState<string | null>(null);
  const { addToast } = useToast();
  const { openAddToPlaylist } = useAddToPlaylist();

  const addReleaseToPlaylist = useCallback(
    (release: Release) => {
      openAddToPlaylist(
        mapReleaseToLocalTracks(release),
        `${release.title} does not have playable tracks in the catalog yet.`,
      );
    },
    [openAddToPlaylist],
  );

  const saveReleaseToLibrary = useCallback(
    async (release: Release) => {
      const tracks = mapReleaseToLocalTracks(release);
      if (tracks.length === 0) {
        addToast({
          type: "info",
          title: "No tracks yet",
          message: `${release.title} does not have playable tracks in the catalog yet.`,
        });
        return;
      }

      setSavingReleaseId(release.id);
      try {
        await saveTracksMetadata(tracks, "remote");
        addToast({
          type: "success",
          title: "Saved to Library",
          message: `Saved ${tracks.length} track${tracks.length > 1 ? "s" : ""} from ${release.title}.`,
        });
      } catch (error) {
        console.error("Failed to save catalog release to library:", error);
        addToast({
          type: "error",
          title: "Save failed",
          message: "Could not save this release to your library.",
        });
      } finally {
        setSavingReleaseId(null);
      }
    },
    [addToast],
  );

  const releaseActions = useCallback(
    (release: Release): CatalogCardAction[] => [
      {
        icon: "playlist_add",
        label: `Add ${release.title} to playlist`,
        onClick: () => addReleaseToPlaylist(release),
        disabled: !release.tracks?.length,
      },
      {
        icon: "library_add",
        label: `Save ${release.title} to library`,
        onClick: () => void saveReleaseToLibrary(release),
        disabled: !release.tracks?.length,
        busy: savingReleaseId === release.id,
      },
    ],
    [addReleaseToPlaylist, saveReleaseToLibrary, savingReleaseId],
  );

  return { releaseActions };
}
