import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RemixSectionGrid } from "../../lib/api";
import {
  identityBlocks,
  structureEditState,
  structureTimeline,
  type RemixStructureBlock,
} from "../../lib/remixStructure";
import {
  applyPaint,
  blockActionResult,
  blockMenuEntries,
  isRepeatBlock,
  LaneBlockMenu,
  laneColumns,
  nextMenuIndex,
  sectionPlaceLabel,
  slicePeaks,
  laneHasFx,
  LaneFxRow,
  normalizeSections,
  peaksToSvgPath,
  RemixSessionLanes,
  sectionColumnLabels,
  sectionMask,
  timelineSeconds,
  toggleInSet,
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

describe("per-lane FX (#1897)", () => {
  it("shows a collapsed FX toggle only when effects are editable", () => {
    const html = render({ onFxChange: noop });
    expect(html).toMatch(
      /<button[^>]*aria-expanded="false"[^>]*aria-label="Effects for Drums"[^>]*>/,
    );
    expect(html).not.toContain("remix-lane-fx-dot");
    expect(html).not.toContain('class="mt-1 flex flex-col gap-1');
    expect(render()).not.toContain("remix-lane-fx-toggle");
  });

  it("marks a stem with non-default fx with a dot", () => {
    const html = render({
      onFxChange: noop,
      stems: [stem({ fx: { space: 0, echo: 0.35, tone: 0 } })],
    });
    expect(html).toContain("remix-lane-fx-dot");
    expect(html).toContain('aria-label="Effects for Drums (on)"');
    expect(laneHasFx(undefined)).toBe(false);
    expect(laneHasFx({ space: 0, echo: 0, tone: 0 })).toBe(false);
    expect(laneHasFx({ tone: -0.2 })).toBe(true);
  });

  it("disables the FX toggle under the published lock", () => {
    const html = render({ onFxChange: noop, disabled: true });
    expect(html).toMatch(/<button[^>]*aria-label="Effects for Drums"[^>]*disabled=""/);
  });

  it("reveals Space, Echo and Tone sliders with plain labels", () => {
    const html = renderToStaticMarkup(
      <LaneFxRow
        id="fx-row"
        stem={{ stemId: "stem-vox", name: "Vocals", fx: { echo: 0.35, tone: -0.25 } }}
        disabled={false}
        onFxChange={noop}
      />,
    );
    expect(html).toContain('aria-label="Vocals effects"');
    expect(html).toContain('aria-label="Vocals space (Dry to Roomy)"');
    expect(html).toContain('aria-label="Vocals echo (None to Lots)"');
    expect(html).toContain('aria-label="Vocals tone (Darker to Brighter)"');
    expect(html).toContain('aria-valuetext="35%"');
    expect(html).toContain('aria-valuetext="Darker 25%"');
    expect(countMatches(html, /type="range"/g)).toBe(3);
    expect(html).not.toMatch(/type="range"[^>]*disabled=""/);

    const locked = renderToStaticMarkup(
      <LaneFxRow
        id="fx-row"
        stem={{ stemId: "stem-vox", name: "Vocals" }}
        disabled
        onFxChange={noop}
      />,
    );
    expect(countMatches(locked, /type="range"[^>]*disabled=""/g)).toBe(3);
  });

  it("toggles one stem's FX row open state", () => {
    const open = toggleInSet(new Set(), "a");
    expect([...open]).toEqual(["a"]);
    expect([...toggleInSet(open, "a")]).toEqual([]);
  });
});

describe("structure blocks (#1899)", () => {
  const grid = barsGrid(16, 4); // 4 × 16 s = 64 s
  const blocks: RemixStructureBlock[] = [
    { section: 0 },
    { section: 1 },
    { section: 1 },
    { section: 3, fadeIn: true, fadeOut: true },
  ];
  const timeline = structureTimeline(grid, blocks);
  const state = structureEditState(grid, { blocks }, {});

  function renderBlocks(overrides: Partial<RemixSessionLanesProps> = {}): string {
    return render({
      grid,
      timeline,
      structureState: state,
      onBlockAction: noop,
      stems: [stem({ peaks: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] })],
      ...overrides,
    });
  }

  it("lays out one column per block, sized by timeline duration", () => {
    const html = renderBlocks();
    expect(countMatches(html, /remix-lane-block-header /g)).toBe(4);
    expect(countMatches(html, /remix-lane-cell /g)).toBe(4);
    // Block 3 (the repeat) sits at 25–50 % of the 64 s timeline.
    expect(html).toContain("left:25%;width:25%");
    expect(html).toContain('aria-label="Drums: section 4 on"');
    expect(laneColumns(grid, null).map((column) => column.section)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(laneColumns(grid, timeline)).toBe(timeline.segments);
  });

  it("names each column after its source section, marking repeats and fades", () => {
    const html = renderBlocks();
    expect(html).toContain('title="Repeat of bar 9"');
    expect(countMatches(html, /remix-lane-repeat-mark/g)).toBe(1);
    expect(html).toContain(
      'aria-label="Loop section 3 (starts 0:32, repeat of bar 9)"',
    );
    expect(html).toContain(
      'aria-label="Loop section 4 (starts 0:48, fades in, fades out)"',
    );
    expect(html).toContain("◢</span>25<span");
    expect(html).toContain("◣</span></button>");
    expect(isRepeatBlock(timeline.segments, 2)).toBe(true);
    expect(isRepeatBlock(timeline.segments, 1)).toBe(false);
    expect(sectionPlaceLabel(barsGrid(4, 3), 0)).toBe("the pickup");
    expect(sectionPlaceLabel(timeGrid(), 2)).toBe("the section at 0:32");
  });

  it("draws each block's slice of the source waveform", () => {
    const html = renderBlocks();
    expect(countMatches(html, /remix-lane-block-waveform/g)).toBe(4);
    // 8 buckets over 64 s: 16 s = 2 buckets.
    const peaks = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    expect(slicePeaks(peaks, 64, 16, 32)).toEqual([0.3, 0.4]);
    expect(slicePeaks(peaks, 64, 48, 64)).toEqual([0.7, 0.8]);
    // A sliver still draws one bucket; nothing for empty input.
    expect(slicePeaks(peaks, 64, 63.9, 64)).toEqual([0.8]);
    expect(slicePeaks([], 64, 0, 16)).toEqual([]);
    expect(slicePeaks(peaks, 0, 0, 16)).toEqual([]);
    // The identity order keeps the single full-lane waveform.
    const plain = render({ grid, stems: [stem()] });
    expect(plain).not.toContain("remix-lane-block-waveform");
    expect(plain).toContain("remix-lane-waveform");
  });

  it("loops a block over its timeline span", () => {
    const html = renderBlocks({ loopSectionIndex: 3 });
    expect(html).toMatch(/remix-lane-loop-band[^"]*" style="left:75%;width:25%"/);
  });

  it("offers a section menu per block, locked when published", () => {
    const html = renderBlocks();
    expect(countMatches(html, /aria-haspopup="menu"/g)).toBe(4);
    expect(html).toContain('aria-label="Section options for bar 1"');
    expect(html).toContain('aria-label="Section options for bar 9 (repeat)"');
    expect(html).toMatch(/aria-haspopup="menu" aria-expanded="false"/);
    expect(renderBlocks({ disabled: true })).toMatch(
      /aria-label="Section options for bar 1"[^>]*disabled=""/,
    );
    // No handler, no menu.
    expect(render({ grid })).not.toContain("aria-haspopup");
  });

  it("disables refused menu entries with a plain reason", () => {
    const first = blockMenuEntries(state, 0, grid);
    expect(first.map((entry) => entry.label)).toEqual([
      "Repeat this section",
      "Remove",
      "Move earlier",
      "Move later",
      "Fade in",
      "Fade out",
    ]);
    expect(first.find((entry) => entry.action === "earlier")).toMatchObject({
      enabled: false,
      reason: "This is already the first section",
    });
    expect(
      blockMenuEntries(state, 3, grid).find((entry) => entry.action === "later"),
    ).toMatchObject({ enabled: false, reason: "This is already the last section" });
    expect(blockMenuEntries(state, 3, grid).slice(4)).toMatchObject([
      { action: "fade_in", checked: true, enabled: true },
      { action: "fade_out", checked: true, enabled: true },
    ]);
    const single = structureEditState(grid, { blocks: [{ section: 2 }] }, {});
    expect(
      blockMenuEntries(single, 0, grid).find((entry) => entry.action === "remove"),
    ).toMatchObject({ enabled: false, reason: "The song needs at least one section" });
    // Two passes = 128 s, already at the 2 × 64 s cap: any repeat is over.
    const long = structureEditState(
      grid,
      { blocks: [...identityBlocks(4), ...identityBlocks(4)] },
      {},
    );
    expect(blockMenuEntries(long, 0, grid)[0]).toMatchObject({
      action: "repeat",
      enabled: false,
      reason: "That would make the remix more than twice as long as the original.",
    });
  });

  it("runs menu actions through the structure ops", () => {
    expect(
      blockActionResult(state, 1, "later", grid)!.blocks.map((block) => block.section),
    ).toEqual([0, 1, 1, 3]);
    expect(
      blockActionResult(state, 0, "later", grid)!.blocks.map((block) => block.section),
    ).toEqual([1, 0, 1, 3]);
    expect(blockActionResult(state, 0, "fade_in", grid)!.blocks[0]).toEqual({
      section: 0,
      fadeIn: true,
    });
    expect(blockActionResult(state, 0, "earlier", grid)).toBeNull();
  });

  it("renders an accessible menu with checkable fades and inert refused entries", () => {
    const html = renderToStaticMarkup(
      <LaneBlockMenu
        id="menu"
        label="Options for bar 1"
        entries={blockMenuEntries(state, 0, grid)}
        onSelect={noop}
        onClose={noop}
      />,
    );
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="Options for bar 1"');
    expect(countMatches(html, /role="menuitem"/g)).toBe(4);
    expect(countMatches(html, /role="menuitemcheckbox"/g)).toBe(2);
    expect(countMatches(html, /aria-checked="false"/g)).toBe(2);
    expect(countMatches(html, /tabindex="-1"/g)).toBe(6);
    expect(html).toMatch(
      /role="menuitem" aria-disabled="true" tabindex="-1" title="This is already the first section"/,
    );
    expect(html).toContain("Move earlier");
  });

  it("moves through menu entries with the arrow keys, wrapping", () => {
    expect(nextMenuIndex("ArrowDown", -1, 6)).toBe(0);
    expect(nextMenuIndex("ArrowDown", 5, 6)).toBe(0);
    expect(nextMenuIndex("ArrowUp", 0, 6)).toBe(5);
    expect(nextMenuIndex("ArrowUp", -1, 6)).toBe(5);
    expect(nextMenuIndex("Home", 3, 6)).toBe(0);
    expect(nextMenuIndex("End", 0, 6)).toBe(5);
    expect(nextMenuIndex("a", 0, 6)).toBeNull();
    expect(nextMenuIndex("ArrowDown", 0, 0)).toBeNull();
  });
});
