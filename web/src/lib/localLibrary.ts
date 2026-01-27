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

const artworkStore = localforage.createInstance({
    name: "resonate",
    storeName: "artwork",
});

export interface LocalTrack {
    id: string;
    title: string;
    artist: string | null;
    albumArtist: string | null;
    album: string | null;
    year: number | null;
    genre: string | null;
    duration: number | null;
    blobKey?: string; // Optional for remote tracks
    artworkKey?: string | null;
    createdAt: string;
    remoteUrl?: string; // For streaming catalog
    remoteArtworkUrl?: string; // For streaming catalog
    sourcePath?: string;
    fileSize?: number;
}

/**
 * Save a track to the local library
 */
export async function saveTrack(
    file: File,
    metadata: Omit<LocalTrack, "id" | "blobKey" | "artworkKey" | "createdAt">,
    artworkBlob?: Blob | null
): Promise<LocalTrack> {
    const id = `local_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const blobKey = `blob_${id}`;

    // Store the audio blob
    await blobStore.setItem(blobKey, file);

    // Store artwork if provided
    let artworkKey: string | null = null;
    if (artworkBlob) {
        artworkKey = `artwork_${id}`;
        await artworkStore.setItem(artworkKey, artworkBlob);
    }

    // Store track metadata
    const track: LocalTrack = {
        id,
        ...metadata,
        blobKey,
        artworkKey,
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
    if (track.remoteUrl) return track.remoteUrl;
    if (!track.blobKey) return null;

    const blob = await getTrackBlob(track.blobKey);
    if (!blob) return null;
    return URL.createObjectURL(blob);
}

// In-memory cache for artwork URLs to avoid recreating object URLs
const artworkUrlCache = new Map<string, string>();

/**
 * Get artwork URL for a track (creates object URL from artwork blob)
 * Uses in-memory cache to avoid recreating URLs on each call
 */
export async function getArtworkUrl(track: LocalTrack): Promise<string | null> {
    if (track.remoteArtworkUrl) return track.remoteArtworkUrl;
    if (!track.artworkKey) return null;

    // Check cache first
    const cached = artworkUrlCache.get(track.artworkKey);
    if (cached) return cached;

    const blob = await artworkStore.getItem<Blob>(track.artworkKey);
    if (!blob) return null;

    const url = URL.createObjectURL(blob);
    artworkUrlCache.set(track.artworkKey, url);
    return url;
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
        if (track.blobKey) {
            await blobStore.removeItem(track.blobKey);
        }
        if (track.artworkKey) {
            await artworkStore.removeItem(track.artworkKey);
        }
        await trackStore.removeItem(id);
    }
}

/**
 * Clear all tracks from the local library
 */
export async function clearLibrary(): Promise<void> {
    await trackStore.clear();
    await blobStore.clear();
    await artworkStore.clear();
}
