"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const agent_runtime_service_1 = require("../modules/agents/agent_runtime.service");
const langgraph_adapter_1 = require("../modules/agents/runtime/langgraph_adapter");
const vertex_ai_adapter_1 = require("../modules/agents/runtime/vertex_ai_adapter");
describe("agent runtime", () => {
    it("falls back to orchestrator when mode is local", async () => {
        const orchestrator = {
            orchestrate: async () => ({ status: "approved", trackId: "track-1" }),
        };
        const runtime = new agent_runtime_service_1.AgentRuntimeService(orchestrator, new vertex_ai_adapter_1.VertexAiAdapter(), new langgraph_adapter_1.LangGraphAdapter());
        process.env.AGENT_RUNTIME = "local";
        const result = await runtime.run({
            sessionId: "session-1",
            userId: "user-1",
            recentTrackIds: [],
            budgetRemainingUsd: 1,
            preferences: {},
        });
        expect(result.status).toBe("approved");
    });
});
