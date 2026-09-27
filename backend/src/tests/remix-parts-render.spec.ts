/**
 * AI parts (#1901 S4 PR 2) render graph — ffmpeg arg construction (pure)
 * plus ffmpeg-gated part decode, track and per-input stretch runs (skipped
 * when ffmpeg is absent, like the #1897/#1899/#1902 render specs).
 */

import { execFileSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { SectionGrid } from "../modules/remix/remix-arrangement";
import type { RemixFxRecipe } from "../modules/remix/remix-fx";
import { structureTimeline } from "../modules/remix/remix-structure";
import {
  buildPartDecodeArgs,
  decodePartTakeLoop,
  partPlacementSpans,
  writePartTrackWav,
} from "../modules/remix/remix-parts";
import {
  buildStemMixFfmpegArgs,
  mixInputStretchStage,
  stemMixReverbSends,
  stretchMixInputs,
  type StemMixFfmpegFx,
  type StemMixFfmpegInput,
} from "../modules/remix/stem-audio-mixer";

const LOUDNORM = "loudnorm=I=-14:LRA=11:TP=-1.5";
const NORMALIZE = "aresample=48000,aformat=sample_fmts=fltp";

function filterOf(args: string[]): string {
  return args[args.indexOf("-filter_complex") + 1];
}

const recipe = (value: Omit<RemixFxRecipe, "schemaVersion">): RemixFxRecipe => ({
  schemaVersion: "remix-fx/v2",
  ...value,
});

const GRID: SectionGrid = {
  kind: "bars",
  sectionSeconds: 16,
  bpm: 120,
  durationSeconds: 58,
  sections: [
    { startSec: 0, endSec: 6 },
    { startSec: 6, endSec: 22 },
    { startSec: 22, endSec: 38 },
    { startSec: 38, endSec: 54 },
    { startSec: 54, endSec: 58 },
  ],
};

const STEMS: StemMixFfmpegInput[] = [
  {
    path: "/tmp/a.audio",
    gainDb: 1.5,
    activeIntervals: [{ startSec: 6, endSec: 22 }],
    fxStemId: "stem-a",
  },
  { path: "/tmp/layer.wav", gainDb: 0, aiLayer: true },
];
const KEYS_PART: StemMixFfmpegInput = {
  path: "/tmp/part-0.wav",
  gainDb: -4.5,
  part: { role: "keys" },
  // Ignored for parts: their blocks are baked in.
  activeIntervals: [{ startSec: 0, endSec: 1 }],
};

describe("buildStemMixFfmpegArgs without parts (#1901 identity)", () => {
  const FX: StemMixFfmpegFx = {
    effects: recipe({
      master: { speed: 0.85, space: 0.4, warmth: 0.3 },
      stems: { "stem-a": { echo: 0.5, tone: -0.4 } },
    }),
    bpm: 120,
    impulsePath: "/tmp/ir.wav",
  };
  const STRUCTURE = { segments: structureTimeline(GRID, [{ section: 2 }, { section: 1 }]) };

  it.each([
    ["no fx, no structure", null, null],
    ["fx", FX, null],
    ["structure", null, STRUCTURE],
    ["fx + structure", FX, STRUCTURE],
  ])("an undefined part flag keeps the args byte-identical (%s)", (_label, fx, structure) => {
    const baseline = buildStemMixFfmpegArgs(STEMS, "/tmp/mix.mp3", fx, structure);
    const flagged = STEMS.map((input) => ({ ...input, part: undefined }));
    expect(buildStemMixFfmpegArgs(flagged, "/tmp/mix.mp3", fx, structure)).toEqual(baseline);
    expect(baseline.join(" ")).not.toContain("part-");
  });
});

describe("buildStemMixFfmpegArgs with an AI part input (#1901)", () => {
  it("routes a part without fx or structure through the plain fx chain (no gate, stereo)", () => {
    const args = buildStemMixFfmpegArgs(
      [{ path: "/tmp/a.audio", gainDb: 0, fxStemId: "stem-a" }, KEYS_PART],
      "/tmp/mix.mp3",
    );
    expect(args.filter((_arg, index) => args[index - 1] === "-i")).toEqual([
      "/tmp/a.audio",
      "/tmp/part-0.wav",
    ]);
    expect(filterOf(args).split(";")).toEqual([
      `[0:a]${NORMALIZE},volume=0dB[a0]`,
      `[1:a]${NORMALIZE},volume=-4.5dB[a1]`,
      "[a0][a1]amix=inputs=2:duration=longest:normalize=0[sum]",
      `[sum]${LOUDNORM}[mix]`,
    ]);
  });

  it("takes varispeed and a master.space reverb send, but no per-stem fx", () => {
    const fx: StemMixFfmpegFx = {
      effects: recipe({
        master: { speed: 1.2, space: 0.5 },
        // A per-stem entry that must never apply to the part.
        stems: { "stem-a": { echo: 0.6, tone: 0.5, space: 1 } },
      }),
      bpm: 120,
      impulsePath: "/tmp/ir.wav",
    };
    const inputs: StemMixFfmpegInput[] = [
      { path: "/tmp/a.audio", gainDb: 0, fxStemId: "stem-a" },
      { ...KEYS_PART, fxStemId: "stem-a" },
    ];
    const filter = filterOf(buildStemMixFfmpegArgs(inputs, "/tmp/mix.mp3", fx));
    const partChain = filter.split(";").find((part) => part.startsWith("[1:a]"))!;
    expect(partChain).toBe(
      `[1:a]${NORMALIZE},asetrate=57600,aresample=48000,volume=-4.5dB,asplit=2[d1][s1]`,
    );
    expect(stemMixReverbSends(inputs, fx.effects)[1]).toBeCloseTo(0.7 * 0.5, 12);
    expect(filter).not.toContain("[1:a]aecho");
  });

  it("is never restructured: one plain input while stems get seeked runs", () => {
    const structure = { segments: structureTimeline(GRID, [{ section: 2 }, { section: 1 }]) };
    const args = buildStemMixFfmpegArgs(
      [{ path: "/tmp/a.audio", gainDb: 0, fxStemId: "stem-a" }, KEYS_PART],
      "/tmp/mix.mp3",
      null,
      structure,
    );
    const partIndex = args.indexOf("/tmp/part-0.wav");
    expect(args[partIndex - 1]).toBe("-i");
    expect(args[partIndex - 3]).not.toBe("-t");
    expect(args.filter((arg) => arg === "/tmp/a.audio")).toHaveLength(2);
  });

  it("decodes takes to 48 kHz stereo float, capped, argv only", () => {
    expect(buildPartDecodeArgs("/w/part-0.take", "/w/part-0.f32")).toEqual([
      "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
      "-i", "/w/part-0.take", "-vn", "-t", "32",
      "-f", "f32le", "-c:a", "pcm_f32le", "-ac", "2", "-ar", "48000",
      "/w/part-0.f32",
    ]);
  });

  it("drum parts get a tempo-only stretch stage", () => {
    const drums: StemMixFfmpegInput = { path: "/tmp/d.wav", gainDb: 0, part: { role: "drums" } };
    expect(mixInputStretchStage(drums, { tempo: 0.85, semitones: -2 })).toEqual({
      tempo: 0.85,
      semitones: 0,
    });
    expect(mixInputStretchStage(KEYS_PART, { tempo: 0.85, semitones: -2 })).toEqual({
      tempo: 0.85,
      semitones: -2,
    });
  });
});

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

(ffmpegAvailable ? describe : describe.skip)("ffmpeg AI part track (#1901)", () => {
  let workDir: string;
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "remix-part-render-"));
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  /** A conformed-take stand-in: `seconds` of a stereo sine as 16-bit FLAC. */
  function writeTake(path: string, seconds: number, hz = 440) {
    execFileSync(
      "ffmpeg",
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", `sine=frequency=${hz}:sample_rate=48000:duration=${seconds}`,
        "-ac", "2", "-sample_fmt", "s16", "-c:a", "flac", "-f", "flac", path,
      ],
      { stdio: "ignore", timeout: 60_000 },
    );
  }

  it("decodes a FLAC take to its sample-exact loop and deletes the intermediate", async () => {
    const take = join(workDir, "part-0.take");
    writeTake(take, 2);
    const raw = join(workDir, "part-0.f32");
    const loop = await decodePartTakeLoop(take, raw);
    expect(loop.length).toBe(2 * 96_000);
    expect(existsSync(raw)).toBe(false);
    // Left = right (the sine is duplicated).
    expect(loop[2000]).toBe(loop[2001]);
  }, 60_000);

  it("rejects audio that doesn't decode", async () => {
    const take = join(workDir, "part-0.take");
    writeFileSync(take, Buffer.from("not audio"));
    await expect(decodePartTakeLoop(take, join(workDir, "part-0.f32"))).rejects.toThrow();
    expect(existsSync(join(workDir, "part-0.f32"))).toBe(false);
  }, 60_000);

  it("lays the loop out on the timeline and stretches drums without transposing them", async () => {
    const take = join(workDir, "part-0.take");
    writeTake(take, 8); // 4 bars at 120 bpm
    const loop = await decodePartTakeLoop(take, join(workDir, "part-0.f32"));
    const segments = structureTimeline(GRID, null);
    const spans = partPlacementSpans({ blocks: null }, GRID, segments, 8);
    const drums = join(workDir, "part-0.wav");
    const keys = join(workDir, "part-1.wav");
    await writePartTrackWav(drums, loop, spans, 58);
    await writePartTrackWav(keys, loop, spans, 58);
    const wav = readFileSync(drums);
    expect(wav.readUInt32LE(40)).toBe(58 * 48_000 * 2 * 4);
    // Silent through the pickup, the loop from phase 0 at the first block.
    expect(wav.readFloatLE(44 + (6 * 48_000 - 1) * 8)).toBe(0);
    expect(wav.readFloatLE(44 + (6 * 48_000 + 100) * 8)).toBe(loop[200]);
    const inputs: StemMixFfmpegInput[] = [
      { path: drums, gainDb: 0, part: { role: "drums" } },
      { path: keys, gainDb: 0, part: { role: "keys" } },
    ];
    const plan = { tempo: 1, semitones: 2 };
    await stretchMixInputs(inputs, workDir, (input) => mixInputStretchStage(input, plan));
    // A key shift alone never touches the drum part; the keys are shifted.
    expect(inputs[0].path).toBe(drums);
    expect(inputs[1].path).toBe(join(workDir, "stretch-1.wav"));
    expect(existsSync(keys)).toBe(false);
  }, 120_000);
});
