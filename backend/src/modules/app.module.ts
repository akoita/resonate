import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AuthModule } from "./auth/auth.module";
import { RolesGuard } from "./auth/roles.guard";
import { CatalogModule } from "./catalog/catalog.module";
import { CurationModule } from "./curation/curation.module";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./identity/identity.module";
import { IngestionModule } from "./ingestion/ingestion.module";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { PaymentsModule } from "./payments/payments.module";
import { RecommendationsModule } from "./recommendations/recommendations.module";
import { RemixModule } from "./remix/remix.module";
import { SessionsModule } from "./sessions/sessions.module";

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ limit: 30, ttl: 60 }],
    }),
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
    MaintenanceModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
