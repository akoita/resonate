// Mock ESM packages so Jest can load them in CommonJS mode
jest.mock("@google/genai", () => ({}));
jest.mock("@google/adk", () => ({
  InMemoryRunner: jest.fn().mockImplementation(() => ({
    runAsync: jest.fn().mockReturnValue((async function* () {})()),
  })),
  isFinalResponse: jest.fn().mockReturnValue(false),
  stringifyContent: jest.fn().mockReturnValue(""),
  FunctionTool: jest.fn().mockImplementation((opts: any) => opts),
  LlmAgent: jest.fn().mockImplementation((opts: any) => opts),
}));

import { AgentRuntimeService } from "../modules/agents/agent_runtime.service";
import { AdkAdapter } from "../modules/agents/runtime/adk_adapter";
import { LangGraphAdapter } from "../modules/agents/runtime/langgraph_adapter";
import { VertexAiAdapter } from "../modules/agents/runtime/vertex_ai_adapter";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";

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

const mockGenerationService = {
  createGeneration: jest.fn().mockResolvedValue({ jobId: "gen-mock-1" }),
} as any;

function makeInput(overrides: Record<string, any> = {}) {
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
  let tools: ToolRegistry;

  beforeEach(() => {
    tools = new ToolRegistry(new EmbeddingService(), new EmbeddingStore(), mockGenerationService);
  });

  it("falls back to orchestrator when mode is local", async () => {
    const orchestrator = {
      orchestrate: async () => ({ status: "approved", tracks: [] }),
    } as any;
    const runtime = new AgentRuntimeService(
      orchestrator,
      new VertexAiAdapter(tools),
      new LangGraphAdapter(),
      new AdkAdapter(tools)
    );
    process.env.AGENT_RUNTIME = "local";
    const result = await runtime.run(makeInput());
    expect(result.status).toBe("approved");
  });

  it("falls back to orchestrator when GOOGLE_AI_API_KEY is not set", async () => {
    const orchestrator = {
      orchestrate: async () => ({ status: "approved", tracks: [{ trackId: "t-orch", mixPlan: {}, negotiation: { priceUsd: 0.05, licenseType: "personal" } }] }),
    } as any;
    const runtime = new AgentRuntimeService(
      orchestrator,
      new VertexAiAdapter(tools),
      new LangGraphAdapter(),
      new AdkAdapter(tools)
    );
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
    } as any;
    const badAdapter = {
      name: "vertex" as const,
      run: async () => {
        throw new Error("Network down");
      },
    };
    const runtime = new AgentRuntimeService(
      orchestrator,
      badAdapter as any,
      new LangGraphAdapter(),
      new AdkAdapter(tools)
    );
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
    } as any;
    const badAdkAdapter = {
      name: "adk" as const,
      run: async () => {
        throw new Error("ADK error");
      },
    };
    const runtime = new AgentRuntimeService(
      orchestrator,
      new VertexAiAdapter(tools),
      new LangGraphAdapter(),
      badAdkAdapter as any
    );
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
    } as any;
    const runtime = new AgentRuntimeService(
      orchestrator,
      new VertexAiAdapter(tools),
      new LangGraphAdapter(),
      new AdkAdapter(tools)
    );
    delete process.env.GOOGLE_AI_API_KEY;
    process.env.AGENT_RUNTIME = "adk";
    const result = await runtime.run(makeInput());
    expect(result.status).toBe("approved");
  });
});

describe("VertexAiAdapter", () => {
  let tools: ToolRegistry;

  beforeEach(() => {
    tools = new ToolRegistry(new EmbeddingService(), new EmbeddingStore(), mockGenerationService);
  });

  it("throws when GOOGLE_AI_API_KEY is not set", async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    const adapter = new VertexAiAdapter(tools);
    await expect(adapter.run(makeInput())).rejects.toThrow("GOOGLE_AI_API_KEY not configured");
  });

  it("throws when GOOGLE_AI_API_KEY is not set (budget 0)", async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    const adapter = new VertexAiAdapter(tools);
    await expect(adapter.run(makeInput({ budgetRemainingUsd: 0 }))).rejects.toThrow();
  });
});

describe("AdkAdapter", () => {
  let tools: ToolRegistry;

  beforeEach(() => {
    tools = new ToolRegistry(new EmbeddingService(), new EmbeddingStore(), mockGenerationService);
  });

  it("throws when GOOGLE_AI_API_KEY is not set", async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    const adapter = new AdkAdapter(tools);
    await expect(adapter.run(makeInput())).rejects.toThrow("GOOGLE_AI_API_KEY not configured");
  });

  it("throws when GOOGLE_AI_API_KEY is not set (budget 0)", async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    const adapter = new AdkAdapter(tools);
    await expect(adapter.run(makeInput({ budgetRemainingUsd: 0 }))).rejects.toThrow();
  });
});
