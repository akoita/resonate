import { Module } from "@nestjs/common";
import { ListeningRecentController } from "./listening_recent.controller";
import { ListeningRecentService } from "./listening_recent.service";
import { ListeningStatsController } from "./listening_stats.controller";
import { ListeningStatsService } from "./listening_stats.service";

/**
 * The listener's own listening: stats ("Your listening") and recent plays
 * (Home's "Jump back in"), both computed on read.
 */
@Module({
  controllers: [ListeningStatsController, ListeningRecentController],
  providers: [ListeningStatsService, ListeningRecentService],
})
export class ListeningStatsModule {}
