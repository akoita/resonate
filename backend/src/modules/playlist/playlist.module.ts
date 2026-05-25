import { Module } from "@nestjs/common";
import { PlaylistController } from "./playlist.controller";
import { PlaylistService } from "./playlist.service";
import { SharedModule } from "../shared/shared.module";

@Module({
    imports: [SharedModule],
    controllers: [PlaylistController],
    providers: [PlaylistService],
    exports: [PlaylistService],
})
export class PlaylistModule { }
