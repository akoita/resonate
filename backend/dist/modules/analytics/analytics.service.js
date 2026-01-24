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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsService = void 0;
const common_1 = require("@nestjs/common");
const analytics_ingest_service_1 = require("./analytics_ingest.service");
let AnalyticsService = class AnalyticsService {
    constructor(ingestService) {
        this.ingestService = ingestService;
    }
    getArtistStats(artistId, days) {
        const since = Date.now() - days * 24 * 60 * 60 * 1000;
        const events = this.ingestService
            .listEvents()
            .filter((event) => new Date(event.occurredAt).getTime() >= since);
        const filtered = events.filter((event) => {
            const payload = event.payload;
            return payload.artistId === artistId;
        });
        const summary = {
            artistId,
            days,
            totalPlays: 0,
            totalPayoutUsd: 0,
        };
        const tracks = [];
        const trackMap = new Map();
        filtered.forEach((event) => {
            const payload = event.payload;
            const trackId = payload.trackId ?? "unknown";
            const title = payload.title ?? "Unknown Track";
            const stats = trackMap.get(trackId) ?? { trackId, title, plays: 0, payoutUsd: 0 };
            if (event.eventName === "license.granted") {
                stats.plays += 1;
                summary.totalPlays += 1;
            }
            if (event.eventName === "payment.settled") {
                const amount = Number(payload.amountUsd ?? 0);
                stats.payoutUsd += amount;
                summary.totalPayoutUsd += amount;
            }
            trackMap.set(trackId, stats);
        });
        tracks.push(...trackMap.values());
        return { summary, tracks };
    }
    getArtistDashboard(artistId, days) {
        const since = Date.now() - days * 24 * 60 * 60 * 1000;
        const events = this.ingestService
            .listEvents()
            .filter((event) => new Date(event.occurredAt).getTime() >= since);
        const filtered = events.filter((event) => {
            const payload = event.payload;
            return payload.artistId === artistId;
        });
        const summary = {
            artistId,
            days,
            totalPlays: 0,
            totalPayoutUsd: 0,
        };
        const trackMap = new Map();
        const sessionMap = new Map();
        const sourceMap = new Map();
        filtered.forEach((event) => {
            const payload = event.payload;
            const trackId = payload.trackId ?? "unknown";
            const title = payload.title ?? "Unknown Track";
            const sessionId = payload.sessionId ?? "unknown";
            const source = payload.source ?? "unknown";
            const trackStats = trackMap.get(trackId) ?? { trackId, title, plays: 0, payoutUsd: 0 };
            const sessionStats = sessionMap.get(sessionId) ?? { sessionId, plays: 0, payoutUsd: 0 };
            const sourceStats = sourceMap.get(source) ?? { source, plays: 0 };
            if (event.eventName === "license.granted") {
                trackStats.plays += 1;
                sessionStats.plays += 1;
                sourceStats.plays += 1;
                summary.totalPlays += 1;
            }
            if (event.eventName === "payment.settled") {
                const amount = Number(payload.amountUsd ?? 0);
                trackStats.payoutUsd += amount;
                sessionStats.payoutUsd += amount;
                summary.totalPayoutUsd += amount;
            }
            trackMap.set(trackId, trackStats);
            sessionMap.set(sessionId, sessionStats);
            sourceMap.set(source, sourceStats);
        });
        const exportPayload = {
            artistId,
            days,
            totalPlays: summary.totalPlays,
            totalPayoutUsd: summary.totalPayoutUsd,
            generatedAt: new Date().toISOString(),
        };
        return {
            summary,
            tracks: [...trackMap.values()],
            sessions: [...sessionMap.values()],
            sources: [...sourceMap.values()],
            export: exportPayload,
        };
    }
};
exports.AnalyticsService = AnalyticsService;
exports.AnalyticsService = AnalyticsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [analytics_ingest_service_1.AnalyticsIngestService])
], AnalyticsService);
