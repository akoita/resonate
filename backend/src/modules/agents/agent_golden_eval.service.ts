import { Injectable } from "@nestjs/common";
import { AGENT_GOLDEN_SET, AgentGoldenCase } from "../../evals/agent_golden_set";
import { AgentRunnerService } from "./agent_runner.service";

export interface AgentGoldenEvalResult {
  id: string;
  description: string;
  passed: boolean;
  expected: AgentGoldenCase["expected"];
  actual: {
    status: "approved" | "rejected";
    reason: string;
    licenseType: string;
    priceUsd: number;
  };
  failures: string[];
}

@Injectable()
export class AgentGoldenEvalService {
  constructor(private readonly runner: AgentRunnerService) {}

  run(cases: AgentGoldenCase[] = AGENT_GOLDEN_SET) {
    const results = cases.map((testCase) => this.runCase(testCase));
    const passed = results.filter((result) => result.passed).length;
    return {
      metrics: {
        total: results.length,
        passed,
        failed: results.length - passed,
        passRate: results.length ? passed / results.length : 0,
      },
      results,
    };
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
      description: testCase.description,
      passed: failures.length === 0,
      expected: testCase.expected,
      actual,
      failures,
    };
  }
}
