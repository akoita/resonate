/**
 * Local Library - Hybrid storage for user library tracks
 *
 * Track metadata → PostgreSQL via Library API (authoritative source)
 * File handles   → IndexedDB (device-local only). The audio stays on disk:
 *                  Resonate keeps a File System Access handle and reads the
 *                  file when it plays, so the library never copies audio into
 *                  browser storage (#2503).
 * Audio blobs    → IndexedDB, legacy only: copies made before #2503. They are
 *                  dropped as soon as a rescan links the file on disk.
 * Artwork        → IndexedDB (device-local only), stored as a small thumbnail
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
    deleteLibraryTracksAPI,
    ApiRequestError,
    clearLocalLibraryAPI,
    APILibraryTrack,
    getStemPreviewUrl,
    getTrack as getCatalogTrack,
    getReleaseArtworkUrl,
    getReleaseTrackStreamUrl,
    type AiDisclosure,
    type Track as CatalogTrack,
} from "./api";
import { sanitizeStemUrl } from "./urlUtils";
import { catalogTrackIdOf, isLocalFileTrack } from "./trackIdentity";

const isMixerStemType = (type?: string | null) => {
    const normalized = type?.trim().toLowerCase();
    return !!normalized && normalized !== "original" && normalized !== "master";
};

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

const omissionStore = localforage.createInstance({
    name: "resonate",
    storeName: "libraryOmissions",
});

/** Track id → FileSystemFileHandle for files that live on this device. */
const fileHandleStore = localforage.createInstance({
    name: "resonate",
    storeName: "fileHandles",
});

function localSourceKey(track: LocalTrack): string | null {
    return track.source === "local" && track.sourcePath && track.fileSize != null
        ? `${track.sourcePath}:${track.fileSize}`
        : null;
}

/** File signatures deliberately removed from this device's scanned library. */
export async function listLocalTrackOmissions(): Promise<string[]> {
    return omissionStore.keys();
}

function getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("resonate.token");
}

export interface PlayerState {
    queueSource?: import("./listeningSession").QueueSource;
    queue: LocalTrack[];
    currentIndex: number;
    volume: number;
    muted?: boolean;
    previousNonZeroVolume?: number;
    shuffle: boolean;
    shuffleCycle?: {
        history: string[];
        position: number;
        played: string[];
    };
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
    catalogTrackId?: string | null;
    artistId?: string | null;
    creditedArtistId?: string | null;
    creditedArtistName?: string | null;
    releaseId?: string | null;
    aiDisclosure?: AiDisclosure | null;
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
    // Source catalog track id (drives the eligibility-backed Remix CTA, #1175)
    sourceTrackId?: string;
    // Source catalog track title, for the multi-stem Remix action (#2042)
    sourceTrackTitle?: string;
    // Best license tier the holder bought; null when only listed (#2042)
    licenseType?: "personal" | "remix" | "commercial" | null;
    // Bought, or only listed for sale by this wallet (#2042)
    holding?: "purchased" | "listed";
    /** ISO date until which the download of a purchased stem is held (#1776); unset when delivered. */
    deliveryHeldUntil?: string;
    listingId?: string; // If listed for sale
    purchaseDate?: string;
    isOwned?: boolean;
    previewUrl?: string; // For remote preview which might differ from full track

    // Availability (set at runtime for local tracks on other devices)
    available?: boolean;
}

/** Why a local track cannot play here, when it cannot. */
export type LocalPlaybackProblem =
    /** The file was imported on another device; nothing links it here. */
    | "other_device"
    /** Linked on this device, but the browser has not been allowed to read it. */
    | "needs_permission"
    /** Linked on this device, but the file was moved, renamed or deleted. */
    | "missing";

export type TrackPlayback = { url: string; problem: null } | { url: null; problem: LocalPlaybackProblem | "no_audio" };

export { isLocalFileTrack };

/** A local file whose library row exists, but whose file lives on another device. */
export function isOnOtherDevice(track: Pick<LocalTrack, "source" | "available">): boolean {
    return isLocalFileTrack(track) && track.available === false;
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
        catalogTrackId: apiTrack.catalogTrackId ?? null,
        releaseId: apiTrack.releaseId ?? null,
        creditedArtistId: apiTrack.creditedArtistId ?? null,
        creditedArtistName: apiTrack.creditedArtistName ?? null,
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
        catalogTrackId: track.catalogTrackId ?? null,
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

/** Longest edge of the artwork thumbnail kept per local track. */
const ARTWORK_THUMBNAIL_EDGE = 320;
/** Artwork below this size is kept as-is; it is already thumbnail-sized. */
const ARTWORK_KEEP_AS_IS_BYTES = 48 * 1024;

/**
 * Shrink embedded cover art before keeping it on the device. A 3000 px cover
 * per track adds up to hundreds of megabytes over a large library, and the
 * library only ever shows it at thumbnail size. Falls back to the original
 * when the browser cannot decode or re-encode it.
 */
export async function makeArtworkThumbnail(blob: Blob): Promise<Blob> {
    if (blob.size <= ARTWORK_KEEP_AS_IS_BYTES) return blob;
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") return blob;
    try {
        const bitmap = await createImageBitmap(blob);
        const scale = Math.min(1, ARTWORK_THUMBNAIL_EDGE / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (!context) return blob;
        context.drawImage(bitmap, 0, 0, width, height);
        bitmap.close?.();
        const thumbnail = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
        return thumbnail.size < blob.size ? thumbnail : blob;
    } catch {
        return blob;
    }
}

/**
 * Save a local track (from a folder scan) to the library.
 *
 * Only a handle to the file is kept on this device — never a copy of the
 * audio — and only metadata goes to the API. The file plays on this device
 * alone; every other device sees the row as "on another device".
 */
export async function saveTrack(
    source: { handle: FileSystemFileHandle },
    metadata: Omit<LocalTrack, "id" | "blobKey" | "artworkKey" | "createdAt" | "source">,
    artworkBlob?: Blob | null
): Promise<LocalTrack> {
    const id = `local_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

    let artworkKey: string | null = null;
    if (artworkBlob) {
        artworkKey = `artwork_${id}`;
        await artworkStore.setItem(artworkKey, await makeArtworkThumbnail(artworkBlob));
    }

    const track: LocalTrack = {
        id,
        ...metadata,
        artworkKey,
        source: "local",
        createdAt: new Date().toISOString(),
    };

    // Device cache first, so the row stays playable here even if the API is down.
    await fileHandleStore.setItem(id, source.handle);
    await trackStore.setItem(id, track);

    const token = getToken();
    if (token) {
        try {
            const apiTrack = await saveLibraryTrackAPI(token, localTrackToApi(track, "local"));
            if (apiTrack.id !== id) {
                track.id = apiTrack.id;
                await moveDeviceEntry(id, apiTrack.id, track);
            }
        } catch (err) {
            console.warn("[Library] Failed to save track to API, kept on this device:", err);
        }
    }

    return { ...track, available: true };
}

async function moveDeviceEntry(fromId: string, toId: string, track: LocalTrack): Promise<void> {
    const handle = await fileHandleStore.getItem<FileSystemFileHandle>(fromId);
    if (handle) await fileHandleStore.setItem(toId, handle);
    await fileHandleStore.removeItem(fromId);
    await trackStore.removeItem(fromId);
    await trackStore.setItem(toId, track);
}

/**
 * Link a file on disk to a library row that already exists — a rescan of the
 * same folder, or the same folder added on a second device. The row becomes
 * playable here, and any legacy in-browser copy of the audio is dropped.
 */
export async function attachFileHandle(track: LocalTrack, handle: FileSystemFileHandle): Promise<void> {
    if (!isLocalFileTrack(track)) return;
    await fileHandleStore.setItem(track.id, handle);
    const cached = await trackStore.getItem<LocalTrack>(track.id);
    if (cached?.blobKey) {
        await blobStore.removeItem(cached.blobKey);
        const { blobKey: _legacyBlobKey, ...rest } = cached;
        void _legacyBlobKey;
        await trackStore.setItem(track.id, rest);
    } else if (!cached) {
        const { available: _available, ...rest } = track;
        void _available;
        await trackStore.setItem(track.id, rest);
    }
}

/** The handle that links a local track to its file on this device, if any. */
export async function getFileHandle(trackId: string): Promise<FileSystemFileHandle | null> {
    return fileHandleStore.getItem<FileSystemFileHandle>(trackId);
}

/** The fields a listener may edit on one of their own files. */
export type LocalTrackEdit = Partial<Pick<LocalTrack, "title" | "artist" | "albumArtist" | "album" | "year" | "genre">>;

/**
 * Edit one of the listener's own files: its names, and its cover on this
 * device. Catalog tracks are never edited here; a release's metadata belongs
 * to its artist.
 */
export async function updateLocalTrack(
    track: LocalTrack,
    edit: LocalTrackEdit,
    artworkBlob?: Blob | null,
): Promise<LocalTrack> {
    if (!isLocalFileTrack(track)) throw new Error("Only your own files can be edited");
    const cached = await trackStore.getItem<LocalTrack>(track.id);
    const { available, ...base } = { ...(cached ?? {}), ...track };

    const patch: LocalTrackEdit = {};
    for (const [key, value] of Object.entries(edit) as Array<[keyof LocalTrackEdit, unknown]>) {
        if (value === undefined) continue;
        const normalized = typeof value === "string" ? value.trim() || null : value;
        if (key === "title" && !normalized) continue; // a track always has a title
        (patch as Record<string, unknown>)[key] = normalized;
    }

    let artworkKey = base.artworkKey ?? null;
    if (artworkBlob) {
        const previousKey = artworkKey;
        artworkKey = `artwork_${track.id}_${Date.now()}`;
        await artworkStore.setItem(artworkKey, await makeArtworkThumbnail(artworkBlob));
        if (previousKey) {
            await artworkStore.removeItem(previousKey);
            const url = artworkUrlCache.get(previousKey);
            if (url) URL.revokeObjectURL(url);
            artworkUrlCache.delete(previousKey);
        }
    }

    const updated: LocalTrack = { ...base, ...patch, artworkKey, source: "local" };
    await trackStore.setItem(track.id, updated);

    const token = getToken();
    if (token && Object.keys(patch).length > 0) {
        await saveLibraryTrackAPI(token, localTrackToApi(updated, "local"));
    }
    return { ...updated, available };
}

/** Mark a local track available only when this device links its file. */
async function withDeviceAvailability(track: LocalTrack): Promise<LocalTrack> {
    if (!isLocalFileTrack(track)) return track;
    if (await fileHandleStore.getItem(track.id)) return { ...track, available: true };
    const blobKey = track.blobKey ?? (await trackStore.getItem<LocalTrack>(track.id))?.blobKey;
    const hasLegacyCopy = blobKey ? (await blobStore.keys()).includes(blobKey) : false;
    return { ...track, available: hasLegacyCopy };
}

/** Ids of local tracks this device can reach (linked file or legacy copy). */
async function listDeviceTrackIds(): Promise<Set<string>> {
    const ids = new Set<string>(await fileHandleStore.keys());
    // Compare keys only: reading a legacy blob would pull the audio into memory.
    const legacyBlobKeys = new Set(await blobStore.keys());
    if (legacyBlobKeys.size > 0) {
        await trackStore.iterate<LocalTrack, void>((value, key) => {
            if (value?.blobKey && legacyBlobKeys.has(value.blobKey)) ids.add(key);
        });
    }
    return ids;
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

/** Save a catalog track using authenticated server truth without local fallback. */
export async function saveTrackMetadataAuthenticated(
    track: LocalTrack,
    token: string,
): Promise<LocalTrack> {
    const apiTrack = await saveLibraryTrackAPI(
        token,
        localTrackToApi(track, track.source ?? "remote"),
    );
    return apiTrackToLocal(apiTrack);
}

/**
 * Save multiple track metadata entries to the API (batch)
 */
export async function saveTracksMetadata(
    tracks: LocalTrack[],
    source: "local" | "remote" = "remote"
): Promise<LocalTrack[]> {
    // Device files are saved by the folder scan, under their own source. A
    // queue or DJ set that contains one must never re-save it as a catalog
    // row (#2505); the server would reject the whole batch.
    const catalogTracks = source === "remote" ? tracks.filter((t) => !isLocalFileTrack(t)) : tracks;
    if (catalogTracks.length === 0) return tracks;
    const token = getToken();
    if (token) {
        try {
            const apiTracks = await saveLibraryTracksAPI(
                token,
                catalogTracks.map((t) => localTrackToApi(t, source))
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
    if (localTrack) return withDeviceAvailability(await enrichStemTrackUrl(localTrack));

    // Fallback 1: try Library API
    const token = getToken();
    if (token) {
        try {
            const apiTrack = await getLibraryTrackAPI(id, token);
            const track = apiTrackToLocal(apiTrack);
            return withDeviceAvailability(await enrichStemTrackUrl(track));
        } catch {
            // not in user's library — try catalog next
        }
    }

    // Fallback 2: try Catalog API (platform tracks referenced by playlists,
    // Sonic Radar discoveries, …). Public catalog reads work without a token,
    // so a playlist entry that was never saved to the library still resolves.
    try {
        const catalogTrack = await getCatalogTrack(id, token);
        if (catalogTrack) return catalogTrackToLocal(catalogTrack);
    } catch {
        // not found anywhere
    }

    return null;
}

function knownDuration(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** The longest stem duration, which is the track's length when the row has none. */
function stemDuration(track: { stems?: ReadonlyArray<{ durationSeconds?: number | null }> | null }): number | null {
    const lengths = (track.stems ?? [])
        .map((stem) => knownDuration(stem.durationSeconds))
        .filter((value): value is number => value !== null);
    return lengths.length > 0 ? Math.max(...lengths) : null;
}

/**
 * The track with its length filled in when the stored copy lacks one.
 *
 * Catalog tracks saved to the browser before their duration was recorded
 * show "--:--" in a playlist while the shared page, read from the server,
 * shows the real length. Use the stems' length first, then ask the catalog.
 * Device files and anything the catalog cannot answer are returned unchanged.
 */
export async function withKnownDuration(track: LocalTrack): Promise<LocalTrack> {
    if (knownDuration(track.duration) !== null) return track;
    const fromStems = stemDuration(track);
    if (fromStems !== null) return { ...track, duration: fromStems };
    const catalogId = catalogTrackIdOf(track);
    if (!catalogId) return track;
    try {
        const catalogTrack = await getCatalogTrack(catalogId, getToken());
        const fromCatalog = catalogTrack ? stemDuration(catalogTrack) : null;
        return fromCatalog !== null ? { ...track, duration: fromCatalog } : track;
    } catch {
        return track;
    }
}

/**
 * Map a catalog track to a fully playable remote LocalTrack (stream URL,
 * release/artist ids, duration). Mirrors the release-page and artist-playback
 * mappers so a playlist entry plays the same way as a release track.
 */
export function catalogTrackToLocal(catalogTrack: CatalogTrack): LocalTrack {
    const release = catalogTrack.release;
    const releaseId = release?.id || catalogTrack.releaseId || null;
    return {
        id: catalogTrack.id,
        title: catalogTrack.title,
        artist:
            catalogTrack.artist?.trim() ||
            release?.primaryArtist?.trim() ||
            release?.artist?.displayName?.trim() ||
            null,
        albumArtist: release?.primaryArtist || release?.artist?.displayName || null,
        album: release?.title || null,
        year: release?.releaseDate ? new Date(release.releaseDate).getFullYear() : null,
        genre: release?.genre || null,
        duration: catalogTrack.stems?.[0]?.durationSeconds ?? null,
        createdAt: catalogTrack.createdAt || new Date().toISOString(),
        source: "remote",
        catalogTrackId: catalogTrack.id,
        releaseId,
        artistId: release?.artist?.id || release?.artistId || null,
        aiDisclosure: catalogTrack.aiDisclosure ?? null,
        remoteUrl: releaseId ? getReleaseTrackStreamUrl(releaseId, catalogTrack.id) : undefined,
        remoteArtworkUrl: release?.artworkUrl || (release?.artworkMimeType
            ? getReleaseArtworkUrl(release.id, {
                artworkRevision: release.artworkRevision,
            })
            : undefined),
        stems: catalogTrack.stems?.map(s => ({
            id: s.id,
            uri: isMixerStemType(s.type) ? getStemPreviewUrl(s.id) : s.uri,
            type: s.type,
            durationSeconds: s.durationSeconds,
            isEncrypted: isMixerStemType(s.type) ? false : s.isEncrypted,
            encryptionMetadata: isMixerStemType(s.type) ? null : s.encryptionMetadata,
        })),
    };
}

/**
 * For stem library tracks (e.g. Sonic Radar purchases) that have stemType
 * but no remoteUrl, resolve the preview URL by looking up the actual stem
 * from the catalog API. This self-heals entries saved without URLs.
 */
async function enrichStemTrackUrl(track: LocalTrack): Promise<LocalTrack> {
    // Only enrich if it's a stem track without a playable URL
    if (!track.stemType || track.remoteUrl || track.previewUrl || track.blobKey) {
        return track;
    }

    // Extract the track ID from the synthetic stem library ID
    // Format: stem_trk_<timestamp>_<hash>_<stemType> → trk_<timestamp>_<hash>
    const stemTypeSlug = track.stemType.toLowerCase().replace(/\s+/g, '_');
    const suffixToRemove = `_${stemTypeSlug}`;
    const prefixToRemove = 'stem_';
    let catalogTrackId: string | null = null;

    if (track.id.startsWith(prefixToRemove) && track.id.endsWith(suffixToRemove)) {
        catalogTrackId = track.id.slice(prefixToRemove.length, -suffixToRemove.length);
    }

    if (!catalogTrackId) return track;

    try {
        const token = getToken();
        const catalogTrack = await getCatalogTrack(catalogTrackId, token);
        if (catalogTrack?.stems) {
            track.catalogTrackId = catalogTrackId;
            const matchingStem = catalogTrack.stems.find(
                s => s.type.toLowerCase() === stemTypeSlug
            );
            if (matchingStem) {
                const url = getStemPreviewUrl(matchingStem.id);
                track.remoteUrl = url;
                track.previewUrl = url;
                // Also set duration if available
                if (!track.duration && matchingStem.durationSeconds) {
                    track.duration = matchingStem.durationSeconds;
                }
            }
        }
    } catch (err) {
        console.warn('[Library] Failed to enrich stem track URL:', err);
    }

    return track;
}

/**
 * Get the legacy in-browser copy of a track's audio (imports made before
 * #2503). New imports never create one.
 */
export async function getTrackBlob(blobKey: string): Promise<Blob | null> {
    return blobStore.getItem<Blob>(blobKey);
}

/**
 * Object URLs for local files. A URL made from a File on disk does not copy the
 * audio, but each one pins the File until revoked, so only the few most recent
 * stay alive.
 */
const LOCAL_URL_CACHE_LIMIT = 4;
const trackUrlCache = new Map<string, { url: string; lastModified: number; size: number }>();

function rememberTrackUrl(id: string, entry: { url: string; lastModified: number; size: number }) {
    const previous = trackUrlCache.get(id);
    if (previous && previous.url !== entry.url) URL.revokeObjectURL(previous.url);
    trackUrlCache.delete(id);
    trackUrlCache.set(id, entry);
    while (trackUrlCache.size > LOCAL_URL_CACHE_LIMIT) {
        const [oldestId, oldest] = trackUrlCache.entries().next().value as [string, { url: string }];
        URL.revokeObjectURL(oldest.url);
        trackUrlCache.delete(oldestId);
    }
}

type ReadPermissionHandle = FileSystemFileHandle & {
    queryPermission?: (descriptor: { mode: "read" }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: "read" }) => Promise<PermissionState>;
};

async function ensureReadPermission(handle: ReadPermissionHandle): Promise<boolean> {
    if (typeof handle.queryPermission !== "function") return true;
    if ((await handle.queryPermission({ mode: "read" })) === "granted") return true;
    if (typeof handle.requestPermission !== "function") return false;
    try {
        // Needs a user gesture; pressing play is one.
        return (await handle.requestPermission({ mode: "read" })) === "granted";
    } catch {
        return false;
    }
}

async function resolveLocalFileUrl(track: LocalTrack): Promise<TrackPlayback> {
    const handle = await fileHandleStore.getItem<ReadPermissionHandle>(track.id);
    if (handle) {
        if (!(await ensureReadPermission(handle))) return { url: null, problem: "needs_permission" };
        let file: File;
        try {
            file = await handle.getFile();
        } catch (error) {
            const name = (error as { name?: string })?.name;
            if (name === "NotAllowedError" || name === "SecurityError") {
                return { url: null, problem: "needs_permission" };
            }
            return { url: null, problem: "missing" };
        }
        const cached = trackUrlCache.get(track.id);
        if (cached && cached.lastModified === file.lastModified && cached.size === file.size) {
            return { url: cached.url, problem: null };
        }
        const url = URL.createObjectURL(file);
        rememberTrackUrl(track.id, { url, lastModified: file.lastModified, size: file.size });
        return { url, problem: null };
    }

    // Legacy: a copy made before #2503.
    const blobKey = track.blobKey ?? (await trackStore.getItem<LocalTrack>(track.id))?.blobKey;
    if (blobKey) {
        const cached = trackUrlCache.get(track.id);
        if (cached) return { url: cached.url, problem: null };
        const blob = await getTrackBlob(blobKey);
        if (blob) {
            const url = URL.createObjectURL(blob);
            rememberTrackUrl(track.id, { url, lastModified: 0, size: blob.size });
            return { url, problem: null };
        }
    }
    return { url: null, problem: "other_device" };
}

/**
 * Resolve what the player should load for a track, and why not when nothing.
 * Local files resolve only on the device that links them; everything else
 * streams from the platform.
 */
export async function resolveTrackPlayback(track: LocalTrack): Promise<TrackPlayback> {
    if (isLocalFileTrack(track)) return resolveLocalFileUrl(track);
    if (track.remoteUrl) return { url: sanitizeStemUrl(track.remoteUrl) || track.remoteUrl, problem: null };
    if (track.previewUrl) return { url: sanitizeStemUrl(track.previewUrl) || track.previewUrl, problem: null };
    // Rows cached before `source` was recorded.
    if (track.blobKey) return resolveLocalFileUrl(track);
    // A whole catalog track whose saved row lost its URL still streams from
    // the catalog: never tell the listener it has no audio.
    if (track.source === "remote" && !track.stemType && track.catalogTrackId && track.releaseId) {
        return { url: getReleaseTrackStreamUrl(track.releaseId, track.catalogTrackId), problem: null };
    }
    return { url: null, problem: "no_audio" };
}

/**
 * Get a playable URL for a track. Prefer {@link resolveTrackPlayback} where the
 * reason for a failure matters.
 */
export async function getTrackUrl(track: LocalTrack): Promise<string | null> {
    return (await resolveTrackPlayback(track)).url;
}

// In-memory cache for artwork URLs to avoid recreating object URLs
const artworkUrlCache = new Map<string, string>();

/**
 * Get artwork URL for a track (creates object URL from artwork blob)
 * Uses in-memory cache to avoid recreating URLs on each call
 */
export async function getArtworkUrl(track: LocalTrack): Promise<string | null> {
    if (track.remoteArtworkUrl) return track.remoteArtworkUrl.startsWith("/")
        ? sanitizeStemUrl(track.remoteArtworkUrl) ?? null : track.remoteArtworkUrl;
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
            await pruneRemoteCacheNotInApi(tracks);

            // The API knows a local track exists; only this device knows
            // whether it links the file. Merge the device cache back in
            // (artwork, legacy copy) and mark the rest "on another device".
            const deviceIds = await listDeviceTrackIds();
            for (const track of tracks) {
                if (isLocalFileTrack(track)) {
                    track.available = deviceIds.has(track.id);
                    if (track.available) {
                        const cached = await trackStore.getItem<LocalTrack>(track.id);
                        if (cached?.artworkKey) track.artworkKey = cached.artworkKey;
                        if (cached?.blobKey) track.blobKey = cached.blobKey;
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

    // Fallback: read from IndexedDB (offline / unauthenticated). When an
    // authenticated API read fails, keep remote catalog rows out of the
    // fallback so deleted backend content is not resurrected from cache.
    const tracks: LocalTrack[] = [];
    const deviceIds = await listDeviceTrackIds();
    await trackStore.iterate<LocalTrack, void>((value) => {
        if (!token || value.source !== "remote") {
            tracks.push({
                ...value,
                available: isLocalFileTrack(value) ? deviceIds.has(value.id) : true,
            });
        }
    });
    return tracks.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

async function pruneRemoteCacheNotInApi(apiTracks: LocalTrack[]): Promise<void> {
    const apiTrackIds = new Set(apiTracks.map((track) => track.id));
    const staleRemoteCacheIds: string[] = [];

    await trackStore.iterate<LocalTrack, void>((value, key) => {
        if (value.source === "remote" && !apiTrackIds.has(value.id)) {
            staleRemoteCacheIds.push(key);
        }
    });

    await Promise.all(staleRemoteCacheIds.map((id) => trackStore.removeItem(id)));
}

/**
 * Delete a track from the library
 */
export async function deleteTrack(id: string, knownTrack?: LocalTrack): Promise<void> {
    const track = knownTrack ?? await getTrack(id);
    const token = getToken();
    if (token) {
        try {
            await deleteLibraryTrackAPI(id, token);
        } catch (error) {
            // A local file may never have synced, or a stale server row may
            // already be gone. In either case there is nothing left to delete.
            if (!(error instanceof ApiRequestError && error.status === 404)) throw error;
        }
    }
    const omissionKey = track ? localSourceKey(track) : null;
    if (omissionKey) await omissionStore.setItem(omissionKey, true);
    try {
        await removeCachedTrack(id);
    } catch (error) {
        if (!token) throw error;
        console.warn("[Library] Server delete succeeded; local cache cleanup failed:", error);
    }
}

async function removeCachedTrack(id: string): Promise<void> {
    const track = await trackStore.getItem<LocalTrack>(id);
    if (track?.blobKey) await blobStore.removeItem(track.blobKey);
    if (track?.artworkKey) await artworkStore.removeItem(track.artworkKey);
    await fileHandleStore.removeItem(id);
    const cachedUrl = trackUrlCache.get(id);
    if (cachedUrl) {
        URL.revokeObjectURL(cachedUrl.url);
        trackUrlCache.delete(id);
    }
    await trackStore.removeItem(id);
}

/** Remove multiple saved tracks after the server confirms the request. */
export async function deleteTracks(ids: string[], knownTracks: LocalTrack[] = []): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return;
    const knownById = new Map(knownTracks.map(track => [track.id, track]));
    const cached = await Promise.all(uniqueIds.map(id => knownById.get(id) ?? trackStore.getItem<LocalTrack>(id)));
    const token = getToken();
    if (token) {
        const result = await deleteLibraryTracksAPI(uniqueIds, token);
        if (result.count !== uniqueIds.length) {
            // A partial count can mean some rows were already absent. Verify
            // that none remain before treating the batch as complete.
            const remaining = await listLibraryTracksAPI(token);
            const remainingIds = new Set(remaining.map(track => track.id));
            if (uniqueIds.some(id => remainingIds.has(id))) {
                throw new Error("Some library tracks could not be removed");
            }
        }
    }
    await Promise.all(cached.map(async track => {
        const key = track ? localSourceKey(track) : null;
        if (key) await omissionStore.setItem(key, true);
    }));
    const cleanup = await Promise.allSettled(uniqueIds.map(removeCachedTrack));
    const failure = cleanup.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) {
        if (!token) throw failure.reason;
        console.warn("[Library] Server batch delete succeeded; local cache cleanup failed:", failure.reason);
    }
}

/**
 * Clear all local tracks from the library (IndexedDB + backend API)
 */
export async function clearLibrary(): Promise<void> {
    const token = getToken();
    if (token) await clearLocalLibraryAPI(token);
    await trackStore.clear();
    await blobStore.clear();
    await artworkStore.clear();
    await fileHandleStore.clear();
    await omissionStore.clear();
    for (const { url } of trackUrlCache.values()) URL.revokeObjectURL(url);
    trackUrlCache.clear();
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
