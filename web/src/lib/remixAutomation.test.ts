/**
 * Automation lanes (#2541): the browser curves replay the backend's
 * `remix-automation-v1.parity.json`, and the preview's Web Audio ramps land
 * on the same values the render steps through.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RemixAutomation } from "./api";
import {
  REMIX_AUTOMATION_SCHEMA_VERSION,
  automationAtSpeed,
  automationPayload,
  automationProblems,
  automationValueLabel,
  emptyAutomation,
  filterCutoffs,
  filterRampPoints,
  filterSteps,
  laneValueAt,
  moveAutomationPoint,
  previewAutomation,
  previewAutomationKey,
  removeAutomationPoint,
  sameAutomation,
  scheduleLane,
  setAutomationPoint,
  timedStemAutomation,
  type TimedPoint,
} from "./remixAutomation";
import { timelineDownbeats } from "./remixCues";
import { structureTimeline } from "./remixStructure";

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, "../../../backend/src/modules/remix/remix-automation-v1.parity.json"),
    "utf8",
  ),
);

describe("remix-automation-v1 parity (#2541)", () => {
  const segments = structureTimeline(fixture.grid, fixture.blocks).segments;
  const downbeats = timelineDownbeats(fixture.grid, segments);

  it("places the bars and the points like the backend", () => {
    expect(downbeats.length).toBe(fixture.downbeats.length);
    downbeats.forEach((t, i) => expect(Math.abs(t - fixture.downbeats[i])).toBeLessThan(1e-9));
    expect(timedStemAutomation(fixture.automation, "bass", downbeats, fixture.speed)).toEqual(fixture.bass);
  });

  it("samples the same curves and cutoffs", () => {
    for (const sample of fixture.samples) {
      const level = laneValueAt(fixture.bass.level, sample.atSec);
      const filter = laneValueAt(fixture.bass.filter, sample.atSec);
      expect(Math.abs(level - sample.levelDb)).toBeLessThan(1e-6);
      expect(Math.abs(filter - sample.filter)).toBeLessThan(1e-6);
      const cutoffs = filterCutoffs(filter);
      expect(Math.abs(cutoffs.lowpassHz - sample.lowpassHz)).toBeLessThan(1e-4);
      expect(Math.abs(cutoffs.highpassHz - sample.highpassHz)).toBeLessThan(1e-4);
    }
    expect(filterSteps(fixture.bass.filter)).toEqual(fixture.filterSteps);
  });

  it("previews the lanes in timeline time; output time divides by speed", () => {
    const lanes = previewAutomation(fixture.automation, downbeats)!;
    expect(Object.keys(lanes).sort()).toEqual(["bass", "vocals"]);
    expect(automationAtSpeed(lanes.bass, fixture.speed)).toEqual(fixture.bass);
  });
});

/** Replays the scheduled events: setValue then exponential ramps. */
function recorder() {
  const events: Array<{ kind: "set" | "exp"; value: number; time: number }> = [];
  return {
    events,
    param: {
      setValueAtTime: (value: number, time: number) => events.push({ kind: "set", value, time }),
      exponentialRampToValueAtTime: (value: number, time: number) => events.push({ kind: "exp", value, time }),
    },
    valueAt(t: number): number {
      let last = events[0];
      for (const event of events.slice(1)) {
        if (t < event.time) {
          if (event.kind === "set") return last.value;
          const f = (t - last.time) / (event.time - last.time);
          return last.value * Math.pow(event.value / last.value, f);
        }
        last = event;
      }
      return last.value;
    },
  };
}

describe("preview scheduling (#2541)", () => {
  const level: TimedPoint[] = [
    { atSec: 2, value: -24 },
    { atSec: 6, value: 0 },
    { atSec: 8, value: -6 },
  ];

  it("an exponential gain ramp is the lane's straight line in dB", () => {
    const rec = recorder();
    scheduleLane(rec.param, level, (db) => Math.pow(10, db / 20), { startAt: 10, offsetOutSec: 3 });
    expect(rec.events[0]).toEqual({ kind: "set", value: Math.pow(10, -18 / 20), time: 10 });
    for (const t of [3, 4.5, 6, 7, 9]) {
      const db = 20 * Math.log10(rec.valueAt(10 + t - 3));
      expect(db).toBeCloseTo(laneValueAt(level, t), 9);
    }
  });

  it("splits a filter ramp where it crosses the middle, so both cutoffs stay exact", () => {
    const filter: TimedPoint[] = [
      { atSec: 0, value: -0.8 },
      { atSec: 4, value: 0.8 },
    ];
    const ramp = filterRampPoints(filter);
    expect(ramp).toEqual([filter[0], { atSec: 2, value: 0 }, filter[1]]);
    const low = recorder();
    const high = recorder();
    scheduleLane(low.param, ramp, (v) => filterCutoffs(v).lowpassHz, { startAt: 0, offsetOutSec: 0 });
    scheduleLane(high.param, ramp, (v) => filterCutoffs(v).highpassHz, { startAt: 0, offsetOutSec: 0 });
    for (const t of [0, 0.5, 1.7, 2, 2.3, 3.9, 5]) {
      const want = filterCutoffs(laneValueAt(filter, t));
      expect(low.valueAt(t) / want.lowpassHz).toBeCloseTo(1, 6);
      expect(high.valueAt(t) / want.highpassHz).toBeCloseTo(1, 6);
    }
  });
});

describe("editing lanes (#2541)", () => {
  it("adds, moves, removes points and drops empty lanes", () => {
    let a = setAutomationPoint(emptyAutomation(), "bass", "level", 4, -3.26);
    a = setAutomationPoint(a, "bass", "level", 0, 0);
    expect(a.stems.bass.level).toEqual([
      { bar: 0, value: 0 },
      { bar: 4, value: -3.5 },
    ]);
    a = moveAutomationPoint(a, "bass", "level", 4, 0);
    expect(a.stems.bass.level).toEqual([{ bar: 0, value: -3.5 }]);
    a = removeAutomationPoint(a, "bass", "level", 0);
    expect(a.stems).toEqual({});
    expect(automationPayload(a)).toBeNull();
  });

  it("compares by content and keys the preview lanes", () => {
    const a: RemixAutomation = {
      schemaVersion: REMIX_AUTOMATION_SCHEMA_VERSION,
      stems: { bass: { filter: [{ bar: 1, value: 0.5 }] }, drums: { level: [{ bar: 0, value: -6 }] } },
    };
    const b: RemixAutomation = { ...a, stems: { drums: a.stems.drums, bass: a.stems.bass } };
    expect(sameAutomation(a, b)).toBe(true);
    expect(sameAutomation(emptyAutomation(), null)).toBe(true);
    expect(sameAutomation(a, null)).toBe(false);
    expect(previewAutomationKey(null)).toBe("");
    expect(previewAutomationKey(previewAutomation(a, [0, 2]))).toBe(
      previewAutomationKey(previewAutomation(b, [0, 2])),
    );
  });

  it("names what stops a save", () => {
    const tooMany = Array.from({ length: 30 }, (_, bar) => ({ bar, value: 0 }));
    expect(
      automationProblems(
        { schemaVersion: REMIX_AUTOMATION_SCHEMA_VERSION, stems: { a: { filter: tooMany }, b: { filter: tooMany } } },
        64,
      ),
    ).toEqual(["Filter lanes can have at most 48 points in total."]);
    expect(
      automationProblems(
        { schemaVersion: REMIX_AUTOMATION_SCHEMA_VERSION, stems: { bass: { level: [{ bar: 9, value: 0 }] } } },
        8,
      ),
    ).toEqual(["bass: a level point is past the last bar (8)."]);
  });

  it("labels values", () => {
    expect(automationValueLabel("level", -3)).toBe("-3.0 dB");
    expect(automationValueLabel("level", 2)).toBe("+2.0 dB");
    expect(automationValueLabel("filter", 0)).toBe("Open");
    expect(automationValueLabel("filter", -0.5)).toBe("Low-pass 2.0 kHz");
    expect(automationValueLabel("filter", 1)).toBe("High-pass 2.0 kHz");
  });
});
