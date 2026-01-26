/**
 * Local Library - IndexedDB storage for user-imported tracks
 * Uses localforage for cross-browser IndexedDB abstraction
 */
import localforage from "localforage";

// Configure localforage
const trackStore = localforage.createInstance({
    name: "resonate",
    storeName: "tracks",
});

const blobStore = localforage.createInstance({
    name: "resonate",
    storeName: "audioBlobs",
});

export interface LocalTrack {
    id: string;
    title: string;
    artist: string | null;
    album: string | null;
    year: number | null;
    genre: string | null;
    duration: number | null;
    blobKey: string;
    createdAt: string;
    // Added for incremental scanning
    sourcePath?: string;
    fileSize?: number;
}

/**
 * Save a track to the local library
 */
export async function saveTrack(
    file: File,
    metadata: Omit<LocalTrack, "id" | "blobKey" | "createdAt">
): Promise<LocalTrack> {
    const id = `local_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const blobKey = `blob_${id}`;

    // Store the audio blob
    await blobStore.setItem(blobKey, file);

    // Store track metadata
    const track: LocalTrack = {
        id,
        ...metadata,
        blobKey,
        createdAt: new Date().toISOString(),
    };

    await trackStore.setItem(id, track);
    return track;
}

/**
 * Get a track by ID
 */
export async function getTrack(id: string): Promise<LocalTrack | null> {
    return trackStore.getItem<LocalTrack>(id);
}

/**
 * Get the audio blob for a track
 */
export async function getTrackBlob(blobKey: string): Promise<Blob | null> {
    return blobStore.getItem<Blob>(blobKey);
}

/**
 * Get a playable URL for a track (creates object URL from blob)
 */
export async function getTrackUrl(track: LocalTrack): Promise<string | null> {
    const blob = await getTrackBlob(track.blobKey);
    if (!blob) return null;
    return URL.createObjectURL(blob);
}

/**
 * List all tracks in the local library
 */
export async function listTracks(): Promise<LocalTrack[]> {
    const tracks: LocalTrack[] = [];
    await trackStore.iterate<LocalTrack, void>((value) => {
        tracks.push(value);
    });
    // Sort by creation date, newest first
    return tracks.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

/**
 * Delete a track from the local library
 */
export async function deleteTrack(id: string): Promise<void> {
    const track = await getTrack(id);
    if (track) {
        await blobStore.removeItem(track.blobKey);
        await trackStore.removeItem(id);
    }
}

/**
 * Clear all tracks from the local library
 */
export async function clearLibrary(): Promise<void> {
    await trackStore.clear();
    await blobStore.clear();
}
