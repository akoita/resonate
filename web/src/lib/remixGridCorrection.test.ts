/**
 * Grid correction (#2539): tap tempo, downbeat nudge, and the parity fixture
 * the backend render test also replays (preview and render agree).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RemixSectionGrid } from "./api";
import { beatHits } from "./remixBeat";
import { partPlacementSpans } from "./remixParts";
import {
  addTap,
  gridDraftChanged,
  gridDraftFrom,
  gridOverridePayload,
  nudgeFirstBeat,
  tapTempoBpm,
  TAP_RESET_MS,
  TAP_WINDOW,
} from "./remixGridCorrection";

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, "../../../backend/src/modules/remix/remix-grid-override-v1.parity.json"),
    "utf8",
  ),
);

describe("tap tempo (#2539)", () => {
  it("needs four taps and uses the median interval", () => {
    expect(tapTempoBpm([0, 500, 1000])).toBeNull();
    expect(tapTempoBpm(fixture.taps)).toBe(120);
    // One late tap does not drag the tempo.
    expect(tapTempoBpm([0, 500, 1000, 1500, 2100])).toBe(120);
  });

  it("starts over after a long gap and keeps the last taps", () => {
    expect(addTap([0, 500], 500 + TAP_RESET_MS + 1)).toEqual([500 + TAP_RESET_MS + 1]);
    let taps: number[] = [];
    for (let i = 0; i < 20; i += 1) taps = addTap(taps, i * 500);
    expect(taps).toHaveLength(TAP_WINDOW);
  });

  it("ignores tempos out of range", () => {
    expect(tapTempoBpm([0, 10, 20, 30])).toBeNull();
  });
});

describe("downbeat nudge (#2539)", () => {
  it("moves by beats and milliseconds", () => {
    const { measuredFirstBeatSec, nudge, override } = fixture;
    expect(nudgeFirstBeat(measuredFirstBeatSec, override.tempoBpm, nudge.beats, nudge.ms)).toBe(override.firstBeatSec);
    expect(nudgeFirstBeat(0.5, 120, 0, -10)).toBe(0.49);
  });

  it("wraps forward one bar instead of going below zero", () => {
    expect(nudgeFirstBeat(0.2, 120, -1, 0)).toBe(1.7);
    expect(nudgeFirstBeat(0, 120, 0, -10)).toBe(1.99);
  });
});

describe("grid draft (#2539)", () => {
  const grid = fixture.grid as RemixSectionGrid;
  it("starts from the served grid and only reports real changes", () => {
    const draft = gridDraftFrom(grid)!;
    expect(draft).toEqual({ tempoBpm: 120, firstBeatSec: 0.82 });
    expect(gridDraftChanged(grid, draft)).toBe(false);
    expect(gridDraftChanged(grid, { ...draft, firstBeatSec: 0.83 })).toBe(true);
  });

  it("builds the PATCH body the server stores", () => {
    expect(gridOverridePayload({ tempoBpm: 120, firstBeatSec: 0.82 })).toEqual(fixture.override);
    expect(gridOverridePayload({ tempoBpm: 400, firstBeatSec: 0 })).toBeNull();
  });
});

describe("remix-grid-override/v1 parity fixture (#2539)", () => {
  it("places the same beat hits as the render", () => {
    const hits = beatHits(fixture.recipe, fixture.grid, fixture.segments);
    expect(hits).toHaveLength(fixture.hits.length);
    hits.forEach((hit, i) => {
      expect(hit.instrument).toBe(fixture.hits[i].instrument);
      expect(Math.abs(hit.timeSec - fixture.hits[i].timeSec)).toBeLessThanOrEqual(1e-9);
    });
  });

  it("places the same AI part spans as the render", () => {
    expect(partPlacementSpans({ blocks: null }, fixture.grid, fixture.segments, fixture.partLoopSec)).toEqual(
      fixture.partSpans,
    );
  });
});
