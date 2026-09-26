/**
 * Beat maker remix-beat/v1 (#1902) render graph — ffmpeg arg construction
 * (pure) plus ffmpeg-gated renders (skipped when ffmpeg is absent, like the
 * #1897/#1899 render specs).
 */

import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildSectionGateVolumeExpression,
  type SectionGrid,
} from "../modules/remix/remix-arrangement";
import type { RemixFxRecipe } from "../modules/remix/remix-fx";
import {
  writeBeatWav,
  type RemixBeatDspRecipe,
} from "../modules/remix/remix-beat";
import {
  masterFadeRamps,
  structureTimeline,
} from "../modules/remix/remix-structure";
import {
  buildMasterFadeVolumeExpression,
  buildStemMixFfmpegArgs,
  type StemMixFfmpegFx,
  type StemMixFfmpegInput,
} from "../modules/remix/stem-audio-mixer";

const LOUDNORM = "loudnorm=I=-14:LRA=11:TP=-1.5";
const NORMALIZE = "aresample=48000,aformat=sample_fmts=fltp";
const MONO_TO_STEREO = "pan=stereo|c0=c0|c1=c0";

function filterOf(args: string[]): string {
  return args[args.indexOf("-filter_complex") + 1];
}

const recipe = (value: Omit<RemixFxRecipe, "schemaVersion">): RemixFxRecipe => ({
  schemaVersion: "remix-fx/v1",
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
const BEAT_INPUT: StemMixFfmpegInput = {
  path: "/tmp/beat.wav",
  gainDb: -3,
  beat: true,
};

describe("buildStemMixFfmpegArgs without a beat (#1902 identity)", () => {
  const FX: StemMixFfmpegFx = {
    effects: recipe({
      master: { speed: 0.85, space: 0.4, warmth: 0.3 },
      stems: { "stem-a": { echo: 0.5, tone: -0.4 } },
    }),
    bpm: 120,
    impulsePath: "/tmp/ir.wav",
  };
  const STRUCTURE = { segments: structureTimeline(GRID, [{ section: 2 }, { section: 1 }]) };

  it("pins the plain pre-#1897 graph (no fx, no structure, no beat)", () => {
    const gate = buildSectionGateVolumeExpression([{ startSec: 6, endSec: 22 }]);
    expect(filterOf(buildStemMixFfmpegArgs(STEMS, "/tmp/mix.mp3"))).toBe(
      `[0:a]volume=1.5dB,volume=volume=${gate}:eval=frame[a0];[1:a]volume=0dB[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0[sum];[sum]${LOUDNORM}[mix]`,
    );
  });

  it.each([
    ["no fx, no structure", null, null],
    ["fx", FX, null],
    ["structure", null, STRUCTURE],
    ["fx + structure", FX, STRUCTURE],
  ])("keeps the args byte-identical with a null beat (%s)", (_label, fx, structure) => {
    const baseline = buildStemMixFfmpegArgs(STEMS, "/tmp/mix.mp3", fx, structure);
    // An explicit `beat: false` flag is the same as no beat input.
    const flagged = STEMS.map((input) => ({ ...input, beat: false }));
    expect(buildStemMixFfmpegArgs(flagged, "/tmp/mix.mp3", fx, structure)).toEqual(
      baseline,
    );
    expect(baseline.join(" ")).not.toContain("beat");
    expect(baseline.join(" ")).not.toContain("pan=");
  });
});

describe("buildStemMixFfmpegArgs with a beat input (#1902)", () => {
  it("routes a beat without fx or structure through the plain fx chain", () => {
    const args = buildStemMixFfmpegArgs(
      [{ path: "/tmp/a.audio", gainDb: 0, fxStemId: "stem-a" }, BEAT_INPUT],
      "/tmp/mix.mp3",
    );
    expect(args.filter((arg, index) => args[index - 1] === "-i")).toEqual([
      "/tmp/a.audio",
      "/tmp/beat.wav",
    ]);
    expect(filterOf(args).split(";")).toEqual([
      `[0:a]${NORMALIZE},volume=0dB[a0]`,
      // Mono duplicated to both channels at unity, then its level.
      `[1:a]${NORMALIZE},${MONO_TO_STEREO},volume=-3dB[a1]`,
      "[a0][a1]amix=inputs=2:duration=longest:normalize=0[sum]",
      `[sum]${LOUDNORM}[mix]`,
    ]);
  });

  it("gives the beat varispeed, gain and a master.space send — no per-stem fx, gate or structure front end", () => {
    const structure = {
      segments: structureTimeline(GRID, [
        { section: 1, fadeIn: true },
        { section: 1 },
        { section: 4, fadeOut: true },
      ]),
    };
    const args = buildStemMixFfmpegArgs(
      [
        { path: "/tmp/a.audio", gainDb: 0, fxStemId: "stem-a" },
        { path: "/tmp/layer.wav", gainDb: 0, aiLayer: true },
        {
          ...BEAT_INPUT,
          // Ignored for the beat: its on/off is baked into the track.
          activeIntervals: [{ startSec: 0, endSec: 4 }],
        },
      ],
      "/tmp/mix.mp3",
      {
        effects: recipe({
          master: { speed: 0.8, space: 0.5, tone: 0.5, warmth: 0.25 },
          stems: { "stem-a": { echo: 0.5, tone: -0.4 } },
        }),
        bpm: 120,
        impulsePath: "/tmp/ir.wav",
      },
      structure,
    );
    const inputs = args.filter((_, index) => args[index - 1] === "-i");
    // Stem runs [6,22], [6,22], [54,58]; the layer, the beat and the IR are
    // single plain inputs (no -ss/-t).
    expect(inputs).toEqual([
      "/tmp/a.audio", "/tmp/a.audio", "/tmp/a.audio",
      "/tmp/layer.wav", "/tmp/beat.wav", "/tmp/ir.wav",
    ]);
    const beatInput = args.indexOf("/tmp/beat.wav");
    expect(args[beatInput - 3]).not.toBe("-t");
    const parts = filterOf(args).split(";");
    const beatChain = parts.find((part) => part.startsWith("[4:a]"));
    expect(beatChain).toBe(
      `[4:a]${NORMALIZE},${MONO_TO_STEREO},asetrate=38400,aresample=48000,volume=-3dB,asplit=2[d2][s2]`,
    );
    // Reverb send 0.7 × master.space, like an AI layer.
    expect(parts).toContain("[s2]volume=0.35[w2]");
    expect(parts).toContain("[s1]volume=0.35[w1]");
    expect(parts).toContain(
      "[w0][w1][w2]amix=inputs=3:duration=longest:normalize=0,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=pad_dur=2.8[rvin]",
    );
    expect(parts).toContain("[rvin][5:a]afir=irnorm=-1[rv]");
    expect(parts.at(-2)).toBe(
      "[d0][d1][d2][rv]amix=inputs=4:duration=longest:normalize=0[sum]",
    );
    // Master fades / tone / warmth / loudness apply to the whole sum.
    const fades = buildMasterFadeVolumeExpression(
      masterFadeRamps(structure.segments),
      0.8,
    );
    expect(parts.at(-1)).toBe(
      `[sum]volume=volume=${fades}:eval=frame,highpass=f=154.919334:width_type=q:width=0.7071,aeval=exprs=tanh(2*val(ch))/tanh(2):channel_layout=same,${LOUDNORM}[mix]`,
    );
    // No beat echo/tone/gate/front end.
    expect(beatChain).not.toMatch(/aecho|lowpass|highpass|eval=frame|atrim|concat/);
  });

  it("clamps the beat's gain like a stem's", () => {
    const filter = filterOf(
      buildStemMixFfmpegArgs(
        [{ path: "/tmp/a.audio", gainDb: 0 }, { ...BEAT_INPUT, gainDb: 40 }],
        "/tmp/mix.mp3",
      ),
    );
    expect(filter).toContain(`${MONO_TO_STEREO},volume=6dB[a1]`);
  });
});

// --- ffmpeg-gated renders ----------------------------------------------------

const SAMPLE_RATE = 48_000;

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** A silent stereo 32-bit float WAV. */
function silentWav(seconds: number): Buffer {
  const frames = Math.round(seconds * SAMPLE_RATE);
  const dataBytes = frames * 2 * 4;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(3, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 8, 28);
  buffer.writeUInt16LE(8, 32);
  buffer.writeUInt16LE(32, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

function decodeMono(path: string): Float32Array {
  const raw = execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", "48000", "-f", "f32le", "-c:a", "pcm_f32le", "-"],
    { timeout: 60_000, maxBuffer: 256 * 1024 * 1024 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

function meanSquare(samples: Float32Array, from: number, to: number): number {
  const start = Math.max(0, Math.round(from * SAMPLE_RATE));
  const end = Math.min(samples.length, Math.round(to * SAMPLE_RATE));
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return end > start ? sum / (end - start) : 0;
}

/** First sample within ±50 ms of `near` whose level exceeds 10% of the local peak. */
function onsetNear(samples: Float32Array, near: number): number {
  const start = Math.max(0, Math.round((near - 0.05) * SAMPLE_RATE));
  const end = Math.min(samples.length, Math.round((near + 0.1) * SAMPLE_RATE));
  let peak = 0;
  for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(samples[i]));
  for (let i = start; i < end; i++) {
    if (Math.abs(samples[i]) > 0.1 * peak) return i / SAMPLE_RATE;
  }
  return Number.NaN;
}

/** Two 4 s sections at 120 bpm (2 bars each); neither is a pickup. */
const ONSET_GRID: SectionGrid = {
  kind: "bars",
  sectionSeconds: 4,
  bpm: 120,
  durationSeconds: 8,
  sections: [
    { startSec: 0, endSec: 4 },
    { startSec: 4, endSec: 8 },
  ],
};

(ffmpegAvailable ? describe : describe.skip)(
  "ffmpeg remix-beat/v1 render (#1902)",
  () => {
    let workDir: string;
    beforeEach(() => {
      workDir = mkdtempSync(join(tmpdir(), "remix-beat-spec-"));
    });
    afterEach(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    it.each([1, 0.8])(
      "kick onsets land on the timeline beats ÷ speed, and a block turned off is silent (speed %p)",
      async (speed) => {
        const stem = join(workDir, "silence.wav");
        writeFileSync(stem, silentWav(8));
        // Timeline: section 1, section 0, section 1 → 12 s; the beat is off
        // in the middle block. Kicks on steps 0 and 8 → one per second.
        const segments = structureTimeline(ONSET_GRID, [
          { section: 1 },
          { section: 0 },
          { section: 1 },
        ]);
        const beat: RemixBeatDspRecipe = {
          kit: "punchy",
          pattern: { kick: Array.from({ length: 16 }, (_, s) => s === 0 || s === 8) },
          blocks: [true, false, true],
        };
        const beatPath = join(workDir, "beat.wav");
        await writeBeatWav(beatPath, beat, ONSET_GRID, segments);
        const out = join(workDir, "mix.mp3");
        execFileSync(
          "ffmpeg",
          buildStemMixFfmpegArgs(
            [
              { path: stem, gainDb: 0, fxStemId: "a" },
              { path: beatPath, gainDb: 0, beat: true },
            ],
            out,
            speed === 1 ? null : { effects: recipe({ master: { speed } }) },
            { segments },
          ),
          { stdio: "ignore", timeout: 60_000 },
        );
        const decoded = decodeMono(out);

        const onBeats = [0, 1, 2, 3, 8, 9, 10, 11];
        const onEnergy = onBeats.map((k) =>
          meanSquare(decoded, k / speed, k / speed + 0.05),
        );
        const loudest = Math.max(...onEnergy);
        onBeats.forEach((k, index) => {
          const at = k / speed;
          // A clear hit, well above the decaying tail just before it…
          expect(onEnergy[index]).toBeGreaterThan(0.3 * loudest);
          if (k > 0) {
            expect(onEnergy[index]).toBeGreaterThan(
              20 * meanSquare(decoded, at - 0.12, at - 0.02),
            );
          }
          // …starting within 5 ms of the expected time.
          expect(Math.abs(onsetNear(decoded, at) - at)).toBeLessThan(0.005);
        });
        // The middle block (timeline 4–8 s) has no hits.
        [5, 6, 7].forEach((k) => {
          expect(meanSquare(decoded, k / speed, k / speed + 0.05)).toBeLessThan(
            0.001 * loudest,
          );
        });
      },
    );
  },
);
