import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isPitchedPartRole,
  normalizeRemixParts,
  partIdFromLaneId,
  partLaneId,
  partLengthSeconds,
  partPlacementSpans,
  partStretchPlan,
  REMIX_PART_ROLES,
  REMIX_PART_SPAN_FADE_SECONDS,
  REMIX_PARTS_MAX,
  REMIX_PARTS_SCHEMA_VERSION,
  sameRemixParts,
  withoutPart,
  withPart,
  withPartBlocks,
  withPartGain,
  withPartMuted,
  type RemixPartSpan,
  type RemixParts,
} from "./remixParts";
import { REMIX_BEAT_LANE_ID, type RemixBeatGrid, type RemixBeatSegment } from "./remixBeat";

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../backend/src/modules/remix/remix-parts-v1.parity.json",
);

type Fixture = {
  schemaVersion: string;
  dspVersion: string;
  fadeSeconds: number;
  cases: Array<{
    name: string;
    grid: RemixBeatGrid;
    segments: RemixBeatSegment[];
    blocks: boolean[] | null;
    bars: number;
    loopSec: number;
    spans: RemixPartSpan[];
  }>;
};

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;

describe("remix-parts/v1 placement parity fixture (#1901)", () => {
  it("shares the schema and the fade length", () => {
    expect(fixture.schemaVersion).toBe(REMIX_PARTS_SCHEMA_VERSION);
    expect(fixture.fadeSeconds).toBe(REMIX_PART_SPAN_FADE_SECONDS);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(8);
  });

  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))(
    "%s: the preview places the same spans as the render",
    (_name, entry) => {
      expect(entry.loopSec).toBe(partLengthSeconds(entry.grid.bpm as number, entry.bars));
      expect(
        partPlacementSpans({ blocks: entry.blocks }, entry.grid, entry.segments, entry.loopSec),
      ).toEqual(entry.spans);
    },
  );

  it("returns nothing for a bad loop length", () => {
    const entry = fixture.cases[0];
    expect(partPlacementSpans({}, entry.grid, entry.segments, 0)).toEqual([]);
    expect(partPlacementSpans({}, entry.grid, entry.segments, Number.NaN)).toEqual([]);
  });
});

describe("roles and stretch plans", () => {
  it("only drums are unpitched; drums never take the key shift", () => {
    expect(REMIX_PART_ROLES.filter((role) => !isPitchedPartRole(role))).toEqual(["drums"]);
    expect(partStretchPlan("drums", { tempo: 0.9, semitones: 3 })).toEqual({ tempo: 0.9, semitones: 0 });
    expect(partStretchPlan("drums", { tempo: 1, semitones: 3 })).toBeNull();
    expect(partStretchPlan("keys", { tempo: 1, semitones: 3 })).toEqual({ tempo: 1, semitones: 3 });
    expect(partStretchPlan("keys", null)).toBeNull();
  });

  it("lane ids never collide with stems or the beat", () => {
    expect(partLaneId("keys-1")).toBe("remix-part:keys-1");
    expect(partLaneId("keys-1")).not.toBe(REMIX_BEAT_LANE_ID);
    expect(partIdFromLaneId("remix-part:keys-1")).toBe("keys-1");
    expect(partIdFromLaneId(REMIX_BEAT_LANE_ID)).toBeNull();
    expect(partIdFromLaneId("stem-1")).toBeNull();
    expect(partIdFromLaneId(null)).toBeNull();
  });
});

describe("normalizeRemixParts", () => {
  const recipe = (parts: unknown[]) => ({ schemaVersion: REMIX_PARTS_SCHEMA_VERSION, parts });

  it("keeps a valid recipe, omitting defaults", () => {
    expect(
      normalizeRemixParts(
        recipe([
          { id: "keys-1", role: "keys", takeId: "t1", gainDb: 0, muted: false, blocks: [true, true] },
          { id: "drums", role: "drums", takeId: "t2", gainDb: -3.456, muted: true, blocks: [true, false] },
        ]),
        2,
      ),
    ).toEqual({
      schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
      parts: [
        { id: "keys-1", role: "keys", takeId: "t1" },
        { id: "drums", role: "drums", takeId: "t2", gainDb: -3.46, muted: true, blocks: [true, false] },
      ],
    });
  });

  it("clamps gain to the stem range and drops invalid or duplicate parts", () => {
    const normalized = normalizeRemixParts(
      recipe([
        { id: "a", role: "bass", takeId: "t", gainDb: 40 },
        { id: "a", role: "bass", takeId: "t2" },
        { id: "Bad Id", role: "bass", takeId: "t" },
        { id: "b", role: "vocals", takeId: "t" },
        { id: "c", role: "pad", takeId: "" },
        { id: "d", role: "pad", takeId: "x".repeat(65) },
        "junk",
        { id: "e", role: "pad", takeId: "t", gainDb: -99 },
      ]),
    );
    expect(normalized?.parts).toEqual([
      { id: "a", role: "bass", takeId: "t", gainDb: 6 },
      { id: "e", role: "pad", takeId: "t", gainDb: -24 },
    ]);
  });

  it("keeps at most 4 parts", () => {
    const parts = Array.from({ length: 6 }, (_, index) => ({
      id: `p${index}`,
      role: "keys",
      takeId: `t${index}`,
    }));
    expect(normalizeRemixParts(recipe(parts))?.parts).toHaveLength(REMIX_PARTS_MAX);
  });

  it("reads a stale or all-on blocks list as on everywhere", () => {
    const stale = normalizeRemixParts(recipe([{ id: "a", role: "keys", takeId: "t", blocks: [false, true] }]), 3);
    expect(stale?.parts[0]).toEqual({ id: "a", role: "keys", takeId: "t" });
    const unknownCount = normalizeRemixParts(recipe([{ id: "a", role: "keys", takeId: "t", blocks: [false] }]));
    expect(unknownCount?.parts[0].blocks).toEqual([false]);
  });

  it("nulls anything else", () => {
    expect(normalizeRemixParts(null)).toBeNull();
    expect(normalizeRemixParts([])).toBeNull();
    expect(normalizeRemixParts({ schemaVersion: "remix-parts/v9", parts: [] })).toBeNull();
    expect(normalizeRemixParts({ parts: "no" })).toBeNull();
    expect(normalizeRemixParts(recipe([]))).toBeNull();
    expect(sameRemixParts(recipe([{ id: "a", role: "keys", takeId: "t", gainDb: 0 }]), recipe([{ id: "a", role: "keys", takeId: "t" }]))).toBe(true);
  });
});

describe("edit helpers", () => {
  const base: RemixParts = {
    schemaVersion: REMIX_PARTS_SCHEMA_VERSION,
    parts: [{ id: "keys-1", role: "keys", takeId: "t1" }],
  };

  it("adds, replaces in place and refuses a fifth part", () => {
    const added = withPart(base, { id: "bass-1", role: "bass", takeId: "t2" });
    expect(added?.parts.map((part) => part.id)).toEqual(["keys-1", "bass-1"]);
    const replaced = withPart(added, { id: "keys-1", role: "keys", takeId: "t9" });
    expect(replaced?.parts[0]).toEqual({ id: "keys-1", role: "keys", takeId: "t9" });
    let full = withPart(null, { id: "a", role: "pad", takeId: "t" });
    for (const id of ["b", "c", "d"]) full = withPart(full, { id, role: "pad", takeId: "t" });
    expect(full?.parts).toHaveLength(4);
    expect(withPart(full, { id: "e", role: "pad", takeId: "t" })).toBe(full);
    expect(withPart(base, { id: "BAD", role: "pad", takeId: "t" })).toBe(base);
  });

  it("removes parts, down to null", () => {
    expect(withoutPart(base, "keys-1")).toBeNull();
    expect(withoutPart(base, "other")).toEqual(base);
    expect(withoutPart(null, "x")).toBeNull();
  });

  it("sets blocks, gain and mute", () => {
    expect(withPartBlocks(base, "keys-1", [true, false])?.parts[0].blocks).toEqual([true, false]);
    expect(withPartBlocks(withPartBlocks(base, "keys-1", [true, false]), "keys-1", [true, true])?.parts[0]).toEqual(base.parts[0]);
    expect(withPartGain(base, "keys-1", -7.126)?.parts[0].gainDb).toBe(-7.13);
    expect(withPartGain(base, "keys-1", 99)?.parts[0].gainDb).toBe(6);
    expect(withPartGain(base, "keys-1", 0)?.parts[0]).toEqual(base.parts[0]);
    expect(withPartMuted(base, "keys-1", true)?.parts[0].muted).toBe(true);
    expect(withPartMuted(withPartMuted(base, "keys-1", true), "keys-1", false)?.parts[0]).toEqual(base.parts[0]);
    expect(withPartMuted(null, "keys-1", true)).toBeNull();
  });
});
