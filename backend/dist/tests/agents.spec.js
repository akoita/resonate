"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const agent_policy_service_1 = require("../modules/agents/agent_policy.service");
const agent_runner_service_1 = require("../modules/agents/agent_runner.service");
const event_bus_1 = require("../modules/shared/event_bus");
describe("agent runner", () => {
    it("approves when budget allows", () => {
        const policy = new agent_policy_service_1.AgentPolicyService();
        const runner = new agent_runner_service_1.AgentRunnerService(policy, new event_bus_1.EventBus());
        const result = runner.run({
            sessionId: "session-1",
            userId: "user-1",
            trackId: "track-1",
            recentTrackIds: [],
            budgetRemainingUsd: 1,
            preferences: {},
        });
        expect(result.status).toBe("approved");
    });
    it("rejects when budget is too low", () => {
        const policy = new agent_policy_service_1.AgentPolicyService();
        const runner = new agent_runner_service_1.AgentRunnerService(policy, new event_bus_1.EventBus());
        const result = runner.run({
            sessionId: "session-1",
            userId: "user-1",
            trackId: "track-1",
            recentTrackIds: [],
            budgetRemainingUsd: 0,
            preferences: { licenseType: "commercial" },
        });
        expect(result.status).toBe("rejected");
    });
});
