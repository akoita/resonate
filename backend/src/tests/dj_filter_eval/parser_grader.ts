/**
 * Grades what the AI DJ's session parser read against what the listener meant
 * (stage A of the filter-adherence eval). Pure and independent: it imports
 * nothing from `src/modules`, so it cannot share a bug with the parser. The
 * guard in `agent_dj_filter_eval_parser.spec.ts` enforces that.
 *
 * Per dimension (genres, moods, energy, bpm, artists) it counts what the parse
 * got right, what it missed and what it added that was not asked for.
 */

export type GradedEnergy = "low" | "medium" | "high" | null;
export type GradedTempo = { min: number | null; max: number | null } | null;

export interface GradedRequest {
  genres: readonly string[];
  moods: readonly string[];
  energy: GradedEnergy;
  bpm: GradedTempo;
  artists?: readonly string[];
}

export const DIMENSIONS = ["genres", "moods", "energy", "bpm", "artists"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** BPM either side of an expected bound that still counts as the same tempo. */
export const BPM_TOLERANCE = 3;

export interface DimensionGrade {
  correct: string[];
  missing: string[];
  spurious: string[];
}

export type CaseVerdict = "exact" | "partial" | "miss" | "clean" | "spurious";

export interface CaseGrade {
  verdict: CaseVerdict;
  dimensions: Record<Dimension, DimensionGrade>;
  correct: number;
  missing: number;
  spurious: number;
}

function gradeSet(expected: readonly string[], got: readonly string[]): DimensionGrade {
  const want = new Map(expected.map((value) => [value.trim().toLowerCase(), value]));
  const have = new Map(got.map((value) => [value.trim().toLowerCase(), value]));
  const grade: DimensionGrade = { correct: [], missing: [], spurious: [] };
  for (const [key, value] of want) (have.has(key) ? grade.correct : grade.missing).push(value);
  for (const [key, value] of have) if (!want.has(key)) grade.spurious.push(value);
  return grade;
}

function gradeEnergy(expected: GradedEnergy, got: GradedEnergy): DimensionGrade {
  const grade: DimensionGrade = { correct: [], missing: [], spurious: [] };
  if (expected === got) {
    if (expected !== null) grade.correct.push(expected);
    return grade;
  }
  if (expected !== null) grade.missing.push(expected);
  if (got !== null) grade.spurious.push(got);
  return grade;
}

function isOpen(range: GradedTempo): boolean {
  return !range || (range.min === null && range.max === null);
}

function describeTempo(range: GradedTempo): string {
  if (isOpen(range) || !range) return "none";
  return `${range.min ?? ""}-${range.max ?? ""}`;
}

function boundMatches(expected: number | null, got: number | null): boolean {
  if (expected === null) return got === null;
  return got !== null && Math.abs(got - expected) <= BPM_TOLERANCE;
}

function gradeTempo(expected: GradedTempo, got: GradedTempo): DimensionGrade {
  const grade: DimensionGrade = { correct: [], missing: [], spurious: [] };
  if (isOpen(expected) && isOpen(got)) return grade;
  if (isOpen(expected)) {
    grade.spurious.push(describeTempo(got));
    return grade;
  }
  if (isOpen(got)) {
    grade.missing.push(describeTempo(expected));
    return grade;
  }
  if (boundMatches(expected!.min, got!.min) && boundMatches(expected!.max, got!.max)) {
    grade.correct.push(describeTempo(expected));
  } else {
    grade.missing.push(describeTempo(expected));
    grade.spurious.push(describeTempo(got));
  }
  return grade;
}

/** Grades one parse. A case that expects nothing is `clean` or `spurious`. */
export function gradeParse(expected: GradedRequest, got: GradedRequest): CaseGrade {
  const dimensions: Record<Dimension, DimensionGrade> = {
    genres: gradeSet(expected.genres, got.genres),
    moods: gradeSet(expected.moods, got.moods),
    energy: gradeEnergy(expected.energy, got.energy),
    bpm: gradeTempo(expected.bpm, got.bpm),
    artists: gradeSet(expected.artists ?? [], got.artists ?? []),
  };
  let correct = 0;
  let missing = 0;
  let spurious = 0;
  for (const dimension of DIMENSIONS) {
    correct += dimensions[dimension].correct.length;
    missing += dimensions[dimension].missing.length;
    spurious += dimensions[dimension].spurious.length;
  }
  const expectsNothing = correct + missing === 0;
  let verdict: CaseVerdict;
  if (expectsNothing) verdict = spurious === 0 ? "clean" : "spurious";
  else if (missing === 0 && spurious === 0) verdict = "exact";
  else if (correct > 0) verdict = "partial";
  else verdict = "miss";
  return { verdict, dimensions, correct, missing, spurious };
}

export function isPerfect(verdict: CaseVerdict): boolean {
  return verdict === "exact" || verdict === "clean";
}

const VERDICT_RANK: Record<CaseVerdict, number> = { exact: 3, clean: 3, partial: 2, spurious: 1, miss: 1 };

/** True when `now` is a worse outcome than `before` (a lower verdict, or more missing or spurious). */
export function isWorse(
  before: { verdict: CaseVerdict; missing: number; spurious: number },
  now: { verdict: CaseVerdict; missing: number; spurious: number },
): boolean {
  return (
    VERDICT_RANK[now.verdict] < VERDICT_RANK[before.verdict] ||
    now.missing > before.missing ||
    now.spurious > before.spurious
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface GradedCaseResult {
  id: string;
  group: string;
  text: string;
  expected: GradedRequest;
  got: GradedRequest;
  grade: CaseGrade;
}

export interface Rate {
  perfect: number;
  total: number;
  rate: number;
}

export interface DimensionScore {
  correct: number;
  missing: number;
  spurious: number;
  precision: number | null;
  recall: number | null;
}

export interface ParserAdherenceReport {
  schemaVersion: "dj-parser-adherence/v1";
  overall: Rate;
  byGroup: Record<string, Rate>;
  byDimension: Record<Dimension, DimensionScore>;
  nonExact: Array<{
    id: string;
    group: string;
    text: string;
    verdict: CaseVerdict;
    expected: GradedRequest;
    got: GradedRequest;
  }>;
  cases: Array<{ id: string; group: string; verdict: CaseVerdict; missing: number; spurious: number }>;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 1000;
}

function rateOf(results: readonly GradedCaseResult[]): Rate {
  const perfect = results.filter((result) => isPerfect(result.grade.verdict)).length;
  return { perfect, total: results.length, rate: ratio(perfect, results.length) ?? 0 };
}

export function buildParserReport(results: readonly GradedCaseResult[]): ParserAdherenceReport {
  const groups = [...new Set(results.map((result) => result.group))];
  const byDimension = {} as Record<Dimension, DimensionScore>;
  for (const dimension of DIMENSIONS) {
    let correct = 0;
    let missing = 0;
    let spurious = 0;
    for (const result of results) {
      correct += result.grade.dimensions[dimension].correct.length;
      missing += result.grade.dimensions[dimension].missing.length;
      spurious += result.grade.dimensions[dimension].spurious.length;
    }
    byDimension[dimension] = {
      correct,
      missing,
      spurious,
      precision: ratio(correct, correct + spurious),
      recall: ratio(correct, correct + missing),
    };
  }
  return {
    schemaVersion: "dj-parser-adherence/v1",
    overall: rateOf(results),
    byGroup: Object.fromEntries(groups.map((group) => [group, rateOf(results.filter((r) => r.group === group))])),
    byDimension,
    nonExact: results
      .filter((result) => !isPerfect(result.grade.verdict))
      .map((result) => ({
        id: result.id,
        group: result.group,
        text: result.text,
        verdict: result.grade.verdict,
        expected: result.expected,
        got: result.got,
      })),
    cases: results.map((result) => ({
      id: result.id,
      group: result.group,
      verdict: result.grade.verdict,
      missing: result.grade.missing,
      spurious: result.grade.spurious,
    })),
  };
}

function summarize(request: GradedRequest): string {
  const parts: string[] = [];
  if (request.genres.length) parts.push(`genres=[${request.genres.join(", ")}]`);
  if (request.moods.length) parts.push(`moods=[${request.moods.join(", ")}]`);
  if (request.energy) parts.push(`energy=${request.energy}`);
  if (!isOpen(request.bpm)) parts.push(`bpm=${describeTempo(request.bpm)}`);
  if (request.artists?.length) parts.push(`artists=[${request.artists.join(", ")}]`);
  return parts.length ? parts.join(" ") : "(nothing)";
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function parserReportMarkdown(report: ParserAdherenceReport): string {
  const lines: string[] = [
    "# AI DJ parser adherence (stage A)",
    "",
    `Exact-parse rate: ${report.overall.perfect}/${report.overall.total} (${percent(report.overall.rate)})`,
    "",
    "## By group",
    "",
    "| Group | Exact | Total | Rate |",
    "| --- | ---: | ---: | ---: |",
    ...Object.entries(report.byGroup).map(
      ([group, rate]) => `| ${group} | ${rate.perfect} | ${rate.total} | ${percent(rate.rate)} |`,
    ),
    "",
    "## By dimension",
    "",
    "| Dimension | Correct | Missing | Spurious | Precision | Recall |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...DIMENSIONS.map((dimension) => {
      const score = report.byDimension[dimension];
      return `| ${dimension} | ${score.correct} | ${score.missing} | ${score.spurious} | ${percent(score.precision)} | ${percent(score.recall)} |`;
    }),
    "",
    `## Not exact (${report.nonExact.length})`,
    "",
  ];
  if (report.nonExact.length === 0) lines.push("None.");
  for (const entry of report.nonExact) {
    lines.push(
      `- \`${entry.id}\` [${entry.verdict}] "${entry.text}"`,
      `  - expected: ${summarize(entry.expected)}`,
      `  - got: ${summarize(entry.got)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
