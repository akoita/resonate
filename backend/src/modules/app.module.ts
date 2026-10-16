import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { GLOBAL_RATE_LIMIT } from "./shared/rate_limits";
import { ConfigModule } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { SharedModule } from "./shared/shared.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AgentsModule } from "./agents/agents.module";
import { ArtistModule } from "./artist/artist.module";
import { ArtistFollowModule } from "./artist_follows/artist_follow.module";
import { AuthModule } from "./auth/auth.module";
import { RolesGuard } from "./auth/roles.guard";
import { CatalogModule } from "./catalog/catalog.module";
import { CommunityModule } from "./community/community.module";
import { CurationModule } from "./curation/curation.module";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./identity/identity.module";
import { IngestionModule } from "./ingestion/ingestion.module";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { PaymentsModule } from "./payments/payments.module";
import { RecommendationsModule } from "./recommendations/recommendations.module";
import { CratesModule } from "./crates/crates.module";
import { RemixModule } from "./remix/remix.module";
import { SessionsModule } from "./sessions/sessions.module";
import { PlaylistModule } from "./playlist/playlist.module";
import { StorageModule } from "./storage/storage.module";
import { EncryptionModule } from "./encryption/encryption.module";
import { ContractsModule } from "./contracts/contracts.module";
import { StemPricingModule } from "./pricing/stem-pricing.module";
import { LibraryModule } from "./library/library.module";
import { GenerationModule } from "./generation/generation.module";
import { WebAuthnModule } from "./webauthn/webauthn.module";
import { X402Module } from "./x402/x402.module";
import { FingerprintModule } from "./fingerprint/fingerprint.module";
import { DmcaModule } from "./dmca/dmca.module";
import { TrustModule } from "./trust/trust.module";
import { NotificationModule } from "./notifications/notification.module";
import { StorefrontModule } from "./storefront/storefront.module";
import { OpenApiModule } from "./openapi/openapi.module";
import { McpModule } from "./mcp/mcp.module";
import { ShowsModule } from "./shows/shows.module";
import { CreditsModule } from "./credits/credits.module";
import { UsageModule } from "./usage/usage.module";
import { PunchlineModule } from "./punchline/punchline.module";
import { PrivacyModule } from "./privacy/privacy.module";
import { ManagementModule } from "./management/management.module";
import { DiscoveryJournalModule } from "./discovery_journal/discovery_journal.module";
import { AccountsModule } from "./accounts/accounts.module";
import { AccountStatusInterceptor } from "./accounts/account_status.interceptor";
import { UserActivityInterceptor } from "./accounts/user_activity.interceptor";
import { UserActivityModule } from "./accounts/user_activity.module";
import { AdminUsersModule } from "./admin_users/admin_users.module";

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
      throttlers: [GLOBAL_RATE_LIMIT],
    }),
    HealthModule,
    AuthModule,
    IdentityModule,
    AgentsModule,
    ArtistModule,
    ArtistFollowModule,
    CurationModule,
    IngestionModule,
    CatalogModule,
    CommunityModule,
    SessionsModule,
    PaymentsModule,
    RecommendationsModule,
    RemixModule,
    AnalyticsModule,
    MaintenanceModule,
    PlaylistModule,
    LibraryModule,
    StorageModule,
    EncryptionModule,
    ContractsModule,
    StemPricingModule,
    GenerationModule,
    WebAuthnModule,
    X402Module,
    FingerprintModule,
    DmcaModule,
    TrustModule,
    NotificationModule,
    StorefrontModule,
    OpenApiModule,
    McpModule,
    ShowsModule,
    CreditsModule,
    UsageModule,
    PunchlineModule,
    PrivacyModule,
    ManagementModule,
    DiscoveryJournalModule,
    CratesModule,
    AccountsModule,
    UserActivityModule,
    AdminUsersModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // #2147: refuses mutating requests from suspended/closed accounts. An
    // interceptor, not a guard, so it runs after the route's AuthGuard has set req.user.
    { provide: APP_INTERCEPTOR, useClass: AccountStatusInterceptor },
    // #2166: bounded "last active" stamp for any authenticated request.
    { provide: APP_INTERCEPTOR, useClass: UserActivityInterceptor },
  ],
})
export class AppModule { }
