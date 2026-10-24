import { Controller, Get, Post, Delete, Body, Param, UseGuards, Req, Query, HttpCode } from "@nestjs/common";
import { Request } from "express";
import { AuthGuard } from "@nestjs/passport";
import { LibraryService } from "./library.service";
import { DeleteLibraryTracksDto, SaveLibraryTrackDto, SaveLibraryTracksDto } from "./library.dto";

@Controller("library")
@UseGuards(AuthGuard("jwt"))
export class LibraryController {
    constructor(private readonly libraryService: LibraryService) {}

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
