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
exports.AgentOrchestrationService = void 0;
const common_1 = require("@nestjs/common");
const prisma_1 = require("../../db/prisma");
const event_bus_1 = require("../shared/event_bus");
const pricing_1 = require("../../pricing/pricing");
let AgentOrchestrationService = class AgentOrchestrationService {
    eventBus;
    states = new Map();
    constructor(eventBus) {
        this.eventBus = eventBus;
    }
    configureSession(sessionId, preferences = {}) {
        const existing = this.states.get(sessionId);
        const merged = { ...(existing?.preferences ?? {}), ...preferences };
        this.states.set(sessionId, {
            preferences: merged,
            recentTrackIds: existing?.recentTrackIds ?? [],
        });
    }
    async selectNextTrack(input) {
        if (input.preferences) {
            this.configureSession(input.sessionId, input.preferences);
        }
        const state = this.states.get(input.sessionId) ?? {
            preferences: {},
            recentTrackIds: [],
        };
        const preferences = state.preferences;
        const allowExplicit = preferences.allowExplicit ?? false;
        const candidates = await prisma_1.prisma.track.findMany({
            where: {
                ...(preferences.genres?.length ? { release: { genre: { in: preferences.genres } } } : {}),
                ...(allowExplicit ? {} : { explicit: false }),
            },
            include: { release: true },
            take: 25,
            orderBy: { createdAt: "desc" },
        });
        const selected = candidates.find((track) => !state.recentTrackIds.includes(track.id)) ??
            candidates[0];
        if (!selected) {
            return { status: "no_tracks" };
        }
        const licenseType = preferences.licenseType ?? "personal";
        const priceUsd = (0, pricing_1.calculatePrice)(licenseType, this.defaultPricing(), state.recentTrackIds.length > 5);
        state.recentTrackIds = [selected.id, ...state.recentTrackIds].slice(0, 20);
        this.states.set(input.sessionId, state);
        this.eventBus.publish({
            eventName: "agent.track_selected",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            sessionId: input.sessionId,
            trackId: selected.id,
            strategy: "recent-first",
            preferences: preferences,
        });
        this.eventBus.publish({
            eventName: "agent.decision_made",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            sessionId: input.sessionId,
            trackId: selected.id,
            licenseType,
            priceUsd,
            reason: "pricing_policy_default",
        });
        return {
            status: "ok",
            track: {
                id: selected.id,
                title: selected.title,
                artistId: selected.release.artistId,
            },
            licenseType,
            priceUsd,
        };
    }
    defaultPricing() {
        return {
            basePlayPriceUsd: 0.02,
            remixSurchargeMultiplier: 3,
            commercialMultiplier: 5,
            volumeDiscountPercent: 5,
            floorUsd: 0.01,
            ceilingUsd: 1,
        };
    }
};
exports.AgentOrchestrationService = AgentOrchestrationService;
exports.AgentOrchestrationService = AgentOrchestrationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [event_bus_1.EventBus])
], AgentOrchestrationService);
