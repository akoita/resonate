import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";

export const PLAYLIST_VISIBILITIES = ["private", "public"] as const;
export type PlaylistVisibility = (typeof PLAYLIST_VISIBILITIES)[number];

/** A single track inside a public playlist, denormalized so any viewer can render and play it. */
export interface PublicPlaylistTrack {
    id: string;
    title: string;
    artist: string | null;
    album: string | null;
    duration: number | null;
    /** Public catalog stream path (no auth), or null for owner-device-only tracks. */
    streamPath: string | null;
    /** Public catalog artwork path (no auth), if known. */
    artworkPath: string | null;
    catalogTrackId: string | null;
    releaseId: string | null;
    /** False when the track is a local device file that other listeners cannot stream. */
    playable: boolean;
}

/** A public playlist as seen by anyone (owner identity is intentionally minimal). */
export interface PublicPlaylistView {
    id: string;
    name: string;
    visibility: PlaylistVisibility;
    ownerUserId: string;
    ownerDisplayName: string | null;
    isOwner: boolean;
    isSaved: boolean;
    trackCount: number;
    playableTrackCount: number;
    tracks: PublicPlaylistTrack[];
    createdAt: Date;
    updatedAt: Date;
}

export interface SavedPlaylistView extends PublicPlaylistView {
    savedPlaylistId: string;
    savedAt: Date;
    /** False when the source went private or was deleted after it was saved. */
    available: boolean;
}

/**
 * A compact public-playlist entry for discovery surfaces (global catalog, home
 * snapshot). Deliberately lighter than {@link PublicPlaylistView}: no per-track
 * payload, just enough to render a card and link through to the full viewer.
 */
export interface PublicPlaylistSummary {
    id: string;
    name: string;
    ownerUserId: string;
    ownerDisplayName: string | null;
    /** Tracks still resolvable in the owner's library. */
    trackCount: number;
    /** Subset of trackCount that any listener can actually stream. */
    playableTrackCount: number;
    /** Up to 4 public catalog artwork paths, drawn from playable tracks, for a cover mosaic. */
    coverArtworkPaths: string[];
    createdAt: Date;
    updatedAt: Date;
}

/** How many candidate playlists we resolve covers/counts for, per discovery request. */
const PUBLIC_PLAYLIST_DISCOVERY_MAX = 100;
/** Cover images surfaced per playlist card (a 2×2 mosaic at most). */
const PUBLIC_PLAYLIST_COVER_LIMIT = 4;

@Injectable()
export class PlaylistService {
    constructor(private readonly eventBus?: EventBus) {}

    async createFolder(userId: string, name: string) {
        return prisma.folder.create({
            data: {
                userId,
                name,
            },
        });
    }

    async listFolders(userId: string) {
        return prisma.folder.findMany({
            where: { userId },
            include: { playlists: true },
        });
    }

    async updateFolder(userId: string, id: string, name: string) {
        const folder = await prisma.folder.findUnique({ where: { id } });
        if (!folder || folder.userId !== userId) {
            throw new NotFoundException("Folder not found");
        }
        return prisma.folder.update({
            where: { id },
            data: { name },
        });
    }

    async deleteFolder(userId: string, id: string) {
        const folder = await prisma.folder.findUnique({
            where: { id },
            include: { playlists: true }
        });
        if (!folder || folder.userId !== userId) {
            throw new NotFoundException("Folder not found");
        }

        // Dissociate playlists from folder before deleting
        if (folder.playlists.length > 0) {
            await prisma.playlist.updateMany({
                where: { folderId: id },
                data: { folderId: null }
            });
        }

        return prisma.folder.delete({ where: { id } });
    }

    async createPlaylist(userId: string, data: { name: string; folderId?: string; trackIds?: string[] }) {
        const playlist = await prisma.playlist.create({
            data: {
                userId,
                name: data.name,
                folderId: data.folderId,
                trackIds: data.trackIds || [],
            },
        });
        this.eventBus?.publish({
            eventName: "playlist.created",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            userId,
            playlistId: playlist.id,
            folderId: playlist.folderId,
            trackCount: playlist.trackIds.length,
        });
        if (playlist.trackIds.length > 0) {
            this.eventBus?.publish({
                eventName: "playlist.track_added",
                eventVersion: 1,
                occurredAt: new Date().toISOString(),
                userId,
                playlistId: playlist.id,
                trackIds: limitTrackIds(playlist.trackIds),
                addedCount: playlist.trackIds.length,
                trackCount: playlist.trackIds.length,
            });
        }
        return playlist;
    }

    async listPlaylists(userId: string, folderId?: string) {
        return prisma.playlist.findMany({
            where: {
                userId,
                folderId: folderId === undefined ? undefined : folderId
            },
        });
    }

    async getPlaylist(userId: string, id: string) {
        const playlist = await prisma.playlist.findUnique({ where: { id } });
        if (!playlist || playlist.userId !== userId) {
            throw new NotFoundException("Playlist not found");
        }
        return playlist;
    }

    async updatePlaylist(userId: string, id: string, data: { name?: string; folderId?: string | null; trackIds?: string[]; visibility?: string }) {
        const playlist = await prisma.playlist.findUnique({ where: { id } });
        if (!playlist || playlist.userId !== userId) {
            throw new NotFoundException("Playlist not found");
        }
        let nextVisibility: PlaylistVisibility | undefined;
        if (data.visibility !== undefined) {
            nextVisibility = normalizeVisibility(data.visibility);
        }
        const updated = await prisma.playlist.update({
            where: { id },
            data: {
                name: data.name,
                folderId: data.folderId,
                trackIds: data.trackIds,
                visibility: nextVisibility,
            },
        });

        if (nextVisibility !== undefined && nextVisibility !== playlist.visibility) {
            this.eventBus?.publish({
                eventName: "playlist.visibility_changed",
                eventVersion: 1,
                occurredAt: new Date().toISOString(),
                userId,
                playlistId: updated.id,
                previousVisibility: playlist.visibility,
                nextVisibility,
                trackCount: updated.trackIds.length,
            });
        }

        const changedFields = getChangedFields(playlist, data);
        if (changedFields.length > 0) {
            this.eventBus?.publish({
                eventName: "playlist.updated",
                eventVersion: 1,
                occurredAt: new Date().toISOString(),
                userId,
                playlistId: updated.id,
                folderId: updated.folderId,
                changedFields,
                trackCount: updated.trackIds.length,
            });
        }

        if (data.trackIds) {
            const previousIds = new Set(playlist.trackIds);
            const nextIds = new Set(data.trackIds);
            const addedTrackIds = data.trackIds.filter((trackId) => !previousIds.has(trackId));
            const removedTrackIds = playlist.trackIds.filter((trackId) => !nextIds.has(trackId));
            if (addedTrackIds.length > 0) {
                this.eventBus?.publish({
                    eventName: "playlist.track_added",
                    eventVersion: 1,
                    occurredAt: new Date().toISOString(),
                    userId,
                    playlistId: updated.id,
                    trackIds: limitTrackIds(addedTrackIds),
                    addedCount: addedTrackIds.length,
                    trackCount: updated.trackIds.length,
                });
            }
            if (removedTrackIds.length > 0) {
                this.eventBus?.publish({
                    eventName: "playlist.track_removed",
                    eventVersion: 1,
                    occurredAt: new Date().toISOString(),
                    userId,
                    playlistId: updated.id,
                    trackIds: limitTrackIds(removedTrackIds),
                    removedCount: removedTrackIds.length,
                    trackCount: updated.trackIds.length,
                });
            }
        }

        return updated;
    }

    async deletePlaylist(userId: string, id: string) {
        const playlist = await prisma.playlist.findUnique({ where: { id } });
        if (!playlist || playlist.userId !== userId) {
            throw new NotFoundException("Playlist not found");
        }
        const deleted = await prisma.playlist.delete({ where: { id } });
        this.eventBus?.publish({
            eventName: "playlist.deleted",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            userId,
            playlistId: deleted.id,
            trackCount: deleted.trackIds.length,
        });
        return deleted;
    }

    // ============================================
    // Public playlists
    // ============================================

    /**
     * Resolve a playlist for a (possibly anonymous) viewer.
     *
     * A non-owner may only read a playlist whose visibility is "public"; private
     * playlists are reported as not found so their existence is not leaked. The
     * owner's private organizational data (folderId) is never returned here.
     *
     * Track ids reference the OWNER's LibraryTrack records, so we resolve them
     * server-side into denormalized, streamable entries any viewer can play.
     */
    async getPublicPlaylist(id: string, viewerUserId?: string): Promise<PublicPlaylistView> {
        const playlist = await prisma.playlist.findUnique({
            where: { id },
            include: { user: { select: { id: true, artist: { select: { displayName: true } } } } },
        });

        const isOwner = Boolean(playlist && viewerUserId && playlist.userId === viewerUserId);
        if (!playlist || (playlist.visibility !== "public" && !isOwner)) {
            throw new NotFoundException("Playlist not found");
        }

        const tracks = await this.resolvePublicTracks(playlist.userId, playlist.trackIds);

        let isSaved = false;
        if (viewerUserId && !isOwner) {
            const saved = await prisma.savedPlaylist.findUnique({
                where: { userId_sourcePlaylistId: { userId: viewerUserId, sourcePlaylistId: id } },
                select: { id: true },
            });
            isSaved = Boolean(saved);
        }

        return {
            id: playlist.id,
            name: playlist.name,
            visibility: playlist.visibility as PlaylistVisibility,
            ownerUserId: playlist.userId,
            ownerDisplayName: playlist.user?.artist?.displayName ?? null,
            isOwner,
            isSaved,
            trackCount: tracks.length,
            playableTrackCount: tracks.filter((t) => t.playable).length,
            tracks,
            createdAt: playlist.createdAt,
            updatedAt: playlist.updatedAt,
        };
    }

    /** Build streamable public track entries from the owner's LibraryTrack records, preserving order. */
    private async resolvePublicTracks(ownerUserId: string, trackIds: string[]): Promise<PublicPlaylistTrack[]> {
        if (trackIds.length === 0) return [];
        // A playlist stores the frontend track id, which for catalog tracks is the
        // catalog track id, not the per-user LibraryTrack uuid. Resolve the owner's
        // rows by either, scoped to the owner so another user's row never matches.
        const records = await prisma.libraryTrack.findMany({
            where: {
                userId: ownerUserId,
                OR: [{ id: { in: trackIds } }, { catalogTrackId: { in: trackIds } }],
            },
        });
        const byKey = indexLibraryTracksByPlaylistKey(records);

        const resolved: PublicPlaylistTrack[] = [];
        for (const trackId of trackIds) {
            const record = byKey.get(trackId);
            if (!record) continue; // track removed from owner's library; skip silently
            const refs = extractCatalogRefs(record);
            const { streamPath, artworkPath } = catalogPathsFor(refs);
            resolved.push({
                id: record.id,
                title: record.title,
                artist: record.artist ?? null,
                album: record.album ?? null,
                duration: record.duration ?? null,
                streamPath,
                artworkPath,
                catalogTrackId: refs.trackId ?? record.catalogTrackId ?? null,
                releaseId: refs.releaseId ?? null,
                playable: Boolean(streamPath),
            });
        }
        return resolved;
    }

    /**
     * List public playlists for discovery surfaces (global catalog, home snapshot).
     *
     * Only playlists that are `public` AND have at least one playable
     * (catalog-backed) track are surfaced — a global discovery surface should
     * never present an empty playlist or one made entirely of owner-device files
     * nobody else can stream. Results are ordered most-recently-updated first.
     *
     * Covers and counts for every candidate are resolved with a single batched
     * LibraryTrack query (no per-playlist round trips).
     */
    async listPublicPlaylists(options?: { limit?: number }): Promise<PublicPlaylistSummary[]> {
        const limit = clampLimit(options?.limit, 50);
        // Over-fetch candidates because some will be dropped for having no
        // playable track; cap the work regardless of the requested limit.
        const candidateTake = Math.min(limit * 4, PUBLIC_PLAYLIST_DISCOVERY_MAX);
        const candidates = await prisma.playlist.findMany({
            where: { visibility: "public" },
            orderBy: { updatedAt: "desc" },
            take: candidateTake,
            include: { user: { select: { artist: { select: { displayName: true } } } } },
        });
        if (candidates.length === 0) return [];

        // Single batched lookup over every referenced track id. A playlist stores
        // the frontend track id, which for catalog tracks is the catalog track id
        // (not the per-user LibraryTrack uuid), so match on either. Rows are then
        // keyed by (ownerUserId + id|catalogTrackId) so a playlist only resolves
        // ITS OWN owner's rows — never another user's row that shares a catalog id.
        const allTrackIds = Array.from(new Set(candidates.flatMap((p) => p.trackIds)));
        const records = allTrackIds.length
            ? await prisma.libraryTrack.findMany({
                where: { OR: [{ id: { in: allTrackIds } }, { catalogTrackId: { in: allTrackIds } }] },
            })
            : [];
        // ownerUserId -> (id | catalogTrackId) -> row, so a playlist only resolves
        // ITS OWN owner's rows — never another user's row that shares a catalog id.
        const byOwner = new Map<string, Map<string, (typeof records)[number]>>();
        for (const r of records) {
            let owned = byOwner.get(r.userId);
            if (!owned) {
                owned = new Map();
                byOwner.set(r.userId, owned);
            }
            owned.set(r.id, r);
            if (r.catalogTrackId) owned.set(r.catalogTrackId, r);
        }

        const summaries: PublicPlaylistSummary[] = [];
        for (const playlist of candidates) {
            const ownerTracks = byOwner.get(playlist.userId);
            let trackCount = 0;
            let playableTrackCount = 0;
            const coverArtworkPaths: string[] = [];
            for (const trackId of playlist.trackIds) {
                const record = ownerTracks?.get(trackId);
                if (!record) continue; // not the owner's track (removed, or hijacked elsewhere)
                trackCount += 1;
                const { streamPath, artworkPath } = catalogPathsFor(extractCatalogRefs(record));
                if (!streamPath) continue; // local-only file: visible to owner, not streamable here
                playableTrackCount += 1;
                if (
                    artworkPath &&
                    coverArtworkPaths.length < PUBLIC_PLAYLIST_COVER_LIMIT &&
                    !coverArtworkPaths.includes(artworkPath)
                ) {
                    coverArtworkPaths.push(artworkPath);
                }
            }
            if (playableTrackCount === 0) continue; // never surface dead-end playlists

            summaries.push({
                id: playlist.id,
                name: playlist.name,
                ownerUserId: playlist.userId,
                ownerDisplayName: playlist.user?.artist?.displayName ?? null,
                trackCount,
                playableTrackCount,
                coverArtworkPaths,
                createdAt: playlist.createdAt,
                updatedAt: playlist.updatedAt,
            });
            if (summaries.length >= limit) break;
        }
        return summaries;
    }

    // ============================================
    // Saved playlists (library references)
    // ============================================

    /** Save (follow) another user's public playlist into the viewer's library. */
    async savePlaylist(userId: string, sourcePlaylistId: string): Promise<SavedPlaylistView> {
        const source = await prisma.playlist.findUnique({ where: { id: sourcePlaylistId } });
        if (!source) {
            throw new NotFoundException("Playlist not found");
        }
        if (source.userId === userId) {
            throw new BadRequestException("You already own this playlist.");
        }
        if (source.visibility !== "public") {
            throw new ForbiddenException("This playlist is private.");
        }

        const saved = await prisma.savedPlaylist.upsert({
            where: { userId_sourcePlaylistId: { userId, sourcePlaylistId } },
            update: {},
            create: { userId, sourcePlaylistId },
        });

        this.eventBus?.publish({
            eventName: "playlist.saved_to_library",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            userId,
            savedPlaylistId: saved.id,
            sourcePlaylistId,
            sourceUserId: source.userId,
        });

        const view = await this.getPublicPlaylist(sourcePlaylistId, userId);
        return { ...view, savedPlaylistId: saved.id, savedAt: saved.createdAt, available: true };
    }

    /** List the viewer's saved playlists, re-resolved live so owner edits propagate. */
    async listSavedPlaylists(userId: string): Promise<SavedPlaylistView[]> {
        const saved = await prisma.savedPlaylist.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
        });

        const views: SavedPlaylistView[] = [];
        for (const entry of saved) {
            try {
                const view = await this.getPublicPlaylist(entry.sourcePlaylistId, userId);
                views.push({ ...view, savedPlaylistId: entry.id, savedAt: entry.createdAt, available: true });
            } catch {
                // Source went private or was deleted: surface as unavailable, never crash.
                views.push({
                    id: entry.sourcePlaylistId,
                    name: "Unavailable playlist",
                    visibility: "private",
                    ownerUserId: "",
                    ownerDisplayName: null,
                    isOwner: false,
                    isSaved: true,
                    trackCount: 0,
                    playableTrackCount: 0,
                    tracks: [],
                    createdAt: entry.createdAt,
                    updatedAt: entry.createdAt,
                    savedPlaylistId: entry.id,
                    savedAt: entry.createdAt,
                    available: false,
                });
            }
        }
        return views;
    }

    /** Remove a saved playlist from the viewer's library. */
    async removeSavedPlaylist(userId: string, savedPlaylistId: string): Promise<{ removed: boolean }> {
        const entry = await prisma.savedPlaylist.findUnique({ where: { id: savedPlaylistId } });
        if (!entry || entry.userId !== userId) {
            throw new NotFoundException("Saved playlist not found");
        }
        await prisma.savedPlaylist.delete({ where: { id: savedPlaylistId } });
        this.eventBus?.publish({
            eventName: "playlist.removed_from_library",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            userId,
            savedPlaylistId,
            sourcePlaylistId: entry.sourcePlaylistId,
        });
        return { removed: true };
    }
}

function getChangedFields(
    playlist: { name: string; folderId: string | null; trackIds: string[]; visibility: string },
    data: { name?: string; folderId?: string | null; trackIds?: string[]; visibility?: string },
) {
    const fields: string[] = [];
    if (data.name !== undefined && data.name !== playlist.name) fields.push("name");
    if (data.folderId !== undefined && data.folderId !== playlist.folderId) fields.push("folder");
    if (data.trackIds !== undefined && !sameStringArray(data.trackIds, playlist.trackIds)) fields.push("tracks");
    if (data.visibility !== undefined && normalizeVisibility(data.visibility) !== playlist.visibility) fields.push("visibility");
    return fields;
}

function normalizeVisibility(value: string): PlaylistVisibility {
    const normalized = String(value).trim().toLowerCase();
    if (!(PLAYLIST_VISIBILITIES as readonly string[]).includes(normalized)) {
        throw new BadRequestException(
            `Invalid playlist visibility "${value}". Allowed: ${PLAYLIST_VISIBILITIES.join(", ")}.`,
        );
    }
    return normalized as PlaylistVisibility;
}

function sameStringArray(left: string[], right: string[]) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function limitTrackIds(trackIds: string[]) {
    return trackIds.slice(0, 100);
}

function clampLimit(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(PUBLIC_PLAYLIST_DISCOVERY_MAX, Math.floor(value)));
}

/**
 * Index an owner's LibraryTrack rows by BOTH id and catalogTrackId, so a playlist
 * entry resolves whether it stored the per-user LibraryTrack uuid or the shared
 * catalog track id (catalog tracks are added to playlists by their catalog id).
 */
function indexLibraryTracksByPlaylistKey<T extends { id: string; catalogTrackId: string | null }>(
    records: T[],
): Map<string, T> {
    const byKey = new Map<string, T>();
    for (const record of records) {
        byKey.set(record.id, record);
        if (record.catalogTrackId) byKey.set(record.catalogTrackId, record);
    }
    return byKey;
}

/** Build public, unauthenticated catalog stream/artwork paths from extracted refs. */
function catalogPathsFor(refs: { releaseId: string | null; trackId: string | null }): {
    streamPath: string | null;
    artworkPath: string | null;
} {
    const streamPath =
        refs.releaseId && refs.trackId
            ? `/catalog/releases/${encodeURIComponent(refs.releaseId)}/tracks/${encodeURIComponent(refs.trackId)}/stream`
            : null;
    const artworkPath = refs.releaseId
        ? `/catalog/releases/${encodeURIComponent(refs.releaseId)}/artwork`
        : null;
    return { streamPath, artworkPath };
}

/**
 * Extract catalog release/track ids from a LibraryTrack so we can build public,
 * unauthenticated stream/artwork URLs. Local device-only tracks yield nothing,
 * which marks them non-playable for other listeners.
 */
function extractCatalogRefs(record: {
    catalogTrackId: string | null;
    remoteUrl: string | null;
    remoteArtworkUrl: string | null;
    previewUrl: string | null;
}): { releaseId: string | null; trackId: string | null } {
    let releaseId: string | null = null;
    let trackId: string | null = record.catalogTrackId ?? null;

    for (const value of [record.remoteUrl, record.remoteArtworkUrl, record.previewUrl]) {
        const path = extractPath(value);
        if (!path) continue;
        const streamMatch = path.match(/\/catalog\/(?:me\/)?releases\/([^/]+)\/tracks\/([^/]+)\/stream/);
        if (streamMatch) {
            releaseId = releaseId ?? decodeSegment(streamMatch[1]);
            trackId = trackId ?? decodeSegment(streamMatch[2]);
        }
        const artworkMatch = path.match(/\/catalog\/(?:me\/)?releases\/([^/]+)\/artwork/);
        if (artworkMatch) {
            releaseId = releaseId ?? decodeSegment(artworkMatch[1]);
        }
    }

    return { releaseId, trackId };
}

function extractPath(value: string | null): string {
    if (!value) return "";
    try {
        return new URL(value, "http://resonate.local").pathname;
    } catch {
        return value;
    }
}

function decodeSegment(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
