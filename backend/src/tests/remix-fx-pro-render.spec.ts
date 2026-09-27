/**
 * remix-fx/v3 Pro EQ and pan (#1903 S6a) — ffmpeg-gated render checks
 * (skipped when ffmpeg is absent, like the #1897 render tests).
 *
 * The render's actual magnitude response is measured with steady-state
 * tones at 50, 200, 1k, 4k and 12k Hz and compared with the analytic Audio
 * EQ Cookbook response the preview's BiquadFilterNodes implement (within
 * 0.1 dB). The pan is measured as a stereo matrix, for a stereo stem and for
 * a probed mono stem (explicit unity up-mix first).
 */

import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  biquadMagnitudeDb,
  eqBiquadCoefficients,
  panGains,
  stemEqStages,
  type RemixFxStem,
} from "../modules/remix/remix-fx";
import {
  buildStemMixFfmpegArgs,
  probeAudioChannels,
} from "../modules/remix/stem-audio-mixer";

const SAMPLE_RATE = 48_000;
/** 9600 samples: a whole number of periods of every test tone. */
const WINDOW = 9_600;
const AMPLITUDE = 0.25;
const EQ_FREQUENCIES = [50, 200, 1_000, 4_000, 12_000];

/** 32-bit float WAV from explicit channel data. */
function floatWav(channels: Float64Array[], sampleRate = SAMPLE_RATE): Buffer {
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

function tone(frequency: number, frames: number, from = 0): Float64Array {
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = AMPLITUDE * Math.sin((2 * Math.PI * frequency * (from + i)) / SAMPLE_RATE);
  }
  return out;
}

/**
 * Amplitude of the `frequency` component of interleaved float `raw` channel
 * `channel`, over WINDOW frames from `start` (exact for whole periods).
 */
function amplitudeAt(
  raw: Buffer,
  channels: number,
  channel: number,
  start: number,
  frequency: number,
): number {
  let sin = 0;
  let cos = 0;
  for (let i = 0; i < WINDOW; i++) {
    const frame = start + i;
    const value = raw.readFloatLE((frame * channels + channel) * 4);
    const phase = (2 * Math.PI * frequency * frame) / SAMPLE_RATE;
    sin += value * Math.sin(phase);
    cos += value * Math.cos(phase);
  }
  return (2 / WINDOW) * Math.hypot(sin, cos);
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
  "ffmpeg remix-fx/v3 Pro EQ and pan render (#1903)",
  () => {
    let workDir: string;
    beforeEach(() => {
      workDir = mkdtempSync(join(tmpdir(), "remix-fx-pro-spec-"));
    });
    afterEach(() => {
      rmSync(workDir, { recursive: true, force: true });
    });

    /**
     * Runs the render's own per-stem chain (the graph up to [a0]) on `input`
     * and returns raw interleaved float output.
     */
    function renderStemChain(
      input: string,
      stemFx: RemixFxStem,
      channels?: number,
    ): Buffer {
      const args = buildStemMixFfmpegArgs(
        [{ path: input, gainDb: 0, fxStemId: "a", ...(channels ? { channels } : {}) }],
        join(workDir, "unused.mp3"),
        { effects: { schemaVersion: "remix-fx/v3", stems: { a: stemFx } } },
      );
      const chain = args[args.indexOf("-filter_complex") + 1].split(";")[0];
      expect(chain.endsWith("[a0]")).toBe(true);
      return execFileSync(
        "ffmpeg",
        [
          "-hide_banner", "-loglevel", "error", "-i", input,
          "-filter_complex", chain,
          "-map", "[a0]", "-f", "f32le", "-c:a", "pcm_f32le", "-",
        ],
        { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
      );
    }

    /** One second per test tone, measured over its second half. */
    function eqResponseErrorsDb(stemFx: RemixFxStem): number[] {
      const segment = SAMPLE_RATE;
      const signal = new Float64Array(segment * EQ_FREQUENCIES.length);
      EQ_FREQUENCIES.forEach((frequency, index) => {
        signal.set(tone(frequency, segment, index * segment), index * segment);
      });
      const input = join(workDir, "tones.wav");
      writeFileSync(input, floatWav([signal, signal]));
      const raw = renderStemChain(input, stemFx);
      expect(raw.length / 8).toBe(signal.length);
      const stages = stemEqStages(stemFx);
      return EQ_FREQUENCIES.map((frequency, index) => {
        const expectedDb = stages.reduce(
          (sum, stage) =>
            sum +
            biquadMagnitudeDb(
              eqBiquadCoefficients(stage.band, stage.gainDb, SAMPLE_RATE),
              frequency,
              SAMPLE_RATE,
            ),
          0,
        );
        const start = index * segment + segment / 2;
        const errors = [0, 1].map((channel) => {
          const measured = amplitudeAt(raw, 2, channel, start, frequency);
          return Math.abs(20 * Math.log10(measured / AMPLITUDE) - expectedDb);
        });
        return Math.max(...errors);
      });
    }

    it.each([
      { eqLow: 6, eqMid: -4.5, eqHigh: 3 },
      { eqLow: -12, eqMid: 12, eqHigh: -12 },
      { eqLow: 12, eqHigh: 12 },
      { eqMid: -12 },
    ])(
      "matches the analytic cookbook magnitude within 0.1 dB (%o)",
      (stemFx) => {
        const errors = eqResponseErrorsDb(stemFx);
        // Reported for the delivery notes (max |error| per frequency).
        reportMeasurement(`EQ ${JSON.stringify(stemFx)} |error| dB @ ${EQ_FREQUENCIES.join("/")} Hz: ${errors.map((e) => e.toExponential(2)).join(", ")}`);
        for (const error of errors) expect(error).toBeLessThanOrEqual(0.1);
      },
    );

    it("applies the equal-power pan matrix to a stereo stem", () => {
      // Left 500 Hz, right 750 Hz: both whole periods in the window.
      const frames = SAMPLE_RATE;
      const input = join(workDir, "stereo.wav");
      writeFileSync(input, floatWav([tone(500, frames), tone(750, frames)]));
      for (const pan of [-0.3, 0.6, -1, 1]) {
        const raw = renderStemChain(input, { pan });
        const { matrix } = panGains(pan)!;
        const start = frames / 2;
        const measure = (channel: number, frequency: number) =>
          amplitudeAt(raw, 2, channel, start, frequency) / AMPLITUDE;
        expect(Math.abs(measure(0, 500) - matrix.ll)).toBeLessThan(1e-4);
        expect(Math.abs(measure(0, 750) - matrix.lr)).toBeLessThan(1e-4);
        expect(Math.abs(measure(1, 500) - matrix.rl)).toBeLessThan(1e-4);
        expect(Math.abs(measure(1, 750) - matrix.rr)).toBeLessThan(1e-4);
      }
    });

    it("probes a mono stem and up-mixes it at unity before the pan", async () => {
      const frames = SAMPLE_RATE;
      const mono = join(workDir, "mono.wav");
      writeFileSync(mono, floatWav([tone(500, frames)]));
      const stereo = join(workDir, "stereo.wav");
      writeFileSync(stereo, floatWav([tone(500, frames), tone(500, frames)]));
      expect(await probeAudioChannels(mono)).toBe(1);
      expect(await probeAudioChannels(stereo)).toBe(2);

      const pan = 0.3;
      const raw = renderStemChain(mono, { pan }, await probeAudioChannels(mono));
      expect(raw.length / 8).toBe(frames); // stereo out
      const { gL, gR } = panGains(pan)!;
      const start = frames / 2;
      // L = R = M: L' = M·gL, R' = M + M·gR.
      expect(
        Math.abs(amplitudeAt(raw, 2, 0, start, 500) / AMPLITUDE - gL),
      ).toBeLessThan(1e-4);
      expect(
        Math.abs(amplitudeAt(raw, 2, 1, start, 500) / AMPLITUDE - (1 + gR)),
      ).toBeLessThan(1e-4);
    });
  },
);

function reportMeasurement(message: string): void {
  if (process.env.REMIX_FX_PRO_LOG) process.stdout.write(`${message}\n`);
}
