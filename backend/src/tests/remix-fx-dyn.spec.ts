/**
 * remix-fx/v4 punch compressor (#1903 S6b): the mapping, the port and the
 * render stage replay the committed fixture (no ffmpeg needed; the
 * ffmpeg-gated comparison lives in remix-fx-dyn-render.spec.ts).
 */

import { readFileSync } from "fs";
import {
  normalizeRemixFxInput,
  punchCompressor,
  readStoredRemixFx,
  remixFxProFieldsSet,
  remixFxUsesPro,
  remixFxUsesPunch,
  REMIX_FX_DYN_DSP_VERSION,
  REMIX_FX_SCHEMA_VERSION,
  REMIX_FX_V3_SCHEMA_VERSION,
} from "../modules/remix/remix-fx";
import {
  createAcompressorState,
  processAcompressor,
} from "../modules/remix/remix-punch-compressor";
import {
  buildFxStemMixFilter,
  punchCompressorFilter,
  stemProFilters,
} from "../modules/remix/stem-audio-mixer";
import {
  DYN_FIXTURE_PATH,
  DYN_PUNCH_POINTS,
  DYN_SIGNAL_CASES,
  punchSignal,
  type DynFixture,
} from "./remix-fx-dyn.fixture";

const fixture = JSON.parse(readFileSync(DYN_FIXTURE_PATH, "utf8")) as DynFixture;

describe("remix-fx-dyn/v1 fixture (#1903 S6b)", () => {
  it("is the current schema and DSP version and covers every pinned case", () => {
    expect(fixture.schemaVersion).toBe(REMIX_FX_SCHEMA_VERSION);
    expect(fixture.dspVersion).toBe(REMIX_FX_DYN_DSP_VERSION);
    expect(fixture.mapping.map((entry) => entry.punch)).toEqual([...DYN_PUNCH_POINTS]);
    expect(fixture.signals.length).toBe(DYN_SIGNAL_CASES.length);
  });

  it("pins the punch mapping exactly", () => {
    for (const entry of fixture.mapping) {
      expect(punchCompressor(entry.punch)).toEqual(entry.compressor);
    }
  });

  it("pins the render's acompressor stage exactly", () => {
    for (const entry of fixture.filter) {
      expect(punchCompressorFilter(punchCompressor(entry.punch)!)).toBe(entry.filter);
    }
  });

  it.each(fixture.signals.map((signal) => [signal.punch, signal.sampleRate, signal.channels, signal]))(
    "the port reproduces ffmpeg's output (punch %s, %s Hz, %s ch) within 1e-9",
    (punch, sampleRate, channels, signal) => {
      const input = punchSignal(sampleRate as number, channels as number);
      const state = createAcompressorState(punchCompressor(punch as number)!, sampleRate as number);
      const output = input.map((channel) => new Float64Array(channel.length));
      // Odd block sizes: the envelope must carry across blocks.
      for (let start = 0; start < input[0].length; start += 128) {
        const frames = Math.min(128, input[0].length - start);
        processAcompressor(
          state,
          input.map((channel) => channel.subarray(start, start + frames)),
          output.map((channel) => channel.subarray(start, start + frames)),
          frames,
        );
      }
      const { checkpoints } = signal as DynFixture["signals"][number];
      checkpoints.forEach((points, c) => {
        points.forEach((expected, k) => {
          expect(Math.abs(output[c][k * fixture.checkpointEvery] - expected)).toBeLessThanOrEqual(1e-9);
        });
      });
    },
  );

  it("is the identity below the knee", () => {
    const state = createAcompressorState(punchCompressor(0.1)!, 48_000);
    const quiet = [Float64Array.from({ length: 512 }, (_, i) => 0.001 * Math.sin(i / 7))];
    const out = [new Float64Array(512)];
    processAcompressor(state, quiet, out, 512);
    expect(Array.from(out[0])).toEqual(Array.from(quiet[0]).map((x) => x * punchCompressor(0.1)!.makeup));
  });
});

describe("remix-fx/v4 punch field (#1903 S6b)", () => {
  it("normalizes punch to 2 decimals, drops 0 and rejects out-of-range values", () => {
    expect(
      normalizeRemixFxInput({ stems: { a: { punch: 0.456 } } }, ["a"]),
    ).toEqual({
      value: { schemaVersion: REMIX_FX_SCHEMA_VERSION, stems: { a: { punch: 0.46 } } },
    });
    expect(normalizeRemixFxInput({ stems: { a: { punch: 0 } } }, ["a"])).toEqual({ value: null });
    expect(normalizeRemixFxInput({ stems: { a: { punch: 1.2 } } }, ["a"])).toEqual({
      error: "effects.stems.a.punch must be between 0 and 1",
    });
    expect(normalizeRemixFxInput({ stems: { a: { punch: -0.1 } } }, ["a"])).toHaveProperty("error");
  });

  it("still reads a stored v3 recipe and rewrites it as v4 with the same values", () => {
    expect(
      readStoredRemixFx({
        schemaVersion: REMIX_FX_V3_SCHEMA_VERSION,
        stems: { a: { eqLow: 3, pan: -0.5 } },
      }),
    ).toEqual({ schemaVersion: "remix-fx/v4", stems: { a: { eqLow: 3, pan: -0.5 } } });
  });

  it("is a Pro field: setting it needs the entitlement, keeping or removing it does not", () => {
    const stored = normalizeRemixFxInput({ stems: { a: { punch: 0.4 } } }, null);
    const storedValue = "value" in stored ? stored.value : null;
    expect(remixFxUsesPro(storedValue)).toBe(true);
    expect(remixFxUsesPunch(storedValue)).toBe(true);
    expect(remixFxProFieldsSet(storedValue, null)).toEqual(["stems.a.punch"]);
    expect(remixFxProFieldsSet(storedValue, storedValue)).toEqual([]);
    expect(remixFxProFieldsSet(null, storedValue)).toEqual([]);
    expect(
      remixFxProFieldsSet(
        { schemaVersion: REMIX_FX_SCHEMA_VERSION, stems: { a: { punch: 0.5 } } },
        storedValue,
      ),
    ).toEqual(["stems.a.punch"]);
  });

  it("adds the compressor as the last Pro stage, only when punch is above 0", () => {
    expect(stemProFilters({ eqLow: 3 })).toEqual([
      "lowshelf=f=200:t=s:w=1:g=3",
    ]);
    const filters = stemProFilters({ eqLow: 3, pan: 0.5, punch: 0.5 });
    expect(filters).toHaveLength(3);
    expect(filters[2]).toBe(
      "acompressor=level_in=1:mode=downward:threshold=0.1:ratio=3.75:attack=10:release=150:makeup=1.412538:knee=2.828427:link=average:detection=rms:level_sc=1:mix=1",
    );
    expect(stemProFilters({ punch: 0 })).toEqual([]);
  });

  it("places the compressor before the section gate in the render graph", () => {
    const { filter } = buildFxStemMixFilter(
      [{ path: "a.wav", gainDb: 0, fxStemId: "a", activeIntervals: [{ startSec: 0, endSec: 4 }] }],
      { effects: { schemaVersion: REMIX_FX_SCHEMA_VERSION, stems: { a: { punch: 1 } } }, bpm: null },
    );
    const chain = filter.split(";")[0];
    expect(chain.indexOf("acompressor=")).toBeGreaterThan(chain.indexOf("volume=0dB"));
    expect(chain.indexOf("acompressor=")).toBeLessThan(chain.indexOf("volume=volume="));
  });
});
