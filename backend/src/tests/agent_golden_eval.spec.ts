import { existsSync, rmSync, readFileSync } from "fs";
import { resolve } from "path";
import { AgentGoldenEvalService } from "../modules/agents/agent_golden_eval.service";
import { AgentPolicyService } from "../modules/agents/agent_policy.service";
import { AgentRunnerService } from "../modules/agents/agent_runner.service";
import { EventBus } from "../modules/shared/event_bus";
import { HYBRID_RETRIEVAL_VARIANT } from "../modules/agents/agent_hybrid_retrieval";
import {
  GOLDEN_CASES,
  GOLDEN_CATALOG,
  HELD_BACK_CATALOG,
  HELD_BACK_EXPECTED_FIRST_BATCH,
  HELD_BACK_REQUEST,
} from "./dj_retrieval_golden/fixtures";
import {
  buildGoldenReport,
  buildGoldenSelector,
  expectGoldenBaselines,
  FixtureAudioFeatureService,
  goldenComparisonMarkdown,
  expectNoHybridRegression,
  goldenReportMarkdown,
  InMemoryGoldenTools,
  runGoldenCases,
  runHeldBackScenario,
  writeGoldenReport,
} from "./dj_retrieval_golden/harness";

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

    const { report, artifactPath: writtenPath, summaryPath } = service.runAndWriteArtifact();

    expect(report.schemaVersion).toBe("agent-golden-eval/v1");
    expect(report.metrics.total).toBeGreaterThanOrEqual(30);
    expect(report.metrics.failed).toBe(0);
    expect(report.metrics.passRate).toBe(1);
    expect(report.metrics.acceptanceRate).toBeGreaterThan(0);
    expect(report.metrics.rejectionRate).toBeGreaterThan(0);
    expect(report.metrics.learnedPreference.total).toBeGreaterThanOrEqual(3);
    expect(report.metrics.learnedPreference.passRate).toBe(1);
    expect(report.metrics.categories.catalog_search_intent.total).toBeGreaterThanOrEqual(2);
    expect(report.metrics.categories.learned_preference_regression.total).toBeGreaterThanOrEqual(3);
    expect(report.metrics.categories.policy_budget_refusal.total).toBeGreaterThanOrEqual(4);
    expect(report.metrics.categories.paid_download_readiness.total).toBeGreaterThanOrEqual(4);
    expect(report.metrics.rubricDimensions.budgetRespected.passRate).toBe(1);
    expect(report.metrics.rubricDimensions.failureModeClarity.passRate).toBe(1);
    expect(report.metrics.rubricDimensions.learnedPreference.passRate).toBe(1);
    expect(report.rubric.judgeRequired).toBe(false);
    expect(report.rubric.dimensions).toEqual(
      expect.arrayContaining([
        "genreMatch",
        "budgetRespected",
        "repeatAvoidance",
        "licensabilityPreference",
        "failureModeClarity",
        "learnedPreference",
      ])
    );
    expect(report.results.every((item) => item.passed)).toBe(true);
    expect(writtenPath).toBe(artifactPath);
    expect(summaryPath).toBe(resolve(process.cwd(), "eval-results/agent-golden-summary.md"));
    expect(existsSync(artifactPath)).toBe(true);
    expect(existsSync(summaryPath)).toBe(true);

    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(artifact.schemaVersion).toBe("agent-golden-eval/v1");
    expect(artifact.metrics.total).toBe(report.metrics.total);
    const summary = readFileSync(summaryPath, "utf8");
    expect(summary).toContain("Agent Golden Eval Report");
    expect(summary).toContain("Learned-preference pass rate");
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
          dimensions: ["budgetRespected", "licensabilityPreference", "failureModeClarity"],
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

/**
 * AI DJ retrieval golden set (#2235): recall@10 / recall@20 per request for the
 * current ranker, over a fixed hand-labelled catalog. Docker-free twin of
 * agent_dj_retrieval_golden.integration.spec.ts (same cases, same baselines;
 * that spec runs the real catalog search against Postgres). Cases the current
 * ranker misses are kept as known gaps with a baseline of what it achieves
 * today, so later retrieval work can only raise them.
 */
describe("AI DJ retrieval golden set", () => {
  it("meets the recorded recall baseline for every case and writes the per-case report", async () => {
    const tools = new InMemoryGoldenTools();
    const selector = buildGoldenSelector(tools, new FixtureAudioFeatureService(tools.tracksById));

    const results = await runGoldenCases(selector, "");
    const report = buildGoldenReport("in-memory catalog twin (npm run eval:golden)", results);
    const { jsonPath, markdownPath } = writeGoldenReport(report, "dj-retrieval-golden-results-in-memory");
    // eslint-disable-next-line no-console
    console.log(goldenReportMarkdown(report));

    expect(report.cases.map((item) => item.id)).toEqual(GOLDEN_CASES.map((item) => item.id));
    expect(GOLDEN_CATALOG.length).toBeGreaterThan(40);
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(markdownPath)).toBe(true);
    expect(report.summary.regressed).toBe(0);
    expectGoldenBaselines(results);
  });

  it("runs the hybrid_rrf_v1 variant over the same cases without regressing any of them (#2242)", async () => {
    const tools = new InMemoryGoldenTools();
    const selector = buildGoldenSelector(tools, new FixtureAudioFeatureService(tools.tracksById));

    const current = await runGoldenCases(selector, "");
    const hybrid = await runGoldenCases(selector, "", undefined, undefined, HYBRID_RETRIEVAL_VARIANT);
    const report = buildGoldenReport(
      `in-memory catalog twin, variant ${HYBRID_RETRIEVAL_VARIANT}`,
      hybrid,
    );
    writeGoldenReport(report, "dj-retrieval-golden-results-in-memory-hybrid");
    // eslint-disable-next-line no-console
    console.log(`${goldenReportMarkdown(report)}\n${goldenComparisonMarkdown(current, hybrid)}`);

    expect(report.summary.regressed).toBe(0);
    expectGoldenBaselines(hybrid);
    expectNoHybridRegression(current, hybrid);
  });

  it.each([[undefined], [HYBRID_RETRIEVAL_VARIANT]])(
    "hears every playable hip-hop match in the first batch and reports what was held back (variant %s)",
    async (variant) => {
      const tools = new InMemoryGoldenTools(HELD_BACK_CATALOG);
      const selector = buildGoldenSelector(tools, new FixtureAudioFeatureService(tools.tracksById));

      const { firstBatch, heldBack } = await runHeldBackScenario(selector, "", HELD_BACK_REQUEST, variant);

      // Nine eligible tracks; one is explicit (preference) and one is the first
      // artist's third (per-artist cap of 2): seven (more than the old target of
      // five) are heard, the rest is reported.
      expect([...firstBatch].sort()).toEqual([...HELD_BACK_EXPECTED_FIRST_BATCH].sort());
      expect(firstBatch).not.toContain("hb_b3_explicit");
      expect(heldBack).toEqual({ variety: 1, explicit: 1 });
    },
  );

  it("covers every case the issue names", () => {
    const ids = new Set(GOLDEN_CASES.map((item) => item.id));
    expect([...ids]).toEqual(
      expect.arrayContaining([
        "world-african",
        "world-mandingue",
        "world-country",
        "world-no-genre",
        "rap-explicit-allowed",
        "rap-french-rap",
        "rap-trap",
        "rap-drill",
        "sentence-warm-deep-house-cooking",
        "sentence-something-to-focus",
        "sentence-40-minute-run",
        "artist-like-nadia-okoro",
        "calm-measured-low-energy-no-tag",
        "unmet-gregorian-chant",
      ]),
    );
  });
});
