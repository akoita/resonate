import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";

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

    async updatePlaylist(userId: string, id: string, data: { name?: string; folderId?: string | null; trackIds?: string[] }) {
        const playlist = await prisma.playlist.findUnique({ where: { id } });
        if (!playlist || playlist.userId !== userId) {
            throw new NotFoundException("Playlist not found");
        }
        const updated = await prisma.playlist.update({
            where: { id },
            data: {
                name: data.name,
                folderId: data.folderId,
                trackIds: data.trackIds,
            },
        });
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
}

function getChangedFields(
    playlist: { name: string; folderId: string | null; trackIds: string[] },
    data: { name?: string; folderId?: string | null; trackIds?: string[] },
) {
    const fields: string[] = [];
    if (data.name !== undefined && data.name !== playlist.name) fields.push("name");
    if (data.folderId !== undefined && data.folderId !== playlist.folderId) fields.push("folder");
    if (data.trackIds !== undefined && !sameStringArray(data.trackIds, playlist.trackIds)) fields.push("tracks");
    return fields;
}

function sameStringArray(left: string[], right: string[]) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function limitTrackIds(trackIds: string[]) {
    return trackIds.slice(0, 100);
}
