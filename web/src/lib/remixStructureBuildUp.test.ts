import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RemixSectionGrid } from "./api";
import { scheduleBuildUps } from "./remixAudioPreview";
import {
  buildUpCutoffHzAt,
  buildUpGainAt,
  buildUpOutputRamps,
  buildUpRamps,
  isIdentityTimeline,
  normalizeRemixStructure,
  REMIX_BUILDUP_EDGE_GRID_PER_SECOND,
  REMIX_BUILDUP_END_HZ,
  REMIX_BUILDUP_FILTER_Q,
  REMIX_BUILDUP_START_GAIN,
  REMIX_BUILDUP_START_HZ,
  REMIX_STRUCTURE_MAX_BUILDUPS,
  REMIX_STRUCTURE_SCHEMA_VERSION,
  REMIX_STRUCTURE_SCHEMA_VERSION_V1,
  structureEditState,
  structureTimeline,
  timelineFromSegments,
  toggleBuildUp,
  type RemixBuildUpRamp,
  type RemixStructureBlock,
} from "./remixStructure";

/**
 * Build-ups (#1908): the preview side of `remix-structure-v2.parity.json`,
 * the same file the backend render is tested against.
 */
const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../backend/src/modules/remix/remix-structure-v2.parity.json",
);

type Fixture = {
  schemaVersion: string;
  constants: {
    startHz: number;
    endHz: number;
    startGain: number;
    filterQ: number;
    edgeGridPerSecond: number;
    maxBuildUps: number;
  };
  grid: RemixSectionGrid;
  timelines: Array<{
    name: string;
    blocks: RemixStructureBlock[];
    segments: unknown[];
    buildUps: RemixBuildUpRamp[];
    output: Array<{ speed: number; ramps: RemixBuildUpRamp[] }>;
  }>;
  sweep: { ramp: RemixBuildUpRamp };
  samples: Array<{ atSec: number; cutoffHz: number; gain: number }>;
  normalize: Array<{ input: unknown; output: unknown }>;
};

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
const TOLERANCE = 1e-9;

/** Same keys, numbers within 1e-9, everything else strictly equal. */
function expectParity(actual: unknown, expected: unknown) {
  if (typeof expected === "number") {
    expect(typeof actual).toBe("number");
    expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(TOLERANCE);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect((actual as unknown[]).length).toBe(expected.length);
    expected.forEach((item, index) => expectParity((actual as unknown[])[index], item));
    return;
  }
  if (expected !== null && typeof expected === "object") {
    expect(actual).not.toBeNull();
    expect(Object.keys(actual as object).sort()).toEqual(Object.keys(expected).sort());
    for (const [key, value] of Object.entries(expected)) {
      expectParity((actual as Record<string, unknown>)[key], value);
    }
    return;
  }
  expect(actual).toBe(expected);
}

describe("remix-structure/v2 build-up parity fixture (#1908)", () => {
  it("pins the schema and constants", () => {
    expect(fixture.schemaVersion).toBe(REMIX_STRUCTURE_SCHEMA_VERSION);
    expect(fixture.constants).toMatchObject({
      startHz: REMIX_BUILDUP_START_HZ,
      endHz: REMIX_BUILDUP_END_HZ,
      startGain: REMIX_BUILDUP_START_GAIN,
      filterQ: REMIX_BUILDUP_FILTER_Q,
      edgeGridPerSecond: REMIX_BUILDUP_EDGE_GRID_PER_SECOND,
      maxBuildUps: REMIX_STRUCTURE_MAX_BUILDUPS,
    });
  });

  it.each(fixture.timelines)("timeline $name", ({ blocks, segments, buildUps, output }) => {
    const timeline = structureTimeline(fixture.grid, blocks);
    expectParity(timeline.segments, segments);
    expectParity(timeline.buildUps, buildUps);
    // Server-served segments derive the same build-ups.
    expectParity(timelineFromSegments(timeline.segments).buildUps, buildUps);
    expect(isIdentityTimeline(timeline)).toBe(false);
    for (const { speed, ramps } of output) {
      expectParity(buildUpOutputRamps(buildUpRamps(timeline.segments), speed), ramps);
    }
  });

  it.each(fixture.samples)("cutoff + gain at $atSec s", ({ atSec, cutoffHz, gain }) => {
    expectParity(buildUpCutoffHzAt(fixture.sweep.ramp, atSec), cutoffHz);
    expectParity(buildUpGainAt(fixture.sweep.ramp, atSec), gain);
  });

  it.each(fixture.normalize.map((entry, index) => ({ ...entry, index })))(
    "normalize case $index matches the backend",
    ({ input, output }) => {
      const result = normalizeRemixStructure(input, fixture.grid.sections.length);
      expect(result).toEqual(output === "error" ? null : output);
    },
  );
});

describe("build-up structure edits (#1908)", () => {
  const grid = fixture.grid;

  it("keeps v1 without build-ups and an identity order with one is not identity", () => {
    expect(
      normalizeRemixStructure({ blocks: [{ section: 1 }, { section: 1 }] }, 5)?.schemaVersion,
    ).toBe(REMIX_STRUCTURE_SCHEMA_VERSION_V1);
    const identity = grid.sections.map((_, section) => ({ section }));
    expect(structureTimeline(grid, identity).buildUps).toBeUndefined();
    const state = structureEditState(grid, null, {});
    const toggled = toggleBuildUp(state, 2)!;
    expect(toggled.structure).toEqual({
      schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION,
      blocks: identity.map((block) => (block.section === 2 ? { ...block, buildUp: true } : block)),
    });
    // Toggling it off again is the original order.
    expect(toggleBuildUp({ ...state, blocks: toggled.blocks }, 2)!.structure).toBeNull();
    expect(toggleBuildUp(state, 9)).toBeNull();
  });
});

describe("scheduleBuildUps (#1908)", () => {
  type Event = [string, number, number];
  function recorder() {
    const events: Event[] = [];
    return {
      events,
      setValueAtTime: (value: number, time: number) => events.push(["set", value, time]),
      linearRampToValueAtTime: (value: number, time: number) =>
        events.push(["ramp", value, time]),
      exponentialRampToValueAtTime: (value: number, time: number) =>
        events.push(["exp", value, time]),
    };
  }
  const ramp = (startSec: number, endSec: number): RemixBuildUpRamp => ({
    startSec,
    endSec,
    fromHz: 30,
    toHz: 1500,
    fromGain: 0.5,
    toGain: 1,
  });

  it("joins adjacent build-ups without a reset", () => {
    const dry = recorder();
    const wet = recorder();
    const frequency = recorder();
    scheduleBuildUps({ dry, wet, frequency }, [ramp(1, 2), ramp(2, 3)], {
      startAt: 10,
      offsetSec: 0,
      speed: 1,
    });
    expect(dry.events).toEqual([
      ["set", 1, 10],
      ["set", 0, 11],
      ["set", 0, 12],
      ["set", 1, 13],
    ]);
    expect(wet.events).toEqual([
      ["set", 0, 10],
      ["set", 0.5, 11],
      ["ramp", 1, 12],
      ["set", 0.5, 12],
      ["ramp", 1, 13],
      ["set", 0, 13],
    ]);
    expect(frequency.events).toEqual([
      ["set", 30, 10],
      ["set", 30, 11],
      ["exp", 1500, 12],
      ["set", 30, 12],
      ["exp", 1500, 13],
      ["set", 30, 13],
    ]);
  });

  it("starts mid build-up at its current values, in output time", () => {
    const dry = recorder();
    const wet = recorder();
    const frequency = recorder();
    // Output ramp 4..8 s; timeline offset 12 at speed 2 = output 6 s (half way).
    scheduleBuildUps({ dry, wet, frequency }, [ramp(4, 8)], {
      startAt: 1,
      offsetSec: 12,
      speed: 2,
    });
    expect(dry.events).toEqual([
      ["set", 0, 1],
      ["set", 1, 3],
    ]);
    expect(wet.events).toEqual([
      ["set", 0.75, 1],
      ["ramp", 1, 3],
      ["set", 0, 3],
    ]);
    expect(frequency.events[0][1]).toBeCloseTo(30 * Math.sqrt(50), 9);
    expect(frequency.events.slice(1)).toEqual([
      ["exp", 1500, 3],
      ["set", 30, 3],
    ]);
  });
});
