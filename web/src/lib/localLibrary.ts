/**
 * Local Library - Hybrid storage for user library tracks
 *
 * Track metadata → PostgreSQL via Library API (authoritative source)
 * Audio blobs    → IndexedDB (device-local only)
 * Artwork blobs  → IndexedDB (device-local only)
 * Player state   → IndexedDB (device-local only)
 *
 * Uses localforage for cross-browser IndexedDB abstraction
 */
import localforage from "localforage";
import {
    saveLibraryTrackAPI,
    saveLibraryTracksAPI,
    listLibraryTracksAPI,
    getLibraryTrackAPI,
    deleteLibraryTrackAPI,
    clearLocalLibraryAPI,
    APILibraryTrack,
    getTrack as getCatalogTrack,
    getReleaseArtworkUrl,
} from "./api";

// Configure localforage stores (blobs + artwork + player only)
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

const playerStore = localforage.createInstance({
    name: "resonate",
    storeName: "player",
});

function getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("resonate.token");
}

export interface PlayerState {
    queue: LocalTrack[];
    currentIndex: number;
    volume: number;
    shuffle: boolean;
    repeatMode: "none" | "one" | "all";
}

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
    stems?: Array<{
        id: string;
        uri: string;
        type: string;
        durationSeconds?: number | null;
        isEncrypted?: boolean;
        encryptionMetadata?: string | null;
        storageProvider?: string | null;
    }>;
    sourcePath?: string;
    fileSize?: number;

    // Source type: "local" (device file) or "remote" (platform-hosted)
    source?: "local" | "remote";

    // Stem ownership extensions
    stemType?: string;
    tokenId?: string;
    listingId?: string; // If listed for sale
    purchaseDate?: string;
    isOwned?: boolean;
    previewUrl?: string; // For remote preview which might differ from full track

    // Availability (set at runtime for local tracks on other devices)
    available?: boolean;
}

/**
 * Convert an API LibraryTrack to a LocalTrack
 */
function apiTrackToLocal(apiTrack: APILibraryTrack): LocalTrack {
    return {
        id: apiTrack.id,
        title: apiTrack.title,
        artist: apiTrack.artist ?? null,
        albumArtist: apiTrack.albumArtist ?? null,
        album: apiTrack.album ?? null,
        year: apiTrack.year ?? null,
        genre: apiTrack.genre ?? null,
        duration: apiTrack.duration ?? null,
        createdAt: apiTrack.createdAt,
        sourcePath: apiTrack.sourcePath ?? undefined,
        fileSize: apiTrack.fileSize ?? undefined,
        remoteUrl: apiTrack.remoteUrl ?? undefined,
        remoteArtworkUrl: apiTrack.remoteArtworkUrl ?? undefined,
        source: apiTrack.source,
        stemType: apiTrack.stemType ?? undefined,
        tokenId: apiTrack.tokenId ?? undefined,
        listingId: apiTrack.listingId ?? undefined,
        purchaseDate: apiTrack.purchaseDate ?? undefined,
        isOwned: apiTrack.isOwned ?? false,
        previewUrl: apiTrack.previewUrl ?? undefined,
    };
}

/**
 * Convert a LocalTrack to the API input shape
 */
function localTrackToApi(
    track: LocalTrack,
    source: "local" | "remote" = "local"
): Omit<APILibraryTrack, "userId" | "createdAt" | "updatedAt"> {
    return {
        id: track.id,
        source,
        title: track.title,
        artist: track.artist,
        albumArtist: track.albumArtist,
        album: track.album,
        year: track.year,
        genre: track.genre,
        duration: track.duration,
        sourcePath: track.sourcePath ?? null,
        fileSize: track.fileSize ?? null,
        catalogTrackId: null,
        remoteUrl: track.remoteUrl ?? null,
        remoteArtworkUrl: track.remoteArtworkUrl ?? null,
        stemType: track.stemType ?? null,
        tokenId: track.tokenId ?? null,
        listingId: track.listingId ?? null,
        purchaseDate: track.purchaseDate ?? null,
        isOwned: track.isOwned ?? false,
        previewUrl: track.previewUrl ?? null,
    };
}

/**
 * Save a local track (from filesystem scan) to the library.
 * Audio blob → IndexedDB, metadata → API
 */
export async function saveTrack(
    file: File,
    metadata: Omit<LocalTrack, "id" | "blobKey" | "artworkKey" | "createdAt">,
    artworkBlob?: Blob | null
): Promise<LocalTrack> {
    const id = `local_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    const blobKey = `blob_${id}`;

    // Store the audio blob locally
    await blobStore.setItem(blobKey, file);

    // Store artwork if provided
    let artworkKey: string | null = null;
    if (artworkBlob) {
        artworkKey = `artwork_${id}`;
        await artworkStore.setItem(artworkKey, artworkBlob);
    }

    // Build track object
    const track: LocalTrack = {
        id,
        ...metadata,
        blobKey,
        artworkKey,
        source: "local",
        createdAt: new Date().toISOString(),
    };

    // Save metadata to IndexedDB (local fallback) and API
    await trackStore.setItem(id, track);

    const token = getToken();
    if (token) {
        try {
            const apiTrack = await saveLibraryTrackAPI(token, localTrackToApi(track, "local"));
            // Update local with server-assigned ID if different
            if (apiTrack.id !== id) {
                track.id = apiTrack.id;
                await trackStore.removeItem(id);
                await trackStore.setItem(apiTrack.id, track);
            }
        } catch (err) {
            console.warn("[Library] Failed to save track to API, kept in IndexedDB:", err);
        }
    }

    return track;
}

/**
 * Save track metadata to the API (for remote catalog tracks saved to library).
 * NO blob is saved locally — remote tracks stream from the platform.
 */
export async function saveTrackMetadata(track: LocalTrack): Promise<LocalTrack> {
    const token = getToken();
    if (token) {
        try {
            const apiTrack = await saveLibraryTrackAPI(
                token,
                localTrackToApi(track, track.source ?? "remote")
            );
            return apiTrackToLocal(apiTrack);
        } catch (err) {
            console.warn("[Library] Failed to save track metadata to API:", err);
        }
    }
    // Fallback: save to IndexedDB
    await trackStore.setItem(track.id, track);
    return track;
}

/**
 * Save multiple track metadata entries to the API (batch)
 */
export async function saveTracksMetadata(
    tracks: LocalTrack[],
    source: "local" | "remote" = "remote"
): Promise<LocalTrack[]> {
    const token = getToken();
    if (token) {
        try {
            const apiTracks = await saveLibraryTracksAPI(
                token,
                tracks.map((t) => localTrackToApi(t, source))
            );
            return apiTracks.map(apiTrackToLocal);
        } catch (err) {
            console.warn("[Library] Failed to batch-save to API:", err);
        }
    }
    // Fallback: save each to IndexedDB
    for (const track of tracks) {
        await trackStore.setItem(track.id, track);
    }
    return tracks;
}

/**
 * Get a track by ID
 */
export async function getTrack(id: string): Promise<LocalTrack | null> {
    // Try IndexedDB first (fast, works offline)
    const localTrack = await trackStore.getItem<LocalTrack>(id);
    if (localTrack) return localTrack;

    // Fallback 1: try Library API
    const token = getToken();
    if (token) {
        try {
            const apiTrack = await getLibraryTrackAPI(id, token);
            return apiTrackToLocal(apiTrack);
        } catch {
            // not in user's library — try catalog next
        }

        // Fallback 2: try Catalog API (platform tracks, e.g. Sonic Radar discoveries)
        try {
            const catalogTrack = await getCatalogTrack(id, token);
            if (catalogTrack) {
                return {
                    id: catalogTrack.id,
                    title: catalogTrack.title,
                    artist: catalogTrack.artist || null,
                    albumArtist: null,
                    album: catalogTrack.release?.title || null,
                    year: null,
                    genre: null,
                    duration: null,
                    createdAt: catalogTrack.createdAt || new Date().toISOString(),
                    source: "remote",
                    remoteArtworkUrl: catalogTrack.release?.artworkUrl || (catalogTrack.release?.artworkMimeType ? getReleaseArtworkUrl(catalogTrack.release.id) : undefined),
                    stems: catalogTrack.stems?.map(s => ({
                        id: s.id,
                        uri: s.uri,
                        type: s.type,
                        durationSeconds: s.durationSeconds,
                        isEncrypted: s.isEncrypted,
                        encryptionMetadata: s.encryptionMetadata,
                    })),
                };
            }
        } catch {
            // not found anywhere
        }
    }

    return null;
}

/**
 * Get the audio blob for a track
 */
export async function getTrackBlob(blobKey: string): Promise<Blob | null> {
    return blobStore.getItem<Blob>(blobKey);
}

// In-memory cache for track URLs to avoid recreating object URLs
const trackUrlCache = new Map<string, string>();

/**
 * Get a playable URL for a track (creates object URL from blob)
 * Uses in-memory cache to avoid recreating URLs on each call
 */
export async function getTrackUrl(track: LocalTrack): Promise<string | null> {
    if (track.remoteUrl) return track.remoteUrl;
    if (!track.blobKey) return null;

    // Check cache first
    const cached = trackUrlCache.get(track.blobKey);
    if (cached) return cached;

    const blob = await getTrackBlob(track.blobKey);
    if (!blob) return null;

    const url = URL.createObjectURL(blob);
    trackUrlCache.set(track.blobKey, url);
    return url;
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
 * List all tracks in the user's library.
 * Fetches from the API; for local tracks, checks blob availability.
 */
export async function listTracks(): Promise<LocalTrack[]> {
    const token = getToken();

    if (token) {
        try {
            const apiTracks = await listLibraryTracksAPI(token);
            const tracks = apiTracks.map(apiTrackToLocal);

            // For local tracks, check if the blob is available on this device
            for (const track of tracks) {
                if (track.source === "local") {
                    if (track.blobKey) {
                        const blob = await blobStore.getItem(track.blobKey);
                        track.available = blob !== null;
                    } else {
                        track.available = false;
                    }
                } else {
                    // Remote tracks are always available
                    track.available = true;
                }
            }

            return tracks.sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
        } catch (err) {
            console.warn("[Library] Failed to list from API, falling back to IndexedDB:", err);
        }
    }

    // Fallback: read from IndexedDB (offline / unauthenticated)
    const tracks: LocalTrack[] = [];
    await trackStore.iterate<LocalTrack, void>((value) => {
        tracks.push({ ...value, available: true });
    });
    return tracks.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

/**
 * Delete a track from the library
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

    // Also delete from API
    const token = getToken();
    if (token) {
        try {
            await deleteLibraryTrackAPI(id, token);
        } catch (err) {
            console.warn("[Library] Failed to delete track from API:", err);
        }
    }
}

/**
 * Clear all local tracks from the library (IndexedDB + backend API)
 */
export async function clearLibrary(): Promise<void> {
    await trackStore.clear();
    await blobStore.clear();
    await artworkStore.clear();

    const token = getToken();
    if (token) {
        try {
            await clearLocalLibraryAPI(token);
        } catch (err) {
            console.warn("[Library] Failed to clear local tracks from API:", err);
        }
    }
}

/**
 * Save player state to IndexedDB
 */
export async function savePlayerState(state: PlayerState): Promise<void> {
    await playerStore.setItem("current_state", state);
}

/**
 * Load player state from IndexedDB
 */
export async function loadPlayerState(): Promise<PlayerState | null> {
    return playerStore.getItem<PlayerState>("current_state");
}
