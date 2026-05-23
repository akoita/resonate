import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsIngestService } from "./analytics_ingest.service";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsAuthorizationService } from "./analytics_authorization.service";
import { AnalyticsInstrumentationService } from "./analytics_instrumentation.service";
import { AnalyticsGovernanceService } from "./analytics_governance.service";
import { ANALYTICS_EVENT_STORE, PrismaAnalyticsEventStore } from "./analytics_event_store";
import { AnalyticsWarehouseExportService } from "./analytics_warehouse";
import { ANALYTICS_REPORT_SOURCE, analyticsReportSourceFromEnv } from "./analytics_bigquery_report";
import {
  ANALYTICS_WAREHOUSE_TARGET,
  AnalyticsWarehouseLoaderService,
  analyticsWarehouseTargetFromEnv,
} from "./analytics_warehouse_loader";
import { ANALYTICS_EVENT_PUBLISHER, analyticsEventPublisherFromEnv } from "./analytics_event_publisher";
import { AnalyticsDomainEventBridgeService } from "./analytics_domain_event_bridge.service";
import { SharedModule } from "../shared/shared.module";

@Module({
  imports: [SharedModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsAuthorizationService,
    AnalyticsIngestService,
    AnalyticsInstrumentationService,
    AnalyticsDomainEventBridgeService,
    AnalyticsGovernanceService,
    AnalyticsWarehouseExportService,
    AnalyticsWarehouseLoaderService,
    PrismaAnalyticsEventStore,
    {
      provide: ANALYTICS_EVENT_STORE,
      useExisting: PrismaAnalyticsEventStore,
    },
    {
      provide: ANALYTICS_EVENT_PUBLISHER,
      useFactory: analyticsEventPublisherFromEnv,
    },
    {
      provide: ANALYTICS_REPORT_SOURCE,
      useFactory: analyticsReportSourceFromEnv,
    },
    {
      provide: ANALYTICS_WAREHOUSE_TARGET,
      useFactory: analyticsWarehouseTargetFromEnv,
    },
  ],
  exports: [
    AnalyticsIngestService,
    AnalyticsAuthorizationService,
    AnalyticsInstrumentationService,
    AnalyticsDomainEventBridgeService,
    AnalyticsGovernanceService,
    AnalyticsWarehouseExportService,
    AnalyticsWarehouseLoaderService,
  ],
})
export class AnalyticsModule {}
