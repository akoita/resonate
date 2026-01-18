import { Module } from "@nestjs/common";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AuthModule } from "./auth/auth.module";
import { CatalogModule } from "./catalog/catalog.module";
import { CurationModule } from "./curation/curation.module";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./identity/identity.module";
import { IngestionModule } from "./ingestion/ingestion.module";
import { PaymentsModule } from "./payments/payments.module";
import { RecommendationsModule } from "./recommendations/recommendations.module";
import { RemixModule } from "./remix/remix.module";
import { SessionsModule } from "./sessions/sessions.module";

@Module({
  imports: [
    HealthModule,
    AuthModule,
    IdentityModule,
    CurationModule,
    IngestionModule,
    CatalogModule,
    SessionsModule,
    PaymentsModule,
    RecommendationsModule,
    RemixModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
