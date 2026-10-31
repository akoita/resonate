import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  formatFxPunch,
  normalizeRemixFx,
  punchCompressor,
  remixFxHasPunch,
  remixFxStemPro,
  REMIX_FX_DYN_DSP_VERSION,
  REMIX_FX_SCHEMA_VERSION,
  REMIX_FX_V3_SCHEMA_VERSION,
  type RemixPunchCompressor,
} from "./remixFx";
import { createAcompressorState, processAcompressor } from "./remixPunchCompressor";

/**
 * Punch compressor (#1903 S6b): the preview's mapping, its TypeScript port
 * and the AudioWorklet that runs it replay ffmpeg's own acompressor output
 * from the backend's committed fixture within 1e-9.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(
  here,
  "../../../backend/src/modules/remix/remix-fx-dyn-v1.parity.json",
);
const WORKLET_PATH = path.resolve(here, "../../public/worklets/remix-punch-compressor.js");

type DynFixture = {
  schemaVersion: string;
  dspVersion: string;
  mapping: Array<{ punch: number; compressor: RemixPunchCompressor | null }>;
  checkpointEvery: number;
  signals: Array<{
    punch: number;
    sampleRate: number;
    channels: number;
    checkpoints: number[][];
  }>;
};

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as DynFixture;

/** Mirrors backend/src/tests/remix-fx-dyn.fixture.ts `punchSignal`. */
function punchSignal(sampleRate: number, channels: number): Float64Array[] {
  const frames = Math.round(0.5 * sampleRate);
  const out = Array.from({ length: channels }, () => new Float64Array(frames));
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const env = t < 0.125 ? 0.05 : t < 0.29 ? 0.9 : 0.2;
    out[0][i] = env * Math.sin(2 * Math.PI * 220 * t);
    if (channels > 1) out[1][i] = env * 0.6 * Math.sin(2 * Math.PI * 331 * t + 0.3);
  }
  return out;
}

type WorkletProcessor = {
  port: { onmessage: ((event: { data: unknown }) => void) | null };
  process(inputs: Float64Array[][], outputs: Float64Array[][]): boolean;
};

/** Evaluate the worklet module with the AudioWorkletGlobalScope it needs. */
function loadWorklet(sampleRate: number) {
  let registered: { name: string; ctor: new (options: unknown) => WorkletProcessor } | null =
    null;
  class AudioWorkletProcessor {
    port = { onmessage: null };
  }
  vm.runInNewContext(readFileSync(WORKLET_PATH, "utf8"), {
    AudioWorkletProcessor,
    sampleRate,
    registerProcessor(name: string, ctor: new (options: unknown) => WorkletProcessor) {
      registered = { name, ctor };
    },
    Math,
  });
  if (!registered) throw new Error("the worklet did not register a processor");
  return registered as { name: string; ctor: new (options: unknown) => WorkletProcessor };
}

function expectCheckpoints(output: Float64Array[], signal: DynFixture["signals"][number]) {
  signal.checkpoints.forEach((points, c) => {
    points.forEach((expected, k) => {
      expect(Math.abs(output[c][k * fixture.checkpointEvery] - expected)).toBeLessThanOrEqual(1e-9);
    });
  });
}

describe("remix-fx-dyn-dsp/v1 parity (#1903 S6b)", () => {
  it("pins the versions", () => {
    expect(fixture.schemaVersion).toBe(REMIX_FX_SCHEMA_VERSION);
    expect(REMIX_FX_SCHEMA_VERSION).toBe("remix-fx/v4");
    expect(fixture.dspVersion).toBe(REMIX_FX_DYN_DSP_VERSION);
  });

  it("reproduces the backend's punch mapping exactly", () => {
    for (const entry of fixture.mapping) {
      expect(punchCompressor(entry.punch)).toEqual(entry.compressor);
    }
  });

  it.each(fixture.signals.map((signal) => ({ ...signal })))(
    "the TypeScript port replays ffmpeg (punch $punch, $sampleRate Hz, $channels ch)",
    (signal) => {
      const input = punchSignal(signal.sampleRate, signal.channels);
      const state = createAcompressorState(punchCompressor(signal.punch)!, signal.sampleRate);
      const output = input.map((channel) => new Float64Array(channel.length));
      processAcompressor(state, input, output, input[0].length);
      expectCheckpoints(output, signal);
    },
  );

  it.each(fixture.signals.map((signal) => ({ ...signal })))(
    "the AudioWorklet replays ffmpeg in 128-frame render quanta (punch $punch, $sampleRate Hz, $channels ch)",
    (signal) => {
      const { name, ctor } = loadWorklet(signal.sampleRate);
      expect(name).toBe("remix-punch-compressor");
      const processor = new ctor({
        processorOptions: { params: punchCompressor(signal.punch) },
      });
      const input = punchSignal(signal.sampleRate, signal.channels);
      const output = input.map((channel) => new Float64Array(channel.length));
      for (let start = 0; start < input[0].length; start += 128) {
        const end = Math.min(start + 128, input[0].length);
        expect(
          processor.process(
            [input.map((channel) => channel.subarray(start, end))],
            [output.map((channel) => channel.subarray(start, end))],
          ),
        ).toBe(true);
      }
      expectCheckpoints(output, signal);
    },
  );

  it("the worklet passes through at punch 0 and ends on dispose", () => {
    const { ctor } = loadWorklet(48_000);
    const processor = new ctor({ processorOptions: { params: punchCompressor(1) } });
    processor.port.onmessage?.({ data: { params: null } });
    const input = [Float64Array.from({ length: 128 }, (_, i) => Math.sin(i / 3))];
    const output = [new Float64Array(128)];
    processor.process([input], [output]);
    expect(Array.from(output[0])).toEqual(Array.from(input[0]));
    processor.port.onmessage?.({ data: { dispose: true } });
    expect(processor.process([input], [output])).toBe(false);
  });
});

describe("punch field (#1903 S6b)", () => {
  it("normalizes like the backend: 2 decimals, clamped, omitted at 0", () => {
    expect(normalizeRemixFx({ stems: { s: { punch: 0.456 } } })).toEqual({
      schemaVersion: REMIX_FX_SCHEMA_VERSION,
      stems: { s: { punch: 0.46 } },
    });
    expect(normalizeRemixFx({ stems: { s: { punch: 3 } } })?.stems?.s.punch).toBe(1);
    expect(normalizeRemixFx({ stems: { s: { punch: 0 } } })).toBeNull();
    expect(normalizeRemixFx({ stems: { s: { punch: -1 } } })).toBeNull();
  });

  it("reads a v3 recipe as v4 with the same values", () => {
    expect(
      normalizeRemixFx({ schemaVersion: REMIX_FX_V3_SCHEMA_VERSION, stems: { s: { pan: 0.5 } } }),
    ).toEqual({ schemaVersion: REMIX_FX_SCHEMA_VERSION, stems: { s: { pan: 0.5 } } });
  });

  it("exposes the effective value, detection and readout", () => {
    const recipe = normalizeRemixFx({ stems: { s: { punch: 0.4 } } });
    expect(remixFxStemPro(recipe, "s").punch).toBe(0.4);
    expect(remixFxStemPro(recipe, "other").punch).toBe(0);
    expect(remixFxHasPunch(recipe)).toBe(true);
    expect(remixFxHasPunch(normalizeRemixFx({ stems: { s: { pan: 0.4 } } }))).toBe(false);
    expect(formatFxPunch(0)).toBe("Off");
    expect(formatFxPunch(0.4)).toBe("40%");
  });
});
