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
exports.AgentEvaluationService = void 0;
const common_1 = require("@nestjs/common");
const event_bus_1 = require("../shared/event_bus");
const agent_orchestrator_service_1 = require("./agent_orchestrator.service");
const agent_runtime_service_1 = require("./agent_runtime.service");
let AgentEvaluationService = class AgentEvaluationService {
    orchestrator;
    runtimeService;
    eventBus;
    constructor(orchestrator, runtimeService, eventBus) {
        this.orchestrator = orchestrator;
        this.runtimeService = runtimeService;
        this.eventBus = eventBus;
    }
    async evaluate(sessions, options) {
        const useRuntime = options?.runtime && options.runtime !== "local";
        const results = [];
        let approved = 0;
        let rejected = 0;
        let totalPrice = 0;
        let totalLatencyMs = 0;
        let repeatCount = 0;
        const seenTracks = new Set();
        for (const session of sessions) {
            if (useRuntime) {
                // Route through the runtime adapter (vertex / langgraph)
                const saved = process.env.AGENT_RUNTIME;
                process.env.AGENT_RUNTIME = options.runtime;
                try {
                    const result = await this.runtimeService.run(session);
                    if (result.status === "approved") {
                        approved += 1;
                        totalPrice += result.priceUsd ?? 0;
                    }
                    else {
                        rejected += 1;
                    }
                    if (result.trackId && seenTracks.has(result.trackId)) {
                        repeatCount += 1;
                    }
                    if (result.trackId) {
                        seenTracks.add(result.trackId);
                    }
                    totalLatencyMs += result.latencyMs ?? 0;
                    results.push(result);
                }
                finally {
                    process.env.AGENT_RUNTIME = saved;
                }
            }
            else {
                const result = await this.orchestrator.orchestrate(session);
                for (const track of result.tracks) {
                    if (track.negotiation) {
                        approved += 1;
                        totalPrice += track.negotiation.priceUsd ?? 0;
                    }
                    else {
                        rejected += 1;
                    }
                    if (seenTracks.has(track.trackId)) {
                        repeatCount += 1;
                    }
                    seenTracks.add(track.trackId);
                }
                if (result.tracks.length === 0) {
                    rejected += 1;
                }
                results.push(result);
            }
        }
        const metrics = {
            runtime: options?.runtime ?? "local",
            total: sessions.length,
            approved,
            rejected,
            approvalRate: sessions.length ? approved / sessions.length : 0,
            avgPriceUsd: approved ? totalPrice / approved : 0,
            repeatRate: sessions.length ? repeatCount / sessions.length : 0,
            ...(useRuntime
                ? { avgLatencyMs: sessions.length ? totalLatencyMs / sessions.length : 0 }
                : {}),
        };
        this.eventBus.publish({
            eventName: "agent.evaluation_completed",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            ...metrics,
        });
        return { metrics, results };
    }
};
exports.AgentEvaluationService = AgentEvaluationService;
exports.AgentEvaluationService = AgentEvaluationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [agent_orchestrator_service_1.AgentOrchestratorService,
        agent_runtime_service_1.AgentRuntimeService,
        event_bus_1.EventBus])
], AgentEvaluationService);
