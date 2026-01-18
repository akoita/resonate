import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsIngestService } from "./analytics_ingest.service";
import { AnalyticsService } from "./analytics.service";

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsIngestService],
})
export class AnalyticsModule {}
