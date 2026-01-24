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
exports.AgentRunnerService = void 0;
const common_1 = require("@nestjs/common");
const event_bus_1 = require("../shared/event_bus");
const agent_policy_service_1 = require("./agent_policy.service");
let AgentRunnerService = class AgentRunnerService {
    policyService;
    eventBus;
    constructor(policyService, eventBus) {
        this.policyService = policyService;
        this.eventBus = eventBus;
    }
    run(input) {
        const decision = this.policyService.evaluate(input);
        this.eventBus.publish({
            eventName: "agent.evaluated",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            sessionId: input.sessionId,
            trackId: input.trackId,
            licenseType: decision.licenseType,
            priceUsd: decision.priceUsd,
            reason: decision.reason,
        });
        return {
            status: decision.allowed ? "approved" : "rejected",
            decision,
        };
    }
};
exports.AgentRunnerService = AgentRunnerService;
exports.AgentRunnerService = AgentRunnerService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [agent_policy_service_1.AgentPolicyService,
        event_bus_1.EventBus])
], AgentRunnerService);
