import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ConfigModule } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { SharedModule } from "./shared/shared.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AgentsModule } from "./agents/agents.module";
import { ArtistModule } from "./artist/artist.module";
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
import { PlaylistModule } from "./playlist/playlist.module";
import { StorageModule } from "./storage/storage.module";
import { EncryptionModule } from "./encryption/encryption.module";
import { ContractsModule } from "./contracts/contracts.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
      },
    }),
    SharedModule,
    ThrottlerModule.forRoot({
      throttlers: [{ limit: 100, ttl: 60 }],
    }),
    HealthModule,
    AuthModule,
    IdentityModule,
    AgentsModule,
    ArtistModule,
    CurationModule,
    IngestionModule,
    CatalogModule,
    SessionsModule,
    PaymentsModule,
    RecommendationsModule,
    RemixModule,
    AnalyticsModule,
    MaintenanceModule,
    PlaylistModule,
    StorageModule,
    EncryptionModule,
    ContractsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule { }
