/**
 * Structure blocks remix-structure/v1 (#1899) — pure unit tests.
 *
 * The parity block replays the committed fixture the web preview is also
 * tested against, so both engines derive the same timeline, join fades, gate
 * intervals and master fade ramps (1e-9).
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { SectionGrid } from "../modules/remix/remix-arrangement";
import { validateStemArrangementInput } from "../modules/remix/remix-arrangement";
import {
  exceedsTimelineCap,
  gateIntervalsForBlocks,
  MAX_TIMELINE_FACTOR,
  MAX_TIMELINE_SECONDS,
  maxTimelineSeconds,
  resolveStoredRemixStructure,
  timelineCapError,
  TIMELINE_CAP_FACTOR_ERROR,
  TIMELINE_CAP_SECONDS_ERROR,
  JOIN_FADE_SECONDS,
  masterFadeRamps,
  MAX_STRUCTURE_BLOCKS,
  NO_SECTION_GRID_ERROR,
  normalizeRemixStructureInput,
  readStoredRemixStructure,
  REMIX_STRUCTURE_SCHEMA_VERSION,
  structureBlockCount,
  structureTimeline,
  timelineDurationSec,
  type RemixStructureBlock,
} from "../modules/remix/remix-structure";

type Segment = {
  index: number;
  section: number;
  outStartSec: number;
  outEndSec: number;
  srcStartSec: number;
  srcEndSec: number;
  joinFadeIn: boolean;
  joinFadeOut: boolean;
  fadeIn: boolean;
  fadeOut: boolean;
};

type Ramp = {
  startSec: number;
  endSec: number;
  from: number;
  to: number;
  holdAfter?: boolean;
};

type ParityFixture = {
  schemaVersion: string;
  constants: { joinFadeSeconds: number; maxBlocks: number };
  grid: SectionGrid;
  timelines: Array<{
    name: string;
    blocks: RemixStructureBlock[] | null;
    durationSec: number;
    segments: Segment[];
    masterFades: Ramp[];
  }>;
  gate: Array<{
    case: string;
    mask: boolean[];
    intervals: Array<{ startSec: number; endSec: number }> | null;
  }>;
  normalize: Array<{ input: unknown; output: unknown }>;
};

const fixture: ParityFixture = JSON.parse(
  readFileSync(
    join(__dirname, "../modules/remix/remix-structure-v1.parity.json"),
    "utf8",
  ),
);

const TOLERANCE = 1e-9;

function expectClose(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOLERANCE);
}

/** Same keys, numbers within 1e-9, everything else strictly equal. */
function expectParity(actual: unknown, expected: unknown) {
  if (typeof expected === "number") {
    expect(typeof actual).toBe("number");
    expectClose(actual as number, expected);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expect((actual as unknown[]).length).toBe(expected.length);
    expected.forEach((item, index) =>
      expectParity((actual as unknown[])[index], item),
    );
    return;
  }
  if (expected !== null && typeof expected === "object") {
    expect(actual).not.toBeNull();
    expect(typeof actual).toBe("object");
    expect(Object.keys(actual as object).sort()).toEqual(
      Object.keys(expected).sort(),
    );
    for (const [key, value] of Object.entries(expected)) {
      expectParity((actual as Record<string, unknown>)[key], value);
    }
    return;
  }
  expect(actual).toBe(expected);
}

const grid = fixture.grid;
const sectionCount = grid.sections.length;

describe("remix-structure/v1 parity fixture (#1899)", () => {
  it("pins the schema version and constants", () => {
    expect(fixture.schemaVersion).toBe(REMIX_STRUCTURE_SCHEMA_VERSION);
    expectClose(JOIN_FADE_SECONDS, fixture.constants.joinFadeSeconds);
    expect(MAX_STRUCTURE_BLOCKS).toBe(fixture.constants.maxBlocks);
  });

  it.each(fixture.timelines)(
    "timeline $name",
    ({ blocks, durationSec, segments, masterFades }) => {
      const actual = structureTimeline(grid, blocks);
      expectParity(actual, segments);
      expectClose(timelineDurationSec(actual), durationSec);
      expectParity(masterFadeRamps(actual), masterFades);
    },
  );

  it.each(fixture.gate.map((entry, index) => ({ ...entry, index })))(
    "gate case $index ($case)",
    ({ case: name, mask, intervals }) => {
      const timeline = fixture.timelines.find((entry) => entry.name === name)!;
      const segments = structureTimeline(grid, timeline.blocks);
      expectParity(gateIntervalsForBlocks(segments, mask), intervals);
    },
  );

  it.each(fixture.normalize.map((entry, index) => ({ ...entry, index })))(
    "normalize case $index",
    ({ input, output }) => {
      expect(normalizeRemixStructureInput(input, sectionCount)).toEqual(output);
    },
  );
});

describe("normalizeRemixStructureInput (#1899)", () => {
  it("returns the no-grid error for any structure without a grid", () => {
    expect(
      normalizeRemixStructureInput({ blocks: [{ section: 0 }] }, 0),
    ).toEqual({ error: NO_SECTION_GRID_ERROR });
    // Clearing is still allowed without a grid.
    expect(normalizeRemixStructureInput(null, 0)).toEqual({ value: null });
  });

  it("accepts an echoed stored shape and the 96-block maximum", () => {
    const blocks = Array.from({ length: 96 }, (_, index) => ({
      section: index % sectionCount,
    }));
    expect(
      normalizeRemixStructureInput(
        { schemaVersion: "remix-structure/v1", blocks },
        sectionCount,
      ),
    ).toEqual({ value: { schemaVersion: "remix-structure/v1", blocks } });
  });

  it("keeps identity order with a fade (not identity)", () => {
    const blocks = grid.sections.map((_, section) => ({ section }));
    const withFade = [...blocks.slice(0, -1), { section: 4, fadeOut: true }];
    expect(
      normalizeRemixStructureInput({ blocks: withFade }, sectionCount),
    ).toEqual({
      value: { schemaVersion: "remix-structure/v1", blocks: withFade },
    });
  });

  it.each([
    ["a string", "extended", /structure must be an object or null/],
    ["an array", [], /structure must be an object or null/],
    ["an unknown top-level key", { blocks: [{ section: 0 }], mode: "x" }, /structure\.mode/],
    ["a foreign schema version", { schemaVersion: "remix-structure/v2", blocks: [{ section: 0 }] }, /schemaVersion/],
    ["missing blocks", {}, /structure\.blocks must be an array/],
    ["too many blocks", { blocks: Array.from({ length: 97 }, () => ({ section: 0 })) }, /1\.\.96 entries/],
    ["a non-object block", { blocks: [1] }, /blocks\[\] must be objects/],
    ["an unknown block key", { blocks: [{ section: 0, gain: 2 }] }, /blocks\[\]\.gain/],
    ["a negative section", { blocks: [{ section: -1 }] }, /integer in 0\.\.4/],
    ["a fractional section", { blocks: [{ section: 1.5 }] }, /integer in 0\.\.4/],
    ["a string section", { blocks: [{ section: "1" }] }, /integer in 0\.\.4/],
    ["a non-boolean fade", { blocks: [{ section: 1, fadeIn: 1 }] }, /fadeIn must be a boolean/],
  ])("rejects %s", (_label, input, message) => {
    const result = normalizeRemixStructureInput(input, sectionCount);
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toMatch(message);
  });
});

describe("readStoredRemixStructure (#1899)", () => {
  const stored = {
    schemaVersion: "remix-structure/v1",
    blocks: [{ section: 2 }, { section: 2, fadeOut: true }],
  };

  it("reads a stored structure", () => {
    expect(readStoredRemixStructure(stored, sectionCount)).toEqual(stored);
    // Lineage reads skip the range check.
    expect(readStoredRemixStructure(stored, null)).toEqual(stored);
  });

  it.each([
    ["null", null, sectionCount],
    ["a string", "remix-structure/v1", sectionCount],
    ["a missing version", { blocks: [{ section: 1 }] }, sectionCount],
    ["a foreign version", { schemaVersion: "remix-structure/v0", blocks: [{ section: 1 }] }, sectionCount],
    ["an out-of-range section (grid re-measured)", stored, 2],
    ["no grid", stored, 0],
    ["an identity order", { schemaVersion: "remix-structure/v1", blocks: grid.sections.map((_, section) => ({ section })) }, sectionCount],
  ])("reads %s as null", (_label, value, count) => {
    expect(readStoredRemixStructure(value, count)).toBeNull();
  });
});

describe("structure blocks and arrangement masks (#1899)", () => {
  const structure = {
    schemaVersion: "remix-structure/v1" as const,
    blocks: [{ section: 1 }, { section: 1 }, { section: 3 }],
  };
  const mask = (length: number) => ({
    schemaVersion: "remix-stem-arrangement/v1",
    sections: Array.from({ length }, () => true),
  });

  it("counts blocks, or the grid sections without a structure", () => {
    expect(structureBlockCount(grid, null)).toBe(5);
    expect(structureBlockCount(grid, structure)).toBe(3);
  });

  it("validates mask length against the block count", () => {
    expect(validateStemArrangementInput(mask(3), grid, 3)).toBeNull();
    expect(validateStemArrangementInput(mask(5), grid, 3)).toMatch(
      /exactly 3 entries/,
    );
    // No block count = the grid sections (pre-#1899 behavior).
    expect(validateStemArrangementInput(mask(5), grid)).toBeNull();
    expect(validateStemArrangementInput(mask(3), grid)).toMatch(
      /exactly 5 entries/,
    );
  });

  it("gates each copy of a repeated section independently", () => {
    const segments = structureTimeline(grid, structure.blocks);
    expect(gateIntervalsForBlocks(segments, [false, true, true])).toEqual([
      { startSec: 16, endSec: 48 },
    ]);
    expect(gateIntervalsForBlocks(segments, null)).toBeNull();
  });

  it("derives no master fades without fade flags", () => {
    expect(masterFadeRamps(structureTimeline(grid, structure.blocks))).toEqual(
      [],
    );
  });
});

describe("timeline safety cap (#1899)", () => {
  const sections = (...list: number[]) => list.map((section) => ({ section }));

  it("pins the cap constants and reasons", () => {
    expect(MAX_TIMELINE_FACTOR).toBe(2);
    expect(MAX_TIMELINE_SECONDS).toBe(900);
    expect(TIMELINE_CAP_FACTOR_ERROR).toBe(
      "That would make the remix more than twice as long as the original — remove a few repeats.",
    );
    expect(TIMELINE_CAP_SECONDS_ERROR).toBe(
      "That would make the remix longer than 15 minutes.",
    );
  });

  it("allows exactly twice the source and rejects anything longer", () => {
    // 58 s source → 116 s cap. 7 × 16 s + 4 s = 116 s exactly.
    expect(maxTimelineSeconds(grid)).toBe(116);
    const atCap = structureTimeline(grid, sections(1, 2, 3, 1, 2, 3, 1, 4));
    expect(timelineDurationSec(atCap)).toBe(116);
    expect(exceedsTimelineCap(grid, atCap)).toBe(false);
    const over = structureTimeline(grid, sections(1, 2, 3, 1, 2, 3, 1, 4, 0));
    expect(exceedsTimelineCap(grid, over)).toBe(true);
    expect(timelineCapError(grid)).toBe(TIMELINE_CAP_FACTOR_ERROR);
  });

  it("caps long sources at 15 minutes with its own reason", () => {
    // 600 s source: 2 × 600 > 900, so the 15-minute ceiling binds.
    const long: SectionGrid = {
      kind: "time",
      sectionSeconds: 100,
      bpm: null,
      durationSeconds: 600,
      sections: Array.from({ length: 6 }, (_, index) => ({
        startSec: index * 100,
        endSec: (index + 1) * 100,
      })),
    };
    expect(maxTimelineSeconds(long)).toBe(900);
    expect(timelineCapError(long)).toBe(TIMELINE_CAP_SECONDS_ERROR);
    expect(
      exceedsTimelineCap(long, structureTimeline(long, sections(0, 1, 2, 3, 4, 5, 0, 1, 2))),
    ).toBe(false);
    expect(
      exceedsTimelineCap(long, structureTimeline(long, sections(0, 1, 2, 3, 4, 5, 0, 1, 2, 3))),
    ).toBe(true);
    // Exactly 2 × 450 s = 900 s: the factor reason still applies.
    expect(timelineCapError({ ...long, durationSeconds: 450 })).toBe(
      TIMELINE_CAP_FACTOR_ERROR,
    );
  });

  it("resolves an over-cap stored structure to the original order", () => {
    const stored = {
      schemaVersion: "remix-structure/v1",
      blocks: sections(1, 2, 3, 1, 2, 3, 1, 4, 0),
    };
    expect(resolveStoredRemixStructure(stored, grid)).toEqual({
      structure: null,
      overCap: true,
    });
    const fine = { schemaVersion: "remix-structure/v1", blocks: sections(1, 1) };
    expect(resolveStoredRemixStructure(fine, grid)).toEqual({
      structure: fine,
      overCap: false,
    });
    expect(resolveStoredRemixStructure(fine, null)).toEqual({
      structure: null,
      overCap: false,
    });
    expect(resolveStoredRemixStructure({ blocks: "x" }, grid)).toEqual({
      structure: null,
      overCap: false,
    });
  });
});
