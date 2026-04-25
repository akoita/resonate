import { AgentGoldenEvalService } from "../modules/agents/agent_golden_eval.service";
import { AgentPolicyService } from "../modules/agents/agent_policy.service";
import { AgentRunnerService } from "../modules/agents/agent_runner.service";
import { EventBus } from "../modules/shared/event_bus";

describe("agent golden evals", () => {
  it("passes the default deterministic policy golden set", () => {
    const runner = new AgentRunnerService(new AgentPolicyService(), new EventBus());
    const service = new AgentGoldenEvalService(runner);

    const result = service.run();

    expect(result.metrics.total).toBeGreaterThanOrEqual(4);
    expect(result.metrics.failed).toBe(0);
    expect(result.metrics.passRate).toBe(1);
    expect(result.results.every((item) => item.passed)).toBe(true);
  });

  it("reports case-level failures for regressions", () => {
    const runner = {
      run: () => ({
        status: "approved",
        decision: {
          allowed: true,
          reason: "policy_ok",
          licenseType: "personal",
          priceUsd: 0.02,
        },
      }),
    } as any;
    const service = new AgentGoldenEvalService(runner);

    const result = service.run([
      {
        id: "forced-failure",
        description: "A deliberately failing case.",
        input: {
          sessionId: "s",
          userId: "u",
          trackId: "t",
          recentTrackIds: [],
          budgetRemainingUsd: 0,
          preferences: { licenseType: "commercial" },
        },
        expected: {
          status: "rejected",
          reason: "budget_exceeded",
          licenseType: "commercial",
        },
      },
    ]);

    expect(result.metrics.failed).toBe(1);
    expect(result.results[0].failures).toEqual(
      expect.arrayContaining([
        "status expected rejected, got approved",
        "reason expected budget_exceeded, got policy_ok",
        "licenseType expected commercial, got personal",
      ])
    );
  });
});
