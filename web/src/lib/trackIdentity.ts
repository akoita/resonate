/**
 * The one place that decides whether a track is a listener's own device file
 * or a platform track (#2508).
 *
 * The two share a client type, so scattered checks on optional fields
 * (`catalogTrackId`, `remoteUrl`, `blobKey`) drift apart and let a local file
 * act like a release. Ask these helpers instead.
 */
type TrackIdentityFields = {
    id: string;
    source?: "local" | "remote";
    catalogTrackId?: string | null;
    blobKey?: string;
    remoteUrl?: string;
};

/** A device-local file the listener added, as opposed to a platform track. */
export function isLocalFileTrack(track: Pick<TrackIdentityFields, "source">): boolean {
    return track.source === "local";
}

/**
 * The catalog track id behind a library entry, or null for a device file or
 * an entry with no catalog identity. Use it for anything that leaves the
 * device: analytics, saved queues, playlists other people see, AI DJ seeds.
 */
export function catalogTrackIdOf(track: TrackIdentityFields): string | null {
    if (isLocalFileTrack(track)) return null;
    if (track.catalogTrackId) return track.catalogTrackId;
    // Rows cached before `source` was recorded: an in-browser copy is local.
    if (track.blobKey) return null;
    return track.source === "remote" || track.remoteUrl ? track.id : null;
}

/** A platform track with a catalog identity. */
export function isCatalogTrack(track: TrackIdentityFields): boolean {
    return catalogTrackIdOf(track) !== null;
}

/**
 * Whether a library row is one of the listener's own files. Unlike
 * {@link isLocalFileTrack} it also counts rows cached before `source` was
 * recorded that hold an in-browser copy.
 */
export function isOwnFileTrack(track: Pick<TrackIdentityFields, "source" | "blobKey">): boolean {
    return isLocalFileTrack(track) || (!track.source && Boolean(track.blobKey));
}

/** The library's "where is it from" filter: everything, platform tracks, or the listener's own files. */
export type LibraryOriginFilter = "all" | "catalog" | "local";

export const LIBRARY_ORIGIN_FILTERS: ReadonlyArray<{ value: LibraryOriginFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "catalog", label: "Resonate" },
    { value: "local", label: "My files" },
];

export function matchesLibraryOriginFilter(
    track: Pick<TrackIdentityFields, "source" | "blobKey">,
    filter: LibraryOriginFilter,
): boolean {
    if (filter === "all") return true;
    return isOwnFileTrack(track) === (filter === "local");
}
