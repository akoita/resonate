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
const analytics_module_1 = require("./analytics/analytics.module");
const agents_module_1 = require("./agents/agents.module");
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
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            throttler_1.ThrottlerModule.forRoot({
                throttlers: [{ limit: 30, ttl: 60 }],
            }),
            health_module_1.HealthModule,
            auth_module_1.AuthModule,
            identity_module_1.IdentityModule,
            agents_module_1.AgentsModule,
            curation_module_1.CurationModule,
            ingestion_module_1.IngestionModule,
            catalog_module_1.CatalogModule,
            sessions_module_1.SessionsModule,
            payments_module_1.PaymentsModule,
            recommendations_module_1.RecommendationsModule,
            remix_module_1.RemixModule,
            analytics_module_1.AnalyticsModule,
            maintenance_module_1.MaintenanceModule,
        ],
        providers: [
            { provide: core_1.APP_GUARD, useClass: throttler_1.ThrottlerGuard },
            { provide: core_1.APP_GUARD, useClass: roles_guard_1.RolesGuard },
        ],
    })
], AppModule);
