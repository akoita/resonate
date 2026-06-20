import { Module } from "@nestjs/common";
import { PlaylistController, PublicPlaylistController } from "./playlist.controller";
import { PlaylistService } from "./playlist.service";
import { SharedModule } from "../shared/shared.module";

@Module({
    imports: [SharedModule],
    controllers: [PlaylistController, PublicPlaylistController],
    providers: [PlaylistService],
    exports: [PlaylistService],
})
export class PlaylistModule { }
