import { EventBus } from "../modules/shared/event_bus";
import { AgentMixerService } from "../modules/agents/agent_mixer.service";
import { AgentNegotiatorService } from "../modules/agents/agent_negotiator.service";
import { AgentOrchestratorService } from "../modules/agents/agent_orchestrator.service";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";

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
    const tools = new ToolRegistry(new EmbeddingService(), new EmbeddingStore());
    const orchestrator = new AgentOrchestratorService(
      new AgentSelectorService(tools),
      new AgentMixerService(),
      new AgentNegotiatorService(tools),
      new EventBus()
    );
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
