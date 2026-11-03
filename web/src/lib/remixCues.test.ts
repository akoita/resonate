/**
 * Cue and loop points (#2540): the studio's bar math replays the backend's
 * `remix-cues-v1.parity.json`, so the loops the preview plays are the bars
 * the DJ export inserts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RemixCues } from "./api";
import {
  INTRO_LOOP_INDEX,
  OUTRO_LOOP_INDEX,
  cueAddedSeconds,
  cueBarsLabel,
  cueLoopLabel,
  cueLoopSpan,
  cuesPayload,
  cuesProblems,
  djExportReasonText,
  stemsExportReasonText,
  lastLoopStartBar,
  sameCues,
  suggestedCues,
  timelineDownbeats,
} from "./remixCues";
import { structureTimeline } from "./remixStructure";

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, "../../../backend/src/modules/remix/remix-cues-v1.parity.json"),
    "utf8",
  ),
);
const EPS = 1e-9;

describe("remix-cues-v1 parity (#2540)", () => {
  const segments = structureTimeline(fixture.grid, fixture.blocks).segments;

  it("builds the same timeline", () => {
    segments.forEach((segment, i) => {
      expect(segment.section).toBe(fixture.segments[i].section);
      expect(Math.abs(segment.outStartSec - fixture.segments[i].outStartSec)).toBeLessThan(EPS);
      expect(Math.abs(segment.outEndSec - fixture.segments[i].outEndSec)).toBeLessThan(EPS);
    });
  });

  it("places the same downbeats and loop spans", () => {
    const downbeats = timelineDownbeats(fixture.grid, segments);
    expect(downbeats).toHaveLength(fixture.downbeats.length);
    downbeats.forEach((t, i) => expect(Math.abs(t - fixture.downbeats[i])).toBeLessThan(EPS));
    const barSec = 240 / fixture.grid.bpm;
    const end = segments[segments.length - 1].outEndSec;
    expect(cueLoopSpan(downbeats, barSec, end, fixture.cues.intro)).toEqual(fixture.spans.intro);
    expect(cueLoopSpan(downbeats, barSec, end, fixture.cues.outro)).toEqual(fixture.spans.outro);
  });
});

describe("cue helpers (#2540)", () => {
  const downbeats = Array.from({ length: 40 }, (_, i) => i * 2);
  const end = 80;

  it("suggests the first and last 8 bars", () => {
    expect(suggestedCues(downbeats, 2, end)).toEqual({
      schemaVersion: "remix-cues/v1",
      intro: { startBar: 0, bars: 8, repeats: 2 },
      outro: { startBar: 32, bars: 8, repeats: 2 },
    });
    expect(suggestedCues([0], 2, 2)).toBeNull();
    expect(lastLoopStartBar(downbeats, 2, 79, 8)).toBe(31);
  });

  it("explains cues that don't fit", () => {
    const cues: RemixCues = {
      schemaVersion: "remix-cues/v1",
      intro: { startBar: 0, bars: 16, repeats: 1 },
      outro: { startBar: 36, bars: 8, repeats: 1 },
    };
    expect(cuesProblems(cues, downbeats, 2, end)).toEqual(["The outro loop runs past the end of the song."]);
    expect(
      cuesProblems({ ...cues, outro: { startBar: 8, bars: 8, repeats: 1 } }, downbeats, 2, end),
    ).toEqual(["The intro loop must end before the outro loop starts."]);
  });

  it("formats and compares", () => {
    expect(cueBarsLabel({ startBar: 0, bars: 8 })).toBe("bars 1–8");
    expect(cueBarsLabel({ startBar: 4, bars: 1 })).toBe("bar 5");
    expect(cueAddedSeconds({ startSec: 0, endSec: 16 }, 2)).toBe(32);
    expect(cueLoopLabel(INTRO_LOOP_INDEX)).toBe("Looping the intro");
    expect(cueLoopLabel(OUTRO_LOOP_INDEX)).toBe("Looping the outro");
    expect(cueLoopLabel(0)).toBeNull();
    expect(cuesPayload({ schemaVersion: "remix-cues/v1", intro: null, outro: null })).toBeNull();
    expect(sameCues(null, { schemaVersion: "remix-cues/v1", intro: null, outro: null })).toBe(true);
    expect(djExportReasonText("no_cues")).toBe("Set an intro or outro loop first.");
    expect(djExportReasonText(null)).toBeNull();
  });

  it("says why there are no stems to export (#2550)", () => {
    expect(stemsExportReasonText("no_stems")).toContain("Turn on Also render stems");
    expect(stemsExportReasonText("no_stems", "export_not_allowed")).toContain("commercial license");
    expect(stemsExportReasonText("no_stems", "pro_required")).toContain("Pro");
    expect(stemsExportReasonText("no_draft")).toContain("Render the mix first");
    expect(stemsExportReasonText(null)).toBeNull();
  });
});
