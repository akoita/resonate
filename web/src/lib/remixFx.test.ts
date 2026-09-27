import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  activeVibeId,
  applyVibe,
  biquadQDb,
  echoTaps,
  formatFxAmount,
  formatFxKey,
  formatFxSpeed,
  formatFxTone,
  generateReverbImpulse,
  normalizeRemixFx,
  REMIX_FX_REVERB_SEEDS,
  REMIX_FX_SCHEMA_VERSION,
  REMIX_FX_V1_SCHEMA_VERSION,
  REMIX_FX_WARMTH_CURVE_POINTS,
  REMIX_VIBES,
  reverbWet,
  sameRemixFx,
  stemHasFx,
  toneFilter,
  warmthAt,
  warmthCurve,
  warmthK,
  remixFxMaster,
  remixFxPitch,
  remixFxStretchPlan,
  remixFxVarispeedRate,
  withMasterFx,
  withRemixFxPitch,
  withStemFx,
  type RemixFxRecipe,
} from "./remixFx";

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../backend/src/modules/remix/remix-fx-v1.parity.json",
);

type Fixture = {
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
  warmth: Array<{ w: number; k: number; curve: Array<{ x: number; y: number }> }>;
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

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
const TOLERANCE = 1e-9;

function expectClose(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE);
}

describe("remix-fx/v1 parity fixture (#1897)", () => {
  it("shares the schema version", () => {
    // The fixture pins the v1 DSP numbers, unchanged by v2 (#1898) and v3 (#1903).
    expect(fixture.schemaVersion).toBe(REMIX_FX_V1_SCHEMA_VERSION);
    expect(REMIX_FX_SCHEMA_VERSION).toBe("remix-fx/v3");
  });

  it("maps tone to the same filters", () => {
    for (const entry of fixture.tone) {
      const filter = toneFilter(entry.t);
      if (entry.filter === null) {
        expect(filter).toBeNull();
        continue;
      }
      expect(filter?.type).toBe(entry.filter.type);
      expectClose(filter!.frequencyHz, entry.filter.frequencyHz);
      expectClose(filter!.q, entry.filter.q);
    }
  });

  it("computes the same echo taps", () => {
    for (const entry of fixture.echo) {
      const taps = echoTaps(entry.e, entry.bpm, entry.speed);
      expect(taps).toHaveLength(entry.taps.length);
      taps.forEach((tap, index) => {
        expectClose(tap.delaySec, entry.taps[index].delaySec);
        expectClose(tap.gain, entry.taps[index].gain);
      });
    }
  });

  it("computes the same reverb wet levels", () => {
    for (const entry of fixture.reverbWet) {
      expectClose(reverbWet(entry.stemSpace, entry.masterSpace), entry.wet);
    }
  });

  it("computes the same warmth curves", () => {
    for (const entry of fixture.warmth) {
      expect(warmthK(entry.w)).toBe(entry.k);
      for (const point of entry.curve) {
        expectClose(warmthAt(entry.w, point.x), point.y);
      }
    }
  });

  it("generates the same reverb impulse response", () => {
    const { impulse } = fixture;
    expect(impulse.seeds).toEqual(REMIX_FX_REVERB_SEEDS);
    for (const side of ["left", "right"] as const) {
      const samples = generateReverbImpulse(
        impulse.sampleRate,
        impulse.seeds[side],
      );
      expect(samples).toHaveLength(impulse.lengthSamples);
      for (let i = 0; i < impulse.predelaySamples; i += 1) {
        expect(samples[i]).toBe(0);
      }
      impulse[side].first.forEach((value, index) => {
        expectClose(samples[impulse.predelaySamples + index], value);
      });
      for (const [index, value] of Object.entries(impulse[side].at)) {
        expectClose(samples[Number(index)], value);
      }
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      expect(Math.sqrt(energy)).toBeCloseTo(1, 12);
    }
  });

  it("normalizes like the backend", () => {
    // v1 fixture outputs are rewritten as v2 (#1898) with the same values.
    for (const entry of fixture.normalize) {
      expect(normalizeRemixFx(entry.input)).toEqual(
        entry.output === null
          ? null
          : { ...(entry.output as object), schemaVersion: REMIX_FX_SCHEMA_VERSION },
      );
    }
  });
});

describe("normalizeRemixFx (#1897)", () => {
  it("clamps out-of-range values instead of rejecting them", () => {
    expect(
      normalizeRemixFx({
        master: { speed: 3, space: -1, tone: -4, warmth: Number.NaN },
        stems: { a: { echo: 9, tone: 2 } },
      }),
    ).toEqual({
      schemaVersion: REMIX_FX_SCHEMA_VERSION,
      master: { speed: 1.25, tone: -1 },
      stems: { a: { echo: 1, tone: 1 } },
    });
  });

  it("drops stems outside the project and non-objects", () => {
    expect(
      normalizeRemixFx({ stems: { a: { echo: 0.5 }, gone: { echo: 0.5 } } }, [
        "a",
      ]),
    ).toEqual({
      schemaVersion: REMIX_FX_SCHEMA_VERSION,
      stems: { a: { echo: 0.5 } },
    });
    expect(normalizeRemixFx("fx")).toBeNull();
    expect(normalizeRemixFx([])).toBeNull();
    expect(normalizeRemixFx({ master: "loud" })).toBeNull();
    expect(
      normalizeRemixFx({ schemaVersion: "remix-fx/v4", master: { speed: 0.9 } }),
    ).toBeNull();
  });

  it("compares recipes structurally and flags stems with fx", () => {
    const recipe: RemixFxRecipe = {
      schemaVersion: REMIX_FX_SCHEMA_VERSION,
      master: { speed: 0.9 },
      stems: { a: { echo: 0.2 } },
    };
    expect(
      sameRemixFx(recipe, { master: { speed: 0.9001 }, stems: { a: { echo: 0.2 }, b: {} } }),
    ).toBe(true);
    expect(sameRemixFx(recipe, null)).toBe(false);
    expect(stemHasFx(recipe, "a")).toBe(true);
    expect(stemHasFx(recipe, "b")).toBe(false);
  });

  it("edits single values and collapses back to null", () => {
    const slowed = withMasterFx(null, "speed", 0.85);
    expect(slowed).toEqual({
      schemaVersion: REMIX_FX_SCHEMA_VERSION,
      master: { speed: 0.85 },
    });
    const echoed = withStemFx(slowed, "a", "echo", 0.4);
    expect(echoed?.stems).toEqual({ a: { echo: 0.4 } });
    expect(withMasterFx(withStemFx(echoed, "a", "echo", 0), "speed", 1)).toBeNull();
  });
});

describe("remix-fx/v2 tempo/key fields (#1898)", () => {
  it("reads v1 and v2 and always writes v3 (#1903)", () => {
    expect(
      normalizeRemixFx({ schemaVersion: REMIX_FX_V1_SCHEMA_VERSION, master: { speed: 0.9 } }),
    ).toEqual({ schemaVersion: "remix-fx/v3", master: { speed: 0.9 } });
    expect(
      normalizeRemixFx({
        schemaVersion: "remix-fx/v2",
        master: { speed: 0.85, keepPitch: true, semitones: 2 },
      }),
    ).toEqual({
      schemaVersion: "remix-fx/v3",
      master: { speed: 0.85, keepPitch: true, semitones: 2 },
    });
  });

  it("clamps and rounds semitones, omits defaults and drops bad types", () => {
    expect(normalizeRemixFx({ master: { semitones: 9 } })).toEqual({
      schemaVersion: "remix-fx/v3",
      master: { semitones: 6 },
    });
    expect(normalizeRemixFx({ master: { semitones: -2.6 } })?.master).toEqual({
      semitones: -3,
    });
    expect(normalizeRemixFx({ master: { semitones: 0.4, keepPitch: false } })).toBeNull();
    expect(
      normalizeRemixFx({ master: { semitones: "2", keepPitch: "yes", speed: 0.9 } }),
    ).toEqual({ schemaVersion: "remix-fx/v3", master: { speed: 0.9 } });
    expect(normalizeRemixFx({ master: { keepPitch: true } })).toEqual({
      schemaVersion: "remix-fx/v3",
      master: { keepPitch: true },
    });
  });

  it("keeps the pitch fields out of the slider values and through slider edits", () => {
    const recipe = withRemixFxPitch(withMasterFx(null, "speed", 0.85), {
      keepPitch: true,
      semitones: -1,
    });
    expect(remixFxMaster(recipe)).toEqual({ speed: 0.85, space: 0, tone: 0, warmth: 0 });
    expect(remixFxPitch(recipe)).toEqual({ keepPitch: true, semitones: -1 });
    const toned = withMasterFx(recipe, "tone", 0.3);
    expect(toned?.master).toEqual({ speed: 0.85, tone: 0.3, keepPitch: true, semitones: -1 });
    expect(withRemixFxPitch(toned, { keepPitch: false, semitones: 0 })?.master).toEqual({
      speed: 0.85,
      tone: 0.3,
    });
    expect(remixFxPitch(null)).toEqual({ keepPitch: false, semitones: 0 });
  });

  it("derives the render's stretch stage and varispeed rate", () => {
    const recipe = (master: Record<string, unknown>) =>
      normalizeRemixFx({ master }) as RemixFxRecipe | null;
    expect(remixFxStretchPlan(null)).toBeNull();
    expect(remixFxVarispeedRate(null)).toBe(1);
    expect(remixFxStretchPlan(recipe({ speed: 0.85 }))).toBeNull();
    expect(remixFxVarispeedRate(recipe({ speed: 0.85 }))).toBe(0.85);
    expect(remixFxStretchPlan(recipe({ keepPitch: true }))).toBeNull();
    expect(remixFxStretchPlan(recipe({ speed: 0.85, keepPitch: true }))).toEqual({
      tempo: 0.85,
      semitones: 0,
    });
    expect(remixFxVarispeedRate(recipe({ speed: 0.85, keepPitch: true }))).toBe(1);
    expect(remixFxStretchPlan(recipe({ speed: 1.2, semitones: -3 }))).toEqual({
      tempo: 1,
      semitones: -3,
    });
    expect(remixFxVarispeedRate(recipe({ speed: 1.2, semitones: -3 }))).toBe(1.2);
  });
});

describe("DSP helpers (#1897)", () => {
  it("converts the Butterworth Q to WebAudio's dB Q", () => {
    expect(biquadQDb(0.7071)).toBeCloseTo(-3.0103, 3);
    expect(Math.pow(10, biquadQDb(0.7071) / 20)).toBeCloseTo(0.7071, 12);
  });

  it("falls back to 0.375/speed without a valid bpm", () => {
    expect(echoTaps(1, 0, 1)[0].delaySec).toBe(0.375);
    expect(echoTaps(1, Number.NaN, 0.75)[0].delaySec).toBe(0.5);
    expect(echoTaps(-1, 120, 1)).toEqual([]);
  });

  it("builds a WaveShaper curve over the requested input range", () => {
    const curve = warmthCurve(0.5);
    expect(curve).toHaveLength(REMIX_FX_WARMTH_CURVE_POINTS);
    expect(curve[0]).toBe(-1);
    expect(curve[curve.length - 1]).toBe(1);
    const i = 1000;
    const x = (2 * i) / (curve.length - 1) - 1;
    expect(curve[i]).toBe(Math.fround(warmthAt(0.5, x)));

    const wide = warmthCurve(0.5, 5, 4);
    expect(wide[4]).toBe(Math.fround(warmthAt(0.5, 4)));
    expect(wide[3]).toBe(Math.fround(warmthAt(0.5, 2)));
    expect(warmthAt(0, 0.3)).toBe(0.3);
  });
});

describe("vibe starters (#1897)", () => {
  const stems = [
    { stemId: "vox", type: "vocals" },
    { stemId: "drums", type: "drums" },
  ];

  it("defines the six vibes with the contract's masters", () => {
    expect(REMIX_VIBES.map((vibe) => [vibe.id, vibe.master])).toEqual([
      ["slowed_reverb", { speed: 0.85, space: 0.45, tone: -0.15 }],
      ["sped_up", { speed: 1.2, space: 0.1 }],
      ["lofi", { speed: 0.95, tone: -0.45, warmth: 0.5, space: 0.15 }],
      ["dreamy", { speed: 0.92, space: 0.6, tone: -0.25 }],
      ["club", { speed: 1.05, space: 0.1, warmth: 0.2 }],
      ["none", null],
    ]);
  });

  it("replaces the master and keeps other stems' fx", () => {
    const current: RemixFxRecipe = {
      schemaVersion: REMIX_FX_SCHEMA_VERSION,
      master: { warmth: 0.9, speed: 1.1 },
      stems: { drums: { space: 0.3 } },
    };
    expect(applyVibe("sped_up", current, stems)).toEqual({
      schemaVersion: REMIX_FX_SCHEMA_VERSION,
      master: { speed: 1.2, space: 0.1 },
      stems: { drums: { space: 0.3 } },
    });
  });

  it("sets only the listed per-stem entries (Dreamy vocals echo)", () => {
    const current: RemixFxRecipe = {
      schemaVersion: REMIX_FX_SCHEMA_VERSION,
      stems: { vox: { tone: 0.2 }, drums: { echo: 0.1 } },
    };
    expect(applyVibe("dreamy", current, stems)).toEqual({
      schemaVersion: REMIX_FX_SCHEMA_VERSION,
      master: { speed: 0.92, space: 0.6, tone: -0.25 },
      stems: { drums: { echo: 0.1 }, vox: { tone: 0.2, echo: 0.35 } },
    });
  });

  it("No effects clears everything", () => {
    expect(
      applyVibe("none", withStemFx(null, "vox", "echo", 0.5), stems),
    ).toBeNull();
  });

  it("reports the vibe whose master matches exactly", () => {
    for (const vibe of REMIX_VIBES) {
      expect(activeVibeId(applyVibe(vibe.id, null, stems))).toBe(vibe.id);
    }
    const tweaked = withMasterFx(applyVibe("lofi", null, stems), "speed", 0.96);
    expect(activeVibeId(tweaked)).toBeNull();
    // Per-stem fx alone is not "No effects".
    expect(activeVibeId(withStemFx(null, "vox", "echo", 0.5))).toBeNull();
  });
});

describe("vibes keep the tempo/key choices (#1898)", () => {
  const stems = [
    { stemId: "vox", type: "vocals" },
    { stemId: "drums", type: "drums" },
  ];
  const pitched: RemixFxRecipe = {
    schemaVersion: REMIX_FX_SCHEMA_VERSION,
    master: { speed: 0.9, warmth: 0.3, keepPitch: true, semitones: 2 },
    stems: { drums: { space: 0.3 } },
  };

  it("a vibe replaces the sound but keeps Keep original pitch and the key", () => {
    expect(applyVibe("lofi", pitched, stems)).toEqual({
      schemaVersion: REMIX_FX_SCHEMA_VERSION,
      master: {
        speed: 0.95,
        space: 0.15,
        tone: -0.45,
        warmth: 0.5,
        keepPitch: true,
        semitones: 2,
      },
      stems: { drums: { space: 0.3 } },
    });
    expect(remixFxPitch(applyVibe("sped_up", pitched, stems))).toEqual({
      keepPitch: true,
      semitones: 2,
    });
  });

  it("No effects leaves only the pitch fields, or null without them", () => {
    expect(applyVibe("none", pitched, stems)).toEqual({
      schemaVersion: REMIX_FX_SCHEMA_VERSION,
      master: { keepPitch: true, semitones: 2 },
    });
    expect(
      applyVibe("none", withRemixFxPitch(null, { semitones: -3 }), stems),
    ).toEqual({ schemaVersion: REMIX_FX_SCHEMA_VERSION, master: { semitones: -3 } });
    expect(
      applyVibe("none", { schemaVersion: REMIX_FX_SCHEMA_VERSION, master: { speed: 0.9 } }, stems),
    ).toBeNull();
  });

  it("ignores the pitch fields when naming the active vibe", () => {
    expect(activeVibeId(withRemixFxPitch(null, { keepPitch: true, semitones: 2 }))).toBe(
      "none",
    );
    for (const vibe of REMIX_VIBES) {
      expect(activeVibeId(applyVibe(vibe.id, pitched, []))).toBe(vibe.id);
    }
    expect(
      activeVibeId(withMasterFx(withRemixFxPitch(null, { semitones: 1 }), "space", 0.2)),
    ).toBeNull();
  });

  it("says honestly what No effects keeps", () => {
    const none = REMIX_VIBES.find((vibe) => vibe.id === "none");
    expect(none?.description).toMatch(/Key/);
    expect(none?.description).toMatch(/Keep original pitch/);
  });
});

describe("control labels (#1897)", () => {
  it("formats values in plain language", () => {
    expect(formatFxSpeed(0.85)).toBe("0.85×");
    expect(formatFxSpeed(1)).toBe("1.00×");
    expect(formatFxAmount(0.45)).toBe("45%");
    expect(formatFxTone(0)).toBe("Neutral");
    expect(formatFxTone(-0.25)).toBe("Darker 25%");
    expect(formatFxTone(0.4)).toBe("Brighter 40%");
  });

  it("formats the key shift with a real minus sign (#1898)", () => {
    expect(formatFxKey(0)).toBe("Original key");
    expect(formatFxKey(2)).toBe("+2 (higher)");
    expect(formatFxKey(-3)).toBe("\u22123 (lower)");
    expect(formatFxKey(-3)).not.toContain("-");
  });
});
