"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Mock ESM packages so Jest can load them in CommonJS mode
jest.mock("@google/genai", () => ({}));
jest.mock("@google/adk", () => ({
    InMemoryRunner: jest.fn().mockImplementation(() => ({
        runAsync: jest.fn().mockReturnValue((async function* () { })()),
    })),
    isFinalResponse: jest.fn().mockReturnValue(false),
    stringifyContent: jest.fn().mockReturnValue(""),
    FunctionTool: jest.fn().mockImplementation((opts) => opts),
    LlmAgent: jest.fn().mockImplementation((opts) => opts),
}));
const agent_runtime_service_1 = require("../modules/agents/agent_runtime.service");
const adk_adapter_1 = require("../modules/agents/runtime/adk_adapter");
const langgraph_adapter_1 = require("../modules/agents/runtime/langgraph_adapter");
const vertex_ai_adapter_1 = require("../modules/agents/runtime/vertex_ai_adapter");
const tool_registry_1 = require("../modules/agents/tools/tool_registry");
const embedding_service_1 = require("../modules/embeddings/embedding.service");
const embedding_store_1 = require("../modules/embeddings/embedding.store");
jest.mock("../db/prisma", () => ({
    prisma: {
        track: {
            findMany: async () => [
                { id: "track-1", title: "Pulse", explicit: false, release: { title: "Album", genre: "electronic", artworkUrl: null } },
            ],
            findUnique: async () => null,
        },
    },
}));
function makeInput(overrides = {}) {
    return {
        sessionId: "session-1",
        userId: "user-1",
        recentTrackIds: [],
        budgetRemainingUsd: 1,
        preferences: {},
        ...overrides,
    };
}
describe("agent runtime", () => {
    let tools;
    beforeEach(() => {
        tools = new tool_registry_1.ToolRegistry(new embedding_service_1.EmbeddingService(), new embedding_store_1.EmbeddingStore());
    });
    it("falls back to orchestrator when mode is local", async () => {
        const orchestrator = {
            orchestrate: async () => ({ status: "approved", tracks: [] }),
        };
        const runtime = new agent_runtime_service_1.AgentRuntimeService(orchestrator, new vertex_ai_adapter_1.VertexAiAdapter(tools), new langgraph_adapter_1.LangGraphAdapter(), new adk_adapter_1.AdkAdapter(tools));
        process.env.AGENT_RUNTIME = "local";
        const result = await runtime.run(makeInput());
        expect(result.status).toBe("approved");
    });
    it("falls back to orchestrator when GOOGLE_AI_API_KEY is not set", async () => {
        const orchestrator = {
            orchestrate: async () => ({ status: "approved", tracks: [{ trackId: "t-orch", mixPlan: {}, negotiation: { priceUsd: 0.05, licenseType: "personal" } }] }),
        };
        const runtime = new agent_runtime_service_1.AgentRuntimeService(orchestrator, new vertex_ai_adapter_1.VertexAiAdapter(tools), new langgraph_adapter_1.LangGraphAdapter(), new adk_adapter_1.AdkAdapter(tools));
        delete process.env.GOOGLE_AI_API_KEY;
        process.env.AGENT_RUNTIME = "vertex";
        const result = await runtime.run(makeInput());
        // Should have fallen back to orchestrator since adapter throws without API key
        expect(result.status).toBe("approved");
        expect("tracks" in result).toBe(true);
    });
    it("falls back to orchestrator when vertex adapter throws", async () => {
        const orchestrator = {
            orchestrate: async () => ({
                status: "approved",
                tracks: [{ trackId: "t-1", mixPlan: {}, negotiation: {} }],
            }),
        };
        const badAdapter = {
            name: "vertex",
            run: async () => {
                throw new Error("Network down");
            },
        };
        const runtime = new agent_runtime_service_1.AgentRuntimeService(orchestrator, badAdapter, new langgraph_adapter_1.LangGraphAdapter(), new adk_adapter_1.AdkAdapter(tools));
        process.env.AGENT_RUNTIME = "vertex";
        const result = await runtime.run(makeInput());
        // Should have fell back to orchestrator
        expect(result.status).toBe("approved");
    });
    it("falls back to orchestrator when ADK adapter throws", async () => {
        const orchestrator = {
            orchestrate: async () => ({
                status: "approved",
                tracks: [{ trackId: "t-1", mixPlan: {}, negotiation: {} }],
            }),
        };
        const badAdkAdapter = {
            name: "adk",
            run: async () => {
                throw new Error("ADK error");
            },
        };
        const runtime = new agent_runtime_service_1.AgentRuntimeService(orchestrator, new vertex_ai_adapter_1.VertexAiAdapter(tools), new langgraph_adapter_1.LangGraphAdapter(), badAdkAdapter);
        process.env.AGENT_RUNTIME = "adk";
        const result = await runtime.run(makeInput());
        expect(result.status).toBe("approved");
    });
    it("falls back to orchestrator when GOOGLE_AI_API_KEY is not set (adk mode)", async () => {
        const orchestrator = {
            orchestrate: async () => ({
                status: "approved",
                tracks: [{ trackId: "t-orch", mixPlan: {}, negotiation: {} }],
            }),
        };
        const runtime = new agent_runtime_service_1.AgentRuntimeService(orchestrator, new vertex_ai_adapter_1.VertexAiAdapter(tools), new langgraph_adapter_1.LangGraphAdapter(), new adk_adapter_1.AdkAdapter(tools));
        delete process.env.GOOGLE_AI_API_KEY;
        process.env.AGENT_RUNTIME = "adk";
        const result = await runtime.run(makeInput());
        expect(result.status).toBe("approved");
    });
});
describe("VertexAiAdapter", () => {
    let tools;
    beforeEach(() => {
        tools = new tool_registry_1.ToolRegistry(new embedding_service_1.EmbeddingService(), new embedding_store_1.EmbeddingStore());
    });
    it("throws when GOOGLE_AI_API_KEY is not set", async () => {
        delete process.env.GOOGLE_AI_API_KEY;
        const adapter = new vertex_ai_adapter_1.VertexAiAdapter(tools);
        await expect(adapter.run(makeInput())).rejects.toThrow("GOOGLE_AI_API_KEY not configured");
    });
    it("throws when GOOGLE_AI_API_KEY is not set (budget 0)", async () => {
        delete process.env.GOOGLE_AI_API_KEY;
        const adapter = new vertex_ai_adapter_1.VertexAiAdapter(tools);
        await expect(adapter.run(makeInput({ budgetRemainingUsd: 0 }))).rejects.toThrow();
    });
});
describe("AdkAdapter", () => {
    let tools;
    beforeEach(() => {
        tools = new tool_registry_1.ToolRegistry(new embedding_service_1.EmbeddingService(), new embedding_store_1.EmbeddingStore());
    });
    it("throws when GOOGLE_AI_API_KEY is not set", async () => {
        delete process.env.GOOGLE_AI_API_KEY;
        const adapter = new adk_adapter_1.AdkAdapter(tools);
        await expect(adapter.run(makeInput())).rejects.toThrow("GOOGLE_AI_API_KEY not configured");
    });
    it("throws when GOOGLE_AI_API_KEY is not set (budget 0)", async () => {
        delete process.env.GOOGLE_AI_API_KEY;
        const adapter = new adk_adapter_1.AdkAdapter(tools);
        await expect(adapter.run(makeInput({ budgetRemainingUsd: 0 }))).rejects.toThrow();
    });
});
