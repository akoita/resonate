import { Controller, Get, Post, Delete, Body, Param, UseGuards, Req, Query, HttpCode } from "@nestjs/common";
import { Request } from "express";
import { AuthGuard } from "@nestjs/passport";
import { LibraryService } from "./library.service";
import { Throttle } from "@nestjs/throttler";
import { DeleteLibraryTracksDto, SaveLibraryTrackDto, SaveLibraryTracksDto } from "./library.dto";
import { AlbumLookupService } from "./album_lookup.service";
import { minutes } from "../shared/rate_limits";

/** Per account, not per IP: the lookup is for one person's own albums. */
const trackByUser = (req: Record<string, any>) => req.user?.userId ?? req.ip;

@Controller("library")
@UseGuards(AuthGuard("jwt"))
export class LibraryController {
    constructor(
        private readonly libraryService: LibraryService,
        private readonly albumLookup: AlbumLookupService,
    ) {}

    /**
     * "Look up details" in Edit album (#2538): MusicBrainz releases for an
     * album of the listener's own files. Sends only artist, album and track
     * count, from this server (no account identifier reaches MusicBrainz).
     */
    @Throttle({ default: { limit: 20, ttl: minutes(1), getTracker: trackByUser } })
    @Get("lookup/releases")
    lookupReleases(
        @Query("artist") artist?: string,
        @Query("album") album?: string,
        @Query("tracks") tracks?: string,
    ) {
        return this.albumLookup.search({ artist, album, tracks });
    }

    /** Year, genre and label of the release the listener picked. */
    @Throttle({ default: { limit: 20, ttl: minutes(1), getTracker: trackByUser } })
    @Get("lookup/releases/:id")
    lookupReleaseDetails(@Param("id") id: string) {
        return this.albumLookup.details(id);
    }

    @Post("tracks")
    saveTrack(@Req() req: Request, @Body() body: SaveLibraryTrackDto) {
        return this.libraryService.saveTrack((req as any).user.userId, body);
    }

    @Post("tracks/batch")
    saveTracks(@Req() req: Request, @Body() body: SaveLibraryTracksDto) {
        return this.libraryService.saveTracks((req as any).user.userId, body.tracks);
    }

    @Get("tracks")
    listTracks(@Req() req: Request, @Query("source") source?: string) {
        return this.libraryService.listTracks((req as any).user.userId, source);
    }

    @Get("tracks/:id")
    getTrack(@Req() req: Request, @Param("id") id: string) {
        return this.libraryService.getTrack((req as any).user.userId, id);
    }

    @Delete("tracks/batch")
    @HttpCode(200)
    deleteTracks(@Req() req: Request, @Body() body: DeleteLibraryTracksDto) {
        return this.libraryService.deleteTracks((req as any).user.userId, body.ids);
    }

    @Delete("tracks/local")
    @HttpCode(200)
    clearLocalTracks(@Req() req: Request) {
        return this.libraryService.clearLocalTracks((req as any).user.userId);
    }

    @Delete("tracks/:id")
    deleteTrack(@Req() req: Request, @Param("id") id: string) {
        return this.libraryService.deleteTrack((req as any).user.userId, id);
    }
}
