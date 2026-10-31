/**
 * Build-ups (#1908, remix-structure/v2): schema + timeline math against the
 * committed parity fixture `remix-structure-v2.parity.json` (the web preview
 * is tested against the same file), the ffmpeg stage's graph, and — when
 * ffmpeg is installed — the MEASURED parity of the stepped ffmpeg sweep
 * against a per-sample model of the preview's WebAudio graph (a
 * BiquadFilterNode highpass whose frequency ramps exponentially, a dry gain
 * and a linearly ramped wet gain).
 */

import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { SectionGrid } from "../modules/remix/remix-arrangement";
import {
  BUILDUP_EDGE_GRID_PER_SECOND,
  BUILDUP_END_HZ,
  BUILDUP_FILTER_Q,
  BUILDUP_START_GAIN,
  BUILDUP_START_HZ,
  BUILDUP_SWEEP_STEPS,
  buildUpCutoffHzAt,
  buildUpGainAt,
  buildUpOutputRamps,
  buildUpRamps,
  buildUpSweepSteps,
  MAX_BUILDUP_BLOCKS,
  normalizeRemixStructureInput,
  readStoredRemixStructure,
  REMIX_STRUCTURE_BUILDUP_DSP_VERSION,
  REMIX_STRUCTURE_DSP_VERSION,
  REMIX_STRUCTURE_SCHEMA_VERSION,
  REMIX_STRUCTURE_SCHEMA_VERSION_V1,
  remixStructureDspVersion,
  structureTimeline,
  TOO_MANY_BUILDUPS_ERROR,
  type RemixBuildUpRamp,
  type RemixStructureBlock,
} from "../modules/remix/remix-structure";
import {
  BUILDUP_STAGE_FRAME_SAMPLES,
  buildBuildUpStageGraph,
  buildStemMixFfmpegArgs,
} from "../modules/remix/stem-audio-mixer";

type Fixture = {
  schemaVersion: string;
  dspVersion: string;
  constants: {
    startHz: number;
    endHz: number;
    startGain: number;
    filterQ: number;
    sweepSteps: number;
    edgeGridPerSecond: number;
    maxBuildUps: number;
    stageFrameSamples: number;
  };
  grid: SectionGrid;
  timelines: Array<{
    name: string;
    blocks: RemixStructureBlock[];
    segments: unknown[];
    buildUps: RemixBuildUpRamp[];
    output: Array<{ speed: number; ramps: RemixBuildUpRamp[] }>;
  }>;
  sweep: {
    ramp: RemixBuildUpRamp;
    steps: Array<{ atSec: number; hz: number }>;
  };
  samples: Array<{ atSec: number; cutoffHz: number; gain: number }>;
  normalize: Array<{ input: unknown; output: unknown }>;
  parity: {
    windowSeconds: number;
    toleranceMaxWindowDb: number;
    toleranceMaxDropWindowDb: number;
    toleranceMeanWindowDb: number;
    measured: Array<{ case: string } & BuildUpParityMeasurement>;
  };
};

const fixture: Fixture = JSON.parse(
  readFileSync(
    join(__dirname, "../modules/remix/remix-structure-v2.parity.json"),
    "utf8",
  ),
);

const TOLERANCE = 1e-9;

/** Same keys, numbers within 1e-9, everything else strictly equal. */
function expectParity(actual: unknown, expected: unknown) {
  if (typeof expected === "number") {
    expect(typeof actual).toBe("number");
    expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(
      TOLERANCE,
    );
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect((actual as unknown[]).length).toBe(expected.length);
    expected.forEach((item, index) =>
      expectParity((actual as unknown[])[index], item),
    );
    return;
  }
  if (expected !== null && typeof expected === "object") {
    expect(actual).not.toBeNull();
    expect(Object.keys(actual as object).sort()).toEqual(
      Object.keys(expected).sort(),
    );
    for (const [key, value] of Object.entries(expected)) {
      expectParity((actual as Record<string, unknown>)[key], value);
    }
    return;
  }
  expect(actual).toBe(expected);
}

describe("remix-structure/v2 build-up parity fixture (#1908)", () => {
  it("pins the schema, DSP version and constants", () => {
    expect(fixture.schemaVersion).toBe(REMIX_STRUCTURE_SCHEMA_VERSION);
    expect(fixture.dspVersion).toBe(REMIX_STRUCTURE_BUILDUP_DSP_VERSION);
    expect(fixture.constants).toEqual({
      startHz: BUILDUP_START_HZ,
      endHz: BUILDUP_END_HZ,
      startGain: BUILDUP_START_GAIN,
      filterQ: BUILDUP_FILTER_Q,
      sweepSteps: BUILDUP_SWEEP_STEPS,
      edgeGridPerSecond: BUILDUP_EDGE_GRID_PER_SECOND,
      maxBuildUps: MAX_BUILDUP_BLOCKS,
      stageFrameSamples: BUILDUP_STAGE_FRAME_SAMPLES,
    });
  });

  it.each(fixture.timelines)(
    "timeline $name",
    ({ blocks, segments, buildUps, output }) => {
      const actual = structureTimeline(fixture.grid, blocks);
      expectParity(actual, segments);
      expectParity(buildUpRamps(actual), buildUps);
      for (const { speed, ramps } of output) {
        expectParity(buildUpOutputRamps(buildUpRamps(actual), speed), ramps);
      }
    },
  );

  it("pins the render's stepped sweep", () => {
    expectParity(buildUpSweepSteps(fixture.sweep.ramp), fixture.sweep.steps);
  });

  it.each(fixture.samples)(
    "cutoff + gain at $atSec s",
    ({ atSec, cutoffHz, gain }) => {
      const ramp = fixture.sweep.ramp;
      expectParity(buildUpCutoffHzAt(ramp, atSec), cutoffHz);
      expectParity(buildUpGainAt(ramp, atSec), gain);
    },
  );

  it.each(fixture.normalize.map((entry, index) => ({ ...entry, index })))(
    "normalize case $index",
    ({ input, output }) => {
      const result = normalizeRemixStructureInput(
        input,
        fixture.grid.sections.length,
      );
      if (output === "error") {
        expect("error" in result).toBe(true);
      } else {
        expect(result).toEqual({ value: output });
      }
    },
  );
});

describe("remix-structure/v2 schema (#1908)", () => {
  const count = fixture.grid.sections.length;

  it("keeps a structure without build-ups on v1, byte-identical", () => {
    const input = {
      schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION_V1,
      blocks: [{ section: 1 }, { section: 1, fadeOut: true }],
    };
    expect(normalizeRemixStructureInput(input, count)).toEqual({
      value: input,
    });
    // A v2-labelled payload without build-ups also stores as v1.
    expect(
      normalizeRemixStructureInput(
        { ...input, schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION },
        count,
      ),
    ).toEqual({ value: input });
  });

  it("stores v2 exactly when a block builds up; false is omitted", () => {
    expect(
      normalizeRemixStructureInput(
        {
          schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION_V1,
          blocks: [{ section: 0, buildUp: true }, { section: 1, buildUp: false }],
        },
        count,
      ),
    ).toEqual({
      value: {
        schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION,
        blocks: [{ section: 0, buildUp: true }, { section: 1 }],
      },
    });
  });

  it("an identity order with a build-up is not identity", () => {
    const blocks = fixture.grid.sections.map((_, section) => ({ section }));
    blocks[2] = { ...blocks[2], buildUp: true } as RemixStructureBlock;
    const result = normalizeRemixStructureInput({ blocks }, count);
    expect("value" in result && result.value?.blocks[2]).toEqual({
      section: 2,
      buildUp: true,
    });
  });

  it("rejects a non-boolean buildUp, an unknown version and too many build-ups", () => {
    expect(
      normalizeRemixStructureInput(
        { blocks: [{ section: 0, buildUp: "yes" }] },
        count,
      ),
    ).toEqual({ error: "structure.blocks[].buildUp must be a boolean" });
    expect(
      "error" in
        normalizeRemixStructureInput(
          { schemaVersion: "remix-structure/v3", blocks: [{ section: 0 }] },
          count,
        ),
    ).toBe(true);
    const many = Array.from({ length: MAX_BUILDUP_BLOCKS + 1 }, () => ({
      section: 0,
      buildUp: true,
    }));
    expect(normalizeRemixStructureInput({ blocks: many }, count)).toEqual({
      error: TOO_MANY_BUILDUPS_ERROR,
    });
  });

  it("reads stored v1 and v2 rows", () => {
    expect(
      readStoredRemixStructure(
        { schemaVersion: "remix-structure/v1", blocks: [{ section: 1 }] },
        count,
      ),
    ).toEqual({ schemaVersion: "remix-structure/v1", blocks: [{ section: 1 }] });
    expect(
      readStoredRemixStructure(
        {
          schemaVersion: "remix-structure/v2",
          blocks: [{ section: 1, buildUp: true }],
        },
        count,
      ),
    ).toEqual({
      schemaVersion: "remix-structure/v2",
      blocks: [{ section: 1, buildUp: true }],
    });
  });

  it("records the build-up DSP version only when a block builds up", () => {
    expect(remixStructureDspVersion(null)).toBe(REMIX_STRUCTURE_DSP_VERSION);
    expect(remixStructureDspVersion({ blocks: [{ section: 0 }] })).toBe(
      REMIX_STRUCTURE_DSP_VERSION,
    );
    expect(
      remixStructureDspVersion({ blocks: [{ section: 0, buildUp: true }] }),
    ).toBe(REMIX_STRUCTURE_BUILDUP_DSP_VERSION);
  });
});

describe("build-up ffmpeg stage (#1908)", () => {
  const input = [{ path: "/tmp/a.audio", gainDb: 0, fxStemId: "a" }];
  const filterOf = (args: string[]) =>
    args[args.indexOf("-filter_complex") + 1];

  it("leaves a structure without build-ups unchanged", () => {
    const filter = filterOf(
      buildStemMixFfmpegArgs(input, "/tmp/mix.mp3", null, {
        segments: structureTimeline(fixture.grid, [
          { section: 1 },
          { section: 2, fadeOut: true },
        ]),
      }),
    );
    expect(filter).not.toContain("highpass@bu");
    expect(filter).not.toContain("asetnsamples");
  });

  it("runs the stage after the master fades, before loudness, in output time", () => {
    const segments = structureTimeline(fixture.grid, [
      { section: 1, fadeIn: true },
      { section: 2, buildUp: true },
      { section: 3 },
    ]);
    const filter = filterOf(
      buildStemMixFfmpegArgs(
        input,
        "/tmp/mix.mp3",
        {
          effects: { schemaVersion: "remix-fx/v1", master: { speed: 1.25 } },
        },
        { segments },
      ),
    );
    const fades = filter.indexOf("volume=volume=if(between(t");
    const stage = filter.indexOf("asetnsamples=n=48:p=0,asplit=2[bud][buw]");
    const loudness = filter.indexOf("loudnorm=");
    expect(fades).toBeGreaterThan(-1);
    expect(stage).toBeGreaterThan(fades);
    expect(loudness).toBeGreaterThan(stage);
    // Block 2 spans timeline 16..32 s → output 12.8..25.6 s at speed 1.25.
    expect(filter).toContain("gte(t\\,12.8)*lt(t\\,25.6)");
    expect(filter).toContain("12.8 highpass@bu f ");
    expect(filter).toContain("25.6 highpass@bu f 30");
    expect(filter).toContain(
      "highpass@bu=f=30:width_type=q:width=0.707107:transform=di",
    );
  });

  it("skips the reset between adjacent build-ups", () => {
    const ramps: RemixBuildUpRamp[] = [
      { startSec: 1, endSec: 2, fromHz: 30, toHz: 1500, fromGain: 0.5, toGain: 1 },
      { startSec: 2, endSec: 3, fromHz: 30, toHz: 1500, fromGain: 0.5, toGain: 1 },
    ];
    const graph = buildBuildUpStageGraph(ramps, "[in]", [], "[out]").join(";");
    expect(graph).not.toContain("2 highpass@bu f 30\\;");
    expect(graph).toContain("3 highpass@bu f 30'");
    expect(graph.match(/highpass@bu f /g)).toHaveLength(
      2 * BUILDUP_SWEEP_STEPS + 1,
    );
  });
});

// --- Measured parity (ffmpeg) -----------------------------------------------

const SAMPLE_RATE = 48_000;

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Deterministic pink-ish noise (LCG + Paul Kellet's economy filter). */
function pinkNoise(seconds: number, seed: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  let state = seed;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let index = 0; index < out.length; index += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const white = state / 0x7fffffff - 0.5;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    out[index] = (b0 + b1 + b2 + white * 0.1848) * 0.25;
  }
  return out;
}

/**
 * The preview's build-up graph, per sample (WebAudio semantics): one RBJ
 * highpass (direct form I, coefficients from the a-rate frequency at every
 * sample) whose frequency is fromHz outside build-ups and
 * fromHz·(toHz/fromHz)^u inside; output = dry·x + wet·hp(x) with dry 1 / wet
 * 0 outside and dry 0 / wet linear inside.
 */
function webAudioReference(
  input: Float32Array,
  ramps: RemixBuildUpRamp[],
): Float64Array {
  const out = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  let cursor = 0;
  for (let index = 0; index < input.length; index += 1) {
    const t = index / SAMPLE_RATE;
    while (cursor < ramps.length && t >= ramps[cursor].endSec) cursor += 1;
    const ramp =
      cursor < ramps.length && t >= ramps[cursor].startSec
        ? ramps[cursor]
        : null;
    const hz = ramp ? buildUpCutoffHzAt(ramp, t) : BUILDUP_START_HZ;
    const w0 = (2 * Math.PI * hz) / SAMPLE_RATE;
    const alpha = Math.sin(w0) / (2 * BUILDUP_FILTER_Q);
    const cos = Math.cos(w0);
    const a0 = 1 + alpha;
    const x = input[index];
    const y =
      (((1 + cos) / 2) * x - (1 + cos) * x1 + ((1 + cos) / 2) * x2 -
        -2 * cos * y1 -
        (1 - alpha) * y2) /
      a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[index] = ramp ? y * buildUpGainAt(ramp, t) : x;
  }
  return out;
}

type BuildUpParityMeasurement = {
  /** Max |RMS dB difference| over windows that contain no drop. */
  maxWindowDb: number;
  /** Max over the windows containing a drop (the high-pass jumps back). */
  maxDropWindowDb: number;
  /** Mean over every window. */
  meanWindowDb: number;
};

/**
 * |RMS dB difference| per window. A "drop window" contains a build-up end
 * (or directly follows one):
 * the cutoff jumps from ~1.5 kHz back to 30 Hz there and the filter's
 * transient is most sensitive to the stepped vs continuous sweep.
 */
function windowedLevelError(
  actual: Float32Array,
  reference: Float64Array,
  windowSeconds: number,
  drops: number[],
): BuildUpParityMeasurement {
  const window = Math.round(windowSeconds * SAMPLE_RATE);
  const length = Math.min(actual.length, reference.length);
  let max = 0;
  let maxDrop = 0;
  let sum = 0;
  let count = 0;
  for (let start = 0; start + window <= length; start += window) {
    let a = 0;
    let r = 0;
    for (let index = start; index < start + window; index += 1) {
      a += actual[index] * actual[index];
      r += reference[index] * reference[index];
    }
    const db = Math.abs(10 * Math.log10(a / r));
    const from = start / SAMPLE_RATE;
    const to = (start + window) / SAMPLE_RATE;
    // The drop transient rings into the following window too.
    if (drops.some((drop) => drop >= from - windowSeconds && drop < to)) {
      maxDrop = Math.max(maxDrop, db);
    } else {
      max = Math.max(max, db);
    }
    sum += db;
    count += 1;
  }
  return {
    maxWindowDb: max,
    maxDropWindowDb: maxDrop,
    meanWindowDb: sum / count,
  };
}

/** The parity cases: timeline grid of 2 s sections, build-ups 0, 2 and 3. */
const PARITY_GRID: SectionGrid = {
  kind: "time",
  sectionSeconds: 2,
  bpm: null,
  durationSeconds: 8,
  sections: [
    { startSec: 0, endSec: 2 },
    { startSec: 2, endSec: 4 },
    { startSec: 4, endSec: 6 },
    { startSec: 6, endSec: 8 },
  ],
};
const PARITY_BLOCKS: RemixStructureBlock[] = [
  { section: 0 },
  { section: 1, buildUp: true },
  { section: 2 },
  { section: 3, buildUp: true },
  { section: 0, buildUp: true },
  { section: 1 },
];
const PARITY_CASES = [
  { case: "speed 1 (adjacent build-ups)", speed: 1 },
  { case: "speed 1.17 (edges off the 1 ms grid)", speed: 1.17 },
];

(ffmpegAvailable ? describe : describe.skip)(
  "ffmpeg build-up stage vs the WebAudio model (#1908, measured parity)",
  () => {
    let workDir: string;
    beforeEach(() => {
      workDir = mkdtempSync(join(tmpdir(), "remix-buildup-spec-"));
    });
    afterEach(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    it.each(PARITY_CASES)("$case", ({ case: name, speed }) => {
      const segments = structureTimeline(PARITY_GRID, PARITY_BLOCKS);
      const ramps = buildUpOutputRamps(buildUpRamps(segments), speed);
      const seconds = segments[segments.length - 1].outEndSec / speed;
      const input = pinkNoise(seconds, 1908);
      const inPath = join(workDir, "in.f32");
      const outPath = join(workDir, "out.f32");
      writeFileSync(inPath, Buffer.from(input.buffer));
      const graph = buildBuildUpStageGraph(ramps, "[0:a]", [], "[o]").join(
        ";",
      );
      execFileSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "f32le",
          "-ar",
          String(SAMPLE_RATE),
          "-ac",
          "1",
          "-i",
          inPath,
          "-filter_complex",
          graph,
          "-map",
          "[o]",
          "-f",
          "f32le",
          outPath,
        ],
        { stdio: "ignore", timeout: 60_000 },
      );
      const raw = readFileSync(outPath);
      const actual = new Float32Array(
        raw.buffer,
        raw.byteOffset,
        raw.length / 4,
      );
      // Same length: the stage never pads or trims.
      expect(actual.length).toBe(input.length);
      const measured = windowedLevelError(
        actual,
        webAudioReference(input, ramps),
        fixture.parity.windowSeconds,
        ramps.map((ramp) => ramp.endSec),
      );
      if (process.env.REMIX_BUILDUP_PARITY_LOG) {
        console.log(JSON.stringify({ case: name, ...measured }));
      }
      expect(measured.maxWindowDb).toBeLessThanOrEqual(
        fixture.parity.toleranceMaxWindowDb,
      );
      expect(measured.maxDropWindowDb).toBeLessThanOrEqual(
        fixture.parity.toleranceMaxDropWindowDb,
      );
      expect(measured.meanWindowDb).toBeLessThanOrEqual(
        fixture.parity.toleranceMeanWindowDb,
      );
    });
  },
);
