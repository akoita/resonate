import { Injectable } from "@nestjs/common";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { AGENT_GOLDEN_SET, AgentGoldenCase, AgentGoldenRubricDimension } from "../../evals/agent_golden_set";
import { AgentRunnerService } from "./agent_runner.service";

export const AGENT_GOLDEN_EVAL_SCHEMA_VERSION = "agent-golden-eval/v1";
export const DEFAULT_AGENT_GOLDEN_EVAL_ARTIFACT_PATH = "eval-results/agent-golden-results.json";
export const DEFAULT_AGENT_GOLDEN_EVAL_SUMMARY_PATH = "eval-results/agent-golden-summary.md";

export interface AgentGoldenEvalRubric {
  deterministicChecks: Array<"status" | "reason" | "licenseType" | "priceCeiling">;
  dimensions: AgentGoldenRubricDimension[];
  judgeSignals: string[];
  judgeRequired: boolean;
}

export interface AgentGoldenEvalDimensionResult {
  passed: boolean;
  failures: string[];
}

export interface AgentGoldenEvalResult {
  id: string;
  category: AgentGoldenCase["category"];
  description: string;
  tags: string[];
  passed: boolean;
  rubric: AgentGoldenEvalRubric;
  expected: AgentGoldenCase["expected"];
  actual: {
    status: "approved" | "rejected";
    reason: string;
    licenseType: string;
    priceUsd: number;
  };
  dimensions: Partial<Record<AgentGoldenRubricDimension, AgentGoldenEvalDimensionResult>>;
  failures: string[];
}

export interface AgentGoldenEvalReport {
  schemaVersion: typeof AGENT_GOLDEN_EVAL_SCHEMA_VERSION;
  generatedAt: string;
  rubric: AgentGoldenEvalRubric;
  metrics: {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    acceptanceRate: number;
    rejectionRate: number;
    learnedPreference: {
      total: number;
      passed: number;
      failed: number;
      passRate: number;
    };
    categories: Record<string, { total: number; passed: number; failed: number }>;
    rubricDimensions: Record<AgentGoldenRubricDimension, { total: number; passed: number; failed: number; passRate: number }>;
  };
  results: AgentGoldenEvalResult[];
}

@Injectable()
export class AgentGoldenEvalService {
  constructor(private readonly runner: AgentRunnerService) {}

  run(cases: AgentGoldenCase[] = AGENT_GOLDEN_SET): AgentGoldenEvalReport {
    const results = cases.map((testCase) => this.runCase(testCase));
    const passed = results.filter((result) => result.passed).length;
    const approved = results.filter((result) => result.actual.status === "approved").length;
    return {
      schemaVersion: AGENT_GOLDEN_EVAL_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      rubric: this.defaultRubric(),
      metrics: {
        total: results.length,
        passed,
        failed: results.length - passed,
        passRate: results.length ? passed / results.length : 0,
        acceptanceRate: results.length ? approved / results.length : 0,
        rejectionRate: results.length ? (results.length - approved) / results.length : 0,
        learnedPreference: this.learnedPreferenceMetrics(results),
        categories: this.categoryMetrics(results),
        rubricDimensions: this.rubricDimensionMetrics(results),
      },
      results,
    };
  }

  runAndWriteArtifact(
    cases: AgentGoldenCase[] = AGENT_GOLDEN_SET,
    artifactPath = process.env.AGENT_GOLDEN_EVAL_RESULT_PATH ?? DEFAULT_AGENT_GOLDEN_EVAL_ARTIFACT_PATH,
    summaryPath = process.env.AGENT_GOLDEN_EVAL_SUMMARY_PATH ?? DEFAULT_AGENT_GOLDEN_EVAL_SUMMARY_PATH
  ) {
    const report = this.run(cases);
    const resolvedPath = resolve(process.cwd(), artifactPath);
    const resolvedSummaryPath = resolve(process.cwd(), summaryPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    mkdirSync(dirname(resolvedSummaryPath), { recursive: true });
    writeFileSync(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    writeFileSync(resolvedSummaryPath, this.toMarkdown(report), "utf8");
    return { report, artifactPath: resolvedPath, summaryPath: resolvedSummaryPath };
  }

  private runCase(testCase: AgentGoldenCase): AgentGoldenEvalResult {
    const result = this.runner.run(testCase.input);
    const actual = {
      status: result.status,
      reason: result.decision.reason,
      licenseType: result.decision.licenseType,
      priceUsd: result.decision.priceUsd,
    };
    const failures = [
      actual.status === testCase.expected.status ? null : `status expected ${testCase.expected.status}, got ${actual.status}`,
      actual.reason === testCase.expected.reason ? null : `reason expected ${testCase.expected.reason}, got ${actual.reason}`,
      actual.licenseType === testCase.expected.licenseType
        ? null
        : `licenseType expected ${testCase.expected.licenseType}, got ${actual.licenseType}`,
      testCase.expected.maxPriceUsd === undefined || actual.priceUsd <= testCase.expected.maxPriceUsd
        ? null
        : `priceUsd expected <= ${testCase.expected.maxPriceUsd}, got ${actual.priceUsd}`,
    ].filter((failure): failure is string => Boolean(failure));
    const dimensions = this.dimensionResults(testCase, actual);
    const dimensionFailures = Object.entries(dimensions)
      .flatMap(([dimension, result]) => result.failures.map((failure) => `${dimension}: ${failure}`));
    const allFailures = [...failures, ...dimensionFailures];

    return {
      id: testCase.id,
      category: testCase.category,
      description: testCase.description,
      tags: testCase.tags,
      passed: allFailures.length === 0,
      rubric: {
        ...testCase.rubric,
        judgeRequired: false,
      },
      expected: testCase.expected,
      actual,
      dimensions,
      failures: allFailures,
    };
  }

  private defaultRubric(): AgentGoldenEvalRubric {
    return {
      deterministicChecks: ["status", "reason", "licenseType", "priceCeiling"],
      dimensions: [
        "genreMatch",
        "budgetRespected",
        "repeatAvoidance",
        "licensabilityPreference",
        "failureModeClarity",
        "learnedPreference",
      ],
      judgeRequired: false,
      judgeSignals: [
        "Intent and license selection are stable.",
        "Policy and budget refusals are explicit.",
        "Approved cases are safe to hand to quote/download tooling.",
      ],
    };
  }

  private dimensionResults(
    testCase: AgentGoldenCase,
    actual: AgentGoldenEvalResult["actual"],
  ): Partial<Record<AgentGoldenRubricDimension, AgentGoldenEvalDimensionResult>> {
    const dimensions: Partial<Record<AgentGoldenRubricDimension, AgentGoldenEvalDimensionResult>> = {};
    for (const dimension of testCase.rubric.dimensions) {
      const failures: string[] = [];
      switch (dimension) {
        case "genreMatch": {
          if (!testCase.input.preferences.genres?.length) {
            failures.push("case does not declare genre preferences");
          }
          break;
        }
        case "budgetRespected": {
          const withinBudget = actual.priceUsd <= testCase.input.budgetRemainingUsd;
          if (actual.status === "approved" && !withinBudget) {
            failures.push(`approved price ${actual.priceUsd} exceeds budget ${testCase.input.budgetRemainingUsd}`);
          }
          if (actual.status === "rejected" && actual.reason !== "budget_exceeded") {
            failures.push(`rejection reason should be budget_exceeded, got ${actual.reason}`);
          }
          break;
        }
        case "repeatAvoidance": {
          if (testCase.input.recentTrackIds.includes(testCase.input.trackId)) {
            failures.push(`track ${testCase.input.trackId} appears in recentTrackIds`);
          }
          break;
        }
        case "licensabilityPreference": {
          const requestedLicense = testCase.input.preferences.licenseType ?? "personal";
          if (actual.licenseType !== requestedLicense) {
            failures.push(`licenseType expected requested ${requestedLicense}, got ${actual.licenseType}`);
          }
          break;
        }
        case "failureModeClarity": {
          if (actual.status === "rejected" && !["budget_exceeded"].includes(actual.reason)) {
            failures.push(`unbranchable rejection reason ${actual.reason}`);
          }
          break;
        }
        case "learnedPreference": {
          const weights = testCase.input.preferences.learnedGenreWeights ?? {};
          const weightedGenres = Object.entries(weights).filter(([, weight]) => weight > 0);
          if (weightedGenres.length === 0) {
            failures.push("case does not declare positive learnedGenreWeights");
          }
          const requestedGenres = new Set(testCase.input.preferences.genres ?? []);
          if (weightedGenres.length > 0 && !weightedGenres.some(([genre]) => requestedGenres.has(genre))) {
            failures.push("positive learned genres do not overlap requested genres");
          }
          break;
        }
      }
      dimensions[dimension] = {
        passed: failures.length === 0,
        failures,
      };
    }
    return dimensions;
  }

  private categoryMetrics(results: AgentGoldenEvalResult[]) {
    return results.reduce<Record<string, { total: number; passed: number; failed: number }>>((metrics, result) => {
      const category = metrics[result.category] ?? { total: 0, passed: 0, failed: 0 };
      category.total += 1;
      if (result.passed) {
        category.passed += 1;
      } else {
        category.failed += 1;
      }
      metrics[result.category] = category;
      return metrics;
    }, {});
  }

  private learnedPreferenceMetrics(results: AgentGoldenEvalResult[]) {
    const learnedResults = results.filter((result) => Boolean(result.dimensions.learnedPreference));
    const passed = learnedResults.filter((result) => result.dimensions.learnedPreference?.passed).length;
    return {
      total: learnedResults.length,
      passed,
      failed: learnedResults.length - passed,
      passRate: learnedResults.length ? passed / learnedResults.length : 0,
    };
  }

  private rubricDimensionMetrics(results: AgentGoldenEvalResult[]) {
    const dimensions: AgentGoldenRubricDimension[] = [
      "genreMatch",
      "budgetRespected",
      "repeatAvoidance",
      "licensabilityPreference",
      "failureModeClarity",
      "learnedPreference",
    ];
    return dimensions.reduce<Record<AgentGoldenRubricDimension, { total: number; passed: number; failed: number; passRate: number }>>((metrics, dimension) => {
      const dimensionResults = results
        .map((result) => result.dimensions[dimension])
        .filter((result): result is AgentGoldenEvalDimensionResult => Boolean(result));
      const passed = dimensionResults.filter((result) => result.passed).length;
      metrics[dimension] = {
        total: dimensionResults.length,
        passed,
        failed: dimensionResults.length - passed,
        passRate: dimensionResults.length ? passed / dimensionResults.length : 0,
      };
      return metrics;
    }, {} as Record<AgentGoldenRubricDimension, { total: number; passed: number; failed: number; passRate: number }>);
  }

  private toMarkdown(report: AgentGoldenEvalReport) {
    const pct = (value: number) => `${Math.round(value * 100)}%`;
    const dimensionRows = Object.entries(report.metrics.rubricDimensions)
      .map(([dimension, metrics]) => `| ${dimension} | ${metrics.passed}/${metrics.total} | ${pct(metrics.passRate)} |`)
      .join("\n");
    const categoryRows = Object.entries(report.metrics.categories)
      .map(([category, metrics]) => {
        const passRate = metrics.total ? metrics.passed / metrics.total : 0;
        return `| ${category} | ${metrics.passed}/${metrics.total} | ${pct(passRate)} |`;
      })
      .join("\n");

    return [
      "# Agent Golden Eval Report",
      "",
      `Generated: ${report.generatedAt}`,
      "",
      "## Summary",
      "",
      `- Cases: ${report.metrics.total}`,
      `- Passed: ${report.metrics.passed}`,
      `- Failed: ${report.metrics.failed}`,
      `- Pass rate: ${pct(report.metrics.passRate)}`,
      `- Acceptance rate: ${pct(report.metrics.acceptanceRate)}`,
      `- Rejection rate: ${pct(report.metrics.rejectionRate)}`,
      `- Learned-preference pass rate: ${report.metrics.learnedPreference.passed}/${report.metrics.learnedPreference.total} (${pct(report.metrics.learnedPreference.passRate)})`,
      "",
      "## Rubric Dimensions",
      "",
      "| Dimension | Passed | Pass rate |",
      "|---|---:|---:|",
      dimensionRows,
      "",
      "## Categories",
      "",
      "| Category | Passed | Pass rate |",
      "|---|---:|---:|",
      categoryRows,
      "",
    ].join("\n");
  }
}
