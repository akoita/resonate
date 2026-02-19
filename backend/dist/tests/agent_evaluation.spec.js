"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const agent_evaluation_service_1 = require("../modules/agents/agent_evaluation.service");
const event_bus_1 = require("../modules/shared/event_bus");
describe("agent evaluation", () => {
    it("aggregates evaluation metrics", async () => {
        const orchestrator = {
            orchestrate: async ({ sessionId }) => sessionId === "session-1"
                ? {
                    status: "approved",
                    tracks: [
                        { trackId: "track-1", negotiation: { priceUsd: 0.5 }, mixPlan: {} },
                    ],
                }
                : {
                    status: "rejected",
                    tracks: [
                        { trackId: "track-1", mixPlan: {} },
                    ],
                },
        };
        const runtimeService = { run: async () => ({ status: "approved" }) };
        const service = new agent_evaluation_service_1.AgentEvaluationService(orchestrator, runtimeService, new event_bus_1.EventBus());
        const result = await service.evaluate([
            {
                sessionId: "session-1",
                userId: "user-1",
                recentTrackIds: [],
                budgetRemainingUsd: 1,
                preferences: {},
            },
            {
                sessionId: "session-2",
                userId: "user-2",
                recentTrackIds: [],
                budgetRemainingUsd: 0,
                preferences: {},
            },
        ]);
        expect(result.metrics.approved).toBe(1);
        expect(result.metrics.rejected).toBe(1);
        expect(result.metrics.repeatRate).toBe(0.5);
    });
});
