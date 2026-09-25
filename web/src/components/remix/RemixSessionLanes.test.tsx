import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemixSectionGrid } from "../../lib/api";
import {
  applyPaint,
  normalizeSections,
  peaksToSvgPath,
  RemixSessionLanes,
  sectionColumnLabels,
  sectionMask,
  timelineSeconds,
  type LaneStem,
  type RemixSessionLanesProps,
} from "./RemixSessionLanes";

const SECTION = 16; // 8 bars at 120 BPM

function barsGrid(firstSpan: number, count = 4): RemixSectionGrid {
  const sections = [{ startSec: 0, endSec: firstSpan }];
  for (let i = 1; i < count; i += 1) {
    const start = firstSpan + (i - 1) * SECTION;
    sections.push({ startSec: start, endSec: start + SECTION });
  }
  return {
    kind: "bars",
    sections,
    sectionSeconds: SECTION,
    durationSeconds: sections[sections.length - 1].endSec,
    bpm: 120,
  };
}

function timeGrid(): RemixSectionGrid {
  return {
    kind: "time",
    sections: [
      { startSec: 0, endSec: 16 },
      { startSec: 16, endSec: 32 },
      { startSec: 32, endSec: 48 },
      { startSec: 48, endSec: 70 },
    ],
    sectionSeconds: 16,
    durationSeconds: 70,
    bpm: null,
  };
}

function stem(overrides: Partial<LaneStem> = {}): LaneStem {
  return {
    stemId: "stem-drums",
    name: "Drums",
    type: "drums",
    muted: false,
    soloed: false,
    soloedOut: false,
    gainDb: null,
    sections: null,
    peaks: [0.2, 0.8, 0.5, 1],
    ...overrides,
  };
}

const noop = () => undefined;

function render(overrides: Partial<RemixSessionLanesProps> = {}): string {
  return renderToStaticMarkup(
    <RemixSessionLanes
      stems={[stem()]}
      grid={barsGrid(16)}
      durationSec={null}
      getPositionSec={() => null}
      playing={false}
      loopSectionIndex={null}
      disabled={false}
      onToggleMute={noop}
      onToggleSolo={noop}
      onGainChange={noop}
      onSetSections={noop}
      onSeek={noop}
      onLoopSection={noop}
      {...overrides}
    />,
  );
}

function countMatches(html: string, pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

describe("sectionColumnLabels", () => {
  it("labels a short leading section as the pickup and counts bars after it", () => {
    expect(sectionColumnLabels(barsGrid(4, 4))).toEqual([
      "Pickup",
      "1",
      "9",
      "17",
    ]);
  });

  it("counts bars from the first section when it is (nearly) full", () => {
    expect(sectionColumnLabels(barsGrid(16, 4))).toEqual(["1", "9", "17", "25"]);
    // 0.8 × section is still a full first section, not a pickup.
    expect(sectionColumnLabels(barsGrid(12.8, 3))).toEqual(["1", "9", "17"]);
  });

  it("treats a leading section just under 0.75 × section as a pickup", () => {
    expect(sectionColumnLabels(barsGrid(11.9, 3))).toEqual(["Pickup", "1", "9"]);
  });

  it("labels time grids with each section's start time", () => {
    expect(sectionColumnLabels(timeGrid())).toEqual([
      "0:00",
      "0:16",
      "0:32",
      "0:48",
    ]);
  });
});

describe("peaksToSvgPath", () => {
  it("returns an empty path for no peaks", () => {
    expect(peaksToSvgPath([], 100, 40)).toBe("");
  });

  it("mirrors each peak around the center line and closes the shape", () => {
    const path = peaksToSvgPath([0.5, 1], 100, 40);
    expect(path).toBe("M0 20 L25 10 L75 0 L100 20 L75 40 L25 30 Z");
  });

  it("clamps out-of-range and non-finite peaks", () => {
    const path = peaksToSvgPath([2, -1, Number.NaN], 30, 10);
    expect(path).toBe("M0 5 L5 0 L15 5 L25 5 L30 5 L25 5 L15 5 L5 10 Z");
  });
});

describe("paint helpers", () => {
  it("treats null or stale masks as all-on working masks", () => {
    expect(sectionMask(null, 3)).toEqual([true, true, true]);
    expect(sectionMask([false], 3)).toEqual([true, true, true]);
    const original = [true, false, true];
    const copy = sectionMask(original, 3);
    copy[0] = false;
    expect(original).toEqual([true, false, true]);
  });

  it("normalizes an all-on mask to null", () => {
    expect(normalizeSections([true, true])).toBeNull();
    expect(normalizeSections([true, false])).toEqual([true, false]);
  });

  it("applies a paint value to one section", () => {
    expect(applyPaint(null, 3, 1, false)).toEqual([true, false, true]);
    expect(applyPaint([true, false, true], 3, 1, true)).toBeNull();
    expect(applyPaint([false, false, true], 3, 0, false)).toEqual([
      false,
      false,
      true,
    ]);
    // Out-of-range index leaves the mask untouched.
    expect(applyPaint([true, false], 2, 5, true)).toEqual([true, false]);
  });
});

describe("timelineSeconds", () => {
  it("prefers the explicit duration and falls back to the grid", () => {
    expect(timelineSeconds(90, barsGrid(16))).toBe(90);
    expect(timelineSeconds(null, barsGrid(16))).toBe(64);
    expect(timelineSeconds(0, barsGrid(16))).toBe(64);
    expect(timelineSeconds(null, null)).toBeNull();
  });
});

describe("RemixSessionLanes", () => {
  it("renders one pressed cell per section when the mask is null (all on)", () => {
    const html = render();
    expect(countMatches(html, /remix-lane-cell /g)).toBe(4);
    expect(countMatches(html, /aria-label="Drums: section \d on"/g)).toBe(4);
    expect(html).not.toContain("remix-lane-cell-off");
  });

  it("reflects a partial mask in the cells", () => {
    const html = render({
      stems: [stem({ sections: [true, false, false, true] })],
    });
    expect(html).toContain('aria-label="Drums: section 1 on"');
    expect(html).toContain('aria-label="Drums: section 2 off"');
    expect(html).toContain('aria-label="Drums: section 3 off"');
    expect(html).toContain('aria-label="Drums: section 4 on"');
    expect(countMatches(html, /remix-lane-cell-off/g)).toBe(2);
  });

  it("positions sections proportionally to time", () => {
    const html = render({ grid: barsGrid(4, 3) }); // 4 + 16 + 16 = 36s
    expect(html).toMatch(/left:11\.1\d*%;width:44\.4\d*%/);
    expect(html).toContain(">Pickup</button>");
  });

  it("dims muted and soloed-out rows but not active ones", () => {
    const html = render({
      stems: [
        stem({ stemId: "a", name: "Drums", muted: true }),
        stem({ stemId: "b", name: "Bass", soloedOut: true }),
        stem({ stemId: "c", name: "Keys" }),
      ],
    });
    expect(countMatches(html, /remix-lane-row-dimmed/g)).toBe(2);
    expect(html).toContain('data-stem-id="a"');
    expect(html).toContain("muted by solo");
    expect(html).toMatch(/aria-pressed="true" aria-label="Mute Drums"/);
  });

  it("uses a purple-accented gain slider with a dB readout", () => {
    const html = render({ stems: [stem({ gainDb: 2.5 })] });
    expect(html).toContain('aria-label="Drums gain in decibels"');
    expect(html).toContain("accent-purple-400");
    expect(html).toContain("+2.5 dB");
  });

  it("shows no ruler or cells when there is no grid", () => {
    const html = render({ grid: null, durationSec: 120 });
    expect(html).not.toContain("remix-lane-ruler");
    expect(html).not.toContain("remix-lane-cell");
    expect(html).not.toContain("All on");
    expect(html).toContain("remix-lane-waveform");
    expect(html).toContain("remix-lane-seek");
  });

  it("shows a loading bar until peaks arrive", () => {
    const html = render({ stems: [stem({ peaks: null })] });
    expect(html).toContain("remix-lane-waveform-loading");
    expect(html).not.toContain('class="pointer-events-none absolute inset-0 h-full w-full remix-lane-waveform"');
  });

  it("highlights the looped section across the lanes", () => {
    const html = render({ loopSectionIndex: 1 });
    expect(html).toContain("remix-lane-loop-band");
    expect(html).toMatch(
      /aria-pressed="true" aria-label="Loop section 2 \(starts 0:16\)"/,
    );
    expect(html).toContain('title="Section 2 · starts 0:16 · click to loop"');
    expect(render()).not.toContain("remix-lane-loop-band");
  });

  it("disables edits but keeps solo and loop available", () => {
    const html = render({ disabled: true });
    expect(html).toMatch(/aria-label="Mute Drums"[^>]*disabled/);
    expect(html).not.toMatch(/aria-label="Solo Drums"[^>]*disabled/);
    expect(html).toMatch(/aria-label="Drums: section 1 on" disabled/);
    expect(html).not.toMatch(/aria-label="Loop section 1[^"]*"[^>]*disabled/);
  });
});
