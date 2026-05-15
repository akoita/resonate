import { existsSync, rmSync, readFileSync } from "fs";
import { resolve } from "path";
import { AgentRecommendationEvalService } from "../modules/agents/agent_recommendation_eval.service";

describe("agent recommendation evals", () => {
  const artifactPath = resolve(process.cwd(), "eval-results/agent-recommendation-results.json");
  const summaryPath = resolve(process.cwd(), "eval-results/agent-recommendation-summary.md");

  beforeEach(() => {
    for (const path of [artifactPath, summaryPath]) {
      if (existsSync(path)) rmSync(path);
    }
  });

  it("writes replayable recommendation quality artifacts", () => {
    const service = new AgentRecommendationEvalService();
    const { report, artifactPath: writtenArtifact, summaryPath: writtenSummary } =
      service.runAndWriteArtifact([
        {
          id: "hip-hop-synonym-match",
          description: "Hip Hop taste can select a nearby Rap candidate without dumping unrelated tracks.",
          selectedTrackIds: ["rap-track"],
          candidateTrackIds: ["rap-track", "ambient-track"],
          expected: {
            status: "selected",
            requiredTrackIds: ["rap-track"],
            forbiddenTrackIds: ["ambient-track"],
            maxSelected: 1,
          },
          dimensions: ["tasteMatch", "noCatalogDump"],
        },
        {
          id: "reggaeton-no-match",
          description: "Explicit taste miss should return no tracks.",
          selectedTrackIds: [],
          candidateTrackIds: [],
          expected: { status: "no_tracks", maxSelected: 0 },
          dimensions: ["tasteMatch", "noCatalogDump"],
        },
      ]);

    expect(report.schemaVersion).toBe("agent-recommendation-eval/v1");
    expect(report.metrics.passRate).toBe(1);
    expect(writtenArtifact).toBe(artifactPath);
    expect(writtenSummary).toBe(summaryPath);
    expect(JSON.parse(readFileSync(artifactPath, "utf8")).metrics.total).toBe(2);
    expect(readFileSync(summaryPath, "utf8")).toContain("Agent Recommendation Eval Report");
  });

  it("fails when a no-match case selects unrelated tracks", () => {
    const service = new AgentRecommendationEvalService();
    const report = service.run([
      {
        id: "bad-catalog-dump",
        description: "Regression fixture.",
        selectedTrackIds: ["ambient-track", "pop-track"],
        candidateTrackIds: ["ambient-track", "pop-track"],
        expected: { status: "no_tracks", maxSelected: 0 },
        dimensions: ["tasteMatch", "noCatalogDump"],
      },
    ]);

    expect(report.metrics.failed).toBe(1);
    expect(report.results[0].failures).toEqual(expect.arrayContaining([
      "expected no tracks, got ambient-track, pop-track",
      "selected 2, max 0",
    ]));
  });
});
