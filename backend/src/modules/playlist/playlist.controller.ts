import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req, Query } from "@nestjs/common";
import { Request } from "express";
import { AuthGuard } from "@nestjs/passport";
import { PlaylistService } from "./playlist.service";

@Controller("playlists")
@UseGuards(AuthGuard("jwt"))
export class PlaylistController {
    constructor(private readonly playlistService: PlaylistService) { }

    // Folders
    @Post("folders")
    createFolder(@Req() req: Request, @Body("name") name: string) {
        return this.playlistService.createFolder((req as any).user.userId, name);
    }

    @Get("folders")
    listFolders(@Req() req: Request) {
        return this.playlistService.listFolders((req as any).user.userId);
    }

    @Put("folders/:id")
    updateFolder(@Req() req: Request, @Param("id") id: string, @Body("name") name: string) {
        return this.playlistService.updateFolder((req as any).user.userId, id, name);
    }

    @Delete("folders/:id")
    deleteFolder(@Req() req: Request, @Param("id") id: string) {
        return this.playlistService.deleteFolder((req as any).user.userId, id);
    }

    // Playlists
    @Post()
    createPlaylist(@Req() req: Request, @Body() body: { name: string; folderId?: string; trackIds?: string[] }) {
        return this.playlistService.createPlaylist((req as any).user.userId, body);
    }

    @Get()
    listPlaylists(@Req() req: Request, @Query("folderId") folderId?: string) {
        return this.playlistService.listPlaylists((req as any).user.userId, folderId);
    }

    @Get(":id")
    getPlaylist(@Req() req: Request, @Param("id") id: string) {
        return this.playlistService.getPlaylist((req as any).user.userId, id);
    }

    @Put(":id")
    updatePlaylist(@Req() req: Request, @Param("id") id: string, @Body() body: { name?: string; folderId?: string | null; trackIds?: string[] }) {
        return this.playlistService.updatePlaylist((req as any).user.userId, id, body);
    }

    @Delete(":id")
    deletePlaylist(@Req() req: Request, @Param("id") id: string) {
        return this.playlistService.deletePlaylist((req as any).user.userId, id);
    }
}
