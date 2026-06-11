import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SharedModule } from "../shared/shared.module";
import { ArtistController } from "./artist.controller";
import { ArtistService } from "./artist.service";

@Module({
    imports: [AuthModule, SharedModule],
    controllers: [ArtistController],
    providers: [ArtistService],
    exports: [ArtistService],
})
export class ArtistModule { }
