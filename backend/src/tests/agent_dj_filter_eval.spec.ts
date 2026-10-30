import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  DECLARED_SPARSITY,
  EVAL_CATALOG,
  EVAL_FAMILIES,
  OBSERVED_CATALOG,
  observedSparsity,
  truthByKey,
  type EvalEnergy,
  type TrackTruth,
} from "./dj_filter_eval/catalog";
import { EVAL_CASES, profileFor } from "./dj_filter_eval/cases";
import { attainableCount, familiesForGenreName, gradePick, type Intent } from "./dj_filter_eval/grader";
import {
  baselineFromResults,
  buildReport,
  compareToBaseline,
  EVAL_VARIANTS,
  listenerPreferences,
  reportMarkdown,
  runAllCases,
  runCase,
  writeFilterReport,
  type BaselineFile,
  type CaseRunResult,
} from "./dj_filter_eval/harness";

const BASELINE_PATH = resolve(__dirname, "dj_filter_eval/baseline.json");
const GRADER_PATH = resolve(__dirname, "dj_filter_eval/grader.ts");

/** The band a measured energy composite reads as (0.65 * rms/0.3 + 0.35 * onsets/8; high >= 0.67, medium >= 0.38). */
function bandOf(energyRms: number, onsetDensity: number): EvalEnergy {
  const composite = 0.65 * Math.min(1, energyRms / 0.3) + 0.35 * Math.min(1, onsetDensity / 8);
  return composite >= 0.67 ? "high" : composite >= 0.38 ? "medium" : "low";
}

const truth = (overrides: Partial<TrackTruth> = {}): TrackTruth => ({
  artist: "Someone",
  family: "hiphop",
  energy: "high",
  bpm: 140,
  fits: ["Hype"],
  explicit: false,
  ...overrides,
});

describe("AI DJ filter-adherence eval: catalog", () => {
  it("holds about ten hand-labelled tracks per family, newest first and interleaved", () => {
    expect(EVAL_CATALOG.length).toBeGreaterThanOrEqual(110);
    expect(EVAL_CATALOG.length).toBeLessThanOrEqual(130);
    expect(new Set(EVAL_CATALOG.map((track) => track.observed.key)).size).toBe(EVAL_CATALOG.length);
    for (const family of EVAL_FAMILIES) {
      const count = EVAL_CATALOG.filter((track) => track.truth.family === family).length;
      expect({ family, ok: count >= 8 && count <= 12 }).toEqual({ family, ok: true });
    }
    expect(EVAL_CATALOG.filter((track) => track.truth.family === ("country" as never))).toHaveLength(0);
    // Not grouped: the newest twelve already span most families.
    expect(new Set(EVAL_CATALOG.slice(0, 12).map((track) => track.truth.family)).size).toBeGreaterThanOrEqual(10);
    expect(OBSERVED_CATALOG.map((track) => track.key)).toEqual(EVAL_CATALOG.map((track) => track.observed.key));
  });

  it("keeps the two layers consistent: same artist, truthful mood tags, measured features that read as the truth", () => {
    for (const { observed, truth: label } of EVAL_CATALOG) {
      expect({ key: observed.key, artist: observed.artist === label.artist }).toEqual({ key: observed.key, artist: true });
      expect({ key: observed.key, explicit: Boolean(observed.explicit) === label.explicit }).toEqual({
        key: observed.key,
        explicit: true,
      });
      for (const mood of observed.moods ?? []) {
        expect({ key: observed.key, mood, fits: label.fits.includes(mood as never) }).toEqual({
          key: observed.key,
          mood,
          fits: true,
        });
      }
      if (observed.measured) {
        expect({ key: observed.key, band: bandOf(observed.measured.energyRms, observed.measured.onsetDensity) }).toEqual({
          key: observed.key,
          band: label.energy,
        });
        expect(observed.measured.tempoBpm).toBe(label.bpm);
      }
    }
    expect(truthByKey.size).toBe(EVAL_CATALOG.length);
  });

  it("honours the declared sparsity ratios", () => {
    const actual = observedSparsity();
    const { tolerance, ...declared } = DECLARED_SPARSITY;
    for (const [name, wanted] of Object.entries(declared)) {
      const got = actual[name as keyof typeof actual];
      expect({ name, got, ok: Math.abs(got - wanted) <= tolerance }).toEqual({ name, got, ok: true });
    }
  });

  it("has artists with three or more tracks, and about half of the hip-hop explicit", () => {
    const counts = new Map<string, number>();
    for (const track of EVAL_CATALOG) counts.set(track.truth.artist, (counts.get(track.truth.artist) ?? 0) + 1);
    expect([...counts.values()].filter((count) => count >= 3).length).toBeGreaterThanOrEqual(6);
    const hiphop = EVAL_CATALOG.filter((track) => track.truth.family === "hiphop");
    const explicitShare = hiphop.filter((track) => track.truth.explicit).length / hiphop.length;
    expect(explicitShare).toBeGreaterThanOrEqual(0.4);
    expect(explicitShare).toBeLessThanOrEqual(0.7);
    expect(EVAL_CATALOG.filter((track) => track.truth.explicit && track.truth.family !== "hiphop").length).toBeGreaterThanOrEqual(2);
  });
});

describe("AI DJ filter-adherence eval: cases", () => {
  it("has stable unique ids and a hand-written intent consistent with each request", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(120);
    expect(new Set(EVAL_CASES.map((item) => item.id)).size).toBe(EVAL_CASES.length);
    for (const item of EVAL_CASES) {
      expect({ id: item.id, explicit: item.intent.explicitAllowed }).toEqual({
        id: item.id,
        explicit: item.request.allowExplicit ?? false,
      });
    }
    const groups = new Set(EVAL_CASES.map((item) => item.group));
    expect([...groups].sort()).toEqual(["artist", "combo", "discovery", "moments", "single", "sounds", "typed", "unmet"]);
  });

  it("states each Sounds starter's intent as the families its genres name", () => {
    for (const item of EVAL_CASES.filter((candidate) => candidate.group === "sounds")) {
      if (item.request.kind !== "structured") throw new Error("Sounds starters are structured");
      const families = new Set((item.request.genres ?? []).flatMap((genre) => familiesForGenreName(genre)));
      expect({ id: item.id, families: [...families].sort() }).toEqual({ id: item.id, families: [...(item.intent.families ?? [])].sort() });
    }
  });

  it("gives a conflicting listener saved taste that differs from what the request asks for", async () => {
    const zen = EVAL_CASES.find((item) => item.id === "moment-zen@conflicting");
    if (!zen) throw new Error("missing case");
    const start = await listenerPreferences(zen.request, profileFor(zen), "start");
    // The Zen starter names no genre, yet the saved vibes and learned rap are what the selector searches.
    expect(start.genres).toEqual(["Hip-Hop", "Rap", "Pop", "World"]);
    expect(start.sessionGenres).toBeUndefined();
    expect(start.mood).toBe("Zen");
    expect(start.energy).toBe("low");
    const next = await listenerPreferences(zen.request, profileFor(zen), "next");
    expect(next.genres).toEqual(["Hip-Hop", "Rap", "Pop", "World"]);
    expect(next.sessionGenres).toBeUndefined();
  });
});

describe("AI DJ filter-adherence eval: grader", () => {
  const zen: Intent = { moment: "Zen", energy: "low", explicitAllowed: false };

  it("grades Zen against high-energy rap as a contradiction", () => {
    const grade = gradePick(zen, truth({ family: "hiphop", energy: "high", fits: ["Hype", "Dark"] }));
    expect(grade.verdict).toBe("contradiction");
    expect(grade.reasons.join(" ")).toContain("Zen");
  });

  it("grades low-energy ambient as on-request for Zen", () => {
    expect(gradePick(zen, truth({ family: "ambient", energy: "low", bpm: 60, fits: ["Zen", "Focus"] })).verdict).toBe("on");
  });

  it("allows a BPM tolerance of 3, mismatches up to 15 and contradicts beyond", () => {
    const intent: Intent = { bpm: { min: 120, max: 128 }, explicitAllowed: false };
    expect(gradePick(intent, truth({ bpm: 131 })).verdict).toBe("on");
    expect(gradePick(intent, truth({ bpm: 117 })).verdict).toBe("on");
    expect(gradePick(intent, truth({ bpm: 140 })).verdict).toBe("partial");
    expect(gradePick(intent, truth({ bpm: 148 })).verdict).toBe("contradiction");
  });

  it("contradicts an explicit track when explicit is off", () => {
    expect(gradePick({ explicitAllowed: false }, truth({ explicit: true })).verdict).toBe("contradiction");
    expect(gradePick({ explicitAllowed: true }, truth({ explicit: true })).verdict).toBe("on");
  });

  it("treats an adjacent energy band as partial and the opposite band as a contradiction", () => {
    const intent: Intent = { energy: "low", explicitAllowed: false };
    expect(gradePick(intent, truth({ energy: "low" })).verdict).toBe("on");
    expect(gradePick(intent, truth({ energy: "medium" })).verdict).toBe("partial");
    expect(gradePick(intent, truth({ energy: "high" })).verdict).toBe("contradiction");
  });

  it("grades a genre against the requested families, and a moment that does not fit as partial", () => {
    const intent: Intent = { families: ["jazz"], moment: "Late Night", explicitAllowed: false };
    expect(gradePick(intent, truth({ family: "jazz", energy: "low", fits: ["Late Night"] })).verdict).toBe("on");
    expect(gradePick(intent, truth({ family: "jazz", energy: "medium", fits: ["Warm"] })).verdict).toBe("partial");
    expect(gradePick(intent, truth({ family: "rock", energy: "low", fits: ["Late Night"] })).verdict).toBe("contradiction");
  });

  it("accepts a hybrid genre for any family it belongs to (#2453)", () => {
    const intent = { families: ["pop" as const], explicitAllowed: false };
    expect(gradePick(intent, truth({ family: "latin", alsoFamilies: ["pop"] })).verdict).not.toBe("contradiction");
    expect(gradePick(intent, truth({ family: "latin" })).verdict).toBe("contradiction");
  });

  it("accepts the named artist or one listed as similar, and nobody else", () => {
    const intent: Intent = { artist: "Tavi Lindqvist", explicitAllowed: false };
    expect(gradePick(intent, truth({ artist: "tavi lindqvist" })).verdict).toBe("on");
    expect(gradePick(intent, truth({ artist: "Nilo Brecken", similarArtists: ["Tavi Lindqvist"] })).verdict).toBe("on");
    expect(gradePick(intent, truth({ artist: "Mara Quillfeather" })).verdict).toBe("contradiction");
  });

  it("counts what the catalog holds on-request", () => {
    expect(attainableCount({ families: ["classical"], explicitAllowed: false }, EVAL_CATALOG)).toBe(
      EVAL_CATALOG.filter((track) => track.truth.family === "classical").length,
    );
    expect(attainableCount({ families: ["country"], explicitAllowed: false }, EVAL_CATALOG)).toBe(0);
  });

  it("is independent of the system under test: it imports nothing but ./catalog", () => {
    const source = readFileSync(GRADER_PATH, "utf8");
    const specifiers = [...source.matchAll(/(?:from|import\()\s*["']([^"']+)["']/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((specifier) => specifier !== "./catalog")).toEqual([]);
    expect(source).not.toMatch(/require\(/);
  });
});

describe("AI DJ filter-adherence eval: deterministic selection", () => {
  jest.setTimeout(600_000);
  let results: CaseRunResult[] = [];

  beforeAll(async () => {
    results = await runAllCases();
  });

  it("runs every case under both retrieval variants, two batches each", () => {
    expect(EVAL_VARIANTS).toHaveLength(2);
    expect(results).toHaveLength(EVAL_CASES.length * EVAL_VARIANTS.length);
    expect(new Set(results.map((result) => result.variant)).size).toBe(2);
    for (const result of results) {
      expect(result.batches.map((batch) => batch.batch)).toEqual([1, 2]);
    }
    // Batch 2 never repeats a batch 1 track.
    for (const result of results) {
      const first = new Set(result.batches[0].played.map((pick) => pick.key));
      expect(result.batches[1].played.filter((pick) => first.has(pick.key))).toEqual([]);
    }
  });

  it("is deterministic: a sample of cases run twice gives the same picks and numbers", async () => {
    const sample = EVAL_CASES.filter((_, index) => index % 11 === 0);
    for (const variant of EVAL_VARIANTS) {
      for (const item of sample) {
        expect(await runCase(item, variant)).toEqual(await runCase(item, variant));
      }
    }
  });

  it("writes the report and prints the summary", () => {
    const report = buildReport(results);
    const { jsonPath, markdownPath } = writeFilterReport(report);
    // eslint-disable-next-line no-console
    console.log(reportMarkdown(report));
    expect(report.schemaVersion).toBe("dj-filter-adherence/v1");
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(markdownPath)).toBe(true);
    expect(Object.keys(report.summary.byGroup).sort()).toEqual(
      ["artist", "combo", "discovery", "moments", "single", "sounds", "typed", "unmet"],
    );
    expect(Object.keys(report.summary.byBatch)).toEqual(["batch 1", "batch 2"]);
  });

  it("does not get worse than the pinned baseline for any case, variant and batch", () => {
    if (process.env.UPDATE_DJ_FILTER_BASELINE === "1") {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(baselineFromResults(results), null, 2)}\n`);
      return;
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as BaselineFile;
    const { regressions, missing, improved } = compareToBaseline(results, baseline);
    if (improved > 0) {
      // eslint-disable-next-line no-console
      console.log(`${improved} batches improved on the baseline: regenerate it with UPDATE_DJ_FILTER_BASELINE=1.`);
    }
    expect({ missing }).toEqual({ missing: [] });
    expect({ regressions }).toEqual({ regressions: [] });
  });
});
