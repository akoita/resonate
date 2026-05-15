import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

export const AGENT_RECOMMENDATION_EVAL_SCHEMA_VERSION = "agent-recommendation-eval/v1";
export const DEFAULT_AGENT_RECOMMENDATION_EVAL_ARTIFACT_PATH = "eval-results/agent-recommendation-results.json";
export const DEFAULT_AGENT_RECOMMENDATION_EVAL_SUMMARY_PATH = "eval-results/agent-recommendation-summary.md";

export type AgentRecommendationEvalDimension =
  | "tasteMatch"
  | "semanticMatch"
  | "noCatalogDump"
  | "recentAvoidance"
  | "diversity"
  | "policyReadiness"
  | "listingAvailability"
  | "novelty"
  | "explanationCoverage"
  | "refusalCorrectness";

export interface AgentRecommendationEvalSignal {
  label: string;
  weight: number;
  reason: string;
}

export interface AgentRecommendationEvalCandidate {
  trackId: string;
  title?: string;
  relevance?: "exact" | "semantic" | "unrelated";
  score?: number;
  hasListing?: boolean;
  recent?: boolean;
  explanation?: string[];
  signals?: AgentRecommendationEvalSignal[];
}

export interface AgentRecommendationEvalRejectedCandidate {
  trackId: string;
  reason: string;
}

export interface AgentRecommendationEvalCase {
  id: string;
  description: string;
  selectedTrackIds: string[];
  candidateTrackIds: string[];
  selectedCandidates?: AgentRecommendationEvalCandidate[];
  candidateDetails?: AgentRecommendationEvalCandidate[];
  rejectedCandidates?: AgentRecommendationEvalRejectedCandidate[];
  expected: {
    status: "selected" | "no_tracks";
    requiredTrackIds?: string[];
    forbiddenTrackIds?: string[];
    maxSelected?: number;
    minSelected?: number;
    minPrecision?: number;
    requireListed?: boolean;
    forbidRecent?: boolean;
    requireExplanation?: boolean;
  };
  dimensions: AgentRecommendationEvalDimension[];
}

export interface AgentRecommendationEvalResult {
  id: string;
  description: string;
  passed: boolean;
  failures: string[];
  selectedTrackIds: string[];
  candidateTrackIds: string[];
  selectedCandidates: Array<AgentRecommendationEvalCandidate & { topSignals: AgentRecommendationEvalSignal[] }>;
  rejectedCandidates: AgentRecommendationEvalRejectedCandidate[];
  metrics: {
    precision: number | null;
    refusalCorrect: boolean | null;
    listingCoverage: number | null;
    noveltyCoverage: number | null;
    explanationCoverage: number | null;
  };
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
      precision: this.averageMetric(results, "precision"),
      refusalCorrectness: this.booleanPassRate(results, "refusalCorrect"),
      listingCoverage: this.averageMetric(results, "listingCoverage"),
      noveltyCoverage: this.averageMetric(results, "noveltyCoverage"),
      explanationCoverage: this.averageMetric(results, "explanationCoverage"),
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
    const selectedCandidates = this.selectedCandidates(testCase);
    const rejectedCandidates = testCase.rejectedCandidates ?? [];
    const addFailure = (dimension: string, message: string) => {
      failures.push(message);
      dimensionFailures.set(dimension, [...(dimensionFailures.get(dimension) ?? []), message]);
    };
    const metrics = this.caseMetrics(testCase, selectedCandidates);

    if (testCase.expected.status === "no_tracks" && testCase.selectedTrackIds.length > 0) {
      addFailure("refusalCorrectness", `expected no tracks, got ${testCase.selectedTrackIds.join(", ")}`);
      if (selectedCandidates.some((candidate) => candidate.relevance === "unrelated")) {
        addFailure("noCatalogDump", "strict no-match case selected unrelated catalog candidates");
      }
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
    if (testCase.expected.minPrecision !== undefined && (metrics.precision ?? 0) < testCase.expected.minPrecision) {
      addFailure("semanticMatch", `precision ${metrics.precision ?? 0} below minimum ${testCase.expected.minPrecision}`);
    }
    if (testCase.expected.requireListed && (metrics.listingCoverage ?? 0) < 1) {
      addFailure("listingAvailability", "selected candidates must all have active listings");
    }
    if (testCase.expected.forbidRecent && (metrics.noveltyCoverage ?? 0) < 1) {
      addFailure("novelty", "selected candidates include recently played tracks");
    }
    if (testCase.expected.requireExplanation && (metrics.explanationCoverage ?? 0) < 1) {
      addFailure("explanationCoverage", "selected candidates must include explanation or signal evidence");
    }

    return {
      id: testCase.id,
      description: testCase.description,
      passed: failures.length === 0,
      failures,
      selectedTrackIds: testCase.selectedTrackIds,
      candidateTrackIds: testCase.candidateTrackIds,
      selectedCandidates: selectedCandidates.map((candidate) => ({
        ...candidate,
        topSignals: [...(candidate.signals ?? [])]
          .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
          .slice(0, 3),
      })),
      rejectedCandidates,
      metrics,
      dimensions: Object.fromEntries(testCase.dimensions.map((dimension) => {
        const dimensionSpecific = dimensionFailures.get(dimension) ?? [];
        return [dimension, { passed: dimensionSpecific.length === 0, failures: dimensionSpecific }];
      })),
    };
  }

  private selectedCandidates(testCase: AgentRecommendationEvalCase): AgentRecommendationEvalCandidate[] {
    if (testCase.selectedCandidates) return testCase.selectedCandidates;
    const byId = new Map((testCase.candidateDetails ?? []).map((candidate) => [candidate.trackId, candidate]));
    return testCase.selectedTrackIds.map((trackId) => byId.get(trackId) ?? { trackId });
  }

  private caseMetrics(
    testCase: AgentRecommendationEvalCase,
    selectedCandidates: AgentRecommendationEvalCandidate[],
  ): AgentRecommendationEvalResult["metrics"] {
    const selectedCount = selectedCandidates.length;
    const relevantSelected = selectedCandidates.filter(
      (candidate) => candidate.relevance === "exact" || candidate.relevance === "semantic",
    ).length;
    const selectedWithKnownRelevance = selectedCandidates.filter((candidate) => candidate.relevance).length;
    const selectedWithKnownListing = selectedCandidates.filter((candidate) => candidate.hasListing !== undefined).length;
    const selectedWithKnownRecent = selectedCandidates.filter((candidate) => candidate.recent !== undefined).length;
    const selectedWithEvidence = selectedCandidates.filter(
      (candidate) => (candidate.explanation?.length ?? 0) > 0 || (candidate.signals?.length ?? 0) > 0,
    ).length;

    return {
      precision: selectedWithKnownRelevance ? relevantSelected / selectedWithKnownRelevance : selectedCount ? null : 1,
      refusalCorrect: testCase.expected.status === "no_tracks" ? selectedCount === 0 : null,
      listingCoverage: selectedWithKnownListing
        ? selectedCandidates.filter((candidate) => candidate.hasListing).length / selectedWithKnownListing
        : selectedCount ? null : 1,
      noveltyCoverage: selectedWithKnownRecent
        ? selectedCandidates.filter((candidate) => !candidate.recent).length / selectedWithKnownRecent
        : selectedCount ? null : 1,
      explanationCoverage: selectedCount ? selectedWithEvidence / selectedCount : 1,
    };
  }

  private averageMetric(
    results: AgentRecommendationEvalResult[],
    key: "precision" | "listingCoverage" | "noveltyCoverage" | "explanationCoverage",
  ) {
    const values = results
      .map((result) => result.metrics[key])
      .filter((value): value is number => typeof value === "number");
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  private booleanPassRate(
    results: AgentRecommendationEvalResult[],
    key: "refusalCorrect",
  ) {
    const values = results
      .map((result) => result.metrics[key])
      .filter((value): value is boolean => typeof value === "boolean");
    return values.length ? values.filter(Boolean).length / values.length : null;
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
      `- Precision: ${report.metrics.precision === null ? "n/a" : pct(report.metrics.precision)}`,
      `- Refusal correctness: ${report.metrics.refusalCorrectness === null ? "n/a" : pct(report.metrics.refusalCorrectness)}`,
      `- Listing coverage: ${report.metrics.listingCoverage === null ? "n/a" : pct(report.metrics.listingCoverage)}`,
      `- Novelty coverage: ${report.metrics.noveltyCoverage === null ? "n/a" : pct(report.metrics.noveltyCoverage)}`,
      `- Explanation coverage: ${report.metrics.explanationCoverage === null ? "n/a" : pct(report.metrics.explanationCoverage)}`,
      "",
      "## Cases",
      ...report.results.map((result) =>
        [
          `- ${result.passed ? "PASS" : "FAIL"} ${result.id}${result.failures.length ? `: ${result.failures.join("; ")}` : ""}`,
          `  - ${result.description}`,
          `  - Selected: ${result.selectedCandidates.length ? result.selectedCandidates.map((candidate) => `${candidate.trackId}${candidate.score === undefined ? "" : ` (${candidate.score})`}`).join(", ") : "none"}`,
          `  - Rejected: ${result.rejectedCandidates.length ? result.rejectedCandidates.map((candidate) => `${candidate.trackId}:${candidate.reason}`).join(", ") : "none"}`,
        ].join("\n")
      ),
      "",
    ].join("\n");
  }
}
