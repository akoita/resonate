/**
 * AI DJ filter-adherence eval, stage A (docs/engineering/ai-dj-filter-adherence-evals.md):
 * how well the deterministic session parser turns a typed sentence into the
 * filters the listener meant. Docker-free. The expectations are hand-written
 * (dj_filter_eval/parser_cases.ts) and graded by an independent grader
 * (dj_filter_eval/parser_grader.ts); the baseline pins today's behaviour per
 * case and may rise, never fall.
 *
 *   npm run eval:dj-filters
 *   UPDATE_DJ_FILTER_BASELINE=1 npm run eval:dj-filters   # record an improvement
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { ArtistAwareRulesParser } from "../modules/agents/agent_session_parser";
import { listeningRequestFromCrateParse } from "../modules/agents/agent_session_request";
import { fixtureArtistResolver } from "./dj_retrieval_golden/harness";
import { PARSER_CASES, type ParserCase } from "./dj_filter_eval/parser_cases";
import {
  buildParserReport,
  gradeParse,
  isWorse,
  parserReportMarkdown,
  type CaseVerdict,
  type GradedCaseResult,
  type GradedRequest,
} from "./dj_filter_eval/parser_grader";

const BASELINE_PATH = resolve(__dirname, "dj_filter_eval/parser_baseline.json");
const GRADER_PATH = resolve(__dirname, "dj_filter_eval/parser_grader.ts");

type BaselineEntry = { verdict: CaseVerdict; missing: number; spurious: number };
type Baseline = { schemaVersion: "dj-parser-baseline/v1"; cases: Record<string, BaselineEntry> };

async function parseCase(testCase: ParserCase): Promise<GradedCaseResult> {
  const parser = new ArtistAwareRulesParser(fixtureArtistResolver());
  const response = listeningRequestFromCrateParse(await parser.parse(testCase.text));
  const got: GradedRequest = { ...response.request, artists: response.artists };
  const expected: GradedRequest = { ...testCase.expect, artists: testCase.expect.artists ?? [] };
  return {
    id: testCase.id,
    group: testCase.group,
    text: testCase.text,
    expected,
    got,
    grade: gradeParse(expected, got),
  };
}

async function runAll(): Promise<GradedCaseResult[]> {
  const results: GradedCaseResult[] = [];
  for (const testCase of PARSER_CASES) results.push(await parseCase(testCase));
  return results;
}

function readBaseline(): Baseline | undefined {
  if (!existsSync(BASELINE_PATH)) return undefined;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

describe("AI DJ parser adherence eval (stage A)", () => {
  describe("grader", () => {
    const base: GradedRequest = { genres: [], moods: [], energy: null, bpm: null, artists: [] };

    it("grades sets case-insensitively and reports missing and spurious terms", () => {
      const grade = gradeParse(
        { ...base, genres: ["Hip-Hop", "Rap"], moods: ["Zen"] },
        { ...base, genres: ["hip-hop", "Trap"], moods: ["zen"] },
      );
      expect(grade.dimensions.genres).toEqual({ correct: ["Hip-Hop"], missing: ["Rap"], spurious: ["Trap"] });
      expect(grade.dimensions.moods.correct).toEqual(["Zen"]);
      expect(grade.verdict).toBe("partial");
    });

    it("grades energy exactly and counts a wrong band as missing plus spurious", () => {
      const grade = gradeParse({ ...base, energy: "low" }, { ...base, energy: "high" });
      expect(grade.dimensions.energy).toEqual({ correct: [], missing: ["low"], spurious: ["high"] });
      expect(grade.verdict).toBe("miss");
      expect(gradeParse({ ...base, energy: "low" }, { ...base, energy: "low" }).verdict).toBe("exact");
    });

    it("accepts a tempo within 3 BPM per bound and rejects further", () => {
      const expected = { ...base, bpm: { min: 107, max: 113 } };
      expect(gradeParse(expected, { ...base, bpm: { min: 105, max: 115 } }).verdict).toBe("exact");
      expect(gradeParse(expected, { ...base, bpm: { min: 100, max: 113 } }).verdict).toBe("miss");
      expect(gradeParse(expected, base).dimensions.bpm.missing).toEqual(["107-113"]);
      expect(gradeParse(expected, { ...base, bpm: { min: 107, max: null } }).verdict).toBe("miss");
    });

    it("treats a tempo nobody asked for as spurious", () => {
      const grade = gradeParse(base, { ...base, bpm: { min: 120, max: 125 } });
      expect(grade.dimensions.bpm.spurious).toEqual(["120-125"]);
      expect(grade.verdict).toBe("spurious");
    });

    it("grades artists as a set", () => {
      const grade = gradeParse({ ...base, artists: ["Kern"] }, { ...base, artists: ["kern", "Vargr"] });
      expect(grade.dimensions.artists).toEqual({ correct: ["Kern"], missing: [], spurious: ["Vargr"] });
    });

    it("returns clean for a nothing-expected case that reads nothing, miss when nothing is right", () => {
      expect(gradeParse(base, base).verdict).toBe("clean");
      expect(gradeParse({ ...base, genres: ["Jazz"] }, base).verdict).toBe("miss");
    });

    it("flags a worse outcome by verdict, missing or spurious", () => {
      const before = { verdict: "partial" as const, missing: 1, spurious: 0 };
      expect(isWorse(before, { verdict: "partial", missing: 1, spurious: 0 })).toBe(false);
      expect(isWorse(before, { verdict: "exact", missing: 0, spurious: 0 })).toBe(false);
      expect(isWorse(before, { verdict: "miss", missing: 1, spurious: 0 })).toBe(true);
      expect(isWorse(before, { verdict: "partial", missing: 2, spurious: 0 })).toBe(true);
      expect(isWorse(before, { verdict: "partial", missing: 1, spurious: 1 })).toBe(true);
    });
  });

  it("keeps the grader independent of the code it grades", () => {
    const source = readFileSync(GRADER_PATH, "utf8");
    const specifiers = [...source.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map((match) => match[1]);
    const outside = specifiers.filter((specifier) => !/^\.\/[\w-]+$/.test(specifier));
    expect(outside).toEqual([]);
    expect(source).not.toMatch(/modules\//);
  });

  it("has unique case ids", () => {
    const ids = PARSER_CASES.map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic", async () => {
    const first = await runAll();
    const second = await runAll();
    expect(second).toEqual(first);
  });

  it("holds every case at or above its pinned baseline and writes the report", async () => {
    const results = await runAll();
    const report = buildParserReport(results);
    const markdown = parserReportMarkdown(report);

    const dir = resolve(process.cwd(), "eval-results");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "dj-parser-adherence.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(resolve(dir, "dj-parser-adherence.md"), markdown);
    // eslint-disable-next-line no-console
    console.log(markdown);

    expect(report.schemaVersion).toBe("dj-parser-adherence/v1");

    if (process.env.UPDATE_DJ_FILTER_BASELINE === "1") {
      const baseline: Baseline = {
        schemaVersion: "dj-parser-baseline/v1",
        cases: Object.fromEntries(
          results.map((result) => [
            result.id,
            { verdict: result.grade.verdict, missing: result.grade.missing, spurious: result.grade.spurious },
          ]),
        ),
      };
      writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
      return;
    }

    const baseline = readBaseline();
    expect(baseline).toBeDefined();
    const regressions: string[] = [];
    for (const result of results) {
      const pinned = baseline?.cases[result.id];
      if (!pinned) {
        regressions.push(`${result.id}: not in the baseline (run with UPDATE_DJ_FILTER_BASELINE=1)`);
        continue;
      }
      const now = { verdict: result.grade.verdict, missing: result.grade.missing, spurious: result.grade.spurious };
      if (isWorse(pinned, now)) {
        regressions.push(
          `${result.id} "${result.text}": ${pinned.verdict} (missing ${pinned.missing}, spurious ${pinned.spurious}) -> ` +
            `${now.verdict} (missing ${now.missing}, spurious ${now.spurious})`,
        );
      }
    }
    expect(regressions).toEqual([]);
  });
});
