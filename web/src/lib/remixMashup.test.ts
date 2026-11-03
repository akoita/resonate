/**
 * Mashups (#2559): the studio's conform plan replays the backend's
 * `remix-mashup-v1.parity.json`, and the preview shifts and cuts B's
 * stretched audio exactly like the render (whole samples).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  denialSourceLabel,
  initialMashup,
  measuredKey,
  previewConforms,
  stemsOfSource,
  suggestKeyShift,
  suggestTempoRatio,
  mashupConformKey,
  mashupConformPlan,
  measuredTempo,
  shiftConformedChannels,
  type RemixMashup,
} from "./remixMashup";
import type { RemixSectionGrid } from "./api";

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, "../../../backend/src/modules/remix/remix-mashup-v1.parity.json"),
    "utf8",
  ),
) as {
  cases: Array<{
    name: string;
    leadGrid: RemixSectionGrid | null;
    secondaryStems: Array<{ audioFeatures?: unknown }>;
    mashup: RemixMashup;
    expected: unknown;
  }>;
};

describe("mashupConformPlan parity (remix-mashup-v1.parity.json)", () => {
  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(
      mashupConformPlan({
        leadGrid: c.leadGrid,
        secondaryStems: c.secondaryStems,
        mashup: c.mashup,
      }),
    ).toEqual(c.expected);
  });
});

describe("shiftConformedChannels", () => {
  const ramp = (n: number) => Float32Array.from({ length: n }, (_, i) => i + 1);

  it("delays a positive shift with leading silence and cuts at A's end", () => {
    const [out] = shiftConformedChannels([ramp(10)], 10, { shiftSec: 0.3, endSec: 1 });
    expect(Array.from(out)).toEqual([0, 0, 0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("trims a negative shift and keeps the length when there is no end", () => {
    const [left, right] = shiftConformedChannels([ramp(6), ramp(6)], 10, {
      shiftSec: -0.2,
      endSec: null,
    });
    expect(Array.from(left)).toEqual([3, 4, 5, 6]);
    expect(Array.from(right)).toEqual([3, 4, 5, 6]);
  });

  it("never returns an empty buffer", () => {
    const [out] = shiftConformedChannels([ramp(3)], 10, { shiftSec: -1, endSec: null });
    expect(out.length).toBe(1);
  });
});

describe("helpers", () => {
  it("reads the most confident measured tempo and keys conforms", () => {
    expect(
      measuredTempo([
        { audioFeatures: { tempoBpm: 90, tempoConfidence: 0.2, firstBeatSec: 1 } },
        { audioFeatures: { tempoBpm: 100, tempoConfidence: 0.8, firstBeatSec: 0.3 } },
      ]),
    ).toEqual({ bpm: 100, firstBeatSec: 0.3 });
    expect(mashupConformKey({ tempo: 1.2, semitones: -2, shiftSec: 3.75, endSec: null })).toBe(
      "1.2|-2|3.75|",
    );
  });
});

describe("studio helpers (#2560)", () => {
  it("suggests the tempo ratio, at half or double time when the direct one is out of range", () => {
    expect(suggestTempoRatio(120, 100)).toEqual({ ratio: 1.2, feel: "same", inRange: true });
    // 170 over 85: direct 2.0 is out of range; B read at double time is 1.0.
    expect(suggestTempoRatio(170, 85)).toEqual({ ratio: 1, feel: "double", inRange: true });
    expect(suggestTempoRatio(70, 140)).toEqual({ ratio: 1, feel: "half", inRange: true });
    // 60 over 125: 0.48 is out of range; 0.96 at half time is in.
    expect(suggestTempoRatio(60, 125)?.feel).toBe("half");
    // 100 over 175: 0.571, 1.143 (half) — in range.
    expect(suggestTempoRatio(100, 175)).toEqual({ ratio: 1.1429, feel: "half", inRange: true });
    expect(suggestTempoRatio(null, 100)).toBeNull();
  });

  it("says when two tempos are too far apart even at half or double time", () => {
    // 100 over 145: 0.69, 1.379, 0.345 — none within 0.75–1.33.
    expect(suggestTempoRatio(100, 145)).toEqual({ ratio: 0.75, feel: "same", inRange: false });
  });

  it("suggests the key shift through the relative major, within a tritone", () => {
    expect(suggestKeyShift({ tonic: "A", mode: "minor" }, { tonic: "G", mode: "minor" })).toBe(2);
    // A minor ≈ C major: no shift for a C major B.
    expect(suggestKeyShift({ tonic: "A", mode: "minor" }, { tonic: "C", mode: "major" })).toBe(0);
    expect(suggestKeyShift({ tonic: "C", mode: "major" }, { tonic: "F#", mode: "major" })).toBe(6);
    expect(suggestKeyShift({ tonic: "C", mode: "major" }, { tonic: "Bb", mode: "major" })).toBe(2);
    expect(suggestKeyShift({ tonic: "C", mode: "major" }, { tonic: "E", mode: "major" })).toBe(-4);
    expect(suggestKeyShift(null, { tonic: "E", mode: "major" })).toBeNull();
    expect(suggestKeyShift({ tonic: "H", mode: "major" }, { tonic: "E", mode: "major" })).toBeNull();
  });

  it("builds the first recipe from the measured features", () => {
    expect(
      initialMashup({
        leadBpm: 120,
        secondaryBpm: 100,
        leadKey: { tonic: "A", mode: "minor" },
        secondaryKey: { tonic: "G", mode: "minor" },
      }),
    ).toEqual({
      schemaVersion: "remix-mashup/v1",
      secondary: { tempoRatio: 1.2, semitones: 2, offsetBars: 0 },
    });
    expect(
      initialMashup({ leadBpm: null, secondaryBpm: null, leadKey: null, secondaryKey: null })
        .secondary,
    ).toEqual({ tempoRatio: 1, semitones: 0, offsetBars: 0 });
  });

  it("picks the most confident measured key", () => {
    expect(
      measuredKey([
        { audioFeatures: { key: { tonic: "C", mode: "major", confidence: 0.4 } } },
        { audioFeatures: { key: { tonic: "D", mode: "minor", confidence: 0.8 } } },
        { audioFeatures: null },
      ]),
    ).toEqual({ tonic: "D", mode: "minor" });
    expect(measuredKey([])).toBeNull();
  });

  it("conforms only B's stems in the preview, and says when B plays as it is", () => {
    const grid = {
      kind: "bars",
      sections: [0, 16, 32, 48].map((startSec) => ({ startSec, endSec: startSec + 16 })),
      sectionSeconds: 16,
      durationSeconds: 64,
      bpm: 120,
      firstBeatSec: 0,
    } as unknown as RemixSectionGrid;
    const project = {
      sourceTrackId: "A",
      secondarySource: { trackId: "B" },
      mashup: {
        schemaVersion: "remix-mashup/v1" as const,
        secondary: { tempoRatio: 1.2, semitones: -2, offsetBars: 4 },
      },
      sectionGrid: grid,
      stems: [
        { stemId: "a1", sourceTrackId: "A" },
        { stemId: "b1", sourceTrackId: "B", audioFeatures: { tempoBpm: 100, firstBeatSec: 0 } },
      ],
    };
    expect(previewConforms(project)).toEqual({
      conforms: { b1: { tempo: 1.2, semitones: -2, shiftSec: 8, endSec: 64 } },
      skipped: null,
    });
    expect(previewConforms({ ...project, sectionGrid: null })).toEqual({
      conforms: {},
      skipped: "no_lead_grid",
    });
    expect(previewConforms({ ...project, secondarySource: null })).toEqual({
      conforms: {},
      skipped: null,
    });
    expect(stemsOfSource(project.stems, "A", "A").map((stem) => stem.stemId)).toEqual(["a1"]);
  });

  it("names the track that blocks on a two-source project", () => {
    const sources = { lead: { trackTitle: "Night Drive" }, secondary: { trackTitle: "Low Tide" } };
    expect(denialSourceLabel({ sourceRole: "secondary" }, sources)).toBe("Track B (“Low Tide”)");
    expect(denialSourceLabel({ sourceRole: "lead" }, sources)).toBe("Track A (“Night Drive”)");
    expect(denialSourceLabel({}, sources)).toBeNull();
    expect(denialSourceLabel({ sourceRole: "lead" }, { lead: sources.lead })).toBeNull();
  });
});
