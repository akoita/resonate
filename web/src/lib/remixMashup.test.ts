/**
 * Mashups (#2559): the studio's conform plan replays the backend's
 * `remix-mashup-v1.parity.json`, and the preview shifts and cuts B's
 * stretched audio exactly like the render (whole samples).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
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
