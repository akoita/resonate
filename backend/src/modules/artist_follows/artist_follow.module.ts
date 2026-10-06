import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { ArtistFollowController } from "./artist_follow.controller";
import { ArtistFollowService } from "./artist_follow.service";

@Module({
  imports: [AnalyticsModule],
  controllers: [ArtistFollowController],
  providers: [ArtistFollowService],
  exports: [ArtistFollowService],
})
export class ArtistFollowModule {}
