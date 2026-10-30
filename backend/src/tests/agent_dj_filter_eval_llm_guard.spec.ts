/**
 * AI DJ filter-adherence eval, stage C (#2454): the LLM curation path's guard.
 * Simulated model replies go through the REAL `AgentRuntimePolicyService.apply`;
 * the output is graded by the independent grader. See
 * docs/engineering/ai-dj-filter-adherence-evals.md and dj_filter_eval/llm_guard.ts.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { getAgentTrackLimit } from "../modules/agents/agent_runtime.config";
import { requestScopeFor, requiresSeedEvidence } from "../modules/agents/agent_session_request";
import { EVAL_CATALOG } from "./dj_filter_eval/catalog";
import { EVAL_CASES, profileFor } from "./dj_filter_eval/cases";
import {
  applyGuard,
  applyGuardServing,
  buildGuardReport,
  compareToGuardBaseline,
  deterministicBatch,
  guardBaselineFromResults,
  guardInputFor,
  guardReportMarkdown,
  modelPicksFor,
  RUN_MATRIX,
  runAllGuardCases,
  runGuardCase,
  STRATEGIES,
  writeGuardReport,
  type GuardBaselineFile,
  type GuardRunResult,
} from "./dj_filter_eval/llm_guard";
import { BATCH_SIZE, listenerPreferences } from "./dj_filter_eval/harness";

const BASELINE_PATH = resolve(__dirname, "dj_filter_eval/llm_guard_baseline.json");

const caseById = (id: string) => {
  const found = EVAL_CASES.find((item) => item.id === id);
  if (!found) throw new Error(`missing case ${id}`);
  return found;
};

describe("AI DJ filter-adherence eval, stage C: LLM-path guard", () => {
  jest.setTimeout(600_000);
  let results: GuardRunResult[] = [];

  beforeAll(async () => {
    results = await runAllGuardCases();
  });

  it("runs every case with each model strategy in normal mode and the adversarial model in both fail-open modes", () => {
    expect(getAgentTrackLimit()).toBe(BATCH_SIZE);
    expect(RUN_MATRIX).toHaveLength(5);
    expect(results).toHaveLength(EVAL_CASES.length * RUN_MATRIX.length);
    for (const strategy of STRATEGIES) {
      for (const item of EVAL_CASES.slice(0, 5)) {
        const keys = modelPicksFor(item, strategy);
        expect(keys.length).toBeLessThanOrEqual(BATCH_SIZE);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.every((key) => EVAL_CATALOG.some((track) => track.observed.key === key))).toBe(true);
      }
    }
  });

  it("guard sanity: the adversarial model's Zen picks for a rap listener are dropped by the request guard", async () => {
    const zen = caseById("moment-zen@conflicting");
    const run = await runGuardCase(zen, "adversarial", "normal");
    expect(run.modelContradictions).toBeGreaterThan(0);
    expect(run.survivingModelContradictions).toBeLessThan(run.modelContradictions);
    expect(run.policy.offRequest).toBeGreaterThan(0);
  });

  it("mirrors the guard: no surviving model pick is tier C in normal mode, and unknown ids are dropped", async () => {
    for (const run of results.filter((candidate) => candidate.mode === "normal")) {
      for (const survivor of run.survivors) expect({ case: run.id, tier: survivor.tier === "C" }).toEqual({ case: run.id, tier: false });
    }
    const zen = caseById("moment-zen@conflicting");
    const { input } = await guardInputFor(zen);
    const result = await applyGuard(input, ["invented-track-id", ...modelPicksFor(zen, "faithful").slice(0, 3)], "normal");
    expect((result.picks ?? []).map((pick) => pick.trackId)).not.toContain("invented-track-id");
    expect(result.policy?.dropped.unknown).toBe(1);
  });

  it("is deterministic: a sample of runs gives the same picks and numbers twice", async () => {
    const sample = EVAL_CASES.filter((_, index) => index % 13 === 0);
    for (const item of sample) {
      for (const { strategy, mode } of RUN_MATRIX) {
        expect(await runGuardCase(item, strategy, mode)).toEqual(await runGuardCase(item, strategy, mode));
      }
    }
  });

  it("fails closed: the deterministic path serves the batch when the guard cannot verify the reply (#2462)", async () => {
    const zen = caseById("moment-zen@conflicting");
    const modelKeys = modelPicksFor(zen, "adversarial");
    const { input } = await guardInputFor(zen);
    // What the deterministic path serves for this case: the same golden selector and input as stage B.
    const selectorKeys = (await deterministicBatch(input)).picks!.map((pick) => pick.trackId);
    expect(selectorKeys.length).toBeGreaterThan(0);
    for (const mode of ["failOpenLookup", "failOpenNoRanking"] as const) {
      const served = await applyGuardServing(input, modelKeys, mode);
      expect(served.fellBackToDeterministic).toBe(true);
      expect((served.result.picks ?? []).map((pick) => pick.trackId)).toEqual(selectorKeys);

      const run = await runGuardCase(zen, "adversarial", mode);
      expect(run.fellBackToDeterministic).toBe(true);
      // No model pick that the selector did not also choose appears.
      const selectorSet = new Set(selectorKeys);
      const modelSet = new Set(modelKeys);
      expect(run.finalPicks.filter((pick) => modelSet.has(pick.key) && !selectorSet.has(pick.key))).toEqual([]);
      expect(run.finalPicks.every((pick) => pick.source === "deterministic")).toBe(true);
      expect(run.finalPicks.map((pick) => pick.key)).toEqual(selectorKeys);
      expect(run.final.contradictions).toBe(0);
    }
    const normal = await runGuardCase(zen, "adversarial", "normal");
    expect(normal.fellBackToDeterministic).toBe(false);
    for (const run of results) {
      // The fail-open modes cannot verify any reply; a seed-only request (the artist group) can never be verified (#2463).
      const unverifiable = run.mode !== "normal" || run.group === "artist";
      expect({ id: run.id, mode: run.mode, fellBack: run.fellBackToDeterministic }).toEqual({
        id: run.id,
        mode: run.mode,
        fellBack: unverifiable,
      });
    }
  });

  it("serves a seed-only request from the selector: no model pick survives (#2463)", async () => {
    const artistCases = EVAL_CASES.filter((item) => item.group === "artist");
    expect(artistCases.length).toBeGreaterThan(0);
    for (const item of artistCases) {
      // Production routes this request to the deterministic selector before any model call.
      const preferences = await listenerPreferences(item.request, profileFor(item), "start");
      expect({ case: item.id, routed: requiresSeedEvidence(requestScopeFor(preferences as never)) }).toEqual({
        case: item.id,
        routed: true,
      });
    }
    const artistRuns = results.filter((run) => run.group === "artist");
    expect(artistRuns).toHaveLength(artistCases.length * RUN_MATRIX.length);
    for (const run of artistRuns) {
      expect(run.fellBackToDeterministic).toBe(true);
      expect(run.finalPicks.every((pick) => pick.source === "deterministic")).toBe(true);
      expect(run.survivingModelContradictions).toBe(0);
      expect(run.final.contradictions).toBe(0);
    }
  });

  it("writes the report and prints the summary", () => {
    const report = buildGuardReport(results);
    const { jsonPath, markdownPath } = writeGuardReport(report);
    // eslint-disable-next-line no-console
    console.log(guardReportMarkdown(report));
    expect(report.schemaVersion).toBe("dj-llm-guard/v1");
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(markdownPath)).toBe(true);
    expect(Object.keys(report.summary.byStrategyAndMode)).toEqual([
      "adversarial / normal",
      "taste / normal",
      "faithful / normal",
      "adversarial / failOpenLookup",
      "adversarial / failOpenNoRanking",
    ]);
    expect(report.worstSurvivors.length).toBeLessThanOrEqual(10);
  });

  it("does not get worse than the pinned baseline for any case, strategy and mode", () => {
    if (process.env.UPDATE_DJ_FILTER_BASELINE === "1") {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(guardBaselineFromResults(results), null, 2)}\n`);
      return;
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as GuardBaselineFile;
    const { regressions, missing, improved } = compareToGuardBaseline(results, baseline);
    if (improved > 0) {
      // eslint-disable-next-line no-console
      console.log(`${improved} runs improved on the baseline: regenerate it with UPDATE_DJ_FILTER_BASELINE=1.`);
    }
    expect({ missing }).toEqual({ missing: [] });
    expect({ regressions }).toEqual({ regressions: [] });
  });
});
