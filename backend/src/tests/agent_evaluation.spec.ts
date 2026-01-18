import { AgentEvaluationService } from "../modules/agents/agent_evaluation.service";
import { EventBus } from "../modules/shared/event_bus";

describe("agent evaluation", () => {
  it("aggregates evaluation metrics", async () => {
    const orchestrator = {
      orchestrate: async ({ sessionId }: any) =>
        sessionId === "session-1"
          ? {
              status: "approved",
              trackId: "track-1",
              negotiation: { priceUsd: 0.5 },
            }
          : {
              status: "rejected",
              trackId: "track-1",
            },
    } as any;
    const service = new AgentEvaluationService(orchestrator, new EventBus());
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
