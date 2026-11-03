/**
 * Grid correction (#2539, S6c of #1903): the artist's tempo and first
 * downbeat override the measured grid for every consumer, without touching
 * the analysis. The parity block replays the fixture the web preview test
 * also replays, so preview and render place beats and parts identically.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  REMIX_GRID_OVERRIDE_SCHEMA_VERSION,
  deriveSectionGrid,
  normalizeGridOverrideInput,
  parseGridOverride,
} from "../modules/remix/remix-arrangement";
import { beatBarPhase, beatHits, beatTimingAtSpeed } from "../modules/remix/remix-beat";
import { partPlacementSpans } from "../modules/remix/remix-parts";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "../modules/remix/remix-grid-override-v1.parity.json"), "utf8"),
);
const EPS = 1e-9;
const stems = fixture.stems;

describe("grid override input (#2539)", () => {
  it("normalizes to 3 decimals and accepts null to reset", () => {
    expect(normalizeGridOverrideInput({ tempoBpm: 120.12345, firstBeatSec: 0.8199 })).toEqual({
      value: { schemaVersion: REMIX_GRID_OVERRIDE_SCHEMA_VERSION, tempoBpm: 120.123, firstBeatSec: 0.82 },
    });
    expect(normalizeGridOverrideInput(null)).toEqual({ value: null });
  });

  it.each([
    ["a string", "120"],
    ["an array", [120, 0]],
    ["a slow tempo", { tempoBpm: 20, firstBeatSec: 0 }],
    ["a fast tempo", { tempoBpm: 301, firstBeatSec: 0 }],
    ["a negative downbeat", { tempoBpm: 120, firstBeatSec: -0.1 }],
    ["a late downbeat", { tempoBpm: 120, firstBeatSec: 121 }],
    ["a missing tempo", { firstBeatSec: 0 }],
    ["another schema", { schemaVersion: "remix-grid-override/v9", tempoBpm: 120, firstBeatSec: 0 }],
  ])("rejects %s", (_label, input) => {
    expect(normalizeGridOverrideInput(input)).toHaveProperty("error");
  });

  it("reads malformed stored rows as no override", () => {
    expect(parseGridOverride({ tempoBpm: "fast" })).toBeNull();
    expect(parseGridOverride(undefined)).toBeNull();
  });
});

describe("deriveSectionGrid with an override (#2539)", () => {
  it("keeps the measured grid and reports it when there is no override", () => {
    const grid = deriveSectionGrid(stems)!;
    expect(grid.bpm).toBe(118.4);
    expect(grid.firstBeatSec).toBe(0.31);
    expect(grid.overridden).toBe(false);
    expect(grid.measured).toEqual({ bpm: 118.4, firstBeatSec: 0.31 });
  });

  it("drives tempo and anchor from the override and keeps the measured values beside it", () => {
    const grid = deriveSectionGrid(stems, fixture.override)!;
    expect(grid).toEqual(fixture.grid);
    expect(grid.measured).toEqual({ bpm: 118.4, firstBeatSec: 0.31 });
  });

  it("gives a source with no measured tempo a bar grid", () => {
    const untimed = [{ audioFeatures: { durationSeconds: 64, tempoConfidence: 0 } }];
    expect(deriveSectionGrid(untimed)!.kind).toBe("time");
    const grid = deriveSectionGrid(untimed, { schemaVersion: REMIX_GRID_OVERRIDE_SCHEMA_VERSION, tempoBpm: 120, firstBeatSec: 0 })!;
    expect(grid.kind).toBe("bars");
    expect(grid.bpm).toBe(120);
    expect(grid.measured).toEqual({ bpm: null, firstBeatSec: null });
  });
});

describe("section-0 bars start on the first downbeat (#2539)", () => {
  const grid = { sections: [{ startSec: 0, endSec: 16.82 }], sectionSeconds: 16, bpm: 120 };
  it("phases section 0 by the downbeat modulo a bar, and nothing else", () => {
    expect(beatBarPhase({ ...grid, firstBeatSec: 0.82 }, 0, 2)).toBe(0.82);
    expect(beatBarPhase({ ...grid, firstBeatSec: 2.5 }, 0, 2)).toBe(0.5);
    expect(beatBarPhase({ ...grid, firstBeatSec: 4 }, 0, 2)).toBe(0);
    expect(beatBarPhase({ ...grid, firstBeatSec: 0.82 }, 1, 2)).toBe(0);
    expect(beatBarPhase(grid, 0, 2)).toBe(0);
  });

  it("scales the downbeat with a pitch-keeping tempo change", () => {
    const { grid: atSpeed } = beatTimingAtSpeed({ ...grid, firstBeatSec: 0.82 }, [], 2);
    expect(atSpeed.firstBeatSec).toBeCloseTo(0.41, 12);
    expect(atSpeed.bpm).toBe(240);
  });
});

describe("remix-grid-override/v1 parity fixture (#2539)", () => {
  it("places the same beat hits as the web preview", () => {
    const hits = beatHits(fixture.recipe, fixture.grid, fixture.segments);
    expect(hits).toHaveLength(fixture.hits.length);
    hits.forEach((hit, i) => {
      expect(hit.instrument).toBe(fixture.hits[i].instrument);
      expect(Math.abs(hit.timeSec - fixture.hits[i].timeSec)).toBeLessThanOrEqual(EPS);
    });
    // The first kick lands on the corrected downbeat, not at 0:00.
    expect(hits[0]).toEqual({ timeSec: 0.82, instrument: "kick" });
  });

  it("places the same AI part spans as the web preview", () => {
    expect(partPlacementSpans({ blocks: null }, fixture.grid, fixture.segments, fixture.partLoopSec)).toEqual(
      fixture.partSpans,
    );
  });
});
