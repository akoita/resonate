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
exports.AgentOrchestratorService = void 0;
const common_1 = require("@nestjs/common");
const event_bus_1 = require("../shared/event_bus");
const agent_mixer_service_1 = require("./agent_mixer.service");
const agent_negotiator_service_1 = require("./agent_negotiator.service");
const agent_selector_service_1 = require("./agent_selector.service");
let AgentOrchestratorService = class AgentOrchestratorService {
    selector;
    mixer;
    negotiator;
    eventBus;
    constructor(selector, mixer, negotiator, eventBus) {
        this.selector = selector;
        this.mixer = mixer;
        this.negotiator = negotiator;
        this.eventBus = eventBus;
    }
    async orchestrate(input) {
        // Build queries from ALL vibes + mood
        const queries = [];
        if (input.preferences.genres?.length) {
            queries.push(...input.preferences.genres);
        }
        if (input.preferences.mood && !queries.includes(input.preferences.mood)) {
            queries.push(input.preferences.mood);
        }
        // Select multiple candidates across all vibes
        const selection = await this.selector.select({
            queries,
            recentTrackIds: input.recentTrackIds,
            allowExplicit: input.preferences.allowExplicit,
            useEmbeddings: queries.length > 0,
            limit: parseInt(process.env.AGENT_TRACK_LIMIT ?? "5", 10),
        });
        if (!selection.selected || selection.selected.length === 0) {
            this.eventBus.publish({
                eventName: "agent.decision_made",
                eventVersion: 1,
                occurredAt: new Date().toISOString(),
                sessionId: input.sessionId,
                trackId: "",
                reason: "no_tracks",
            });
            return { status: "no_tracks", tracks: [] };
        }
        this.eventBus.publish({
            eventName: "agent.selection",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            sessionId: input.sessionId,
            trackId: selection.selected[0]?.id,
            candidates: selection.candidates,
            count: selection.selected.length,
        });
        // Process each selected track through mixer + negotiator
        const tracks = [];
        let budgetLeft = input.budgetRemainingUsd;
        let previousTrackId = input.recentTrackIds[0];
        for (const track of selection.selected) {
            const mixPlan = this.mixer.plan({
                trackId: track.id,
                previousTrackId,
                mood: input.preferences.mood,
                energy: input.preferences.energy,
            });
            this.eventBus.publish({
                eventName: "agent.mix_planned",
                eventVersion: 1,
                occurredAt: new Date().toISOString(),
                sessionId: input.sessionId,
                trackId: track.id,
                trackTitle: track.title ?? "Unknown",
                transition: mixPlan.transition,
            });
            const negotiation = await this.negotiator.negotiate({
                trackId: track.id,
                licenseType: input.preferences.licenseType,
                budgetRemainingUsd: budgetLeft,
                stemTypes: input.preferences.stemTypes,
            });
            this.eventBus.publish({
                eventName: "agent.negotiated",
                eventVersion: 1,
                occurredAt: new Date().toISOString(),
                sessionId: input.sessionId,
                trackId: track.id,
                trackTitle: track.title ?? "Unknown",
                licenseType: negotiation.licenseType,
                priceUsd: negotiation.priceUsd,
                reason: negotiation.reason,
            });
            if (negotiation.allowed) {
                budgetLeft -= negotiation.priceUsd;
                tracks.push({ trackId: track.id, mixPlan, negotiation });
            }
            previousTrackId = track.id;
            if (budgetLeft <= 0)
                break;
        }
        // Final decision event
        this.eventBus.publish({
            eventName: "agent.decision_made",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            sessionId: input.sessionId,
            trackCount: tracks.length,
            totalSpend: tracks.reduce((sum, t) => sum + t.negotiation.priceUsd, 0),
            reason: tracks.length > 0 ? "approved" : "all_rejected",
        });
        return {
            status: tracks.length > 0 ? "approved" : "all_rejected",
            tracks,
        };
    }
};
exports.AgentOrchestratorService = AgentOrchestratorService;
exports.AgentOrchestratorService = AgentOrchestratorService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [agent_selector_service_1.AgentSelectorService,
        agent_mixer_service_1.AgentMixerService,
        agent_negotiator_service_1.AgentNegotiatorService,
        event_bus_1.EventBus])
], AgentOrchestratorService);
