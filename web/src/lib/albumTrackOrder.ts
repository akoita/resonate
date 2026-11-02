/**
 * Album order for the listener's own files: by disc, then track number, as the
 * tags or the listener's edits give them. Tracks without a number keep their
 * current relative order after the numbered ones, so an album with no numbers
 * at all is left exactly as it was.
 */
export function sortByAlbumPosition<T extends { trackNumber?: number | null; discNumber?: number | null }>(
    tracks: T[],
): T[] {
    if (!tracks.some((t) => t.trackNumber)) return tracks;
    return tracks
        .map((track, index) => ({ track, index }))
        .sort((a, b) => {
            const aNumbered = a.track.trackNumber ? 0 : 1;
            const bNumbered = b.track.trackNumber ? 0 : 1;
            if (aNumbered !== bNumbered) return aNumbered - bNumbered;
            const disc = (a.track.discNumber ?? 1) - (b.track.discNumber ?? 1);
            if (disc !== 0) return disc;
            const position = (a.track.trackNumber ?? 0) - (b.track.trackNumber ?? 0);
            return position !== 0 ? position : a.index - b.index;
        })
        .map(({ track }) => track);
}
