"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const event_bus_1 = require("../modules/shared/event_bus");
const agent_mixer_service_1 = require("../modules/agents/agent_mixer.service");
const agent_negotiator_service_1 = require("../modules/agents/agent_negotiator.service");
const agent_orchestrator_service_1 = require("../modules/agents/agent_orchestrator.service");
const agent_selector_service_1 = require("../modules/agents/agent_selector.service");
const tool_registry_1 = require("../modules/agents/tools/tool_registry");
const embedding_service_1 = require("../modules/embeddings/embedding.service");
const embedding_store_1 = require("../modules/embeddings/embedding.store");
jest.mock("../db/prisma", () => {
    return {
        prisma: {
            track: {
                findMany: async () => [
                    { id: "track-1", title: "Pulse", explicit: false },
                    { id: "track-2", title: "Glow", explicit: false },
                ],
            },
        },
    };
});
describe("agent orchestrator", () => {
    it("orchestrates selection, mix, negotiation", async () => {
        const tools = new tool_registry_1.ToolRegistry(new embedding_service_1.EmbeddingService(), new embedding_store_1.EmbeddingStore());
        const orchestrator = new agent_orchestrator_service_1.AgentOrchestratorService(new agent_selector_service_1.AgentSelectorService(tools), new agent_mixer_service_1.AgentMixerService(), new agent_negotiator_service_1.AgentNegotiatorService(tools), new event_bus_1.EventBus());
        const result = await orchestrator.orchestrate({
            sessionId: "session-1",
            userId: "user-1",
            recentTrackIds: [],
            budgetRemainingUsd: 1,
            preferences: {},
        });
        expect(result.status).toBe("approved");
        expect(result.tracks.length).toBeGreaterThan(0);
        expect(result.tracks[0].trackId).toBe("track-1");
        expect(result.tracks[0].mixPlan?.transition).toBeDefined();
    });
});
