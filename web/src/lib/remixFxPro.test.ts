import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  activeVibeId,
  applyVibe,
  eqBiquadCoefficients,
  formatFxEqGain,
  formatFxPan,
  normalizeRemixFx,
  panGains,
  remixFxHasPro,
  remixFxStem,
  remixFxStemPro,
  REMIX_FX_EQ_BANDS,
  REMIX_FX_PRO_DSP_VERSION,
  REMIX_FX_SCHEMA_VERSION,
  REMIX_VIBES,
  stemEqStages,
  stemHasPro,
  withStemFx,
  withStemProFx,
  type RemixEqBandId,
  type RemixFxRecipe,
} from "./remixFx";

/**
 * remix-fx/v3 Pro fields (#1903 S6a): the preview's EQ/pan mapping replays
 * the backend's committed Pro parity fixture within 1e-12.
 */

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../backend/src/modules/remix/remix-fx-pro-v1.parity.json",
);

type ProFixture = {
  schemaVersion: string;
  dspVersion: string;
  bands: Record<RemixEqBandId, { type: string; frequencyHz: number; slope?: number; q?: number }>;
  eq: Array<{
    band: RemixEqBandId;
    gainDb: number;
    sampleRate: number;
    coefficients: { b0: number; b1: number; b2: number; a1: number; a2: number };
  }>;
  pan: Array<{
    pan: number;
    gains: {
      x: number;
      gL: number;
      gR: number;
      matrix: { ll: number; lr: number; rl: number; rr: number };
    } | null;
  }>;
  normalize: Array<{ input: unknown; output: unknown }>;
};

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as ProFixture;
const TOLERANCE = 1e-12;

function expectClose(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE);
}

describe("remix-fx-pro-dsp/v1 parity fixture (#1903)", () => {
  it("shares the versions and band definitions", () => {
    expect(fixture.schemaVersion).toBe(REMIX_FX_SCHEMA_VERSION);
    expect(REMIX_FX_SCHEMA_VERSION).toBe("remix-fx/v3");
    expect(fixture.dspVersion).toBe(REMIX_FX_PRO_DSP_VERSION);
    for (const band of ["low", "mid", "high"] as const) {
      expect(REMIX_FX_EQ_BANDS[band]).toEqual({
        ...fixture.bands[band],
        key: REMIX_FX_EQ_BANDS[band].key,
      });
    }
  });

  it("reproduces every EQ biquad at 48 and 44.1 kHz", () => {
    expect(fixture.eq.length).toBe(48);
    for (const entry of fixture.eq) {
      const actual = eqBiquadCoefficients(entry.band, entry.gainDb, entry.sampleRate);
      for (const key of ["b0", "b1", "b2", "a1", "a2"] as const) {
        expectClose(actual[key], entry.coefficients[key]);
      }
    }
  });

  it("reproduces the pan gains", () => {
    for (const entry of fixture.pan) {
      const actual = panGains(entry.pan);
      if (entry.gains === null) {
        expect(actual).toBeNull();
        continue;
      }
      expectClose(actual!.x, entry.gains.x);
      expectClose(actual!.gL, entry.gains.gL);
      expectClose(actual!.gR, entry.gains.gR);
      for (const key of ["ll", "lr", "rl", "rr"] as const) {
        expectClose(actual!.matrix[key], entry.gains.matrix[key]);
      }
    }
  });

  it("normalizes like the backend", () => {
    for (const { input, output } of fixture.normalize) {
      expect(normalizeRemixFx(input, ["a", "b"])).toEqual(output);
    }
  });
});

describe("Pro normalization and helpers (#1903)", () => {
  it("clamps and rounds to the step, omitting defaults", () => {
    expect(
      normalizeRemixFx({
        stems: { s: { eqLow: 20, eqMid: -3.3, eqHigh: 0.2, pan: -1.7 } },
      }),
    ).toEqual({
      schemaVersion: "remix-fx/v3",
      stems: { s: { eqLow: 12, eqMid: -3.5, pan: -1 } },
    });
    expect(normalizeRemixFx({ stems: { s: { pan: 0.004, eqLow: "3" } } })).toBeNull();
    // v1 / v2 read as v3 with the same values.
    expect(
      normalizeRemixFx({ schemaVersion: "remix-fx/v2", stems: { s: { echo: 0.2 } } }),
    ).toEqual({ schemaVersion: "remix-fx/v3", stems: { s: { echo: 0.2 } } });
    expect(normalizeRemixFx({ schemaVersion: "remix-fx/v4", stems: { s: { pan: 1 } } })).toBeNull();
  });

  it("edits Pro values beside the FX row's values", () => {
    let recipe = withStemProFx(null, "bass", "eqLow", 3);
    recipe = withStemProFx(recipe, "bass", "pan", -0.3);
    recipe = withStemFx(recipe, "bass", "echo", 0.4);
    expect(recipe).toEqual({
      schemaVersion: "remix-fx/v3",
      stems: { bass: { echo: 0.4, eqLow: 3, pan: -0.3 } },
    });
    expect(remixFxStem(recipe, "bass")).toEqual({ space: 0, echo: 0.4, tone: 0 });
    expect(remixFxStemPro(recipe, "bass")).toEqual({
      eqLow: 3,
      eqMid: 0,
      eqHigh: 0,
      pan: -0.3,
    });
    expect(stemHasPro(recipe, "bass")).toBe(true);
    expect(stemHasPro(recipe, "drums")).toBe(false);
    expect(remixFxHasPro(recipe)).toBe(true);
    // Resetting every Pro value leaves the FX row's echo.
    recipe = withStemProFx(withStemProFx(recipe, "bass", "eqLow", 0), "bass", "pan", 0);
    expect(recipe?.stems).toEqual({ bass: { echo: 0.4 } });
    expect(remixFxHasPro(recipe)).toBe(false);
  });

  it("orders EQ stages low → mid → high", () => {
    expect(stemEqStages({ eqHigh: 1, eqLow: -2 })).toEqual([
      { band: "low", gainDb: -2 },
      { band: "high", gainDb: 1 },
    ]);
  });

  it("formats dB and pan readouts", () => {
    expect(formatFxEqGain(0)).toBe("0 dB");
    expect(formatFxEqGain(3)).toBe("+3 dB");
    expect(formatFxEqGain(-4.5)).toBe("−4.5 dB");
    expect(formatFxPan(0)).toBe("C");
    expect(formatFxPan(-0.3)).toBe("L 30");
    expect(formatFxPan(0.3)).toBe("R 30");
    expect(formatFxPan(1)).toBe("R 100");
  });
});

describe("vibes and Pro fields (#1903)", () => {
  const stems = [
    { stemId: "vox", type: "vocals" },
    { stemId: "bass", type: "bass" },
  ];
  const withPro: RemixFxRecipe = {
    schemaVersion: "remix-fx/v3",
    master: { semitones: 2 },
    stems: { vox: { eqHigh: 3 }, bass: { eqLow: 4, pan: -0.3 } },
  };

  it("keeps every stem's Pro fields when a vibe is applied", () => {
    const dreamy = applyVibe("dreamy", withPro, stems);
    expect(dreamy?.stems).toEqual({
      vox: { echo: 0.35, eqHigh: 3 },
      bass: { eqLow: 4, pan: -0.3 },
    });
    expect(activeVibeId(dreamy)).toBe("dreamy");
    expect(applyVibe("lofi", withPro, stems)?.stems).toEqual(withPro.stems);
  });

  it("'No effects' clears the Pro EQ and pan too (they are effects), keeping the key", () => {
    const none = applyVibe("none", withPro, stems);
    expect(none).toEqual({ schemaVersion: "remix-fx/v3", master: { semitones: 2 } });
    expect(remixFxHasPro(none)).toBe(false);
    expect(REMIX_VIBES.find((vibe) => vibe.id === "none")?.description).toMatch(
      /Pro EQ and pan included/,
    );
    // A Pro-only recipe is not "No effects".
    expect(activeVibeId({ schemaVersion: "remix-fx/v3", stems: { bass: { pan: 0.5 } } })).toBeNull();
  });
});
