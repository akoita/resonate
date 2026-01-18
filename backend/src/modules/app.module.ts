import { Module } from "@nestjs/common";
import { AnalyticsModule } from "./analytics/analytics.module";
import { CatalogModule } from "./catalog/catalog.module";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./identity/identity.module";
import { IngestionModule } from "./ingestion/ingestion.module";
import { PaymentsModule } from "./payments/payments.module";
import { SessionsModule } from "./sessions/sessions.module";

@Module({
  imports: [
    HealthModule,
    IdentityModule,
    IngestionModule,
    CatalogModule,
    SessionsModule,
    PaymentsModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
