"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const throttler_1 = require("@nestjs/throttler");
const config_1 = require("@nestjs/config");
const bullmq_1 = require("@nestjs/bullmq");
const shared_module_1 = require("./shared/shared.module");
const analytics_module_1 = require("./analytics/analytics.module");
const agents_module_1 = require("./agents/agents.module");
const artist_module_1 = require("./artist/artist.module");
const auth_module_1 = require("./auth/auth.module");
const roles_guard_1 = require("./auth/roles.guard");
const catalog_module_1 = require("./catalog/catalog.module");
const curation_module_1 = require("./curation/curation.module");
const health_module_1 = require("./health/health.module");
const identity_module_1 = require("./identity/identity.module");
const ingestion_module_1 = require("./ingestion/ingestion.module");
const maintenance_module_1 = require("./maintenance/maintenance.module");
const payments_module_1 = require("./payments/payments.module");
const recommendations_module_1 = require("./recommendations/recommendations.module");
const remix_module_1 = require("./remix/remix.module");
const sessions_module_1 = require("./sessions/sessions.module");
const playlist_module_1 = require("./playlist/playlist.module");
const storage_module_1 = require("./storage/storage.module");
const encryption_module_1 = require("./encryption/encryption.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            bullmq_1.BullModule.forRoot({
                connection: {
                    host: process.env.REDIS_HOST || "localhost",
                    port: parseInt(process.env.REDIS_PORT || "6379"),
                },
            }),
            shared_module_1.SharedModule,
            throttler_1.ThrottlerModule.forRoot({
                throttlers: [{ limit: 100, ttl: 60 }],
            }),
            health_module_1.HealthModule,
            auth_module_1.AuthModule,
            identity_module_1.IdentityModule,
            agents_module_1.AgentsModule,
            artist_module_1.ArtistModule,
            curation_module_1.CurationModule,
            ingestion_module_1.IngestionModule,
            catalog_module_1.CatalogModule,
            sessions_module_1.SessionsModule,
            payments_module_1.PaymentsModule,
            recommendations_module_1.RecommendationsModule,
            remix_module_1.RemixModule,
            analytics_module_1.AnalyticsModule,
            maintenance_module_1.MaintenanceModule,
            playlist_module_1.PlaylistModule,
            storage_module_1.StorageModule,
            encryption_module_1.EncryptionModule,
        ],
        providers: [
            { provide: core_1.APP_GUARD, useClass: throttler_1.ThrottlerGuard },
            { provide: core_1.APP_GUARD, useClass: roles_guard_1.RolesGuard },
        ],
    })
], AppModule);
