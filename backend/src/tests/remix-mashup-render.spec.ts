/**
 * Mashups render conform (#2559, S6f-3b of #1903): the conform plan (B's
 * bar 1 on A's bar), the stretch stage composed with the master's, the
 * shift/cut args, and an ffmpeg-gated parity check that B's beats land on
 * A's beats after the stretch and the shift (skipped without ffmpeg, like
 * the other render specs).
 */

import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { deriveSectionGrid } from "../modules/remix/remix-arrangement";
import {
  mashupConformPlan,
  measuredTempo,
  normalizeRemixMashupInput,
  type MashupConform,
} from "../modules/remix/remix-mashup";
import {
  buildConformShiftArgs,
  conformMixInputs,
  mixInputConformStage,
  mixInputStretchStage,
  stretchMixInputs,
  type StemMixFfmpegInput,
} from "../modules/remix/stem-audio-mixer";

const features = (tempoBpm: number, firstBeatSec: number, durationSeconds = 64) => ({
  audioFeatures: {
    schemaVersion: "stem-audio-features/v1",
    tempoBpm,
    tempoConfidence: 0.9,
    firstBeatSec,
    durationSeconds,
  },
});

const recipe = (secondary: Record<string, unknown>) =>
  normalizeRemixMashupInput({ secondary })!;

describe("mashupConformPlan (#2559)", () => {
  const leadGrid = deriveSectionGrid([features(120, 0)]);

  it("puts B's first downbeat on A's bar, after B's stretch", () => {
    const plan = mashupConformPlan({
      leadGrid,
      secondaryStems: [features(100, 0.3)],
      mashup: recipe({ tempoRatio: 1.2, semitones: -2, offsetBars: 2 }),
    });
    // A's bar 2 starts at 4 s (2 s bars); B's downbeat 0.3 s plays at 0.25 s.
    expect(plan).toEqual({
      conform: { tempo: 1.2, semitones: -2, shiftSec: 3.75, endSec: 64 },
    });
  });

  it("uses B's corrected downbeat, and trims when B starts late", () => {
    const plan = mashupConformPlan({
      leadGrid,
      secondaryStems: [features(100, 0.3)],
      mashup: recipe({ tempoRatio: 1.2, semitones: 0, offsetBars: 0, firstBeatSec: 6 }),
    });
    expect(plan).toEqual({
      conform: { tempo: 1.2, semitones: 0, shiftSec: -5, endSec: 64 },
    });
  });

  it("skips without a bar grid on A or past A's last bar", () => {
    const timeGrid = deriveSectionGrid([
      { audioFeatures: { durationSeconds: 64 } },
    ]);
    expect(
      mashupConformPlan({
        leadGrid: timeGrid,
        secondaryStems: [features(100, 0)],
        mashup: recipe({ tempoRatio: 1.2, semitones: 0, offsetBars: 0 }),
      }),
    ).toEqual({ skipped: "no_lead_grid" });
    expect(
      mashupConformPlan({
        leadGrid,
        secondaryStems: [features(100, 0)],
        mashup: recipe({ tempoRatio: 1.2, semitones: 0, offsetBars: 40 }),
      }),
    ).toEqual({ skipped: "offset_past_end" });
  });

  it("reads the most confident measured tempo", () => {
    expect(
      measuredTempo([
        { audioFeatures: { tempoBpm: 90, tempoConfidence: 0.2, firstBeatSec: 1 } },
        { audioFeatures: { tempoBpm: 100, tempoConfidence: 0.8, firstBeatSec: 0.3 } },
        { audioFeatures: null },
      ]),
    ).toEqual({ bpm: 100, firstBeatSec: 0.3 });
  });
});

describe("remix-mashup-v1.parity.json (#2559)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fixture = require("../modules/remix/remix-mashup-v1.parity.json") as {
    cases: Array<{
      name: string;
      leadStems: Array<{ audioFeatures?: unknown }>;
      leadOverride: Parameters<typeof deriveSectionGrid>[1];
      leadGrid: unknown;
      secondaryStems: Array<{ audioFeatures?: unknown }>;
      mashup: unknown;
      expected: unknown;
    }>;
  };
  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const leadGrid = deriveSectionGrid(c.leadStems, c.leadOverride);
    expect(leadGrid).toEqual(c.leadGrid);
    expect(
      mashupConformPlan({
        leadGrid,
        secondaryStems: c.secondaryStems,
        mashup: normalizeRemixMashupInput(c.mashup)!,
      }),
    ).toEqual(c.expected);
  });
});

describe("the conform stretch stage and shift (#2559)", () => {
  const conform: MashupConform = { tempo: 1.2, semitones: -2, shiftSec: 3.75, endSec: 64 };
  const input = (extra: Partial<StemMixFfmpegInput> = {}): StemMixFfmpegInput => ({
    path: "/tmp/b.wav",
    gainDb: 0,
    fxStemId: "b",
    conform,
    ...extra,
  });

  it("stretches B by its own stage first, then by the master's like any stem", () => {
    expect(mixInputConformStage(input())).toEqual({ tempo: 1.2, semitones: -2 });
    expect(
      mixInputConformStage(input({ conform: { ...conform, tempo: 1, semitones: 0 } })),
    ).toBeNull();
    expect(mixInputConformStage({ path: "/a", gainDb: 0 })).toBeNull();
    // The master stage is unchanged for B's (already conformed) file.
    expect(mixInputStretchStage(input(), { tempo: 1.25, semitones: 1 })).toEqual({
      tempo: 1.25,
      semitones: 1,
    });
    expect(mixInputStretchStage(input(), null)).toBeNull();
  });

  it("delays a positive shift and trims a negative one, in whole samples", () => {
    const af = (args: string[]) => args[args.indexOf("-af") + 1];
    expect(af(buildConformShiftArgs("/i", "/o", 3.75, 64))).toBe(
      "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=delays=180000S:all=1,atrim=end_sample=3072000",
    );
    expect(af(buildConformShiftArgs("/i", "/o", -0.5, null))).toBe(
      "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=start_sample=24000,asetpts=PTS-STARTPTS",
    );
  });
});

function hasFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Onset times (s) of clicks in a file: the first loud sample after silence. */
function onsets(path: string): number[] {
  const raw = execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", path,
    "-ac", "1", "-ar", "48000", "-f", "f32le", "-",
  ], { maxBuffer: 64 * 1024 * 1024 });
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const out: number[] = [];
  let quietUntil = 0;
  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i]) > 0.2 && i >= quietUntil) {
      out.push(i / 48000);
      quietUntil = i + Math.round(0.2 * 48000);
    }
  }
  return out;
}

const describeFfmpeg = hasFfmpeg() ? describe : describe.skip;

describeFfmpeg("B's beats land on A's beats after the conform (real ffmpeg, #2559)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mashup-conform-"));
  });
  afterAll(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  /** A 100 BPM click track whose first beat is at 0.3 s. */
  function clickTrack(path: string) {
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
      "aevalsrc=exprs='if(gte(t,0.3)*lt(mod(t-0.3,0.6),0.008),0.8*sin(2*PI*1500*t),0)':s=48000:d=12",
      "-ac", "2", path,
    ]);
  }

  it.each([
    ["without a master stretch", null],
    ["with a master keep-pitch tempo of 1.25", { tempo: 1.25, semitones: 0 }],
  ])("%s", async (_name, master) => {
    const plan = mashupConformPlan({
      leadGrid: deriveSectionGrid([features(120, 0, 30)]),
      secondaryStems: [features(100, 0.3)],
      mashup: recipe({ tempoRatio: 1.2, semitones: 0, offsetBars: 2 }),
    });
    if (!("conform" in plan)) throw new Error("expected a conform plan");
    const path = join(dir, `b-${master ? "m" : "n"}.wav`);
    clickTrack(path);
    const inputs: StemMixFfmpegInput[] = [
      { path, gainDb: 0, fxStemId: "b", conform: plan.conform },
    ];
    // The mixer's order: B's conform, then the master stage.
    await conformMixInputs(inputs, dir);
    if (master) {
      await stretchMixInputs(inputs, dir, (input) => mixInputStretchStage(input, master));
    }

    // A at 120 BPM: beats every 0.5 s from its bar 2 (4 s); the master
    // stretch divides A's time by its tempo.
    const scale = master?.tempo ?? 1;
    const found = onsets(inputs[0].path);
    expect(found.length).toBeGreaterThanOrEqual(10);
    expect(found[0]).toBeCloseTo(4 / scale, 1);
    for (const [index, at] of found.entries()) {
      const expected = (4 + index * 0.5) / scale;
      expect(Math.abs(at - expected)).toBeLessThan(0.012);
    }
    // Cut at A's end (30 s of A's time).
    const seconds = Number(
      execFileSync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", inputs[0].path,
      ]).toString(),
    );
    expect(seconds).toBeLessThanOrEqual(30 / scale + 0.01);
  }, 60_000);
});
