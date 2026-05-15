import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

export const AGENT_RECOMMENDATION_EVAL_SCHEMA_VERSION = "agent-recommendation-eval/v1";
export const DEFAULT_AGENT_RECOMMENDATION_EVAL_ARTIFACT_PATH = "eval-results/agent-recommendation-results.json";
export const DEFAULT_AGENT_RECOMMENDATION_EVAL_SUMMARY_PATH = "eval-results/agent-recommendation-summary.md";

export interface AgentRecommendationEvalCase {
  id: string;
  description: string;
  selectedTrackIds: string[];
  candidateTrackIds: string[];
  expected: {
    status: "selected" | "no_tracks";
    requiredTrackIds?: string[];
    forbiddenTrackIds?: string[];
    maxSelected?: number;
    minSelected?: number;
  };
  dimensions: Array<"tasteMatch" | "noCatalogDump" | "recentAvoidance" | "diversity" | "policyReadiness">;
}

export interface AgentRecommendationEvalResult {
  id: string;
  passed: boolean;
  failures: string[];
  selectedTrackIds: string[];
  candidateTrackIds: string[];
  dimensions: Record<string, { passed: boolean; failures: string[] }>;
}

export class AgentRecommendationEvalService {
  run(cases: AgentRecommendationEvalCase[]) {
    const results = cases.map((testCase) => this.evaluateCase(testCase));
    const passed = results.filter((result) => result.passed).length;
    const metrics = {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: results.length ? passed / results.length : 0,
      dimensions: this.dimensionMetrics(results),
    };

    return {
      schemaVersion: AGENT_RECOMMENDATION_EVAL_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      metrics,
      results,
    };
  }

  runAndWriteArtifact(
    cases: AgentRecommendationEvalCase[],
    options: {
      artifactPath?: string;
      summaryPath?: string;
    } = {},
  ) {
    const report = this.run(cases);
    const artifactPath = resolve(process.cwd(), options.artifactPath ?? DEFAULT_AGENT_RECOMMENDATION_EVAL_ARTIFACT_PATH);
    const summaryPath = resolve(process.cwd(), options.summaryPath ?? DEFAULT_AGENT_RECOMMENDATION_EVAL_SUMMARY_PATH);
    mkdirSync(dirname(artifactPath), { recursive: true });
    mkdirSync(dirname(summaryPath), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(summaryPath, this.toSummary(report));
    return { report, artifactPath, summaryPath };
  }

  private evaluateCase(testCase: AgentRecommendationEvalCase): AgentRecommendationEvalResult {
    const failures: string[] = [];
    const dimensionFailures = new Map<string, string[]>();
    const addFailure = (dimension: string, message: string) => {
      failures.push(message);
      dimensionFailures.set(dimension, [...(dimensionFailures.get(dimension) ?? []), message]);
    };

    if (testCase.expected.status === "no_tracks" && testCase.selectedTrackIds.length > 0) {
      addFailure("tasteMatch", `expected no tracks, got ${testCase.selectedTrackIds.join(", ")}`);
    }
    if (testCase.expected.status === "selected" && testCase.selectedTrackIds.length === 0) {
      addFailure("tasteMatch", "expected at least one selected track");
    }
    for (const trackId of testCase.expected.requiredTrackIds ?? []) {
      if (!testCase.selectedTrackIds.includes(trackId)) {
        addFailure("tasteMatch", `missing required track ${trackId}`);
      }
    }
    for (const trackId of testCase.expected.forbiddenTrackIds ?? []) {
      if (testCase.selectedTrackIds.includes(trackId)) {
        addFailure("recentAvoidance", `selected forbidden track ${trackId}`);
      }
    }
    if (testCase.expected.maxSelected !== undefined && testCase.selectedTrackIds.length > testCase.expected.maxSelected) {
      addFailure("noCatalogDump", `selected ${testCase.selectedTrackIds.length}, max ${testCase.expected.maxSelected}`);
    }
    if (testCase.expected.minSelected !== undefined && testCase.selectedTrackIds.length < testCase.expected.minSelected) {
      addFailure("tasteMatch", `selected ${testCase.selectedTrackIds.length}, min ${testCase.expected.minSelected}`);
    }

    return {
      id: testCase.id,
      passed: failures.length === 0,
      failures,
      selectedTrackIds: testCase.selectedTrackIds,
      candidateTrackIds: testCase.candidateTrackIds,
      dimensions: Object.fromEntries(testCase.dimensions.map((dimension) => {
        const dimensionSpecific = dimensionFailures.get(dimension) ?? [];
        return [dimension, { passed: dimensionSpecific.length === 0, failures: dimensionSpecific }];
      })),
    };
  }

  private dimensionMetrics(results: AgentRecommendationEvalResult[]) {
    const dimensions = new Map<string, { total: number; passed: number }>();
    for (const result of results) {
      for (const [dimension, outcome] of Object.entries(result.dimensions)) {
        const current = dimensions.get(dimension) ?? { total: 0, passed: 0 };
        current.total += 1;
        if (outcome.passed) current.passed += 1;
        dimensions.set(dimension, current);
      }
    }
    return Object.fromEntries(Array.from(dimensions.entries()).map(([dimension, value]) => [
      dimension,
      {
        ...value,
        failed: value.total - value.passed,
        passRate: value.total ? value.passed / value.total : 0,
      },
    ]));
  }

  private toSummary(report: ReturnType<AgentRecommendationEvalService["run"]>) {
    const pct = (value: number) => `${Math.round(value * 100)}%`;
    return [
      "# Agent Recommendation Eval Report",
      "",
      `- Schema: ${report.schemaVersion}`,
      `- Generated: ${report.generatedAt}`,
      `- Pass rate: ${report.metrics.passed}/${report.metrics.total} (${pct(report.metrics.passRate)})`,
      "",
      "## Cases",
      ...report.results.map((result) =>
        `- ${result.passed ? "PASS" : "FAIL"} ${result.id}${result.failures.length ? `: ${result.failures.join("; ")}` : ""}`
      ),
      "",
    ].join("\n");
  }
}
