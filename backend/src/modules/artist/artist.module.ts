import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SharedModule } from "../shared/shared.module";
import { ArtistController } from "./artist.controller";
import { ArtistEnrichmentService } from "./artist-enrichment.service";
import { ArtistService } from "./artist.service";

@Module({
    imports: [AuthModule, SharedModule],
    controllers: [ArtistController],
    providers: [ArtistService, ArtistEnrichmentService],
    exports: [ArtistService],
})
export class ArtistModule { }
