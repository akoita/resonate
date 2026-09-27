/**
 * Shared effects recipe remix-fx/v2 (#1897, #1898) — pure unit tests.
 *
 * The parity block replays the committed v1 fixture the web preview is also
 * tested against, so both engines reproduce the same DSP numbers (1e-9). The
 * v1 DSP mapping is unchanged by v2; normalization now writes v2, so the
 * fixture's normalize outputs are compared with their version upgraded.
 */

import { readFileSync } from "fs";
import { join } from "path";
import {
  buildImpulseWav,
  echoTaps,
  generateReverbImpulse,
  normalizeRemixFxInput,
  readStoredRemixFx,
  REMIX_FX_DSP_VERSION,
  REMIX_FX_IMPULSE,
  REMIX_FX_SCHEMA_VERSION,
  REMIX_FX_V1_SCHEMA_VERSION,
  remixFxSpeed,
  remixFxStretchPlan,
  remixFxVarispeedRate,
  reverbWet,
  toneFilter,
  warmthCurve,
  warmthK,
} from "../modules/remix/remix-fx";

type ParityFixture = {
  schemaVersion: string;
  tone: Array<{
    t: number;
    filter: { type: string; frequencyHz: number; q: number } | null;
  }>;
  echo: Array<{
    e: number;
    bpm: number | null;
    speed: number;
    taps: Array<{ delaySec: number; gain: number }>;
  }>;
  reverbWet: Array<{ stemSpace: number; masterSpace: number; wet: number }>;
  warmth: Array<{
    w: number;
    k: number;
    curve: Array<{ x: number; y: number }>;
  }>;
  impulse: {
    sampleRate: number;
    lengthSamples: number;
    predelaySamples: number;
    seeds: { left: number; right: number };
    left: { first: number[]; at: Record<string, number> };
    right: { first: number[]; at: Record<string, number> };
  };
  normalize: Array<{ input: unknown; output: unknown }>;
};

const fixture: ParityFixture = JSON.parse(
  readFileSync(
    join(__dirname, "../modules/remix/remix-fx-v1.parity.json"),
    "utf8",
  ),
);

const TOLERANCE = 1e-9;

function expectClose(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE);
}

describe("remix-fx/v1 parity fixture (#1897)", () => {
  it("pins the schema version", () => {
    // The fixture pins the v1 DSP numbers, which v2 (#1898) keeps unchanged.
    expect(fixture.schemaVersion).toBe(REMIX_FX_V1_SCHEMA_VERSION);
    expect(REMIX_FX_SCHEMA_VERSION).toBe("remix-fx/v2");
    expect(REMIX_FX_DSP_VERSION).toBe("remix-fx-dsp/v1");
  });

  it.each(fixture.tone)("tone t=$t", ({ t, filter }) => {
    const actual = toneFilter(t);
    if (filter === null) {
      expect(actual).toBeNull();
      return;
    }
    expect(actual).not.toBeNull();
    expect(actual!.type).toBe(filter.type);
    expectClose(actual!.frequencyHz, filter.frequencyHz);
    expectClose(actual!.q, filter.q);
  });

  it.each(fixture.echo)(
    "echo e=$e bpm=$bpm speed=$speed",
    ({ e, bpm, speed, taps }) => {
      const actual = echoTaps(e, bpm, speed);
      expect(actual).toHaveLength(taps.length);
      taps.forEach((tap, index) => {
        expectClose(actual[index].delaySec, tap.delaySec);
        expectClose(actual[index].gain, tap.gain);
      });
    },
  );

  it.each(fixture.reverbWet)(
    "reverb wet stem=$stemSpace master=$masterSpace",
    ({ stemSpace, masterSpace, wet }) => {
      expectClose(reverbWet(stemSpace, masterSpace), wet);
    },
  );

  it.each(fixture.warmth)("warmth w=$w", ({ w, k, curve }) => {
    expectClose(warmthK(w), k);
    for (const point of curve) {
      expectClose(warmthCurve(w, point.x), point.y);
    }
  });

  it("generates the deterministic impulse response", () => {
    const spec = fixture.impulse;
    expect(REMIX_FX_IMPULSE.sampleRate).toBe(spec.sampleRate);
    expect(REMIX_FX_IMPULSE.seeds).toEqual(spec.seeds);
    for (const side of ["left", "right"] as const) {
      const ir = generateReverbImpulse(spec.sampleRate, spec.seeds[side]);
      expect(ir).toHaveLength(spec.lengthSamples);
      for (let i = 0; i < spec.predelaySamples; i += 1) {
        expect(ir[i]).toBe(0);
      }
      spec[side].first.forEach((value, index) => {
        expectClose(ir[spec.predelaySamples + index], value);
      });
      for (const [at, value] of Object.entries(spec[side].at)) {
        expectClose(ir[Number(at)], value);
      }
      let energy = 0;
      for (const sample of ir) energy += sample * sample;
      expectClose(Math.sqrt(energy), 1);
    }
  });

  it.each(fixture.normalize.map((entry, index) => ({ ...entry, index })))(
    "normalize case $index",
    ({ input, output }) => {
      // v1 fixture outputs are rewritten as v2 (#1898); the values are the
      // same.
      expect(normalizeRemixFxInput(input, ["a", "b"])).toEqual({
        value:
          output === null
            ? null
            : { ...(output as object), schemaVersion: REMIX_FX_SCHEMA_VERSION },
      });
    },
  );
});

describe("normalizeRemixFxInput (#1897)", () => {
  const stems = ["stem-1", "stem-2"];

  it("rounds, omits defaults, and drops all-default stems", () => {
    expect(
      normalizeRemixFxInput(
        {
          schemaVersion: "remix-fx/v1",
          master: { speed: 1.004, space: 0.456, tone: 0, warmth: 0.2 },
          stems: {
            "stem-1": { space: 0.001, echo: 0, tone: -0.333 },
            "stem-2": { space: 0, echo: 0, tone: 0 },
          },
        },
        stems,
      ),
    ).toEqual({
      value: {
        schemaVersion: "remix-fx/v2",
        master: { space: 0.46, warmth: 0.2 },
        stems: { "stem-1": { tone: -0.33 } },
      },
    });
  });

  it("keeps stems-only recipes and omits an all-default master", () => {
    expect(
      normalizeRemixFxInput(
        { master: { speed: 1 }, stems: { "stem-2": { echo: 1 } } },
        stems,
      ),
    ).toEqual({
      value: { schemaVersion: "remix-fx/v2", stems: { "stem-2": { echo: 1 } } },
    });
  });

  it("accepts the bounds inclusively", () => {
    expect(
      normalizeRemixFxInput(
        { master: { speed: 0.75, space: 1, tone: -1, warmth: 1 } },
        stems,
      ),
    ).toEqual({
      value: {
        schemaVersion: "remix-fx/v2",
        master: { speed: 0.75, space: 1, tone: -1, warmth: 1 },
      },
    });
    expect(normalizeRemixFxInput({ master: { speed: 1.25 } }, stems)).toEqual({
      value: { schemaVersion: "remix-fx/v2", master: { speed: 1.25 } },
    });
  });

  it.each([
    ["a string", "slowed", /effects must be an object or null/],
    ["an array", [], /effects must be an object or null/],
    ["an unknown top-level key", { vibe: "lofi" }, /effects\.vibe/],
    ["a foreign schema version", { schemaVersion: "remix-fx/v3" }, /schemaVersion/],
    ["a non-object master", { master: 3 }, /effects\.master must be an object/],
    ["an unknown master field", { master: { pitch: 1 } }, /effects\.master\.pitch/],
    ["speed below range", { master: { speed: 0.74 } }, /speed must be between 0\.75 and 1\.25/],
    ["speed above range", { master: { speed: 1.26 } }, /speed must be between/],
    ["negative space", { master: { space: -0.1 } }, /space must be between 0 and 1/],
    ["warmth above range", { master: { warmth: 1.5 } }, /warmth must be between/],
    ["tone below range", { master: { tone: -1.01 } }, /tone must be between -1 and 1/],
    ["a string value", { master: { space: "0.5" } }, /must be a finite number/],
    ["NaN", { master: { space: Number.NaN } }, /must be a finite number/],
    ["Infinity", { master: { tone: Number.POSITIVE_INFINITY } }, /must be a finite number/],
    ["a non-object stems map", { stems: [] }, /effects\.stems must be an object/],
    ["an unknown stem id", { stems: { other: { echo: 0.5 } } }, /not part of this project/],
    ["an unknown stem field", { stems: { "stem-1": { speed: 1 } } }, /effects\.stems\.stem-1\.speed/],
    ["stem echo above range", { stems: { "stem-1": { echo: 2 } } }, /echo must be between 0 and 1/],
  ])("rejects %s", (_label, input, message) => {
    const result = normalizeRemixFxInput(input, stems);
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toMatch(message);
  });

  it("returns null for null, empty and all-default recipes", () => {
    expect(normalizeRemixFxInput(null, stems)).toEqual({ value: null });
    expect(normalizeRemixFxInput({}, stems)).toEqual({ value: null });
    expect(
      normalizeRemixFxInput({ schemaVersion: "remix-fx/v1", stems: {} }, stems),
    ).toEqual({ value: null });
  });
});

describe("normalizeRemixFxInput remix-fx/v2 fields (#1898)", () => {
  it("accepts keepPitch and semitones and writes v2", () => {
    expect(
      normalizeRemixFxInput(
        {
          schemaVersion: "remix-fx/v2",
          master: { speed: 0.85, keepPitch: true, semitones: 2 },
        },
        [],
      ),
    ).toEqual({
      value: {
        schemaVersion: "remix-fx/v2",
        master: { speed: 0.85, keepPitch: true, semitones: 2 },
      },
    });
  });

  it("upgrades a v1 recipe (or none) to v2 without changing values", () => {
    for (const schemaVersion of ["remix-fx/v1", undefined]) {
      expect(
        normalizeRemixFxInput({ schemaVersion, master: { speed: 1.1 } }, []),
      ).toEqual({
        value: { schemaVersion: "remix-fx/v2", master: { speed: 1.1 } },
      });
    }
  });

  it("omits keepPitch false and semitones 0; all-default is null", () => {
    expect(
      normalizeRemixFxInput(
        { master: { speed: 0.9, keepPitch: false, semitones: 0 } },
        [],
      ),
    ).toEqual({
      value: { schemaVersion: "remix-fx/v2", master: { speed: 0.9 } },
    });
    expect(
      normalizeRemixFxInput({ master: { keepPitch: false, semitones: -0 } }, []),
    ).toEqual({ value: null });
  });

  it("keeps keepPitch alone (a saved preference) and a key shift alone", () => {
    expect(normalizeRemixFxInput({ master: { keepPitch: true } }, [])).toEqual({
      value: { schemaVersion: "remix-fx/v2", master: { keepPitch: true } },
    });
    expect(normalizeRemixFxInput({ master: { semitones: -6 } }, [])).toEqual({
      value: { schemaVersion: "remix-fx/v2", master: { semitones: -6 } },
    });
    expect(normalizeRemixFxInput({ master: { semitones: 6 } }, [])).toEqual({
      value: { schemaVersion: "remix-fx/v2", master: { semitones: 6 } },
    });
  });

  it.each([
    ["keepPitch as a string", { master: { keepPitch: "yes" } }, /keepPitch must be a boolean/],
    ["keepPitch as 1", { master: { keepPitch: 1 } }, /keepPitch must be a boolean/],
    ["fractional semitones", { master: { semitones: 1.5 } }, /semitones must be a whole number between -6 and 6/],
    ["semitones below range", { master: { semitones: -7 } }, /semitones must be a whole number/],
    ["semitones above range", { master: { semitones: 7 } }, /semitones must be a whole number/],
    ["semitones as a string", { master: { semitones: "2" } }, /semitones must be a whole number/],
    ["NaN semitones", { master: { semitones: Number.NaN } }, /semitones must be a whole number/],
    ["an unknown master field", { master: { pitch: 2 } }, /allowed: speed, space, tone, warmth, keepPitch, semitones/],
    ["a pitch field on a stem", { stems: { a: { semitones: 2 } } }, /effects\.stems\.a\.semitones/],
  ])("rejects %s", (_label, input, message) => {
    const result = normalizeRemixFxInput(input, ["a"]);
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toMatch(message);
  });
});

describe("tempo/key stretch plan (#1898)", () => {
  const recipe = (master: Record<string, unknown>) =>
    ({ schemaVersion: "remix-fx/v2", master }) as never;

  it.each([
    ["no recipe", null, null, 1],
    ["varispeed only", recipe({ speed: 0.85 }), null, 0.85],
    ["keepPitch at speed 1 (identity stage)", recipe({ keepPitch: true }), null, 1],
    ["keepPitch at 0.85", recipe({ speed: 0.85, keepPitch: true }), { tempo: 0.85, semitones: 0 }, 1],
    ["a key shift with varispeed", recipe({ speed: 1.2, semitones: -3 }), { tempo: 1, semitones: -3 }, 1.2],
    ["keepPitch and a key shift", recipe({ speed: 0.85, keepPitch: true, semitones: 2 }), { tempo: 0.85, semitones: 2 }, 1],
  ])("%s", (_label, effects, plan, rate) => {
    expect(remixFxStretchPlan(effects)).toEqual(plan);
    expect(remixFxVarispeedRate(effects)).toBe(rate);
  });

  it("uses the render's 1/100 speed grid", () => {
    expect(remixFxSpeed(recipe({ speed: 0.854 }))).toBe(0.85);
    expect(remixFxSpeed(null)).toBe(1);
  });
});

describe("readStoredRemixFx (#1897)", () => {
  it("reads a stored v1 recipe as v2 (#1898)", () => {
    const stored = {
      schemaVersion: "remix-fx/v1",
      master: { speed: 0.85, space: 0.45 },
      stems: { a: { echo: 0.33 } },
    };
    expect(readStoredRemixFx(stored)).toEqual({
      ...stored,
      schemaVersion: "remix-fx/v2",
    });
  });

  it("reads a stored v2 recipe with keepPitch and a key shift (#1898)", () => {
    const stored = {
      schemaVersion: "remix-fx/v2",
      master: { speed: 0.85, keepPitch: true, semitones: -2 },
    };
    expect(readStoredRemixFx(stored)).toEqual(stored);
  });

  it.each([
    ["null", null],
    ["a string", "remix-fx/v1"],
    ["an array", []],
    ["a missing version", { master: { speed: 0.85 } }],
    ["a foreign version", { schemaVersion: "remix-fx/v0", master: { speed: 0.85 } }],
    ["a future version", { schemaVersion: "remix-fx/v3", master: { speed: 0.85 } }],
    ["a fractional key shift", { schemaVersion: "remix-fx/v2", master: { semitones: 1.5 } }],
    ["an out-of-range value", { schemaVersion: "remix-fx/v1", master: { speed: 9 } }],
    ["an all-default recipe", { schemaVersion: "remix-fx/v1", master: { speed: 1 } }],
  ])("reads %s as null", (_label, stored) => {
    expect(readStoredRemixFx(stored)).toBeNull();
  });
});

describe("DSP mapping edge cases (#1897)", () => {
  it("treats warmth 0 as the identity curve", () => {
    expect(warmthCurve(0, 0.3)).toBe(0.3);
  });

  it("falls back to the 0.375 s echo base without a usable grid bpm", () => {
    expectClose(echoTaps(1, 0, 1)[0].delaySec, 0.375);
    expectClose(echoTaps(1, Number.NaN, 0.75)[0].delaySec, 0.5);
    expect(echoTaps(-0.2, 120, 1)).toEqual([]);
  });
});

describe("buildImpulseWav (#1897)", () => {
  it("encodes a 48 kHz stereo 32-bit float WAV of both IR channels", () => {
    const wav = buildImpulseWav();
    const frames = REMIX_FX_IMPULSE.sampleRate * REMIX_FX_IMPULSE.lengthSeconds;
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(20)).toBe(3); // IEEE float
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(24)).toBe(48_000);
    expect(wav.readUInt16LE(34)).toBe(32);
    expect(wav.readUInt32LE(40)).toBe(frames * 2 * 4);
    expect(wav.length).toBe(44 + frames * 2 * 4);

    const left = generateReverbImpulse(48_000, 1896);
    const right = generateReverbImpulse(48_000, 1897);
    for (const frame of [960, 961, 48_000, 120_000]) {
      expect(wav.readFloatLE(44 + frame * 8)).toBeCloseTo(left[frame], 7);
      expect(wav.readFloatLE(44 + frame * 8 + 4)).toBeCloseTo(right[frame], 7);
    }
    // Deterministic + memoized.
    expect(buildImpulseWav()).toBe(wav);
  });
});
