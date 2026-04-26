import { existsSync, rmSync, readFileSync } from "fs";
import { resolve } from "path";
import { AgentGoldenEvalService } from "../modules/agents/agent_golden_eval.service";
import { AgentPolicyService } from "../modules/agents/agent_policy.service";
import { AgentRunnerService } from "../modules/agents/agent_runner.service";
import { EventBus } from "../modules/shared/event_bus";

describe("agent golden evals", () => {
  const artifactPath = resolve(process.cwd(), "eval-results/agent-golden-results.json");

  beforeAll(() => {
    if (existsSync(artifactPath)) {
      rmSync(artifactPath);
    }
  });

  it("passes the default deterministic policy golden set and writes a JSON artifact", () => {
    const runner = new AgentRunnerService(new AgentPolicyService(), new EventBus());
    const service = new AgentGoldenEvalService(runner);

    const { report, artifactPath: writtenPath } = service.runAndWriteArtifact();

    expect(report.schemaVersion).toBe("agent-golden-eval/v1");
    expect(report.metrics.total).toBeGreaterThanOrEqual(25);
    expect(report.metrics.failed).toBe(0);
    expect(report.metrics.passRate).toBe(1);
    expect(report.metrics.categories.catalog_search_intent.total).toBeGreaterThanOrEqual(2);
    expect(report.metrics.categories.policy_budget_refusal.total).toBeGreaterThanOrEqual(4);
    expect(report.metrics.categories.paid_download_readiness.total).toBeGreaterThanOrEqual(4);
    expect(report.rubric.judgeRequired).toBe(false);
    expect(report.results.every((item) => item.passed)).toBe(true);
    expect(writtenPath).toBe(artifactPath);
    expect(existsSync(artifactPath)).toBe(true);

    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(artifact.schemaVersion).toBe("agent-golden-eval/v1");
    expect(artifact.metrics.total).toBe(report.metrics.total);
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
        category: "policy_budget_refusal",
        description: "A deliberately failing case.",
        tags: ["test"],
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
        rubric: {
          deterministicChecks: ["status", "reason", "licenseType", "priceCeiling"],
          judgeSignals: ["Regression fixture"],
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
