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
exports.RecommendationsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../../db/prisma");
const event_bus_1 = require("../shared/event_bus");
let RecommendationsService = class RecommendationsService {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this.preferences = new Map();
        this.recentTrackIds = new Map();
    }
    setPreferences(userId, prefs) {
        const existing = this.preferences.get(userId) ?? {};
        const merged = { ...existing, ...prefs };
        this.preferences.set(userId, merged);
        this.eventBus.publish({
            eventName: "recommendation.preferences_updated",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            userId,
            preferences: merged,
        });
        return { userId, preferences: merged };
    }
    getPreferences(userId) {
        return this.preferences.get(userId) ?? {};
    }
    async getRecommendations(userId, limit = 10) {
        const prefs = this.getPreferences(userId);
        const allowExplicit = prefs.allowExplicit ?? false;
        const candidates = await prisma_1.prisma.track.findMany({
            where: {
                ...(prefs.genres?.length ? { genre: { in: prefs.genres } } : {}),
                ...(allowExplicit ? {} : { explicit: false }),
            },
            take: 50,
            orderBy: { createdAt: "desc" },
        });
        const recent = this.recentTrackIds.get(userId) ?? [];
        const filtered = candidates.filter((track) => !recent.includes(track.id));
        const selected = (filtered.length ? filtered : candidates).slice(0, limit);
        const updatedRecent = [
            ...selected.map((track) => track.id),
            ...recent,
        ].slice(0, 50);
        this.recentTrackIds.set(userId, updatedRecent);
        this.eventBus.publish({
            eventName: "recommendation.generated",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            userId,
            trackIds: selected.map((track) => track.id),
            strategy: prefs.genres?.length ? "genre_match" : "recent_first",
        });
        return {
            userId,
            preferences: prefs,
            items: selected.map((track) => ({
                id: track.id,
                title: track.title,
                artistId: track.artistId,
            })),
        };
    }
};
exports.RecommendationsService = RecommendationsService;
exports.RecommendationsService = RecommendationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [event_bus_1.EventBus])
], RecommendationsService);
