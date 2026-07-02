import { describe, expect, it } from "vitest";
import type { RemixSectionGrid } from "./api";
import {
  activeIntervalsFromSections,
  arrangementPayload,
  parseArrangementSections,
  REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION,
  sectionGridSummaryLabel,
  sectionStartLabel,
} from "./remixArrangement";
import { scheduleSectionEnvelope } from "./remixAudioPreview";

const grid: RemixSectionGrid = {
  kind: "bars",
  sections: [
    { startSec: 0, endSec: 16 },
    { startSec: 16, endSec: 32 },
    { startSec: 32, endSec: 48 },
    { startSec: 48, endSec: 64 },
  ],
  sectionSeconds: 16,
  durationSeconds: 64,
  bpm: 120,
};

describe("parseArrangementSections", () => {
  it("reads a valid mask and rejects foreign or mis-sized shapes", () => {
    const mask = arrangementPayload([true, false, true, true]);
    expect(parseArrangementSections(mask, 4)).toEqual([true, false, true, true]);
    expect(parseArrangementSections(null, 4)).toBeNull();
    expect(parseArrangementSections(mask, 3)).toBeNull(); // other grid
    expect(
      parseArrangementSections({ schemaVersion: "v2", sections: [true] }, 1),
    ).toBeNull();
  });
});

describe("activeIntervalsFromSections", () => {
  it("mirrors the backend: null for fully active, [] for silent, merged spans otherwise", () => {
    expect(activeIntervalsFromSections(grid, null)).toBeNull();
    expect(
      activeIntervalsFromSections(grid, [true, true, true, true]),
    ).toBeNull();
    expect(
      activeIntervalsFromSections(grid, [false, false, false, false]),
    ).toEqual([]);
    expect(
      activeIntervalsFromSections(grid, [true, true, false, true]),
    ).toEqual([
      { startSec: 0, endSec: 32 },
      { startSec: 48, endSec: 64 },
    ]);
  });
});

describe("labels", () => {
  it("describes bar grids with the measured tempo and time grids honestly", () => {
    expect(sectionGridSummaryLabel(grid)).toBe(
      "8-bar sections · measured 120 BPM",
    );
    expect(
      sectionGridSummaryLabel({ ...grid, kind: "time", bpm: null }),
    ).toBe("16-second sections · tempo not measured");
  });

  it("labels section columns with their start time", () => {
    expect(sectionStartLabel({ startSec: 0, endSec: 16 })).toBe("0:00");
    expect(sectionStartLabel({ startSec: 75, endSec: 91 })).toBe("1:15");
  });
});

describe("arrangementPayload", () => {
  it("stamps the schema version and copies the mask", () => {
    const sections = [true, false];
    const payload = arrangementPayload(sections);
    expect(payload.schemaVersion).toBe(REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION);
    expect(payload.sections).toEqual(sections);
    expect(payload.sections).not.toBe(sections); // defensive copy
  });
});

describe("scheduleSectionEnvelope", () => {
  function recorder() {
    const events: Array<[string, number, number]> = [];
    return {
      events,
      param: {
        setValueAtTime: (value: number, time: number) => {
          events.push(["set", value, round(time)]);
        },
        linearRampToValueAtTime: (value: number, time: number) => {
          events.push(["ramp", value, round(time)]);
        },
      },
    };
  }
  const round = (value: number) => Math.round(value * 1000) / 1000;

  it("holds 1 for fully-active stems and 0 for silent ones", () => {
    const full = recorder();
    scheduleSectionEnvelope(full.param, null, 10);
    expect(full.events).toEqual([["set", 1, 10]]);

    const silent = recorder();
    scheduleSectionEnvelope(silent.param, [], 10);
    expect(silent.events).toEqual([["set", 0, 10]]);
  });

  it("schedules trapezoids matching the render's edge fades", () => {
    const { param, events } = recorder();
    scheduleSectionEnvelope(
      param,
      [
        { startSec: 0, endSec: 32 },
        { startSec: 48, endSec: 64 },
      ],
      10,
      0.05,
    );
    expect(events).toEqual([
      ["set", 1, 10], // starts inside the first span → no fade-in at 0
      ["set", 1, round(10 + 32 - 0.05)],
      ["ramp", 0, 10 + 32],
      ["set", 0, 10 + 48],
      ["ramp", 1, round(10 + 48 + 0.05)],
      ["set", 1, round(10 + 64 - 0.05)],
      ["ramp", 0, 10 + 64],
    ]);
  });
});
