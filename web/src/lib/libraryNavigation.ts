export type LibraryNavigationTrack = {
  artist?: string | null;
  creditedArtistId?: string | null;
  creditedArtistName?: string | null;
  catalogTrackId?: string | null;
  releaseId?: string | null;
};

export function libraryArtistNameForProfile(
  artistProfileId: string,
  tracks: LibraryNavigationTrack[],
): string | null {
  const match = tracks.find((track) => track.creditedArtistId === artistProfileId);
  return match?.artist || match?.creditedArtistName || null;
}

export function libraryArtistNameForCatalogCredit(
  creditedName: string,
  tracks: LibraryNavigationTrack[],
): string | null {
  const normalizedName = creditedName.trim().toLowerCase();
  const match = tracks.find(
    (track) => track.artist?.trim().toLowerCase() === normalizedName,
  );
  return match?.artist || null;
}

export function isCatalogReleaseFullySaved(
  releaseId: string,
  releaseTrackIds: string[],
  libraryTracks: LibraryNavigationTrack[],
): boolean {
  if (releaseTrackIds.length === 0) return false;
  const expectedTrackIds = new Set(releaseTrackIds);
  const savedTrackIds = new Set(
    libraryTracks
      .filter(
        (track) =>
          track.releaseId === releaseId ||
          expectedTrackIds.has(track.catalogTrackId || ""),
      )
      .map((track) => track.catalogTrackId)
      .filter((trackId): trackId is string => Boolean(trackId)),
  );
  return releaseTrackIds.every((trackId) => savedTrackIds.has(trackId));
}

export function releaseActionNoun(type?: string | null): "single" | "album" | "release" {
  const normalizedType = type?.trim().toLowerCase();
  if (normalizedType === "single") return "single";
  if (normalizedType === "album") return "album";
  return "release";
}
