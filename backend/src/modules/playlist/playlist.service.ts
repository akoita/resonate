import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../../db/prisma";

@Injectable()
export class PlaylistService {
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
        return prisma.playlist.create({
            data: {
                userId,
                name: data.name,
                folderId: data.folderId,
                trackIds: data.trackIds || [],
            },
        });
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
        return prisma.playlist.update({
            where: { id },
            data: {
                name: data.name,
                folderId: data.folderId,
                trackIds: data.trackIds,
            },
        });
    }

    async deletePlaylist(userId: string, id: string) {
        const playlist = await prisma.playlist.findUnique({ where: { id } });
        if (!playlist || playlist.userId !== userId) {
            throw new NotFoundException("Playlist not found");
        }
        return prisma.playlist.delete({ where: { id } });
    }
}
