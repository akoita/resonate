/**
 * remix-fx/v3 Pro fields (#1903 S6a): per-stem 3-band EQ and pan — pure
 * unit tests.
 *
 * The parity block replays the committed Pro fixture the web preview is also
 * tested against (coefficients and pan gains within 1e-12). The render block
 * pins the ffmpeg filter strings, the chain order, the mono up-mix, and that
 * recipes without Pro fields keep a byte-identical graph. ffmpeg's measured
 * response lives in remix-fx-pro-render.spec.ts.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { buildSectionGateVolumeExpression } from "../modules/remix/remix-arrangement";
import {
  eqBiquadCoefficients,
  normalizeRemixFxInput,
  panGains,
  readStoredRemixFx,
  REMIX_FX_DSP_VERSION,
  REMIX_FX_EQ_BANDS,
  REMIX_FX_PRO_DSP_VERSION,
  REMIX_FX_SCHEMA_VERSION,
  remixFxProFieldsSet,
  remixFxUsesPro,
  stemEqStages,
  type RemixFxEqBandId,
  type RemixFxRecipe,
} from "../modules/remix/remix-fx";
import {
  buildChannelProbeArgs,
  buildStemMixFfmpegArgs,
  stemProFilters,
  type StemMixFfmpegInput,
} from "../modules/remix/stem-audio-mixer";

type ProFixture = {
  schemaVersion: string;
  dspVersion: string;
  bands: Record<
    RemixFxEqBandId,
    { type: string; frequencyHz: number; slope?: number; q?: number }
  >;
  eq: Array<{
    band: RemixFxEqBandId;
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

const fixture: ProFixture = JSON.parse(
  readFileSync(
    join(__dirname, "../modules/remix/remix-fx-pro-v1.parity.json"),
    "utf8",
  ),
);

const TOLERANCE = 1e-12;

function expectClose(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE);
}

describe("remix-fx-pro-dsp/v1 parity fixture (#1903)", () => {
  it("pins the versions and the band definitions", () => {
    expect(fixture.schemaVersion).toBe(REMIX_FX_SCHEMA_VERSION);
    expect(REMIX_FX_SCHEMA_VERSION).toBe("remix-fx/v3");
    expect(fixture.dspVersion).toBe(REMIX_FX_PRO_DSP_VERSION);
    expect(REMIX_FX_PRO_DSP_VERSION).toBe("remix-fx-pro-dsp/v1");
    // The v1 mapping is unchanged by v3.
    expect(REMIX_FX_DSP_VERSION).toBe("remix-fx-dsp/v1");
    for (const band of ["low", "mid", "high"] as const) {
      const { key: _key, ...definition } = REMIX_FX_EQ_BANDS[band];
      expect(definition).toEqual(fixture.bands[band]);
    }
  });

  it("covers both preview sample rates and 8 gains per band", () => {
    expect(new Set(fixture.eq.map((entry) => entry.sampleRate))).toEqual(
      new Set([48_000, 44_100]),
    );
    expect(fixture.eq).toHaveLength(2 * 3 * 8);
  });

  it.each(fixture.eq)(
    "$band $gainDb dB at $sampleRate Hz",
    ({ band, gainDb, sampleRate, coefficients }) => {
      const actual = eqBiquadCoefficients(band, gainDb, sampleRate);
      for (const key of ["b0", "b1", "b2", "a1", "a2"] as const) {
        expectClose(actual[key], coefficients[key]);
      }
    },
  );

  it.each(fixture.pan)("pan $pan", ({ pan, gains }) => {
    const actual = panGains(pan);
    if (gains === null) {
      expect(actual).toBeNull();
      return;
    }
    expect(actual).not.toBeNull();
    expectClose(actual!.x, gains.x);
    expectClose(actual!.gL, gains.gL);
    expectClose(actual!.gR, gains.gR);
    for (const key of ["ll", "lr", "rl", "rr"] as const) {
      expectClose(actual!.matrix[key], gains.matrix[key]);
    }
  });

  it.each(fixture.normalize.map((entry, index) => ({ ...entry, index })))(
    "normalize case $index",
    ({ input, output }) => {
      expect(normalizeRemixFxInput(input, ["a", "b"])).toEqual({
        value: output,
      });
    },
  );
});

describe("normalizeRemixFxInput Pro fields (#1903)", () => {
  const stems = ["s1", "s2"];

  it("accepts the bounds inclusively, rounds EQ to 0.5 dB and pan to 0.01", () => {
    expect(
      normalizeRemixFxInput(
        {
          schemaVersion: "remix-fx/v3",
          stems: {
            s1: { eqLow: -12, eqMid: 12, eqHigh: 2.74, pan: -1 },
            s2: { eqLow: 0.24, pan: 0.996 },
          },
        },
        stems,
      ),
    ).toEqual({
      value: {
        schemaVersion: "remix-fx/v3",
        stems: {
          s1: { eqLow: -12, eqMid: 12, eqHigh: 2.5, pan: -1 },
          s2: { pan: 1 },
        },
      },
    });
  });

  it("omits Pro fields at their default and drops an all-default stem", () => {
    expect(
      normalizeRemixFxInput(
        { stems: { s1: { eqLow: 0, eqMid: -0, eqHigh: 0.2, pan: 0.004 } } },
        stems,
      ),
    ).toEqual({ value: null });
  });

  it("keeps Pro fields next to the v1 per-stem fields and the v2 master", () => {
    expect(
      normalizeRemixFxInput(
        {
          schemaVersion: "remix-fx/v2",
          master: { speed: 0.9, semitones: -1 },
          stems: { s1: { echo: 0.3, eqMid: -3, pan: 0.25 } },
        },
        stems,
      ),
    ).toEqual({
      value: {
        schemaVersion: "remix-fx/v3",
        master: { speed: 0.9, semitones: -1 },
        stems: { s1: { echo: 0.3, eqMid: -3, pan: 0.25 } },
      },
    });
  });

  it.each([
    ["EQ above range", { stems: { s1: { eqLow: 12.5 } } }, /effects\.stems\.s1\.eqLow must be between -12 and 12/],
    ["EQ below range", { stems: { s1: { eqHigh: -13 } } }, /eqHigh must be between -12 and 12/],
    ["EQ as a string", { stems: { s1: { eqMid: "3" } } }, /eqMid must be a finite number/],
    ["NaN pan", { stems: { s1: { pan: Number.NaN } } }, /pan must be a finite number/],
    ["pan beyond left", { stems: { s1: { pan: -1.01 } } }, /pan must be between -1 and 1/],
    ["pan beyond right", { stems: { s1: { pan: 2 } } }, /pan must be between -1 and 1/],
    ["an unknown stem field", { stems: { s1: { eq: 3 } } }, /allowed: space, echo, tone, eqLow, eqMid, eqHigh, pan/],
    ["a Pro field on the master", { master: { pan: 0.5 } }, /effects\.master\.pan/],
    ["a future schema version", { schemaVersion: "remix-fx/v4" }, /schemaVersion must be "remix-fx\/v3", "remix-fx\/v2" or "remix-fx\/v1"/],
  ])("rejects %s", (_label, input, message) => {
    const result = normalizeRemixFxInput(input, stems);
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toMatch(message);
  });

  it("reads stored v1/v2/v3 rows tolerantly (bad Pro values read as null)", () => {
    expect(
      readStoredRemixFx({
        schemaVersion: "remix-fx/v3",
        stems: { s1: { eqLow: 3, pan: -0.3 } },
      }),
    ).toEqual({
      schemaVersion: "remix-fx/v3",
      stems: { s1: { eqLow: 3, pan: -0.3 } },
    });
    expect(
      readStoredRemixFx({ schemaVersion: "remix-fx/v2", stems: { s1: { echo: 0.2 } } }),
    ).toEqual({ schemaVersion: "remix-fx/v3", stems: { s1: { echo: 0.2 } } });
    expect(
      readStoredRemixFx({ schemaVersion: "remix-fx/v3", stems: { s1: { pan: 4 } } }),
    ).toBeNull();
  });
});

describe("Pro field helpers (#1903)", () => {
  const recipe = (stems: RemixFxRecipe["stems"]): RemixFxRecipe => ({
    schemaVersion: "remix-fx/v3",
    stems,
  });

  it("detects Pro usage per recipe", () => {
    expect(remixFxUsesPro(null)).toBe(false);
    expect(remixFxUsesPro(recipe({ a: { echo: 0.5, tone: 0.2 } }))).toBe(false);
    expect(remixFxUsesPro(recipe({ a: { echo: 0.5 }, b: { pan: -0.3 } }))).toBe(true);
    expect(remixFxUsesPro(recipe({ a: { eqHigh: 1.5 } }))).toBe(true);
  });

  it("lists the Pro fields a recipe sets relative to the stored one", () => {
    const stored = recipe({ a: { eqLow: 3, pan: -0.3 } });
    // Keeping saved values sets nothing.
    expect(remixFxProFieldsSet(stored, stored)).toEqual([]);
    // Removing them (or the whole recipe) sets nothing.
    expect(remixFxProFieldsSet(recipe({ a: { echo: 0.2 } }), stored)).toEqual([]);
    expect(remixFxProFieldsSet(null, stored)).toEqual([]);
    // A changed value or a new field / stem is a set.
    expect(
      remixFxProFieldsSet(
        recipe({ a: { eqLow: 3.5, pan: -0.3 }, b: { eqMid: -2 } }),
        stored,
      ),
    ).toEqual(["stems.a.eqLow", "stems.b.eqMid"]);
    expect(remixFxProFieldsSet(recipe({ a: { pan: 1 } }), null)).toEqual([
      "stems.a.pan",
    ]);
  });

  it("orders the EQ stages low → mid → high and skips 0 dB bands", () => {
    expect(stemEqStages({ eqHigh: 2, eqLow: -3, echo: 0.5 })).toEqual([
      { band: "low", gainDb: -3 },
      { band: "high", gainDb: 2 },
    ]);
    expect(stemEqStages({ eqMid: 0 })).toEqual([]);
    expect(stemEqStages(undefined)).toEqual([]);
  });
});

function filterOf(args: string[]): string {
  return args[args.indexOf("-filter_complex") + 1];
}

describe("render: Pro filter strings (#1903)", () => {
  it("maps EQ bands to ffmpeg lowshelf / equalizer / highshelf", () => {
    expect(stemProFilters({ eqLow: 3, eqMid: -4.5, eqHigh: 12 })).toEqual([
      "lowshelf=f=200:t=s:w=1:g=3",
      "equalizer=f=1000:t=q:w=0.7071:g=-4.5",
      "highshelf=f=4000:t=s:w=1:g=12",
    ]);
  });

  it("maps pan to an explicit '=' matrix with fx number formatting", () => {
    const left = panGains(-0.3)!;
    expect(stemProFilters({ pan: -0.3 })).toEqual([
      `pan=stereo|c0=1*c0+${Math.round(left.gL * 1e6) / 1e6}*c1|c1=0*c0+${Math.round(left.gR * 1e6) / 1e6}*c1`,
    ]);
    expect(stemProFilters({ pan: -0.3 })[0]).toBe(
      "pan=stereo|c0=1*c0+0.45399*c1|c1=0*c0+0.891007*c1",
    );
    expect(stemProFilters({ pan: 0.3 })[0]).toBe(
      "pan=stereo|c0=0.891007*c0+0*c1|c1=0.45399*c0+1*c1",
    );
    // Hard left: L' = L + R, R' = 0 (cos(0) = 1, sin(0) = 0).
    expect(stemProFilters({ pan: -1 })[0]).toBe(
      "pan=stereo|c0=1*c0+1*c1|c1=0*c0+0*c1",
    );
    // Hard right: L' = 0 (cos(π/2) formats to 0), R' = R + L.
    expect(stemProFilters({ pan: 1 })[0]).toBe(
      "pan=stereo|c0=0*c0+0*c1|c1=1*c0+1*c1",
    );
  });

  it("up-mixes a mono stem to stereo at unity before the pan only", () => {
    expect(stemProFilters({ eqLow: 2, pan: 0.5 }, 1)).toEqual([
      "lowshelf=f=200:t=s:w=1:g=2",
      "pan=stereo|c0=c0|c1=c0",
      expect.stringMatching(/^pan=stereo\|c0=0\.707107\*c0\+0\*c1\|c1=0\.707107\*c0\+1\*c1$/),
    ]);
    // No pan: a mono stem is left as is.
    expect(stemProFilters({ eqLow: 2 }, 1)).toEqual([
      "lowshelf=f=200:t=s:w=1:g=2",
    ]);
    // Stereo (or unknown) input: no up-mix.
    expect(stemProFilters({ pan: 0.5 }, 2)).toHaveLength(1);
    expect(stemProFilters({ pan: 0.5 })).toHaveLength(1);
  });

  it("inserts the Pro stages after gain and before the section gate, tone and echo", () => {
    const intervals = [{ startSec: 0, endSec: 8 }];
    const args = buildStemMixFfmpegArgs(
      [
        {
          path: "/tmp/a.audio",
          gainDb: -3,
          activeIntervals: intervals,
          fxStemId: "a",
          channels: 1,
        },
        { path: "/tmp/b.audio", gainDb: 0, fxStemId: "b" },
      ],
      "/tmp/mix.mp3",
      {
        effects: {
          schemaVersion: "remix-fx/v3",
          master: { speed: 0.85 },
          stems: {
            a: { eqLow: 3, eqMid: -2, eqHigh: 1.5, pan: -0.3, tone: 0.5, echo: 0.5 },
          },
        },
        bpm: 120,
      },
    );
    const [chainA, chainB] = filterOf(args).split(";");
    // The gate expression escapes its own commas, so check the order by
    // position rather than by splitting.
    const expectedOrder = [
      "[0:a]aresample=48000,aformat=sample_fmts=fltp,asetrate=40800,aresample=48000,volume=-3dB,",
      "lowshelf=f=200:t=s:w=1:g=3,",
      "equalizer=f=1000:t=q:w=0.7071:g=-2,",
      "highshelf=f=4000:t=s:w=1:g=1.5,",
      "pan=stereo|c0=c0|c1=c0,",
      "pan=stereo|c0=1*c0+0.45399*c1|c1=0*c0+0.891007*c1,",
      `volume=volume=${buildSectionGateVolumeExpression([{ startSec: 0, endSec: 8 / 0.85 }])}:eval=frame,`,
      "highpass=",
      "aecho=",
    ];
    const positions = expectedOrder.map((stage) => chainA.indexOf(stage));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(chainA.startsWith(expectedOrder.slice(0, 7).join(""))).toBe(true);
    // A stem without Pro fields gets no Pro stage.
    expect(chainB).toBe(
      "[1:a]aresample=48000,aformat=sample_fmts=fltp,asetrate=40800,aresample=48000,volume=0dB[a1]",
    );
  });

  it("never gives Pro stages to AI layers, the beat or AI parts", () => {
    const effects: RemixFxRecipe = {
      schemaVersion: "remix-fx/v3",
      stems: { a: { eqLow: 6, pan: 0.4 } },
    };
    const inputs: StemMixFfmpegInput[] = [
      { path: "/tmp/layer.wav", gainDb: 0, aiLayer: true, fxStemId: "a" },
      { path: "/tmp/beat.wav", gainDb: 0, beat: true, fxStemId: "a" },
      { path: "/tmp/part.wav", gainDb: 0, part: { role: "bass" }, fxStemId: "a" },
    ];
    const filter = filterOf(buildStemMixFfmpegArgs(inputs, "/tmp/mix.mp3", { effects }));
    expect(filter).not.toMatch(/lowshelf|equalizer|highshelf/);
    // Only the beat's own mono up-mix: no Pro pan matrix.
    expect(filter.match(/pan=stereo/g)).toEqual(["pan=stereo"]);
  });

  it("keeps the graph byte-identical for recipes without Pro fields", () => {
    const inputs: StemMixFfmpegInput[] = [
      { path: "/tmp/a.audio", gainDb: 1.5, fxStemId: "a", channels: 1 },
      { path: "/tmp/b.audio", gainDb: 0, fxStemId: "b" },
    ];
    const classic: RemixFxRecipe = {
      schemaVersion: "remix-fx/v2",
      master: { speed: 0.9, tone: -0.2 },
      stems: { a: { echo: 0.4, tone: 0.3 } },
    };
    const baseline = buildStemMixFfmpegArgs(inputs, "/tmp/mix.mp3", {
      effects: classic,
      bpm: 100,
    });
    // The same recipe written as v3, and with Pro fields that normalize away.
    const asV3 = normalizeRemixFxInput(
      {
        ...classic,
        schemaVersion: "remix-fx/v3",
        stems: {
          a: { echo: 0.4, tone: 0.3, eqLow: 0, pan: 0 },
          b: { eqMid: 0.2, pan: -0.004 },
        },
      },
      ["a", "b"],
    );
    expect("value" in asV3 && asV3.value).toBeTruthy();
    const v3Args = buildStemMixFfmpegArgs(inputs, "/tmp/mix.mp3", {
      effects: (asV3 as { value: RemixFxRecipe }).value,
      bpm: 100,
    });
    expect(v3Args).toEqual(baseline);
    expect(filterOf(baseline)).not.toMatch(/shelf|equalizer|pan=/);
  });

  it("probes the first audio stream's channel count with ffprobe", () => {
    expect(buildChannelProbeArgs("/tmp/stem.audio")).toEqual([
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=channels",
      "-of", "csv=p=0",
      "/tmp/stem.audio",
    ]);
  });
});
