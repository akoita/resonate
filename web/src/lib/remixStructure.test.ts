import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RemixSectionGrid } from "./api";
import {
  extendedMix,
  gateIntervalsForBlocks,
  hasPickup,
  MAX_TIMELINE_FACTOR,
  MAX_TIMELINE_SECONDS,
  maxTimelineSeconds,
  structureTooLongReason,
  withinTimelineCap,
  identityBlocks,
  isIdentityTimeline,
  masterFadeRamps,
  masterFadeValueAt,
  moveBlock,
  normalizeBlockMask,
  normalizeRemixStructure,
  removeBlock,
  repeatBlock,
  resetStructure,
  REMIX_STRUCTURE_JOIN_FADE_SECONDS,
  REMIX_STRUCTURE_MAX_BLOCKS,
  REMIX_STRUCTURE_SCHEMA_VERSION,
  sameRemixStructure,
  shortEdit,
  structureEditState,
  structureTimeline,
  timelineFromSegments,
  toggleFade,
  type RemixStructureBlock,
  type RemixStructureEditState,
  type RemixStructureSegment,
} from "./remixStructure";

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../backend/src/modules/remix/remix-structure-v1.parity.json",
);

type FixtureRamp = {
  startSec: number;
  endSec: number;
  from: number;
  to: number;
  holdAfter?: boolean;
};

type Fixture = {
  schemaVersion: string;
  constants: { joinFadeSeconds: number; maxBlocks: number };
  grid: RemixSectionGrid;
  timelines: Array<{
    name: string;
    blocks: RemixStructureBlock[] | null;
    durationSec: number;
    segments: RemixStructureSegment[];
    masterFades: FixtureRamp[];
  }>;
  gate: Array<{
    case: string;
    mask: boolean[];
    intervals: Array<{ startSec: number; endSec: number }> | null;
  }>;
  normalize: Array<{
    input: unknown;
    output: { value: unknown } | { error: string };
  }>;
};

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
const TOLERANCE = 1e-9;
const grid = fixture.grid;

function expectClose(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE);
}

describe("remix-structure/v1 parity fixture (#1899)", () => {
  it("shares the schema version and constants", () => {
    expect(fixture.schemaVersion).toBe(REMIX_STRUCTURE_SCHEMA_VERSION);
    expect(REMIX_STRUCTURE_JOIN_FADE_SECONDS).toBe(
      fixture.constants.joinFadeSeconds,
    );
    expect(REMIX_STRUCTURE_MAX_BLOCKS).toBe(fixture.constants.maxBlocks);
  });

  it("lays out the same timelines", () => {
    for (const entry of fixture.timelines) {
      const timeline = structureTimeline(grid, entry.blocks);
      expectClose(timeline.durationSec, entry.durationSec);
      expect(timeline.segments).toHaveLength(entry.segments.length);
      timeline.segments.forEach((segment, index) => {
        const expected = entry.segments[index];
        expect(segment.index).toBe(expected.index);
        expect(segment.section).toBe(expected.section);
        for (const key of [
          "outStartSec",
          "outEndSec",
          "srcStartSec",
          "srcEndSec",
        ] as const) {
          expectClose(segment[key], expected[key]);
        }
        for (const key of [
          "joinFadeIn",
          "joinFadeOut",
          "fadeIn",
          "fadeOut",
        ] as const) {
          expect([entry.name, index, key, segment[key]]).toEqual([
            entry.name,
            index,
            key,
            expected[key],
          ]);
        }
      });
    }
  });

  it("computes the same master fade ramps", () => {
    for (const entry of fixture.timelines) {
      const ramps = structureTimeline(grid, entry.blocks).masterFades;
      expect(masterFadeRamps(structureTimeline(grid, entry.blocks).segments)).toEqual(
        ramps,
      );
      expect(ramps).toHaveLength(entry.masterFades.length);
      ramps.forEach((ramp, index) => {
        const expected = entry.masterFades[index];
        expectClose(ramp.startSec, expected.startSec);
        expectClose(ramp.endSec, expected.endSec);
        expectClose(ramp.from, expected.from);
        expectClose(ramp.to, expected.to);
        expect(ramp.holdAfter).toBe(expected.holdAfter);
      });
    }
  });

  it("gates blocks with the same intervals", () => {
    for (const entry of fixture.gate) {
      const source = fixture.timelines.find((t) => t.name === entry.case)!;
      const { segments } = structureTimeline(grid, source.blocks);
      const intervals = gateIntervalsForBlocks(segments, entry.mask);
      if (entry.intervals === null) {
        expect(intervals).toBeNull();
        continue;
      }
      expect(intervals).toHaveLength(entry.intervals.length);
      intervals!.forEach((interval, index) => {
        expectClose(interval.startSec, entry.intervals![index].startSec);
        expectClose(interval.endSec, entry.intervals![index].endSec);
      });
    }
  });

  it("normalizes like the backend (null where it rejects)", () => {
    for (const entry of fixture.normalize) {
      const output = normalizeRemixStructure(entry.input, grid.sections.length);
      if ("error" in entry.output) {
        expect(output).toBeNull();
      } else {
        expect(output).toEqual(entry.output.value);
      }
    }
  });
});

describe("normalizeRemixStructure (#1899)", () => {
  it("rejects foreign shapes and versions as null", () => {
    expect(normalizeRemixStructure("blocks", 5)).toBeNull();
    expect(normalizeRemixStructure([], 5)).toBeNull();
    expect(
      normalizeRemixStructure(
        { schemaVersion: "remix-structure/v2", blocks: [{ section: 1 }] },
        5,
      ),
    ).toBeNull();
    expect(normalizeRemixStructure({ blocks: [{ section: 1.5 }] }, 5)).toBeNull();
    expect(
      normalizeRemixStructure({ blocks: [{ section: 1, fadeIn: "yes" }] }, 5),
    ).toBeNull();
    expect(normalizeRemixStructure({ blocks: [{ section: 0 }] }, 0)).toBeNull();
    const tooMany = Array.from({ length: 97 }, () => ({ section: 0 }));
    expect(normalizeRemixStructure({ blocks: tooMany }, 5)).toBeNull();
    expect(
      normalizeRemixStructure({ blocks: tooMany.slice(0, 96) }, 5)?.blocks,
    ).toHaveLength(96);
  });

  it("compares structures after normalization", () => {
    expect(
      sameRemixStructure(
        { blocks: [{ section: 1, fadeIn: false }] },
        { schemaVersion: "remix-structure/v1", blocks: [{ section: 1 }] },
        5,
      ),
    ).toBe(true);
    expect(sameRemixStructure(null, { blocks: identityBlocks(5) }, 5)).toBe(true);
    expect(sameRemixStructure(null, { blocks: [{ section: 1 }] }, 5)).toBe(false);
  });
});

describe("timeline helpers (#1899)", () => {
  it("reads the master fade level along the timeline", () => {
    const { masterFades } = structureTimeline(
      grid,
      fixture.timelines.find((t) => t.name === "fades")!.blocks,
    );
    expect(masterFadeValueAt(masterFades, 0)).toBe(0);
    expect(masterFadeValueAt(masterFades, 3)).toBeCloseTo(0.5, 12);
    expect(masterFadeValueAt(masterFades, 10)).toBeCloseTo(0.5, 12);
    expect(masterFadeValueAt(masterFades, 18)).toBeCloseTo(0.5, 12);
    expect(masterFadeValueAt(masterFades, 30)).toBe(1);
    expect(masterFadeValueAt(masterFades, 46)).toBeCloseTo(0.5, 12);
    expect(masterFadeValueAt(masterFades, 54)).toBe(0); // held after the end
    expect(masterFadeValueAt([], 10)).toBe(1);
  });

  it("rebuilds the timeline from server-served segments", () => {
    for (const entry of fixture.timelines) {
      expect(timelineFromSegments(entry.segments)).toEqual(
        structureTimeline(grid, entry.blocks),
      );
    }
    expect(timelineFromSegments([]).durationSec).toBe(0);
  });

  it("recognizes the identity timeline", () => {
    expect(isIdentityTimeline(null)).toBe(true);
    expect(isIdentityTimeline(structureTimeline(grid, null))).toBe(true);
    for (const entry of fixture.timelines.slice(1)) {
      expect(isIdentityTimeline(structureTimeline(grid, entry.blocks))).toBe(false);
    }
    // Dropping the tail is a structure (join fade-out on the last block).
    expect(
      isIdentityTimeline(structureTimeline(grid, identityBlocks(4))),
    ).toBe(false);
  });
});

function state(
  blocks: RemixStructureBlock[],
  masks: RemixStructureEditState["masks"] = {},
): RemixStructureEditState {
  return { sectionCount: 5, blocks, masks };
}

const identity = identityBlocks(5);

describe("structure edit operations (#1899)", () => {
  it("builds the edit state from a project, dropping stale masks", () => {
    const edit = structureEditState(
      grid,
      { blocks: [{ section: 1 }, { section: 2 }] },
      { a: [true, false], b: [true, false, true], c: [true, true], d: null },
    );
    expect(edit.blocks).toEqual([{ section: 1 }, { section: 2 }]);
    expect(edit.masks).toEqual({ a: [true, false], b: null, c: null, d: null });
    expect(structureEditState(grid, null, {}).blocks).toEqual(identity);
  });

  it("repeats a block and copies its mask column", () => {
    const result = repeatBlock(
      state(identity, { a: [true, false, true, true, true], b: null }),
      1,
      grid,
    )!;
    expect(result.blocks.map((block) => block.section)).toEqual([0, 1, 1, 2, 3, 4]);
    expect(result.structure?.blocks).toEqual(result.blocks);
    expect(result.masks).toEqual({
      a: [true, false, false, true, true, true],
      b: null,
    });
    // A copy repeats the section only, not the block's fades.
    const faded = repeatBlock(
      state([{ section: 2, fadeIn: true, fadeOut: true }]),
      0,
      grid,
    )!;
    expect(faded.blocks).toEqual([
      { section: 2, fadeIn: true, fadeOut: true },
      { section: 2 },
    ]);
    const full = Array.from({ length: 96 }, () => ({ section: 0 }));
    // 96 blocks of the 6 s pickup (576 s) are under a lifted cap: the
    // block limit alone refuses.
    const longGrid = { ...grid, durationSeconds: 450 };
    expect(repeatBlock(state(full), 0, longGrid)).toBeNull();
    expect(repeatBlock(state(full.slice(1)), 0, longGrid)).not.toBeNull();
    expect(repeatBlock(state(identity), 5, grid)).toBeNull();
  });

  it("refuses a repeat past the timeline cap, allowing it up to the boundary", () => {
    // Cap = min(2 × 58 s, 900 s) = 116 s. Identity = 58 s; each repeat of
    // section 1 adds 16 s: 74, 90, 106, then 122 > 116.
    expect(maxTimelineSeconds(grid)).toBe(116);
    let edit: RemixStructureEditState = state(identity);
    for (let step = 0; step < 3; step += 1) {
      edit = repeatBlock(edit, 1, grid)!;
      expect(edit).not.toBeNull();
    }
    expect(structureTimeline(grid, edit.blocks).durationSec).toBe(106);
    expect(repeatBlock(edit, 1, grid)).toBeNull();
    // The 4 s tail still fits (110 s) and then the 6 s pickup exactly hits
    // 116 s: on the boundary is allowed.
    const withTail = repeatBlock(edit, edit.blocks.length - 1, grid)!;
    expect(structureTimeline(grid, withTail.blocks).durationSec).toBe(110);
    const atCap = repeatBlock(withTail, 0, grid)!;
    expect(structureTimeline(grid, atCap.blocks).durationSec).toBe(116);
    expect(repeatBlock(atCap, atCap.blocks.length - 1, grid)).toBeNull();
  });


  it("removes a block with its column, never the last one", () => {
    const repeated = [0, 1, 1, 2, 3, 4].map((section) => ({ section }));
    const result = removeBlock(
      state(repeated, { a: [true, true, false, true, true, true] }),
      2,
    )!;
    // Back to the identity order: structure null, all-on mask null.
    expect(result.structure).toBeNull();
    expect(result.blocks).toEqual(identity);
    expect(result.masks).toEqual({ a: null });
    expect(removeBlock(state([{ section: 3 }]), 0)).toBeNull();
    expect(removeBlock(state(identity), -1)).toBeNull();
    // A stale mask counts as all on.
    expect(removeBlock(state(identity, { a: [false] }), 0)!.masks).toEqual({
      a: null,
    });
  });

  it("moves a block earlier or later with its column", () => {
    const result = moveBlock(
      state(identity, { a: [true, false, true, true, true] }),
      1,
      -1,
    )!;
    expect(result.blocks.map((block) => block.section)).toEqual([1, 0, 2, 3, 4]);
    expect(result.masks.a).toEqual([false, true, true, true, true]);
    const back = moveBlock(result, 0, 1)!;
    expect(back.structure).toBeNull();
    expect(back.masks.a).toEqual([true, false, true, true, true]);
    expect(moveBlock(state(identity), 0, -1)).toBeNull();
    expect(moveBlock(state(identity), 4, 1)).toBeNull();
  });

  it("toggles fades and collapses back to null", () => {
    const faded = toggleFade(state(identity, { a: [false, true, true, true, true] }), 4, "out")!;
    expect(faded.structure).toEqual({
      schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION,
      blocks: [...identity.slice(0, 4), { section: 4, fadeOut: true }],
    });
    expect(faded.masks.a).toEqual([false, true, true, true, true]);
    const both = toggleFade(faded, 4, "in")!;
    expect(both.blocks[4]).toEqual({ section: 4, fadeIn: true, fadeOut: true });
    const cleared = toggleFade(toggleFade(both, 4, "in")!, 4, "out")!;
    expect(cleared.structure).toBeNull();
    expect(toggleFade(state(identity), 9, "in")).toBeNull();
  });

  it("resets to the original order with first-occurrence mask values", () => {
    // Blocks: 2, 1, 2 — section 2's first block is off, its repeat on;
    // sections 0, 3 and 4 are not played → on.
    const result = resetStructure(
      state([{ section: 2 }, { section: 1 }, { section: 2, fadeIn: true }], {
        a: [false, true, true],
        b: [true, false, false],
        c: null,
      }),
      grid,
    )!;
    expect(result.structure).toBeNull();
    expect(result.blocks).toEqual(identity);
    expect(result.masks).toEqual({
      a: [true, true, false, true, true],
      b: [true, false, true, true, true],
      c: null,
    });
  });
});

describe("timeline cap (#1899)", () => {
  it("is twice the source, but never more than 15 minutes", () => {
    expect(MAX_TIMELINE_FACTOR).toBe(2);
    expect(MAX_TIMELINE_SECONDS).toBe(900);
    expect(maxTimelineSeconds({ durationSeconds: 58 })).toBe(116);
    expect(maxTimelineSeconds({ durationSeconds: 450 })).toBe(900);
    expect(maxTimelineSeconds({ durationSeconds: 600 })).toBe(900);
  });

  it("says which limit a longer structure would pass", () => {
    const twice = "That would make the remix more than twice as long as the original.";
    const ceiling = "That would make the remix longer than 15 minutes.";
    expect(structureTooLongReason({ durationSeconds: 58 })).toBe(twice);
    // 2 × 450 s = 900 s: the ceiling is not yet binding.
    expect(structureTooLongReason({ durationSeconds: 450 })).toBe(twice);
    expect(structureTooLongReason({ durationSeconds: 450.5 })).toBe(ceiling);
    expect(structureTooLongReason({ durationSeconds: 600 })).toBe(ceiling);
  });

  it("allows the boundary within 1e-6 and refuses past it", () => {
    const twoSections = {
      sections: [
        { startSec: 0, endSec: 10 },
        { startSec: 10, endSec: 20 },
      ],
      durationSeconds: 20,
    };
    const four = [0, 1, 0, 1].map((section) => ({ section }));
    expect(withinTimelineCap(twoSections, four)).toBe(true); // 40 s = cap
    expect(
      withinTimelineCap({ ...twoSections, durationSeconds: 20 - 4e-7 }, four),
    ).toBe(true); // over by 8e-7 ≤ 1e-6
    expect(
      withinTimelineCap({ ...twoSections, durationSeconds: 19.99 }, four),
    ).toBe(false);
    expect(withinTimelineCap(twoSections, [...four, { section: 0 }])).toBe(false);
  });
});

describe("structure recipes (#1899)", () => {
  it("detects a pickup only when section 0 is short and not alone", () => {
    expect(hasPickup(grid)).toBe(true); // 6 s < 0.75 × 16 s
    expect(
      hasPickup({ ...grid, sections: [{ startSec: 0, endSec: 12 }, ...grid.sections.slice(1)] }),
    ).toBe(false);
    expect(hasPickup({ ...grid, sections: [{ startSec: 0, endSec: 6 }] })).toBe(false);
  });

  it("extended mix drops the pickup, doubles first and last, fades out", () => {
    const result = extendedMix(
      grid,
      state(identity, { a: [false, true, false, true, true] }),
    )!;
    const expected = fixture.timelines.find((t) => t.name === "extended-mix")!;
    expect(result.blocks).toEqual(expected.blocks);
    expect(result.structure?.blocks).toEqual(expected.blocks);
    expect(result.masks.a).toEqual([true, true, false, true, true, true]);

    // No pickup: section 0 is doubled.
    const full = {
      ...grid,
      sections: [
        { startSec: 0, endSec: 16 },
        { startSec: 16, endSec: 32 },
      ],
    };
    expect(
      extendedMix(full, { sectionCount: 2, blocks: identityBlocks(2), masks: {} })!
        .blocks,
    ).toEqual([{ section: 0 }, { section: 0 }, { section: 1 }, { section: 1, fadeOut: true }]);
    // A single section plays twice, fading out on the second.
    const single = { ...grid, sections: [{ startSec: 0, endSec: 16 }] };
    expect(
      extendedMix(single, { sectionCount: 1, blocks: identityBlocks(1), masks: {} })!
        .blocks,
    ).toEqual([{ section: 0 }, { section: 0, fadeOut: true }]);
  });

  it("extended mix is refused past the timeline cap", () => {
    // Two 16 s sections of a 24 s source: the 64 s extended mix is over the
    // 48 s cap; from a 32 s source it lands exactly on the 64 s cap.
    const sections = [
      { startSec: 0, endSec: 16 },
      { startSec: 16, endSec: 32 },
    ];
    const edit = { sectionCount: 2, blocks: identityBlocks(2), masks: {} };
    expect(
      extendedMix({ ...grid, sections, durationSeconds: 24 }, edit),
    ).toBeNull();
    expect(
      extendedMix({ ...grid, sections, durationSeconds: 32 }, edit),
    ).not.toBeNull();
  });

  it("short edit keeps the first ceil(0.6·N) sections and fades out", () => {
    const result = shortEdit(
      grid,
      state([{ section: 3 }, { section: 0 }, { section: 2 }], {
        a: [false, false, true],
      }),
    )!;
    expect(result.blocks).toEqual([
      { section: 0 },
      { section: 1 },
      { section: 2, fadeOut: true },
    ]);
    // Section 0 → block 1 (off), 1 → unplayed (on), 2 → block 2 (on).
    expect(result.masks.a).toEqual([false, true, true]);
    const sizes = [1, 2, 3, 4, 10].map((count) => {
      const sections = Array.from({ length: count }, (_, i) => ({
        startSec: i * 16,
        endSec: (i + 1) * 16,
      }));
      return shortEdit(
        { sections },
        { sectionCount: count, blocks: identityBlocks(count), masks: {} },
      )!.blocks.length;
    });
    expect(sizes).toEqual([1, 2, 2, 3, 6]);
  });

  it("normalizes all-on masks to null", () => {
    expect(normalizeBlockMask([true, true], 2)).toBeNull();
    expect(normalizeBlockMask([true, false], 3)).toBeNull();
    expect(normalizeBlockMask([true, false], 2)).toEqual([true, false]);
    expect(
      shortEdit(grid, state(identity, { a: null }))!.masks,
    ).toEqual({ a: null });
  });
});
