import { Injectable } from "@nestjs/common";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { AGENT_GOLDEN_SET, AgentGoldenCase } from "../../evals/agent_golden_set";
import { AgentRunnerService } from "./agent_runner.service";

export const AGENT_GOLDEN_EVAL_SCHEMA_VERSION = "agent-golden-eval/v1";
export const DEFAULT_AGENT_GOLDEN_EVAL_ARTIFACT_PATH = "eval-results/agent-golden-results.json";

export interface AgentGoldenEvalRubric {
  deterministicChecks: Array<"status" | "reason" | "licenseType" | "priceCeiling">;
  judgeSignals: string[];
  judgeRequired: boolean;
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
    categories: Record<string, { total: number; passed: number; failed: number }>;
  };
  results: AgentGoldenEvalResult[];
}

@Injectable()
export class AgentGoldenEvalService {
  constructor(private readonly runner: AgentRunnerService) {}

  run(cases: AgentGoldenCase[] = AGENT_GOLDEN_SET): AgentGoldenEvalReport {
    const results = cases.map((testCase) => this.runCase(testCase));
    const passed = results.filter((result) => result.passed).length;
    return {
      schemaVersion: AGENT_GOLDEN_EVAL_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      rubric: this.defaultRubric(),
      metrics: {
        total: results.length,
        passed,
        failed: results.length - passed,
        passRate: results.length ? passed / results.length : 0,
        categories: this.categoryMetrics(results),
      },
      results,
    };
  }

  runAndWriteArtifact(
    cases: AgentGoldenCase[] = AGENT_GOLDEN_SET,
    artifactPath = process.env.AGENT_GOLDEN_EVAL_RESULT_PATH ?? DEFAULT_AGENT_GOLDEN_EVAL_ARTIFACT_PATH
  ) {
    const report = this.run(cases);
    const resolvedPath = resolve(process.cwd(), artifactPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return { report, artifactPath: resolvedPath };
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

    return {
      id: testCase.id,
      category: testCase.category,
      description: testCase.description,
      tags: testCase.tags,
      passed: failures.length === 0,
      rubric: {
        ...testCase.rubric,
        judgeRequired: false,
      },
      expected: testCase.expected,
      actual,
      failures,
    };
  }

  private defaultRubric(): AgentGoldenEvalRubric {
    return {
      deterministicChecks: ["status", "reason", "licenseType", "priceCeiling"],
      judgeRequired: false,
      judgeSignals: [
        "Intent and license selection are stable.",
        "Policy and budget refusals are explicit.",
        "Approved cases are safe to hand to quote/download tooling.",
      ],
    };
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
}
