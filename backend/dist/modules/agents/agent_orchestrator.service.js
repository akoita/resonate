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
    constructor(selector, mixer, negotiator, eventBus) {
        this.selector = selector;
        this.mixer = mixer;
        this.negotiator = negotiator;
        this.eventBus = eventBus;
    }
    async orchestrate(input) {
        const selection = await this.selector.select({
            query: input.preferences.genres?.[0] ?? input.preferences.mood,
            recentTrackIds: input.recentTrackIds,
            allowExplicit: input.preferences.allowExplicit,
            useEmbeddings: Boolean(input.preferences.genres?.length || input.preferences.mood),
        });
        if (!selection.selected) {
            return { status: "no_tracks" };
        }
        this.eventBus.publish({
            eventName: "agent.selection",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            sessionId: input.sessionId,
            trackId: selection.selected.id,
            candidates: selection.candidates,
        });
        const mixPlan = this.mixer.plan({
            trackId: selection.selected.id,
            previousTrackId: input.recentTrackIds[0],
            mood: input.preferences.mood,
            energy: input.preferences.energy,
        });
        this.eventBus.publish({
            eventName: "agent.mix_planned",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            sessionId: input.sessionId,
            trackId: selection.selected.id,
            transition: mixPlan.transition,
        });
        const negotiation = await this.negotiator.negotiate({
            trackId: selection.selected.id,
            licenseType: input.preferences.licenseType,
            budgetRemainingUsd: input.budgetRemainingUsd,
        });
        this.eventBus.publish({
            eventName: "agent.negotiated",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            sessionId: input.sessionId,
            trackId: selection.selected.id,
            licenseType: negotiation.licenseType,
            priceUsd: negotiation.priceUsd,
            reason: negotiation.reason,
        });
        return {
            status: negotiation.allowed ? "approved" : "rejected",
            trackId: selection.selected.id,
            mixPlan,
            negotiation,
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
