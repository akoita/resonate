/**
 * remix-fx/v4 punch compressor (#1903 S6b) — ffmpeg-gated parity checks
 * (skipped when ffmpeg is absent, like the other remix-fx render tests).
 *
 * 1. The port (remix-punch-compressor.ts) against a live ffmpeg
 *    `acompressor` run, in double precision, on the fixture's deterministic
 *    signal: every sample within 1e-9 (in practice ~1e-16).
 * 2. The render's own per-stem chain (float WAV in, float out) against the
 *    port on the same float input: within 1e-6 (float32 output rounding).
 *
 * `UPDATE_REMIX_FX_DYN_FIXTURE=1` rewrites remix-fx-dyn-v1.parity.json from
 * live ffmpeg output (only on a deliberate mapping change, with a new
 * REMIX_FX_DYN_DSP_VERSION).
 */

import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  punchCompressor,
  REMIX_FX_DYN_DSP_VERSION,
  REMIX_FX_SCHEMA_VERSION,
  type RemixFxPunchCompressor,
} from "../modules/remix/remix-fx";
import {
  createAcompressorState,
  processAcompressor,
} from "../modules/remix/remix-punch-compressor";
import {
  buildStemMixFfmpegArgs,
  punchCompressorFilter,
} from "../modules/remix/stem-audio-mixer";
import {
  DYN_FIXTURE_PATH,
  DYN_PUNCH_POINTS,
  DYN_SIGNAL_CASES,
  punchSignal,
  type DynFixture,
} from "./remix-fx-dyn.fixture";

const ffmpegAvailable = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

function interleavedF64(channels: Float64Array[]): Buffer {
  const frames = channels[0].length;
  const buffer = Buffer.alloc(frames * channels.length * 8);
  let offset = 0;
  for (let i = 0; i < frames; i++) {
    for (const channel of channels) {
      buffer.writeDoubleLE(channel[i], offset);
      offset += 8;
    }
  }
  return buffer;
}

function floatWav(channels: Float64Array[], sampleRate: number): Buffer {
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

/** Live ffmpeg acompressor in double precision; planar channels out. */
function ffmpegAcompressor(
  channels: Float64Array[],
  sampleRate: number,
  punch: RemixFxPunchCompressor,
): Float64Array[] {
  const raw = execFileSync(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error",
      "-f", "f64le", "-ar", String(sampleRate), "-ac", String(channels.length),
      "-i", "pipe:0",
      "-af", punchCompressorFilter(punch),
      "-f", "f64le", "pipe:1",
    ],
    { input: interleavedF64(channels), timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
  );
  const frames = raw.length / 8 / channels.length;
  return channels.map((_, c) => {
    const out = new Float64Array(frames);
    for (let i = 0; i < frames; i++) {
      out[i] = raw.readDoubleLE((i * channels.length + c) * 8);
    }
    return out;
  });
}

function portAcompressor(
  channels: Float64Array[],
  sampleRate: number,
  punch: RemixFxPunchCompressor,
): Float64Array[] {
  const state = createAcompressorState(punch, sampleRate);
  const out = channels.map((channel) => new Float64Array(channel.length));
  processAcompressor(state, channels, out, channels[0].length);
  return out;
}

function maxAbsDiff(a: Float64Array[], b: Float64Array[]): number {
  let max = 0;
  a.forEach((channel, c) => {
    expect(b[c].length).toBe(channel.length);
    for (let i = 0; i < channel.length; i++) {
      max = Math.max(max, Math.abs(channel[i] - b[c][i]));
    }
  });
  return max;
}

(ffmpegAvailable ? describe : describe.skip)(
  "ffmpeg remix-fx/v4 punch compressor parity (#1903 S6b)",
  () => {
    let workDir: string;
    beforeEach(() => {
      workDir = mkdtempSync(join(tmpdir(), "remix-fx-dyn-spec-"));
    });
    afterEach(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    it.each(DYN_SIGNAL_CASES)(
      "the port matches live ffmpeg acompressor (punch $punch, $sampleRate Hz, $channels ch)",
      ({ punch, sampleRate, channels }) => {
        const mapping = punchCompressor(punch)!;
        const signal = punchSignal(sampleRate, channels);
        const expected = ffmpegAcompressor(signal, sampleRate, mapping);
        const actual = portAcompressor(signal, sampleRate, mapping);
        expect(maxAbsDiff(expected, actual)).toBeLessThanOrEqual(1e-9);
      },
    );

    it("the render's per-stem chain runs the same compressor", () => {
      const sampleRate = 48_000;
      const signal = punchSignal(sampleRate, 2);
      const input = join(workDir, "punch.wav");
      writeFileSync(input, floatWav(signal, sampleRate));
      const args = buildStemMixFfmpegArgs(
        [{ path: input, gainDb: 0, fxStemId: "a" }],
        join(workDir, "unused.mp3"),
        { effects: { schemaVersion: REMIX_FX_SCHEMA_VERSION, stems: { a: { punch: 0.8 } } } },
      );
      const chain = args[args.indexOf("-filter_complex") + 1].split(";")[0];
      expect(chain).toContain("acompressor=");
      expect(chain.endsWith("[a0]")).toBe(true);
      const raw = execFileSync(
        "ffmpeg",
        [
          "-hide_banner", "-loglevel", "error", "-i", input,
          "-filter_complex", chain,
          "-map", "[a0]", "-f", "f32le", "-c:a", "pcm_f32le", "-",
        ],
        { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
      );
      const frames = raw.length / 8;
      const rendered = [0, 1].map((c) => {
        const out = new Float64Array(frames);
        for (let i = 0; i < frames; i++) out[i] = raw.readFloatLE((i * 2 + c) * 4);
        return out;
      });
      // The render reads the stem as float32: compress the same input.
      const float32Input = signal.map((channel) => Float64Array.from(new Float32Array(channel)));
      const port = portAcompressor(float32Input, sampleRate, punchCompressor(0.8)!);
      expect(maxAbsDiff(port, rendered)).toBeLessThanOrEqual(1e-6);
    });

    if (process.env.UPDATE_REMIX_FX_DYN_FIXTURE === "1") {
      it("rewrites the committed fixture from live ffmpeg", () => {
        const fixture: DynFixture = {
          schemaVersion: REMIX_FX_SCHEMA_VERSION,
          dspVersion: REMIX_FX_DYN_DSP_VERSION,
          note:
            "Parity fixture for #1903 S6b (Pro punch compressor). `mapping` pins punchCompressor(punch); `signals` pin live ffmpeg acompressor output (double precision, every `checkpointEvery`-th frame) for the deterministic punchSignal. The backend port and the web preview port must reproduce mapping exactly and checkpoints within 1e-9. Regenerate only with a new dspVersion (UPDATE_REMIX_FX_DYN_FIXTURE=1).",
          ffmpegVersion: execFileSync("ffmpeg", ["-version"]).toString().split("\n")[0],
          mapping: DYN_PUNCH_POINTS.map((punch) => ({
            punch,
            compressor: punchCompressor(punch),
          })),
          filter: DYN_PUNCH_POINTS.filter((punch) => punch > 0).map((punch) => ({
            punch,
            filter: punchCompressorFilter(punchCompressor(punch)!),
          })),
          checkpointEvery: 250,
          signals: DYN_SIGNAL_CASES.map(({ punch, sampleRate, channels }) => {
            const output = ffmpegAcompressor(
              punchSignal(sampleRate, channels),
              sampleRate,
              punchCompressor(punch)!,
            );
            return {
              punch,
              sampleRate,
              channels,
              checkpoints: output.map((channel) =>
                Array.from(channel).filter((_, i) => i % 250 === 0),
              ),
            };
          }),
        };
        writeFileSync(DYN_FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
      });
    }
  },
);
