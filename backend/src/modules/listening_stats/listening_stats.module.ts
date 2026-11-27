import { Module } from "@nestjs/common";
import { ListeningStatsController } from "./listening_stats.controller";
import { ListeningStatsService } from "./listening_stats.service";

/** The listener's own listening stats ("Your listening"), computed on read. */
@Module({
  controllers: [ListeningStatsController],
  providers: [ListeningStatsService],
})
export class ListeningStatsModule {}
