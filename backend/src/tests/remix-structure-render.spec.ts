/**
 * Structure blocks remix-structure/v1 (#1899) render graph — ffmpeg arg
 * construction (pure) plus ffmpeg-gated render checks (skipped when ffmpeg is
 * absent, like the #1189/#1897 smoke tests).
 */

import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildSectionGateVolumeExpression,
  type SectionGrid,
} from "../modules/remix/remix-arrangement";
import { writeImpulseWav, type RemixFxRecipe } from "../modules/remix/remix-fx";
import {
  gateIntervalsForBlocks,
  masterFadeRamps,
  structureTimeline,
  type RemixStructureBlock,
  type RemixStructureSegment,
} from "../modules/remix/remix-structure";
import {
  AFIR_UNITY_GAIN_OPTIONS,
  buildMasterFadeVolumeExpression,
  buildStemMixFfmpegArgs,
  resolveAfirUnityGainOptions,
  structureRuns,
  type StemMixFfmpegFx,
  type StemMixFfmpegInput,
} from "../modules/remix/stem-audio-mixer";

const LOUDNORM = "loudnorm=I=-14:LRA=11:TP=-1.5";
const NORMALIZE = "aresample=48000,aformat=sample_fmts=fltp";

function filterOf(args: string[]): string {
  return args[args.indexOf("-filter_complex") + 1];
}

const recipe = (value: Omit<RemixFxRecipe, "schemaVersion">): RemixFxRecipe => ({
  schemaVersion: "remix-fx/v1",
  ...value,
});

/** The parity fixture's grid: a 6 s pickup, three 16 s sections, a 4 s tail. */
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

const timeline = (blocks: RemixStructureBlock[] | null) => ({
  segments: structureTimeline(GRID, blocks),
});

describe("buildStemMixFfmpegArgs without a structure (#1899 identity)", () => {
  const inputs: StemMixFfmpegInput[] = [
    {
      path: "/tmp/a.audio",
      gainDb: 1.5,
      activeIntervals: [{ startSec: 6, endSec: 22 }],
      fxStemId: "stem-a",
    },
    { path: "/tmp/layer.wav", gainDb: 0, aiLayer: true },
  ];

  it.each([undefined, null, { segments: [] }])(
    "keeps the pre-#1897 graph byte-identical without fx (structure %p)",
    (structure) => {
      const baseline = buildStemMixFfmpegArgs(inputs, "/tmp/mix.mp3");
      expect(
        buildStemMixFfmpegArgs(inputs, "/tmp/mix.mp3", null, structure),
      ).toEqual(baseline);
      expect(
        buildStemMixFfmpegArgs(
          inputs,
          "/tmp/mix.mp3",
          { effects: null },
          structure,
        ),
      ).toEqual(baseline);
    },
  );

  it.each([undefined, null, { segments: [] }])(
    "keeps the #1897 fx graph byte-identical (structure %p)",
    (structure) => {
      const fx: StemMixFfmpegFx = {
        effects: recipe({
          master: { speed: 0.85, space: 0.4, warmth: 0.3 },
          stems: { "stem-a": { echo: 0.5, tone: -0.4 } },
        }),
        bpm: 120,
        impulsePath: "/tmp/ir.wav",
      };
      expect(
        buildStemMixFfmpegArgs(inputs, "/tmp/mix.mp3", fx, structure),
      ).toEqual(buildStemMixFfmpegArgs(inputs, "/tmp/mix.mp3", fx));
    },
  );
});

/** `-ss/-t/-i` triples (null seek/read for a plain `-i`). */
function inputSpecsOf(args: string[]) {
  const specs: Array<{ path: string; seek: string | null; read: string | null }> = [];
  args.forEach((arg, index) => {
    if (arg !== "-i") return;
    const hasSeek = args[index - 4] === "-ss" && args[index - 2] === "-t";
    specs.push({
      path: args[index + 1],
      seek: hasSeek ? args[index - 3] : null,
      read: hasSeek ? args[index - 1] : null,
    });
  });
  return specs;
}

describe("buildStemMixFfmpegArgs with remix-structure/v1 (#1899)", () => {
  it("compiles runs in source time: one seeked input per run, pre-roll trim, join fades, concat", () => {
    // reorder-repeat from the fixture: 1, 2, 2, 1, 3. 1→2 is consecutive
    // source audio, so it is one run; every other join jumps.
    const structure = timeline([
      { section: 1 },
      { section: 2 },
      { section: 2 },
      { section: 1 },
      { section: 3 },
    ]);
    expect(
      structureRuns(structure.segments).map((run) => [
        run.srcStartSec,
        run.srcEndSec,
      ]),
    ).toEqual([
      [6, 38],
      [22, 38],
      [6, 22],
      [38, 54],
    ]);
    const args = buildStemMixFfmpegArgs(
      [{ path: "/tmp/a.audio", gainDb: -2, fxStemId: "stem-a" }],
      "/tmp/mix.mp3",
      null,
      structure,
    );
    // Every run reads the same stem file, seeking 0.1 s early on the
    // 1/50 s grid and reading 0.1 s past the run.
    expect(inputSpecsOf(args)).toEqual([
      { path: "/tmp/a.audio", seek: "5.9", read: "32.2" },
      { path: "/tmp/a.audio", seek: "21.9", read: "16.2" },
      { path: "/tmp/a.audio", seek: "5.9", read: "16.2" },
      { path: "/tmp/a.audio", seek: "37.9", read: "16.2" },
    ]);
    const trim = (end: string) =>
      `${NORMALIZE},apad=whole_dur=${end},atrim=start=0.1:end=${end},asetpts=PTS-STARTPTS`;
    expect(filterOf(args).split(";")).toEqual([
      `[0:a]${trim("32.1")},afade=t=in:st=0:d=0.01,afade=t=out:st=31.99:d=0.01[x0c0]`,
      `[1:a]${trim("16.1")},afade=t=in:st=0:d=0.01,afade=t=out:st=15.99:d=0.01[x0c1]`,
      `[2:a]${trim("16.1")},afade=t=in:st=0:d=0.01,afade=t=out:st=15.99:d=0.01[x0c2]`,
      `[3:a]${trim("16.1")},afade=t=in:st=0:d=0.01,afade=t=out:st=15.99:d=0.01[x0c3]`,
      // Structure without fx: the plain chain after the concat front end.
      "[x0c0][x0c1][x0c2][x0c3]concat=n=4:v=0:a=1,volume=-2dB[a0]",
      "[a0]amix=inputs=1:duration=longest:normalize=0[sum]",
      `[sum]${LOUDNORM}[mix]`,
    ]);
    expect(args.slice(-11)).toEqual([
      "-map", "[mix]", "-codec:a", "libmp3lame", "-b:a", "320k",
      "-ar", "48000", "-ac", "2", "/tmp/mix.mp3",
    ]);
  });

  it("plays consecutive blocks as one run with no inner join fades", () => {
    // Blocks 1, 2, 3, 4 play straight through: one run, only the first jumps
    // in, and the single-run fast path skips the concat.
    const args = buildStemMixFfmpegArgs(
      [{ path: "/tmp/a.audio", gainDb: 0 }],
      "/tmp/mix.mp3",
      null,
      timeline([{ section: 1 }, { section: 2 }, { section: 3 }, { section: 4 }]),
    );
    expect(inputSpecsOf(args)).toEqual([
      { path: "/tmp/a.audio", seek: "5.9", read: "52.2" },
    ]);
    const filter = filterOf(args);
    expect(filter.match(/afade=/g)).toHaveLength(1);
    expect(filter.split(";")[0]).toBe(
      `[0:a]${NORMALIZE},apad=whole_dur=52.1,atrim=start=0.1:end=52.1,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.01,volume=0dB[a0]`,
    );
    expect(filter).not.toContain("concat");
  });

  it("compiles a single block without concat; a section-0 run seeks from 0", () => {
    const single = buildStemMixFfmpegArgs(
      [{ path: "/tmp/a.audio", gainDb: 0 }],
      "/tmp/mix.mp3",
      null,
      timeline([{ section: 2 }]),
    );
    expect(filterOf(single).split(";")[0]).toBe(
      `[0:a]${NORMALIZE},apad=whole_dur=16.1,atrim=start=0.1:end=16.1,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.01,afade=t=out:st=15.99:d=0.01,volume=0dB[a0]`,
    );
    expect(filterOf(single)).not.toContain("concat");

    const fromStart = buildStemMixFfmpegArgs(
      [{ path: "/tmp/a.audio", gainDb: 0 }],
      "/tmp/mix.mp3",
      null,
      timeline([{ section: 0 }, { section: 0 }]),
    );
    expect(inputSpecsOf(fromStart)).toEqual([
      { path: "/tmp/a.audio", seek: "0", read: "6.1" },
      { path: "/tmp/a.audio", seek: "0", read: "6.1" },
    ]);
    expect(filterOf(fromStart)).toContain(
      "[0:a]aresample=48000,aformat=sample_fmts=fltp,apad=whole_dur=6,atrim=start=0:end=6,asetpts=PTS-STARTPTS,afade=t=out:st=5.99:d=0.01[x0c0]",
    );
  });

  it("gates block masks in output time and scales master fades by speed", () => {
    const blocks: RemixStructureBlock[] = [
      { section: 1, fadeIn: true },
      { section: 1 },
      { section: 2 },
      { section: 4, fadeOut: true },
    ];
    const structure = timeline(blocks);
    // Stem off in the first copy of section 1 only: a repeated section's
    // copies are gated independently.
    const intervals = gateIntervalsForBlocks(structure.segments, [
      false,
      true,
      true,
      true,
    ])!;
    expect(intervals).toEqual([{ startSec: 16, endSec: 52 }]);
    const args = buildStemMixFfmpegArgs(
      [
        {
          path: "/tmp/a.audio",
          gainDb: 0,
          activeIntervals: intervals,
          fxStemId: "stem-a",
        },
        { path: "/tmp/b.audio", gainDb: -1, fxStemId: "stem-b" },
        { path: "/tmp/layer.wav", gainDb: 0, aiLayer: true },
      ],
      "/tmp/mix.mp3",
      {
        effects: recipe({
          master: { speed: 0.8, space: 0.5, tone: 0.5 },
          stems: { "stem-a": { echo: 0.5 } },
        }),
        bpm: 120,
        impulsePath: "/tmp/ir.wav",
      },
      structure,
    );
    // Runs: [6,22], [6,38] (blocks 1→2), [54,58]. The AI layer and the IR
    // stay single plain inputs after the stems' runs.
    expect(inputSpecsOf(args)).toEqual([
      { path: "/tmp/a.audio", seek: "5.9", read: "16.2" },
      { path: "/tmp/a.audio", seek: "5.9", read: "32.2" },
      { path: "/tmp/a.audio", seek: "53.9", read: "4.2" },
      { path: "/tmp/b.audio", seek: "5.9", read: "16.2" },
      { path: "/tmp/b.audio", seek: "5.9", read: "32.2" },
      { path: "/tmp/b.audio", seek: "53.9", read: "4.2" },
      { path: "/tmp/layer.wav", seek: null, read: null },
      { path: "/tmp/ir.wav", seek: null, read: null },
    ]);
    const parts = filterOf(args).split(";");
    const gate = buildSectionGateVolumeExpression([
      { startSec: 16 / 0.8, endSec: 52 / 0.8 },
    ]);
    expect(parts[0]).toBe(
      `[0:a]${NORMALIZE},apad=whole_dur=16.1,atrim=start=0.1:end=16.1,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.01,afade=t=out:st=15.99:d=0.01[x0c0]`,
    );
    expect(parts[2]).toBe(
      `[2:a]${NORMALIZE},apad=whole_dur=4.1,atrim=start=0.1:end=4.1,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.01[x0c2]`,
    );
    // Stem 0: concat → varispeed → gain → gate (÷ speed) → echo → send.
    expect(parts[3]).toBe(
      `[x0c0][x0c1][x0c2]concat=n=3:v=0:a=1,asetrate=38400,aresample=48000,volume=0dB,volume=volume=${gate}:eval=frame,aecho=in_gain=1:out_gain=1:delays=468.75|937.5|1406.25|1875:decays=0.25|0.15|0.09|0.054,asplit=2[d0][s0]`,
    );
    expect(parts[4]).toBe("[s0]volume=0.35[w0]");
    expect(parts[5].startsWith(`[3:a]${NORMALIZE},apad=`)).toBe(true);
    expect(parts[8]).toBe(
      "[x1c0][x1c1][x1c2]concat=n=3:v=0:a=1,asetrate=38400,aresample=48000,volume=-1dB,asplit=2[d1][s1]",
    );
    // AI layers are generated audio, not source stems: never restructured.
    expect(parts[10]).toBe(
      `[6:a]${NORMALIZE},asetrate=38400,aresample=48000,volume=0dB,asplit=2[d2][s2]`,
    );
    expect(parts[13]).toBe(`[rvin][7:a]afir=${AFIR_UNITY_GAIN_OPTIONS}[rv]`);
    const fades = buildMasterFadeVolumeExpression(
      masterFadeRamps(structure.segments),
      0.8,
    );
    // Master fades after the sum (incl. reverb), before tone + loudness.
    expect(parts.at(-1)).toBe(
      `[sum]volume=volume=${fades}:eval=frame,highpass=f=154.919334:width_type=q:width=0.7071,${LOUDNORM}[mix]`,
    );
    expect(parts.at(-2)).toBe(
      "[d0][d1][d2][rv]amix=inputs=4:duration=longest:normalize=0[sum]",
    );
  });
});

describe("buildMasterFadeVolumeExpression (#1899)", () => {
  it("builds ramps in output time, holding silence after a last fade-out", () => {
    // The fixture's "fades" case: 0..6 in, 6..14 in, 14..22 out, 38..54 out
    // (held).
    const segments = structureTimeline(GRID, [
      { section: 0, fadeIn: true },
      { section: 1, fadeIn: true, fadeOut: true },
      { section: 2 },
      { section: 3, fadeOut: true },
    ]);
    expect(buildMasterFadeVolumeExpression(masterFadeRamps(segments))).toBe(
      [
        "if(between(t\\,0\\,6)\\,0+(1)*(t-0)/6\\,1)",
        "if(between(t\\,6\\,14)\\,0+(1)*(t-6)/8\\,1)",
        "if(between(t\\,14\\,22)\\,1+(-1)*(t-14)/8\\,1)",
        "if(gte(t\\,54)\\,0\\,if(between(t\\,38\\,54)\\,1+(-1)*(t-38)/16\\,1))",
      ].join("*"),
    );
    expect(
      buildMasterFadeVolumeExpression(
        [{ startSec: 8, endSec: 12, from: 1, to: 0, holdAfter: true }],
        0.8,
      ),
    ).toBe("if(gte(t\\,15)\\,0\\,if(between(t\\,10\\,15)\\,1+(-1)*(t-10)/5\\,1))");
    expect(buildMasterFadeVolumeExpression([])).toBeNull();
  });
});

// --- ffmpeg-gated renders ----------------------------------------------------

const SAMPLE_RATE = 48_000;

/** 32-bit float WAV from per-frame values (mono duplicated to both channels). */
function floatWav(samples: Float64Array, channels = 2): Buffer {
  const frames = samples.length;
  const buffer = Buffer.alloc(44 + frames * channels * 4);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + frames * channels * 4, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(3, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * channels * 4, 28);
  buffer.writeUInt16LE(channels * 4, 32);
  buffer.writeUInt16LE(32, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * channels * 4, 40);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      buffer.writeFloatLE(samples[i], offset);
      offset += 4;
    }
  }
  return buffer;
}

/** 32-bit float WAV from explicit channels at any rate. */
function floatWavAt(channels: Float64Array[], rate: number): Buffer {
  const frames = channels[0].length;
  const count = channels.length;
  const buffer = Buffer.alloc(44 + frames * count * 4);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + frames * count * 4, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(3, 20);
  buffer.writeUInt16LE(count, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * count * 4, 28);
  buffer.writeUInt16LE(count * 4, 32);
  buffer.writeUInt16LE(32, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * count * 4, 40);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      buffer.writeFloatLE(channel[i], offset);
      offset += 4;
    }
  }
  return buffer;
}

/** Piecewise sine: one frequency per second-long section. */
function sectionTones(frequencies: number[], amplitude = 0.3): Float64Array {
  const samples = new Float64Array(frequencies.length * SAMPLE_RATE);
  frequencies.forEach((frequency, section) => {
    for (let i = 0; i < SAMPLE_RATE; i++) {
      samples[section * SAMPLE_RATE + i] =
        amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
    }
  });
  return samples;
}

/** Decode any audio file to mono float samples at 48 kHz. */
function decodeMono(path: string): Float32Array {
  const raw = execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", "48000", "-f", "f32le", "-c:a", "pcm_f32le", "-"],
    { timeout: 60_000, maxBuffer: 256 * 1024 * 1024 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

/** Dominant frequency by zero-crossing count over [from, to) seconds. */
function zeroCrossingHz(samples: Float32Array, from: number, to: number): number {
  const start = Math.round(from * SAMPLE_RATE);
  const end = Math.round(to * SAMPLE_RATE);
  let crossings = 0;
  for (let i = start + 1; i < end; i++) {
    if ((samples[i - 1] < 0) !== (samples[i] < 0)) crossings++;
  }
  return crossings / 2 / (to - from);
}

/** Tap the graph before the loudness policy, as raw mono float. */
function renderPreLoudness(
  mixArgs: string[],
  { channels = 1, filter }: { channels?: number; filter?: string } = {},
): Float32Array {
  const at = mixArgs.indexOf("-filter_complex");
  const tapped = (filter ?? mixArgs[at + 1])
    .replace(`,${LOUDNORM}[mix]`, "[mix]")
    .replace(`[sum]${LOUDNORM}[mix]`, "[sum]anull[mix]");
  // Keep the render's inputs (with their -ss/-t) and swap the output for raw
  // float at 48 kHz.
  const args = [
    ...mixArgs.slice(0, at),
    "-filter_complex", tapped,
    "-map", "[mix]", "-ac", String(channels), "-f", "f32le", "-c:a", "pcm_f32le", "-",
  ].filter((arg) => arg !== "-y");
  const raw = execFileSync("ffmpeg", args, {
    timeout: 60_000,
    maxBuffer: 256 * 1024 * 1024,
  });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

function probeDurationSeconds(path: string): number {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
    { encoding: "utf8", timeout: 60_000 },
  );
  if (probe.status === 0 && probe.stdout.trim()) {
    return Number(probe.stdout.trim());
  }
  return decodeMono(path).length / SAMPLE_RATE;
}

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Three one-second sections at 220 / 440 / 880 Hz. */
const TONE_GRID: SectionGrid = {
  kind: "time",
  sectionSeconds: 1,
  bpm: null,
  durationSeconds: 3,
  sections: [
    { startSec: 0, endSec: 1 },
    { startSec: 1, endSec: 2 },
    { startSec: 2, endSec: 3 },
  ],
};
const TONE_HZ = [220, 440, 880];

(ffmpegAvailable ? describe : describe.skip)(
  "ffmpeg remix-structure/v1 render (#1899)",
  () => {
    let workDir: string;
    beforeEach(() => {
      workDir = mkdtempSync(join(tmpdir(), "remix-structure-spec-"));
    });
    afterEach(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    it.each([
      { label: "no fx", speed: 1 },
      { label: "speed 0.8", speed: 0.8 },
    ])(
      "reorders and repeats sections; the output lasts the timeline ($label)",
      ({ speed }) => {
        const source = join(workDir, "tones.wav");
        writeFileSync(source, floatWav(sectionTones(TONE_HZ)));
        // 2, 0, 0, 1, 2 → 5 s of timeline.
        const blocks = [2, 0, 0, 1, 2].map((section) => ({ section }));
        const segments = structureTimeline(TONE_GRID, blocks);
        const out = join(workDir, "mix.mp3");
        execFileSync(
          "ffmpeg",
          buildStemMixFfmpegArgs(
            [{ path: source, gainDb: 0, fxStemId: "a" }],
            out,
            speed === 1
              ? null
              : { effects: recipe({ master: { speed } }) },
            { segments },
          ),
          { stdio: "ignore", timeout: 60_000 },
        );
        const expected = 5 / speed;
        expect(Math.abs(probeDurationSeconds(out) - expected)).toBeLessThan(
          0.1,
        );
        // Each block plays its own section (varispeed scales the pitch).
        const decoded = decodeMono(out);
        blocks.forEach((block, index) => {
          const hz = zeroCrossingHz(
            decoded,
            (index + 0.2) / speed,
            (index + 0.8) / speed,
          );
          expect(Math.abs(hz - TONE_HZ[block.section] * speed)).toBeLessThan(
            TONE_HZ[block.section] * 0.05,
          );
        });
      },
    );

    it.each(["wav", "mp3"])(
      "per-run seeked inputs reproduce a full-decode atrim render sample for sample (%s)",
      (format) => {
        // A 6 s 44.1 kHz stereo signal with HF content and noise, cut at
        // boundaries off the 1/50 s seek grid.
        const rate = 44_100;
        const frames = 6 * rate;
        let seed = 1899;
        const noise = () => {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          return seed / 0x7fffffff - 0.5;
        };
        const left = new Float64Array(frames);
        const right = new Float64Array(frames);
        for (let i = 0; i < frames; i++) {
          const t = i / rate;
          left[i] =
            0.3 * Math.sin(2 * Math.PI * 220 * t) +
            0.15 * Math.sin(2 * Math.PI * 6300 * t) +
            0.05 * noise();
          right[i] =
            0.3 * Math.sin(2 * Math.PI * 330 * t) +
            0.1 * Math.sin(2 * Math.PI * 9100 * t) +
            0.05 * noise();
        }
        const wav = join(workDir, "source.wav");
        writeFileSync(wav, floatWavAt([left, right], rate));
        let source = wav;
        if (format === "mp3") {
          // Encoded like the Demucs worker: CBR 320 kbps.
          source = join(workDir, "source.mp3");
          execFileSync(
            "ffmpeg",
            ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-b:a", "320k", source],
            { timeout: 60_000 },
          );
        }
        const grid: SectionGrid = {
          kind: "time",
          sectionSeconds: 1.5,
          bpm: null,
          durationSeconds: 6,
          sections: [
            { startSec: 0, endSec: 1.37 },
            { startSec: 1.37, endSec: 2.9 },
            { startSec: 2.9, endSec: 4.41 },
            { startSec: 4.41, endSec: 6 },
          ],
        };
        const segments = structureTimeline(
          grid,
          [2, 3, 0, 1, 1, 3, 0].map((section) => ({ section })),
        );
        expect(structureRuns(segments)).toHaveLength(5);
        const input = [{ path: source, gainDb: 0, fxStemId: "a" }];
        const mixArgs = buildStemMixFfmpegArgs(
          input,
          join(workDir, "unused.mp3"),
          null,
          { segments },
        );
        const actual = renderPreLoudness(mixArgs, { channels: 2 });

        // Reference: the full-decode front end (one input → asplit → per-block
        // atrim + the same join fades → concat).
        const branchLabels = segments.map((_, k) => `[b${k}]`).join("");
        const branches = segments.map((segment, k) => {
          const filters = [
            `atrim=start=${segment.srcStartSec}:end=${segment.srcEndSec}`,
            "asetpts=PTS-STARTPTS",
          ];
          if (segment.joinFadeIn) filters.push("afade=t=in:st=0:d=0.01");
          if (segment.joinFadeOut) {
            const duration =
              Math.round((segment.srcEndSec - segment.srcStartSec - 0.01) * 1e6) / 1e6;
            filters.push(`afade=t=out:st=${duration}:d=0.01`);
          }
          return `[b${k}]${filters.join(",")}[c${k}]`;
        });
        const reference = renderPreLoudness(
          ["-i", source, "-filter_complex", ""],
          {
            channels: 2,
            filter: [
              `[0:a]${NORMALIZE},apad=whole_dur=6,asplit=${segments.length}${branchLabels}`,
              ...branches,
              `${segments.map((_, k) => `[c${k}]`).join("")}concat=n=${segments.length}:v=0:a=1,volume=0dB[a0]`,
              "[a0]amix=inputs=1:duration=longest:normalize=0[sum]",
              "[sum]anull[mix]",
            ].join(";"),
          },
        );

        const timelineFrames = Math.round(
          segments[segments.length - 1].outEndSec * SAMPLE_RATE,
        );
        expect(Math.abs(actual.length / 2 - timelineFrames)).toBeLessThanOrEqual(1);
        expect(Math.abs(reference.length / 2 - timelineFrames)).toBeLessThanOrEqual(1);
        let maxDiff = 0;
        const n = Math.min(actual.length, reference.length);
        for (let i = 0; i < n; i++) {
          maxDiff = Math.max(maxDiff, Math.abs(actual[i] - reference[i]));
        }
        expect(maxDiff).toBeLessThan(1e-6);
      },
    );

    it("a join fade removes the click where the audio jumps", () => {
      // 50 Hz: section 0 ends mid-cycle at +peak phase (t = 1.005 s would be
      // a peak), so jumping 1 → 0 lands a peak next to a zero crossing.
      const grid: SectionGrid = {
        kind: "time",
        sectionSeconds: 1.005,
        bpm: null,
        durationSeconds: 2.01,
        sections: [
          { startSec: 0, endSec: 1.005 },
          { startSec: 1.005, endSec: 2.01 },
        ],
      };
      const samples = new Float64Array(Math.round(2.01 * SAMPLE_RATE));
      for (let i = 0; i < samples.length; i++) {
        samples[i] = 0.5 * Math.sin((2 * Math.PI * 50 * i) / SAMPLE_RATE);
      }
      const source = join(workDir, "sine.wav");
      writeFileSync(source, floatWav(samples));
      const segments = structureTimeline(grid, [{ section: 0 }, { section: 0 }]);
      expect(segments[0].joinFadeOut).toBe(true);
      expect(segments[1].joinFadeIn).toBe(true);
      const boundary = Math.round(1.005 * SAMPLE_RATE);

      const maxJumpNearBoundary = (withFades: RemixStructureSegment[]) => {
        const rendered = renderPreLoudness(
          buildStemMixFfmpegArgs(
            [{ path: source, gainDb: 0, fxStemId: "a" }],
            join(workDir, "unused.mp3"),
            null,
            { segments: withFades },
          ),
        );
        let maxJump = 0;
        for (let i = boundary - 960; i < boundary + 960; i++) {
          maxJump = Math.max(maxJump, Math.abs(rendered[i] - rendered[i - 1]));
        }
        return maxJump;
      };
      // The natural per-sample slope of a 0.5-amplitude 50 Hz sine.
      const naturalSlope = (0.5 * 2 * Math.PI * 50) / SAMPLE_RATE;
      const withoutFades = maxJumpNearBoundary(
        segments.map((segment) => ({
          ...segment,
          joinFadeIn: false,
          joinFadeOut: false,
        })),
      );
      const withFades = maxJumpNearBoundary(segments);
      // The hard cut jumps by (nearly) the full 0.5 peak; the 10 ms join fade
      // keeps every step within a couple of natural slopes.
      expect(withoutFades).toBeGreaterThan(0.4);
      expect(withFades).toBeLessThan(3 * naturalSlope);
    });

    it("a last-block fade-out ends silent, including the reverb tail", async () => {
      const afirOptions = await resolveAfirUnityGainOptions();
      if (afirOptions !== AFIR_UNITY_GAIN_OPTIONS) return; // ffmpeg < 7
      const source = join(workDir, "tones.wav");
      writeFileSync(source, floatWav(sectionTones(TONE_HZ)));
      const ir = join(workDir, "reverb-ir.wav");
      await writeImpulseWav(ir);
      const fx: StemMixFfmpegFx = {
        effects: recipe({ master: { space: 1 } }),
        impulsePath: ir,
        afirOptions,
      };
      const render = (blocks: RemixStructureBlock[]) => {
        const out = join(workDir, `mix-${blocks.length}-${Date.now()}.mp3`);
        execFileSync(
          "ffmpeg",
          buildStemMixFfmpegArgs(
            [{ path: source, gainDb: 0, fxStemId: "a" }],
            out,
            fx,
            { segments: structureTimeline(TONE_GRID, blocks) },
          ),
          { stdio: "ignore", timeout: 60_000 },
        );
        return decodeMono(out);
      };
      const peakAfter = (samples: Float32Array, fromSec: number) => {
        let peak = 0;
        for (let i = Math.round(fromSec * SAMPLE_RATE); i < samples.length; i++) {
          peak = Math.max(peak, Math.abs(samples[i]));
        }
        return peak;
      };
      // Timeline 0, 1, 2 → 3 s, then the 2.8 s reverb tail.
      const faded = render([
        { section: 0 },
        { section: 1 },
        { section: 2, fadeOut: true },
      ]);
      const unfaded = render([{ section: 1 }, { section: 0 }, { section: 2 }]);
      expect(faded.length / SAMPLE_RATE).toBeGreaterThan(5.5);
      // Without a fade the reverb tail rings audibly past the timeline end.
      expect(peakAfter(unfaded, 3.1)).toBeGreaterThan(0.01);
      // With the held fade-out everything after the timeline is silent
      // (mp3 codec noise only).
      expect(peakAfter(faded, 3.05)).toBeLessThan(1e-3);
    });
  },
);
