import { Module } from "@nestjs/common";
import { LibraryController } from "./library.controller";
import { LibraryService } from "./library.service";
import { AlbumLookupService } from "./album_lookup.service";

@Module({
    controllers: [LibraryController],
    providers: [LibraryService, AlbumLookupService],
    exports: [LibraryService],
})
export class LibraryModule {}
