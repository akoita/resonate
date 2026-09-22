import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import {
    LOCAL_FILE_AVAILABILITY,
    REMOVED_AVAILABILITY,
    resolveTrackAvailability,
    type TrackAvailability,
} from "../catalog/track-availability";
import {
    normalizeCreditName,
    resolveCreditedArtistName,
} from "../shared/artist_attribution";

const prisma = new PrismaClient();

type CatalogLibraryIdentity = {
    releaseId: string;
    creditedArtistId: string | null;
    creditedArtistName: string | null;
};

function resolveCatalogLibraryIdentity(track: {
    artist?: string | null;
    releaseId: string;
    release: {
        primaryArtist?: string | null;
        artist: { id: string; displayName: string };
        artistCredits: Array<{ artistId: string; displayName: string; role: string; identityStatus: string }>;
    };
}): CatalogLibraryIdentity {
    const creditedArtistName = resolveCreditedArtistName({
        trackArtist: track.artist,
        credits: track.release.artistCredits,
        primaryArtist: track.release.primaryArtist,
        accountDisplayName: track.release.artist.displayName,
    });
    const normalizedName = normalizeCreditName(creditedArtistName).toLowerCase();
    const matchingCredits = track.release.artistCredits.filter(
        (credit) => normalizeCreditName(credit.displayName).toLowerCase() === normalizedName,
    );
    const matchingIds = new Set(
        matchingCredits
            .filter((credit) => credit.identityStatus !== "ambiguous")
            .map((credit) => credit.artistId),
    );

    return {
        releaseId: track.releaseId,
        creditedArtistId: matchingCredits.some((credit) => credit.identityStatus === "ambiguous")
            ? null
            : matchingIds.size === 1 ? Array.from(matchingIds)[0] : null,
        creditedArtistName,
    };
}

function extractPath(value?: string | null): string {
    if (!value) return "";
    try {
        return new URL(value, "http://resonate.local").pathname;
    } catch {
        return value;
    }
}

function decodePathSegment(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function collectCatalogReferences(track: {
    id: string;
    source: string;
    catalogTrackId?: string | null;
    remoteUrl?: string | null;
    remoteArtworkUrl?: string | null;
    previewUrl?: string | null;
}) {
    const trackIds = new Set<string>();
    const releaseIds = new Set<string>();
    const stemIds = new Set<string>();

    if (track.catalogTrackId) trackIds.add(track.catalogTrackId);

    for (const value of [track.remoteUrl, track.remoteArtworkUrl, track.previewUrl]) {
        const path = extractPath(value);
        const streamMatch = path.match(/\/catalog\/(?:me\/)?releases\/([^/]+)\/tracks\/([^/]+)\/stream/);
        if (streamMatch) {
            releaseIds.add(decodePathSegment(streamMatch[1]));
            trackIds.add(decodePathSegment(streamMatch[2]));
        }

        const artworkMatch = path.match(/\/catalog\/(?:me\/)?releases\/([^/]+)\/artwork/);
        if (artworkMatch) {
            releaseIds.add(decodePathSegment(artworkMatch[1]));
        }

        const stemMatch = path.match(/\/catalog\/stems\/([^/]+)\/preview/);
        if (stemMatch) {
            stemIds.add(decodePathSegment(stemMatch[1]));
        }
    }

    return { trackIds, releaseIds, stemIds };
}

export interface SaveTrackInput {
    id?: string;
    source?: string;
    title: string;
    artist?: string | null;
    albumArtist?: string | null;
    album?: string | null;
    year?: number | null;
    genre?: string | null;
    duration?: number | null;
    sourcePath?: string | null;
    fileSize?: number | null;
    catalogTrackId?: string | null;
    remoteUrl?: string | null;
    remoteArtworkUrl?: string | null;
    stemType?: string | null;
    tokenId?: string | null;
    listingId?: string | null;
    purchaseDate?: string | null;
    isOwned?: boolean;
    previewUrl?: string | null;
}

@Injectable()
export class LibraryService {
    async saveTrack(userId: string, data: SaveTrackInput) {
        const source = data.source || "local";
        const trackData = {
            userId,
            source,
            title: data.title,
            artist: data.artist,
            albumArtist: data.albumArtist,
            album: data.album,
            year: data.year,
            genre: data.genre,
            duration: data.duration,
            sourcePath: data.sourcePath,
            fileSize: data.fileSize,
            catalogTrackId: data.catalogTrackId,
            remoteUrl: data.remoteUrl,
            remoteArtworkUrl: data.remoteArtworkUrl,
            stemType: data.stemType,
            tokenId: data.tokenId,
            listingId: data.listingId,
            purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
            isOwned: data.isOwned ?? false,
            previewUrl: data.previewUrl,
        };

        // Remote catalog tracks: ALWAYS dedup per-user by (userId, catalogTrackId)
        // and let the row id be a generated per-user uuid. The client-provided
        // `id` for a catalog track is the SHARED catalog track id, so honoring it
        // as the primary key would let one user's save overwrite another user's
        // row (hijacking its `userId`). Keep this branch ahead of the id branch.
        if (source === "remote" && data.catalogTrackId) {
            return prisma.libraryTrack.upsert({
                where: {
                    userId_catalogTrackId: {
                        userId,
                        catalogTrackId: data.catalogTrackId,
                    },
                },
                update: trackData,
                create: trackData,
            });
        }

        // If an ID is provided (local files, owned stems, etc.), upsert by ID.
        if (data.id) {
            return prisma.libraryTrack.upsert({
                where: { id: data.id },
                update: trackData,
                create: { id: data.id, ...trackData },
            });
        }

        // For local tracks, dedup by sourcePath + fileSize
        if (source === "local" && data.sourcePath && data.fileSize) {
            return prisma.libraryTrack.upsert({
                where: {
                    userId_sourcePath_fileSize: {
                        userId,
                        sourcePath: data.sourcePath,
                        fileSize: data.fileSize,
                    },
                },
                update: trackData,
                create: trackData,
            });
        }

        // Fallback: just create
        return prisma.libraryTrack.create({ data: trackData });
    }

    async saveTracks(userId: string, tracks: SaveTrackInput[]) {
        const results = [];
        for (const track of tracks) {
            results.push(await this.saveTrack(userId, track));
        }
        return results;
    }

    async listTracks(userId: string, source?: string) {
        const where: any = { userId };
        if (source) where.source = source;
        const tracks = await prisma.libraryTrack.findMany({
            where,
            orderBy: { createdAt: "desc" },
        });

        const remoteTracks = tracks.filter((track) => track.source === "remote");
        const catalogTrackIds = new Set<string>();
        const catalogReleaseIds = new Set<string>();
        const catalogStemIds = new Set<string>();

        for (const track of remoteTracks) {
            const references = collectCatalogReferences(track);
            references.trackIds.forEach((id) => catalogTrackIds.add(id));
            references.releaseIds.forEach((id) => catalogReleaseIds.add(id));
            references.stemIds.forEach((id) => catalogStemIds.add(id));
        }

        if (catalogTrackIds.size === 0 && catalogReleaseIds.size === 0 && catalogStemIds.size === 0) {
            return withAvailability(tracks, new Map());
        }

        const [existingCatalogTracks, existingCatalogReleases, existingCatalogStems] = await Promise.all([
            catalogTrackIds.size > 0
                ? prisma.track.findMany({
                    where: { id: { in: Array.from(catalogTrackIds) } },
                    select: {
                        id: true,
                        artist: true,
                        releaseId: true,
                        release: {
                            select: {
                                primaryArtist: true,
                                artist: { select: { id: true, displayName: true } },
                                artistCredits: {
                                    select: { artistId: true, displayName: true, role: true, identityStatus: true },
                                    orderBy: { sortOrder: "asc" },
                                },
                            },
                        },
                    },
                })
                : Promise.resolve([]),
            catalogReleaseIds.size > 0
                ? prisma.release.findMany({
                    where: { id: { in: Array.from(catalogReleaseIds) } },
                    select: { id: true },
                })
                : Promise.resolve([]),
            catalogStemIds.size > 0
                ? prisma.stem.findMany({
                    where: { id: { in: Array.from(catalogStemIds) } },
                    select: { id: true },
                })
                : Promise.resolve([]),
        ]);
        const existingCatalogTrackIds = new Set(existingCatalogTracks.map((track) => track.id));
        const catalogIdentities = new Map(
            existingCatalogTracks.map((track) => [track.id, resolveCatalogLibraryIdentity(track)]),
        );
        const existingCatalogReleaseIds = new Set(existingCatalogReleases.map((release) => release.id));
        const existingCatalogStemIds = new Set(existingCatalogStems.map((stem) => stem.id));
        const staleTracks = remoteTracks.filter((track) => {
            const references = collectCatalogReferences(track);
            return (
                Array.from(references.trackIds).some((id) => !existingCatalogTrackIds.has(id)) ||
                Array.from(references.releaseIds).some((id) => !existingCatalogReleaseIds.has(id)) ||
                Array.from(references.stemIds).some((id) => !existingCatalogStemIds.has(id))
            );
        });
        const staleTrackIds = staleTracks.map((track) => track.id);

        // #1793: a withdrawn release is NOT stale — its rows above still resolve,
        // so nothing is deleted. Annotate every catalog-backed row with why it
        // can or cannot be played, in one batched query.
        const availability = await resolveTrackAvailability(catalogTrackIds);

        if (staleTrackIds.length === 0) {
            return withAvailability(tracks, availability, catalogIdentities);
        }

        await prisma.libraryTrack.deleteMany({
            where: { userId, id: { in: staleTrackIds } },
        });
        // Playlists may reference these tracks by per-user LibraryTrack.id OR by
        // the shared catalogTrackId (the frontend stores catalog ids for catalog
        // tracks), so purge both sets of keys.
        const stalePlaylistKeys = new Set<string>(staleTrackIds);
        for (const track of staleTracks) {
            if (track.catalogTrackId) stalePlaylistKeys.add(track.catalogTrackId);
        }
        const stalePlaylistKeyList = Array.from(stalePlaylistKeys);
        const playlists = await prisma.playlist.findMany({
            where: { userId, trackIds: { hasSome: stalePlaylistKeyList } },
            select: { id: true, trackIds: true },
        });
        for (const playlist of playlists) {
            await prisma.playlist.update({
                where: { id: playlist.id },
                data: {
                    trackIds: playlist.trackIds.filter((id) => !stalePlaylistKeys.has(id)),
                },
            });
        }

        return withAvailability(
            tracks.filter((track) => !staleTrackIds.includes(track.id)),
            availability,
            catalogIdentities,
        );
    }

    async getTrack(userId: string, id: string) {
        const track = await findOwnedLibraryTrack(userId, id);
        if (!track) {
            throw new NotFoundException("Library track not found");
        }
        const [annotated] = withAvailability(
            [track],
            await resolveTrackAvailability(collectCatalogReferences(track).trackIds),
        );
        return annotated;
    }

    async deleteTrack(userId: string, id: string) {
        const track = await findOwnedLibraryTrack(userId, id);
        if (!track) {
            throw new NotFoundException("Library track not found");
        }
        return prisma.libraryTrack.delete({ where: { id: track.id } });
    }

    async deleteTracks(userId: string, ids: string[]) {
        return prisma.libraryTrack.deleteMany({
            where: { id: { in: ids }, userId },
        });
    }

    async clearLocalTracks(userId: string) {
        return prisma.libraryTrack.deleteMany({
            where: { userId, source: "local" },
        });
    }
}

/**
 * Annotate library rows with catalog availability (#1793).
 *
 * A row whose release an artist withdrew STAYS in the library — it is returned
 * with `availability.state === "withdrawn"` so the person sees what happened
 * instead of finding a hole. Device-local rows report "local_file".
 */
function withAvailability<
    T extends {
        id: string;
        source: string;
        catalogTrackId?: string | null;
        remoteUrl?: string | null;
        remoteArtworkUrl?: string | null;
        previewUrl?: string | null;
    },
>(
    tracks: T[],
    availability: Map<string, TrackAvailability>,
    catalogIdentities: Map<string, CatalogLibraryIdentity> = new Map(),
): Array<T & {
    availability: TrackAvailability;
    releaseId?: string;
    creditedArtistId?: string | null;
    creditedArtistName?: string | null;
}> {
    return tracks.map((track) => {
        const [catalogTrackId] = Array.from(collectCatalogReferences(track).trackIds);
        if (!catalogTrackId) {
            return { ...track, availability: LOCAL_FILE_AVAILABILITY };
        }
        const identity = catalogIdentities.get(catalogTrackId);
        return {
            ...track,
            availability: availability.get(catalogTrackId) ?? REMOVED_AVAILABILITY,
            ...(identity || {}),
        };
    });
}

/**
 * Resolve a LibraryTrack owned by `userId` from either its per-user `id` or its
 * shared `catalogTrackId`. Frontend callers may still pass a catalog id for
 * tracks added before the per-user-row fix, so accept both.
 */
async function findOwnedLibraryTrack(userId: string, id: string) {
    const track = await prisma.libraryTrack.findFirst({
        where: { userId, OR: [{ id }, { catalogTrackId: id }] },
    });
    return track;
}
