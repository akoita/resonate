import { AgentRuntimeService } from "../modules/agents/agent_runtime.service";
import { LangGraphAdapter } from "../modules/agents/runtime/langgraph_adapter";
import { VertexAiAdapter } from "../modules/agents/runtime/vertex_ai_adapter";

describe("agent runtime", () => {
  it("falls back to orchestrator when mode is local", async () => {
    const orchestrator = {
      orchestrate: async () => ({ status: "approved", trackId: "track-1" }),
    } as any;
    const runtime = new AgentRuntimeService(
      orchestrator,
      new VertexAiAdapter(),
      new LangGraphAdapter()
    );
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
