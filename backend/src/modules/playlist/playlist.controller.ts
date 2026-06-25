import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req, Query } from "@nestjs/common";
import { Request } from "express";
import { AuthGuard } from "@nestjs/passport";
import { OptionalJwtAuthGuard } from "../auth/optional-jwt.guard";
import { PlaylistService } from "./playlist.service";

@Controller("playlists")
@UseGuards(AuthGuard("jwt"))
export class PlaylistController {
    constructor(private readonly playlistService: PlaylistService) { }

    // Saved (followed) public playlists — declared before ":id" routes so the
    // "saved" segment is not captured as a playlist id.
    @Post("saved")
    savePlaylist(@Req() req: Request, @Body() body: { sourcePlaylistId: string }) {
        return this.playlistService.savePlaylist((req as any).user.userId, body.sourcePlaylistId);
    }

    @Get("saved")
    listSavedPlaylists(@Req() req: Request) {
        return this.playlistService.listSavedPlaylists((req as any).user.userId);
    }

    @Delete("saved/:id")
    removeSavedPlaylist(@Req() req: Request, @Param("id") id: string) {
        return this.playlistService.removeSavedPlaylist((req as any).user.userId, id);
    }

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
    updatePlaylist(@Req() req: Request, @Param("id") id: string, @Body() body: { name?: string; folderId?: string | null; trackIds?: string[]; visibility?: string }) {
        return this.playlistService.updatePlaylist((req as any).user.userId, id, body);
    }

    @Delete(":id")
    deletePlaylist(@Req() req: Request, @Param("id") id: string) {
        return this.playlistService.deletePlaylist((req as any).user.userId, id);
    }
}

/**
 * Public, unauthenticated read for shared playlists. Auth is optional: a valid
 * token lets the handler report owner/saved state, but anonymous viewers can
 * still load any playlist whose visibility is "public".
 */
@Controller("playlists")
export class PublicPlaylistController {
    constructor(private readonly playlistService: PlaylistService) { }

    @UseGuards(OptionalJwtAuthGuard)
    @Get("public/:id")
    getPublicPlaylist(@Req() req: Request, @Param("id") id: string) {
        return this.playlistService.getPublicPlaylist(id, (req as any).user?.userId);
    }
}

/**
 * Public, unauthenticated discovery feed for public playlists, exposed under the
 * catalog surface (`GET /catalog/playlists`) so it sits beside catalog releases,
 * artists, and stems. It lives in PlaylistModule (which owns playlist data)
 * rather than CatalogModule so the catalog module does not import the playlist
 * module — that import would close a NestJS module cycle via SharedModule.
 */
@Controller("catalog/playlists")
export class PublicPlaylistDiscoveryController {
    constructor(private readonly playlistService: PlaylistService) { }

    @Get()
    listPublicPlaylists(@Query("limit") limit?: string) {
        const parsedLimit = limit ? Number(limit) : undefined;
        return this.playlistService.listPublicPlaylists({
            limit: parsedLimit !== undefined && Number.isNaN(parsedLimit) ? undefined : parsedLimit,
        });
    }
}
