"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsController = void 0;
const common_1 = require("@nestjs/common");
const analytics_ingest_service_1 = require("./analytics_ingest.service");
const analytics_service_1 = require("./analytics.service");
let AnalyticsController = class AnalyticsController {
    constructor(analyticsService, analyticsIngestService) {
        this.analyticsService = analyticsService;
        this.analyticsIngestService = analyticsIngestService;
    }
    getArtist(artistId, days) {
        return this.analyticsService.getArtistStats(artistId, Number(days ?? 7));
    }
    getArtistDashboard(artistId, days) {
        return this.analyticsService.getArtistDashboard(artistId, Number(days ?? 30));
    }
    ingest(body) {
        return this.analyticsIngestService.ingest({
            eventName: body.eventName,
            payload: body.payload,
            occurredAt: new Date().toISOString(),
        });
    }
    rollup() {
        return this.analyticsIngestService.dailyRollup();
    }
};
exports.AnalyticsController = AnalyticsController;
__decorate([
    (0, common_1.Get)("artist/:id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Query)("days")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AnalyticsController.prototype, "getArtist", null);
__decorate([
    (0, common_1.Get)("artist/:id/v1"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Query)("days")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AnalyticsController.prototype, "getArtistDashboard", null);
__decorate([
    (0, common_1.Post)("ingest"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AnalyticsController.prototype, "ingest", null);
__decorate([
    (0, common_1.Get)("rollup/daily"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AnalyticsController.prototype, "rollup", null);
exports.AnalyticsController = AnalyticsController = __decorate([
    (0, common_1.Controller)("analytics"),
    __metadata("design:paramtypes", [analytics_service_1.AnalyticsService,
        analytics_ingest_service_1.AnalyticsIngestService])
], AnalyticsController);
