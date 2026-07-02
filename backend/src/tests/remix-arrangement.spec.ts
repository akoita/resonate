/**
 * Section-grid arrangement (#1314) — pure unit tests.
 *
 * Grid derivation from measured features, mask parsing/validation, interval
 * merging, and the ffmpeg gate-expression builder. No DB, no ffmpeg.
 */

import {
  activeIntervalsForArrangement,
  buildSectionGateVolumeExpression,
  deriveSectionGrid,
  FALLBACK_SECTION_SECONDS,
  MAX_SECTION_COUNT,
  parseStemArrangement,
  REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION,
  validateStemArrangementInput,
} from "../modules/remix/remix-arrangement";
import { buildStemMixFfmpegArgs } from "../modules/remix/stem-audio-mixer";

const features = (overrides: Record<string, unknown> = {}) => ({
  audioFeatures: {
    schemaVersion: "stem-audio-features/v1",
    tempoBpm: 120,
    tempoConfidence: 0.8,
    firstBeatSec: 0.5,
    durationSeconds: 64,
    ...overrides,
  },
});

describe("deriveSectionGrid", () => {
  it("derives beat-anchored 8-bar sections from the highest-confidence tempo", () => {
    const grid = deriveSectionGrid([
      features({ tempoBpm: 90, tempoConfidence: 0.3 }),
      features(), // 120 BPM, confidence 0.8 → wins
    ]);
    expect(grid).not.toBeNull();
    expect(grid!.kind).toBe("bars");
    expect(grid!.bpm).toBe(120);
    // 8 bars * 4 beats * 60 / 120 = 16s per section.
    expect(grid!.sectionSeconds).toBe(16);
    // Anchored at firstBeat 0.5 (< quarter section → folded into section 0):
    // boundaries at 16.5, 32.5, 48.5 over 64s → 4 sections.
    expect(grid!.sections).toEqual([
      { startSec: 0, endSec: 16.5 },
      { startSec: 16.5, endSec: 32.5 },
      { startSec: 32.5, endSec: 48.5 },
      { startSec: 48.5, endSec: 64 },
    ]);
  });

  it("falls back to fixed time sections when no tempo is measured", () => {
    const grid = deriveSectionGrid([
      features({ tempoBpm: null, firstBeatSec: null }),
    ]);
    expect(grid).not.toBeNull();
    expect(grid!.kind).toBe("time");
    expect(grid!.bpm).toBeNull();
    expect(grid!.sectionSeconds).toBe(FALLBACK_SECTION_SECONDS);
    expect(grid!.sections).toHaveLength(4); // 64s / 16s
  });

  it("returns null when nothing is measured or the track is too short", () => {
    expect(deriveSectionGrid([{ audioFeatures: null }])).toBeNull();
    expect(deriveSectionGrid([])).toBeNull();
    // 10s track < 2 sections of 16s → nothing to arrange.
    expect(
      deriveSectionGrid([features({ tempoBpm: null, durationSeconds: 10 })]),
    ).toBeNull();
  });

  it("caps runaway grids instead of emitting hundreds of sections", () => {
    // 3 hours at 300 BPM would be ~840 sections.
    expect(
      deriveSectionGrid([
        features({ tempoBpm: 300, durationSeconds: 3 * 3600 }),
      ]),
    ).toBeNull();
    // A long but sane track stays under the cap.
    const grid = deriveSectionGrid([features({ durationSeconds: 600 })]);
    expect(grid).not.toBeNull();
    expect(grid!.sections.length).toBeLessThanOrEqual(MAX_SECTION_COUNT);
  });

  it("merges the trailing sliver into the previous section", () => {
    // 34s at 120 BPM (16s sections, anchor 0): boundary at 16 only — the
    // 2s tail after 32 is under the quarter-section minimum span.
    const grid = deriveSectionGrid([
      features({ firstBeatSec: 0, durationSeconds: 34 }),
    ]);
    expect(grid!.sections).toEqual([
      { startSec: 0, endSec: 16 },
      { startSec: 16, endSec: 34 },
    ]);
  });
});

describe("parseStemArrangement / validateStemArrangementInput", () => {
  const grid = deriveSectionGrid([features()])!; // 4 sections

  it("round-trips a valid mask and rejects foreign shapes", () => {
    const mask = {
      schemaVersion: REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION,
      sections: [true, false, true, true],
    };
    expect(parseStemArrangement(mask)).toEqual(mask);
    expect(parseStemArrangement(null)).toBeNull();
    expect(parseStemArrangement({ sections: [true] })).toBeNull();
    expect(
      parseStemArrangement({
        schemaVersion: "remix-stem-arrangement/v2",
        sections: [true],
      }),
    ).toBeNull();
    expect(
      parseStemArrangement({
        schemaVersion: REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION,
        sections: [1, 0],
      }),
    ).toBeNull();
  });

  it("validates PATCH payloads against the derived grid", () => {
    expect(
      validateStemArrangementInput(
        {
          schemaVersion: REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION,
          sections: [true, false, true, true],
        },
        grid,
      ),
    ).toBeNull();
    expect(validateStemArrangementInput(null, grid)).toBeNull(); // reset
    expect(
      validateStemArrangementInput(
        {
          schemaVersion: REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION,
          sections: [true, false],
        },
        grid,
      ),
    ).toMatch(/exactly 4 entries/);
    expect(validateStemArrangementInput({ bogus: true }, grid)).toMatch(
      /arrangement must be null or/,
    );
    expect(
      validateStemArrangementInput(
        {
          schemaVersion: REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION,
          sections: [true, true],
        },
        null,
      ),
    ).toMatch(/no section grid/);
  });
});

describe("activeIntervalsForArrangement", () => {
  const grid = deriveSectionGrid([features({ firstBeatSec: 0 })])!; // 0/16/32/48/64

  const mask = (sections: boolean[]) => ({
    schemaVersion: REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION,
    sections,
  }) as const;

  it("returns null for fully-active stems (no gating at all)", () => {
    expect(activeIntervalsForArrangement(grid, null)).toBeNull();
    expect(
      activeIntervalsForArrangement(grid, mask([true, true, true, true])),
    ).toBeNull();
  });

  it("fails open to fully-active when the mask was authored on another grid", () => {
    expect(activeIntervalsForArrangement(grid, mask([true, false]))).toBeNull();
  });

  it("returns [] for all-off masks (effectively muted)", () => {
    expect(
      activeIntervalsForArrangement(grid, mask([false, false, false, false])),
    ).toEqual([]);
  });

  it("merges adjacent on-sections into single spans", () => {
    expect(
      activeIntervalsForArrangement(grid, mask([true, true, false, true])),
    ).toEqual([
      { startSec: 0, endSec: 32 },
      { startSec: 48, endSec: 64 },
    ]);
  });
});

describe("buildSectionGateVolumeExpression", () => {
  it("builds clamped trapezoids with escaped commas and no fade-in at zero", () => {
    const expr = buildSectionGateVolumeExpression(
      [
        { startSec: 0, endSec: 32 },
        { startSec: 48, endSec: 64 },
      ],
      0.05,
    );
    // No fade-in for the track start; fade edges elsewhere.
    expect(expr).toBe(
      "min(1\\,max(0\\,min(1\\,min((32-t)/0.05\\,1)))+max(0\\,min(min((t-48)/0.05\\,1)\\,min((64-t)/0.05\\,1))))",
    );
    // Nothing but numbers/operators/escaped commas — never user strings.
    expect(expr).toMatch(/^[\dtminax()+\-/.,\\]+$/);
  });

  it("returns silence for an empty interval list", () => {
    expect(buildSectionGateVolumeExpression([], 0.05)).toBe("0");
  });
});

describe("buildStemMixFfmpegArgs with section gating", () => {
  it("adds a per-frame volume gate only for gated stems", () => {
    const args = buildStemMixFfmpegArgs(
      [
        { path: "/tmp/a.audio", gainDb: -3 },
        {
          path: "/tmp/b.audio",
          gainDb: 0,
          activeIntervals: [{ startSec: 16, endSec: 32 }],
        },
      ],
      "/tmp/mix.mp3",
    );
    const filter = args[args.indexOf("-filter_complex") + 1];
    // Ungated stem: static gain only, byte-identical to pre-#1314.
    expect(filter).toContain("[0:a]volume=-3dB[a0]");
    // Gated stem: static gain, then the generated envelope.
    expect(filter).toContain(
      "[1:a]volume=0dB,volume=volume=min(1\\,max(0\\,min(min((t-16)/0.05\\,1)\\,min((32-t)/0.05\\,1)))):eval=frame[a1]",
    );
    expect(filter).toContain("amix=inputs=2");
  });
});
