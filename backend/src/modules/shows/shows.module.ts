import { Module } from "@nestjs/common";
import { AnalyticsModule } from "../analytics/analytics.module";
import { CommunityModule } from "../community/community.module";
import { ShowsController } from "./shows.controller";
import { ShowsService } from "./shows.service";
import { ShowsEscrowIndexerService } from "./shows-escrow-indexer.service";

@Module({
  imports: [AnalyticsModule, CommunityModule],
  controllers: [ShowsController],
  providers: [ShowsService, ShowsEscrowIndexerService],
  exports: [ShowsService, ShowsEscrowIndexerService],
})
export class ShowsModule {}
