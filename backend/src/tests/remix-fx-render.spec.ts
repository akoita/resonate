/**
 * remix-fx/v1 render graph (#1897) — ffmpeg arg construction (pure) plus
 * ffmpeg-gated render checks (skipped when ffmpeg is absent, like the #1189
 * smoke tests).
 */

import { execFileSync, spawnSync } from "child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildSectionGateVolumeExpression } from "../modules/remix/remix-arrangement";
import {
  buildImpulseWav,
  generateReverbImpulse,
  writeImpulseWav,
  type RemixFxRecipe,
} from "../modules/remix/remix-fx";
import {
  AFIR_UNITY_GAIN_OPTIONS,
  buildStemMixFfmpegArgs,
  resolveAfirUnityGainOptions,
  type StemMixFfmpegInput,
} from "../modules/remix/stem-audio-mixer";

const LOUDNORM = "loudnorm=I=-14:LRA=11:TP=-1.5";

function filterOf(args: string[]): string {
  return args[args.indexOf("-filter_complex") + 1];
}

function inputsOf(args: string[]): string[] {
  const out: string[] = [];
  args.forEach((arg, index) => {
    if (arg === "-i") out.push(args[index + 1]);
  });
  return out;
}

const recipe = (value: Omit<RemixFxRecipe, "schemaVersion">): RemixFxRecipe => ({
  schemaVersion: "remix-fx/v1",
  ...value,
});

describe("buildStemMixFfmpegArgs without effects (#1897 identity)", () => {
  const cases: Array<[string, StemMixFfmpegInput[]]> = [
    ["plain stems", [
      { path: "/tmp/a.audio", gainDb: 0 },
      { path: "/tmp/b.audio", gainDb: -6.5 },
    ]],
    ["gated stems + an AI layer", [
      {
        path: "/tmp/a.audio",
        gainDb: 1.5,
        activeIntervals: [
          { startSec: 0, endSec: 8 },
          { startSec: 16, endSec: 24.5 },
        ],
        fxStemId: "stem-a",
      },
      { path: "/tmp/layer.wav", gainDb: 0, aiLayer: true },
    ]],
  ];

  it.each(cases)("is byte-identical for %s", (_label, inputs) => {
    const baseline = buildStemMixFfmpegArgs(inputs, "/tmp/mix.mp3");
    for (const fx of [
      undefined,
      null,
      { effects: null },
      { effects: null, bpm: 120, impulsePath: "/tmp/ir.wav" },
    ]) {
      expect(buildStemMixFfmpegArgs(inputs, "/tmp/mix.mp3", fx)).toEqual(
        baseline,
      );
    }
  });

  it("keeps the exact pre-#1897 graph for gated stems", () => {
    const intervals = [
      { startSec: 0, endSec: 8 },
      { startSec: 16, endSec: 24.5 },
    ];
    const args = buildStemMixFfmpegArgs(
      [
        { path: "/tmp/a.audio", gainDb: 1.5, activeIntervals: intervals },
        { path: "/tmp/layer.wav", gainDb: 0 },
      ],
      "/tmp/mix.mp3",
      { effects: null },
    );
    expect(args).toEqual([
      "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
      "-i", "/tmp/a.audio",
      "-i", "/tmp/layer.wav",
      "-filter_complex",
      `[0:a]volume=1.5dB,volume=volume=${buildSectionGateVolumeExpression(intervals)}:eval=frame[a0];[1:a]volume=0dB[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0[sum];[sum]${LOUDNORM}[mix]`,
      "-map", "[mix]",
      "-codec:a", "libmp3lame",
      "-b:a", "320k",
      "-ar", "48000",
      "-ac", "2",
      "/tmp/mix.mp3",
    ]);
  });
});

describe("buildStemMixFfmpegArgs with remix-fx/v1 (#1897)", () => {
  it("emits the full contract chain in order", () => {
    const args = buildStemMixFfmpegArgs(
      [
        {
          path: "/tmp/a.audio",
          gainDb: -3,
          activeIntervals: [{ startSec: 8.5, endSec: 17 }],
          fxStemId: "stem-a",
        },
        { path: "/tmp/b.audio", gainDb: 0, fxStemId: "stem-b" },
      ],
      "/tmp/mix.mp3",
      {
        effects: recipe({
          master: { speed: 0.85, space: 0.45, tone: 0.5, warmth: 0.25 },
          stems: { "stem-a": { tone: -0.5, echo: 1, space: 0.3 } },
        }),
        bpm: 108,
        impulsePath: "/tmp/ir.wav",
      },
    );

    expect(inputsOf(args)).toEqual(["/tmp/a.audio", "/tmp/b.audio", "/tmp/ir.wav"]);
    // Gate intervals divided by the speed: 8.5/0.85 = 10, 17/0.85 = 20.
    const gate = buildSectionGateVolumeExpression([{ startSec: 10, endSec: 20 }]);
    expect(filterOf(args).split(";")).toEqual([
      `[0:a]aresample=48000,aformat=sample_fmts=fltp,asetrate=40800,aresample=48000,volume=-3dB,volume=volume=${gate}:eval=frame,lowpass=f=4000:width_type=q:width=0.7071,aecho=in_gain=1:out_gain=1:delays=490.196078|980.392157|1470.588235|1960.784314:decays=0.5|0.3|0.18|0.108,asplit=2[d0][s0]`,
      // 0.7·(1 − 0.7·0.55) = 0.4305
      "[s0]volume=0.4305[w0]",
      "[1:a]aresample=48000,aformat=sample_fmts=fltp,asetrate=40800,aresample=48000,volume=0dB,asplit=2[d1][s1]",
      // AI-free stem without its own space still sends master.space: 0.7·0.45
      "[s1]volume=0.315[w1]",
      "[w0][w1]amix=inputs=2:duration=longest:normalize=0,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=pad_dur=2.8[rvin]",
      `[rvin][2:a]afir=${AFIR_UNITY_GAIN_OPTIONS}[rv]`,
      "[d0][d1][rv]amix=inputs=3:duration=longest:normalize=0[sum]",
      `[sum]highpass=f=154.919334:width_type=q:width=0.7071,aeval=exprs=tanh(2*val(ch))/tanh(2):channel_layout=same,${LOUDNORM}[mix]`,
    ]);
    expect(args.slice(-11)).toEqual([
      "-map", "[mix]", "-codec:a", "libmp3lame", "-b:a", "320k",
      "-ar", "48000", "-ac", "2", "/tmp/mix.mp3",
    ]);
  });

  it("skips varispeed at speed 1 and the reverb bus without any space", () => {
    const args = buildStemMixFfmpegArgs(
      [{ path: "/tmp/a.audio", gainDb: 0, fxStemId: "stem-a" }],
      "/tmp/mix.mp3",
      {
        effects: recipe({ stems: { "stem-a": { tone: 1, echo: 0.35 } } }),
        bpm: null,
      },
    );
    expect(inputsOf(args)).toEqual(["/tmp/a.audio"]);
    expect(filterOf(args)).toBe(
      "[0:a]aresample=48000,aformat=sample_fmts=fltp,volume=0dB,highpass=f=1200:width_type=q:width=0.7071,aecho=in_gain=1:out_gain=1:delays=375|750|1125|1500:decays=0.175|0.105|0.063|0.0378[a0];" +
        `[a0]amix=inputs=1:duration=longest:normalize=0[sum];[sum]${LOUDNORM}[mix]`,
    );
  });

  it("uses the bpm-less dotted-eighth fallback divided by speed", () => {
    const filter = filterOf(
      buildStemMixFfmpegArgs(
        [{ path: "/tmp/a.audio", gainDb: 0, fxStemId: "stem-a" }],
        "/tmp/mix.mp3",
        {
          effects: recipe({
            master: { speed: 1.2 },
            stems: { "stem-a": { echo: 0.35 } },
          }),
        },
      ),
    );
    expect(filter).toContain("asetrate=57600,aresample=48000");
    expect(filter).toContain("delays=312.5|625|937.5|1250");
  });

  it("gives AI layers varispeed + a master-space send but no per-stem fx", () => {
    const filter = filterOf(
      buildStemMixFfmpegArgs(
        [
          { path: "/tmp/a.audio", gainDb: 0, fxStemId: "stem-a" },
          // Even if a layer carried a stem id, per-stem fx never apply to it.
          { path: "/tmp/layer.wav", gainDb: 0, aiLayer: true, fxStemId: "stem-a" },
        ],
        "/tmp/mix.mp3",
        {
          effects: recipe({
            master: { speed: 0.75, space: 0.5 },
            stems: { "stem-a": { tone: -1, echo: 0.5, space: 1 } },
          }),
          bpm: 120,
          impulsePath: "/tmp/ir.wav",
        },
      ),
    );
    const parts = filter.split(";");
    expect(parts[0]).toContain("lowpass=f=800:");
    expect(parts[0]).toContain("aecho=");
    expect(parts[1]).toBe("[s0]volume=0.7[w0]");
    expect(parts[2]).toBe(
      "[1:a]aresample=48000,aformat=sample_fmts=fltp,asetrate=36000,aresample=48000,volume=0dB,asplit=2[d1][s1]",
    );
    expect(parts[3]).toBe("[s1]volume=0.35[w1]");
    expect(parts[5]).toBe(`[rvin][2:a]afir=${AFIR_UNITY_GAIN_OPTIONS}[rv]`);
  });

  it("uses caller-provided afir options and a single-send bus", () => {
    const filter = filterOf(
      buildStemMixFfmpegArgs(
        [
          { path: "/tmp/a.audio", gainDb: 0, fxStemId: "stem-a" },
          { path: "/tmp/b.audio", gainDb: 0, fxStemId: "stem-b" },
        ],
        "/tmp/mix.mp3",
        {
          effects: recipe({ stems: { "stem-b": { space: 0.5 } } }),
          impulsePath: "/tmp/ir.wav",
          afirOptions: "gtype=none",
        },
      ),
    );
    expect(filter).toContain("[0:a]aresample=48000,aformat=sample_fmts=fltp,volume=0dB[a0]");
    expect(filter).toContain("[s1]volume=0.35[w1]");
    expect(filter).toContain("[w1]amix=inputs=1:duration=longest:normalize=0");
    expect(filter).toContain("[rvin][2:a]afir=gtype=none[rv]");
    expect(filter).toContain("[a0][d1][rv]amix=inputs=3");
  });

  it("applies master-only fx (tone, warmth) without touching per-input chains", () => {
    const filter = filterOf(
      buildStemMixFfmpegArgs(
        [{ path: "/tmp/a.audio", gainDb: 2, fxStemId: "stem-a" }],
        "/tmp/mix.mp3",
        { effects: recipe({ master: { tone: -0.25, warmth: 1 } }) },
      ),
    );
    expect(filter).toBe(
      "[0:a]aresample=48000,aformat=sample_fmts=fltp,volume=2dB[a0];" +
        "[a0]amix=inputs=1:duration=longest:normalize=0[sum];" +
        `[sum]lowpass=f=8944.27191:width_type=q:width=0.7071,aeval=exprs=tanh(5*val(ch))/tanh(5):channel_layout=same,${LOUDNORM}[mix]`,
    );
  });

  it("refuses a reverb send without the impulse file", () => {
    expect(() =>
      buildStemMixFfmpegArgs(
        [{ path: "/tmp/a.audio", gainDb: 0 }],
        "/tmp/mix.mp3",
        { effects: recipe({ master: { space: 0.2 } }) },
      ),
    ).toThrow(/impulse/);
  });
});

/** 16-bit PCM WAV sine; stereo by default at 48 kHz. */
function sineWav(
  frequency: number,
  seconds: number,
  { sampleRate = 48_000, channels = 2, amplitude = 12_000 } = {},
): Buffer {
  const frames = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i++) {
    const value = Math.round(
      Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude,
    );
    for (let ch = 0; ch < channels; ch++) {
      data.writeInt16LE(value, (i * channels + ch) * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** 32-bit float stereo WAV from explicit channel data. */
function floatWav(channels: Float64Array[], sampleRate = 48_000): Buffer {
  const frames = channels[0].length;
  const buffer = Buffer.alloc(44 + frames * channels.length * 4);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + frames * channels.length * 4, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(3, 20);
  buffer.writeUInt16LE(channels.length, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels.length * 4, 28);
  buffer.writeUInt16LE(channels.length * 4, 32);
  buffer.writeUInt16LE(32, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * channels.length * 4, 40);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      buffer.writeFloatLE(channel[i], offset);
      offset += 4;
    }
  }
  return buffer;
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
  // ffprobe missing: decode with ffmpeg and read the final time stamp.
  const decoded = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", path, "-f", "null", "-"],
    { encoding: "utf8", timeout: 60_000 },
  );
  const times = [...decoded.stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  const last = times[times.length - 1];
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

(ffmpegAvailable ? describe : describe.skip)(
  "ffmpeg remix-fx/v1 render (#1897)",
  () => {
    let workDir: string;
    beforeEach(() => {
      workDir = mkdtempSync(join(tmpdir(), "remix-fx-spec-"));
    });
    afterEach(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    it.each([
      // No reverb send: the render is exactly the varispeed-stretched input.
      { label: "space 0", space: 0, tailSeconds: 0 },
      // A reverb send rings out the full 2.8 s IR tail after the input ends.
      { label: "space 0.5", space: 0.5, tailSeconds: 2.8 },
    ])(
      "varispeed stretches the output by 1/speed ($label)",
      async ({ space, tailSeconds }) => {
        const a = join(workDir, "a.wav");
        const b = join(workDir, "b.wav");
        writeFileSync(a, sineWav(440, 3));
        writeFileSync(b, sineWav(660, 3, { sampleRate: 44_100, channels: 1 }));
        const ir = join(workDir, "reverb-ir.wav");
        await writeImpulseWav(ir);
        const out = join(workDir, "mix.mp3");
        execFileSync(
          "ffmpeg",
          buildStemMixFfmpegArgs(
            [
              { path: a, gainDb: 0, fxStemId: "a" },
              { path: b, gainDb: -6, fxStemId: "b" },
            ],
            out,
            {
              effects: {
                schemaVersion: "remix-fx/v1",
                master: { speed: 0.85, ...(space > 0 ? { space } : {}) },
              },
              impulsePath: ir,
              afirOptions: await resolveAfirUnityGainOptions(),
            },
          ),
          { stdio: "ignore", timeout: 60_000 },
        );
        const duration = probeDurationSeconds(out);
        const expected = 3 / 0.85 + tailSeconds;
        expect(Math.abs(duration - expected) / expected).toBeLessThanOrEqual(
          0.02,
        );
      },
    );

    it("the padded reverb bus rings out the IR tail after the last send", async () => {
      const afirOptions = await resolveAfirUnityGainOptions();
      if (afirOptions !== AFIR_UNITY_GAIN_OPTIONS) return; // ffmpeg < 7
      // One impulse 100 samples before the end of a 1 s input.
      const impulse = new Float64Array(48_000);
      impulse[48_000 - 100] = 0.5;
      const input = join(workDir, "late-impulse.wav");
      writeFileSync(input, floatWav([impulse, impulse]));
      const ir = join(workDir, "reverb-ir.wav");
      await writeImpulseWav(ir);
      const args = buildStemMixFfmpegArgs(
        [{ path: input, gainDb: 0, fxStemId: "a" }],
        join(workDir, "unused.mp3"),
        {
          effects: { schemaVersion: "remix-fx/v1", master: { space: 1 } },
          impulsePath: ir,
          afirOptions,
        },
      );
      // Tap the reverb bus itself: the graph up to [rv], as raw float.
      const filter = args[args.indexOf("-filter_complex") + 1]
        .split(";")
        .filter((part) => !part.includes("[sum]") && !part.startsWith("[d0]"))
        .join(";");
      const raw = execFileSync(
        "ffmpeg",
        [
          "-hide_banner", "-loglevel", "error", "-i", input, "-i", ir,
          "-filter_complex", `${filter};[d0]anullsink`,
          "-map", "[rv]", "-f", "f32le", "-c:a", "pcm_f32le", "-",
        ],
        { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
      );
      const frames = raw.length / 8;
      expect(frames).toBe(48_000 + 2.8 * 48_000);
      // Everything after the input's end is the IR tail, at the send level.
      const left = generateReverbImpulse(48_000, 1896);
      const wet = 0.7;
      let maxError = 0;
      let tailEnergy = 0;
      for (let frame = 48_000; frame < frames; frame++) {
        const j = frame - (48_000 - 100);
        const expected = j < left.length ? wet * 0.5 * left[j] : 0;
        const actual = raw.readFloatLE(frame * 8);
        tailEnergy += actual * actual;
        maxError = Math.max(maxError, Math.abs(actual - expected));
      }
      expect(tailEnergy).toBeGreaterThan(0.99 * (wet * 0.5) ** 2);
      expect(maxError).toBeLessThan(1e-6);
    });

    it("gates sections in output time after varispeed", () => {
      const a = join(workDir, "a.wav");
      writeFileSync(a, sineWav(440, 4));
      const out = join(workDir, "mix.mp3");
      execFileSync(
        "ffmpeg",
        buildStemMixFfmpegArgs(
          [
            {
              path: a,
              gainDb: 0,
              fxStemId: "a",
              // Source-time 0..1.7 s → output-time 0..2 s at speed 0.85.
              activeIntervals: [{ startSec: 0, endSec: 1.7 }],
            },
          ],
          out,
          { effects: { schemaVersion: "remix-fx/v1", master: { speed: 0.85 } } },
        ),
        { stdio: "ignore", timeout: 60_000 },
      );
      const detected = spawnSync(
        "ffmpeg",
        ["-hide_banner", "-i", out, "-af", "silencedetect=n=-50dB:d=0.3", "-f", "null", "-"],
        { encoding: "utf8", timeout: 60_000 },
      );
      const match = detected.stderr.match(/silence_start:\s*([\d.]+)/);
      expect(match).not.toBeNull();
      expect(Math.abs(Number(match![1]) - 2)).toBeLessThanOrEqual(0.1);
    });

    it("renders echo/space/tone/warmth and still applies the loudness policy", async () => {
      const a = join(workDir, "a.wav");
      const b = join(workDir, "b.wav");
      const layer = join(workDir, "layer.wav");
      writeFileSync(a, sineWav(220, 8));
      writeFileSync(b, sineWav(880, 8, { amplitude: 6_000 }));
      writeFileSync(layer, sineWav(330, 8, { sampleRate: 44_100 }));
      const ir = join(workDir, "reverb-ir.wav");
      await writeImpulseWav(ir);
      const out = join(workDir, "mix.mp3");
      execFileSync(
        "ffmpeg",
        buildStemMixFfmpegArgs(
          [
            { path: a, gainDb: 0, fxStemId: "a" },
            { path: b, gainDb: -3, fxStemId: "b" },
            { path: layer, gainDb: 0, aiLayer: true },
          ],
          out,
          {
            effects: {
              schemaVersion: "remix-fx/v1",
              master: { speed: 0.85, space: 0.45, tone: -0.2, warmth: 0.5 },
              stems: {
                a: { echo: 0.6, tone: 0.3, space: 0.4 },
                b: { echo: 0.3, tone: -0.6 },
              },
            },
            bpm: 96,
            impulsePath: ir,
            afirOptions: await resolveAfirUnityGainOptions(),
          },
        ),
        { stdio: "ignore", timeout: 120_000 },
      );
      expect(existsSync(out)).toBe(true);
      expect(statSync(out).size).toBeGreaterThan(1000);

      const measured = spawnSync(
        "ffmpeg",
        ["-hide_banner", "-nostats", "-i", out, "-af", "ebur128=peak=true", "-f", "null", "-"],
        { encoding: "utf8", timeout: 60_000 },
      );
      expect(measured.status).toBe(0);
      const summary = measured.stderr.slice(measured.stderr.lastIndexOf("Summary:"));
      const integrated = Number(summary.match(/I:\s*(-?[\d.]+) LUFS/)![1]);
      const truePeak = Number(summary.match(/Peak:\s*(-?[\d.]+) dBFS/)![1]);
      // Policy: -14 LUFS integrated, -1.5 dBTP ceiling (single-pass loudnorm
      // tolerance + mp3 encoding).
      expect(Math.abs(integrated - -14)).toBeLessThanOrEqual(1.5);
      expect(truePeak).toBeLessThanOrEqual(-0.5);
    });

    it("convolves the reverb bus at unity with the energy-normalized IR", async () => {
      const afirOptions = await resolveAfirUnityGainOptions();
      if (afirOptions !== AFIR_UNITY_GAIN_OPTIONS) {
        // ffmpeg < 7 lacks irnorm; level parity is only guaranteed on >= 7.
        return;
      }
      const impulse = new Float64Array(48_000);
      impulse[100] = 0.5;
      const input = join(workDir, "impulse.wav");
      writeFileSync(input, floatWav([impulse, impulse]));
      const ir = join(workDir, "reverb-ir.wav");
      writeFileSync(ir, buildImpulseWav());
      const raw = execFileSync(
        "ffmpeg",
        [
          "-hide_banner", "-loglevel", "error", "-i", input, "-i", ir,
          "-filter_complex", `[0:a][1:a]afir=${afirOptions}[o]`,
          "-map", "[o]", "-f", "f32le", "-c:a", "pcm_f32le", "-",
        ],
        { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
      );
      const left = generateReverbImpulse(48_000, 1896);
      const right = generateReverbImpulse(48_000, 1897);
      let maxError = 0;
      for (let frame = 0; frame < raw.length / 8; frame++) {
        const j = frame - 100;
        const expectedL = j >= 0 && j < left.length ? 0.5 * left[j] : 0;
        const expectedR = j >= 0 && j < right.length ? 0.5 * right[j] : 0;
        maxError = Math.max(
          maxError,
          Math.abs(raw.readFloatLE(frame * 8) - expectedL),
          Math.abs(raw.readFloatLE(frame * 8 + 4) - expectedR),
        );
      }
      // float32 FFT convolution noise only; a gain error would be ~1e-2.
      expect(maxError).toBeLessThan(1e-6);
    });
  },
);
