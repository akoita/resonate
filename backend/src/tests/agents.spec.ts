import { AgentPolicyService } from "../modules/agents/agent_policy.service";
import { AgentRunnerService } from "../modules/agents/agent_runner.service";
import { EventBus } from "../modules/shared/event_bus";

describe("agent runner", () => {
  it("approves when budget allows", () => {
    const policy = new AgentPolicyService();
    const runner = new AgentRunnerService(policy, new EventBus());
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
    const policy = new AgentPolicyService();
    const runner = new AgentRunnerService(policy, new EventBus());
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
