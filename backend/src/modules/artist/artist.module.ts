import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ArtistController } from "./artist.controller";
import { ArtistService } from "./artist.service";

@Module({
    controllers: [ArtistController],
    providers: [ArtistService],
    exports: [ArtistService],
})
export class ArtistModule { }
