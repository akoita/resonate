import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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

        // If an ID is provided, upsert by ID
        if (data.id) {
            return prisma.libraryTrack.upsert({
                where: { id: data.id },
                update: trackData,
                create: { id: data.id, ...trackData },
            });
        }

        // For remote tracks, dedup by catalogTrackId
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
            return tracks;
        }

        const [existingCatalogTracks, existingCatalogReleases, existingCatalogStems] = await Promise.all([
            catalogTrackIds.size > 0
                ? prisma.track.findMany({
                    where: { id: { in: Array.from(catalogTrackIds) } },
                    select: { id: true },
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
        const existingCatalogReleaseIds = new Set(existingCatalogReleases.map((release) => release.id));
        const existingCatalogStemIds = new Set(existingCatalogStems.map((stem) => stem.id));
        const staleTrackIds = remoteTracks
            .filter((track) => {
                const references = collectCatalogReferences(track);
                return (
                    Array.from(references.trackIds).some((id) => !existingCatalogTrackIds.has(id)) ||
                    Array.from(references.releaseIds).some((id) => !existingCatalogReleaseIds.has(id)) ||
                    Array.from(references.stemIds).some((id) => !existingCatalogStemIds.has(id))
                );
            })
            .map((track) => track.id);

        if (staleTrackIds.length === 0) {
            return tracks;
        }

        await prisma.libraryTrack.deleteMany({
            where: { userId, id: { in: staleTrackIds } },
        });
        const playlists = await prisma.playlist.findMany({
            where: { userId, trackIds: { hasSome: staleTrackIds } },
            select: { id: true, trackIds: true },
        });
        for (const playlist of playlists) {
            await prisma.playlist.update({
                where: { id: playlist.id },
                data: {
                    trackIds: playlist.trackIds.filter((id) => !staleTrackIds.includes(id)),
                },
            });
        }

        return tracks.filter((track) => !staleTrackIds.includes(track.id));
    }

    async getTrack(userId: string, id: string) {
        const track = await prisma.libraryTrack.findUnique({ where: { id } });
        if (!track || track.userId !== userId) {
            throw new NotFoundException("Library track not found");
        }
        return track;
    }

    async deleteTrack(userId: string, id: string) {
        const track = await prisma.libraryTrack.findUnique({ where: { id } });
        if (!track || track.userId !== userId) {
            throw new NotFoundException("Library track not found");
        }
        return prisma.libraryTrack.delete({ where: { id } });
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
