import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsIngestService } from "./analytics_ingest.service";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsInstrumentationService } from "./analytics_instrumentation.service";
import { AnalyticsGovernanceService } from "./analytics_governance.service";
import { ANALYTICS_EVENT_STORE, PrismaAnalyticsEventStore } from "./analytics_event_store";
import { AnalyticsWarehouseExportService } from "./analytics_warehouse";

@Module({
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsIngestService,
    AnalyticsInstrumentationService,
    AnalyticsGovernanceService,
    AnalyticsWarehouseExportService,
    PrismaAnalyticsEventStore,
    {
      provide: ANALYTICS_EVENT_STORE,
      useExisting: PrismaAnalyticsEventStore,
    },
  ],
  exports: [
    AnalyticsIngestService,
    AnalyticsInstrumentationService,
    AnalyticsGovernanceService,
    AnalyticsWarehouseExportService,
  ],
})
export class AnalyticsModule {}
