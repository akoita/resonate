import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
        return prisma.libraryTrack.findMany({
            where,
            orderBy: { createdAt: "desc" },
        });
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
