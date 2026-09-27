import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  activeBeatPresetId,
  BEAT_PRESETS,
  beatBlocksAfterStructureEdit,
  beatGridAvailable,
  beatHits,
  beatOneShot,
  beatTimingAtSpeed,
  beatRenderKey,
  beatTrackLength,
  defaultBeat,
  normalizeRemixBeat,
  REMIX_BEAT_INSTRUMENTS,
  REMIX_BEAT_KITS,
  REMIX_BEAT_KIT_IDS,
  REMIX_BEAT_LANE_ID,
  REMIX_BEAT_SCHEMA_VERSION,
  REMIX_BEAT_SEEDS,
  renderBeatInto,
  renderBeatTrack,
  sameRemixBeat,
  toggleBeatStep,
  withBeatMuted,
  type RemixBeatGrid,
  type RemixBeatInstrument,
  type RemixBeatKitId,
  type RemixBeatRecipe,
  type RemixBeatSegment,
} from "./remixBeat";
import {
  moveBlock,
  removeBlock,
  repeatBlock,
  resetStructure,
  structureEditState,
  structureTimeline,
} from "./remixStructure";

const FIXTURE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../backend/src/modules/remix/remix-beat-v1.parity.json",
);

type Fixture = {
  schemaVersion: string;
  sampleRate: number;
  instruments: string[];
  seeds: Record<string, number>;
  kits: Record<string, unknown>;
  oneShots: Record<
    string,
    Record<
      string,
      { length: number; first: number[]; at2400: number; peak: number }
    >
  >;
  scenario: {
    grid: RemixBeatGrid & { kind: "bars"; durationSeconds: number };
    segments: RemixBeatSegment[];
    recipe: RemixBeatRecipe;
  };
  hits: { timeSec: number; instrument: RemixBeatInstrument }[];
  track: { length: number; at: Record<string, number> };
};

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
const SR = fixture.sampleRate;

describe("remix-beat/v1 parity fixture (#1902)", () => {
  it("shares the schema, instruments, seeds and kits", () => {
    expect(fixture.schemaVersion).toBe(REMIX_BEAT_SCHEMA_VERSION);
    expect(fixture.instruments).toEqual([...REMIX_BEAT_INSTRUMENTS]);
    expect(fixture.seeds).toEqual(REMIX_BEAT_SEEDS);
    expect(fixture.kits).toEqual(REMIX_BEAT_KITS);
  });

  it("reproduces every one-shot within 1e-9", () => {
    for (const kit of REMIX_BEAT_KIT_IDS) {
      for (const instrument of REMIX_BEAT_INSTRUMENTS) {
        const expected = fixture.oneShots[kit][instrument];
        const shot = beatOneShot(kit, instrument, SR);
        expect(shot.length).toBe(expected.length);
        expected.first.forEach((value, index) => {
          expect(Math.abs(shot[index] - value)).toBeLessThan(1e-9);
        });
        expect(Math.abs((shot[2400] ?? 0) - expected.at2400)).toBeLessThan(1e-9);
        let peak = 0;
        for (const value of shot) peak = Math.max(peak, Math.abs(value));
        expect(Math.abs(peak - expected.peak)).toBeLessThan(1e-9);
      }
    }
  });

  it("reproduces the hit list (pickup skipped, block off, swing)", () => {
    const { grid, segments, recipe } = fixture.scenario;
    const hits = beatHits(recipe, grid, segments);
    expect(hits).toHaveLength(fixture.hits.length);
    hits.forEach((hit, index) => {
      expect(hit.instrument).toBe(fixture.hits[index].instrument);
      expect(Math.abs(hit.timeSec - fixture.hits[index].timeSec)).toBeLessThan(1e-9);
    });
  });

  it("reproduces the track samples within 1e-9 (Float64)", () => {
    const { grid, segments, recipe } = fixture.scenario;
    const length = beatTrackLength(recipe.kit, segments, SR);
    expect(length).toBe(fixture.track.length);
    const track = renderBeatInto(new Float64Array(length), recipe, grid, segments, SR);
    for (const [index, value] of Object.entries(fixture.track.at)) {
      expect(Math.abs(track[Number(index)] - value)).toBeLessThan(1e-9);
    }
  });

  it("renders the Float32 preview track to float precision", () => {
    const { grid, segments, recipe } = fixture.scenario;
    const track = renderBeatTrack(recipe, grid, segments, SR);
    expect(track).toBeInstanceOf(Float32Array);
    expect(track.length).toBe(fixture.track.length);
    for (const [index, value] of Object.entries(fixture.track.at)) {
      expect(Math.abs(track[Number(index)] - value)).toBeLessThan(1e-6);
    }
  });
});

const grid: RemixBeatGrid = {
  bpm: 120,
  sectionSeconds: 16,
  sections: [
    { startSec: 0, endSec: 16 },
    { startSec: 16, endSec: 32 },
  ],
};
const segments: RemixBeatSegment[] = [
  { section: 0, outStartSec: 0, outEndSec: 16 },
  { section: 1, outStartSec: 16, outEndSec: 32 },
];

function beat(overrides: Partial<RemixBeatRecipe> = {}): RemixBeatRecipe {
  return { ...defaultBeat("four_on_the_floor"), ...overrides };
}

describe("normalizeRemixBeat", () => {
  it("fills every key and missing rows", () => {
    expect(
      normalizeRemixBeat({ kit: "808", pattern: { kick: BEAT_PRESETS[0].pattern.kick } }),
    ).toEqual({
      schemaVersion: REMIX_BEAT_SCHEMA_VERSION,
      kit: "808",
      pattern: {
        kick: BEAT_PRESETS[0].pattern.kick,
        snare: new Array(16).fill(false),
        clap: new Array(16).fill(false),
        hat: new Array(16).fill(false),
        openHat: new Array(16).fill(false),
      },
      swing: 0,
      gainDb: 0,
      blocks: null,
    });
  });

  it("nulls what the backend rejects", () => {
    for (const value of [
      null,
      "beat",
      [],
      { kit: "cowbell" },
      { schemaVersion: "remix-beat/v2", kit: "punchy" },
      { kit: "punchy", pattern: { kick: [true] } },
      { kit: "punchy", pattern: { kick: new Array(16).fill(1) } },
      { kit: "punchy", pattern: [] },
    ]) {
      expect(normalizeRemixBeat(value)).toBeNull();
    }
  });

  it("clamps and rounds swing and gain", () => {
    const normalized = normalizeRemixBeat(
      beat({ swing: 0.987, gainDb: -40 }),
    );
    expect(normalized?.swing).toBe(0.6);
    expect(normalized?.gainDb).toBe(-24);
    expect(normalizeRemixBeat(beat({ swing: 0.123, gainDb: 9 }))).toMatchObject({
      swing: 0.12,
      gainDb: 6,
    });
    expect(
      normalizeRemixBeat({ ...beat(), swing: Number.NaN, gainDb: "loud" }),
    ).toMatchObject({ swing: 0, gainDb: 0 });
  });

  it("normalizes blocks against the block count", () => {
    expect(normalizeRemixBeat(beat({ blocks: [true, false] }), 2)?.blocks).toEqual([
      true,
      false,
    ]);
    // Stale (another length) or all on → null.
    expect(normalizeRemixBeat(beat({ blocks: [true, false] }), 3)?.blocks).toBeNull();
    expect(normalizeRemixBeat(beat({ blocks: [true, true] }), 2)?.blocks).toBeNull();
    // Without a count, an all-on list is still null.
    expect(normalizeRemixBeat(beat({ blocks: [true, true] }))?.blocks).toBeNull();
    expect(normalizeRemixBeat(beat({ blocks: [false] }))?.blocks).toEqual([false]);
  });

  it("compares after normalization", () => {
    expect(sameRemixBeat(beat({ swing: 0.301 }), beat({ swing: 0.3 }))).toBe(true);
    expect(sameRemixBeat(beat({ kit: "lofi" }), beat())).toBe(false);
    expect(sameRemixBeat(null, undefined)).toBe(true);
  });
});

describe("beat presets", () => {
  it("defines the five presets with full 5×16 patterns", () => {
    expect(BEAT_PRESETS.map((preset) => preset.label)).toEqual([
      "Four on the floor",
      "Boom bap",
      "Trap",
      "Breakbeat",
      "Half-time",
    ]);
    for (const preset of BEAT_PRESETS) {
      for (const instrument of REMIX_BEAT_INSTRUMENTS) {
        expect(preset.pattern[instrument]).toHaveLength(16);
      }
    }
    const steps = (row: boolean[]) =>
      row.flatMap((on, index) => (on ? [index] : []));
    const byId = Object.fromEntries(BEAT_PRESETS.map((preset) => [preset.id, preset.pattern]));
    expect(steps(byId.four_on_the_floor.kick)).toEqual([0, 4, 8, 12]);
    expect(steps(byId.four_on_the_floor.clap)).toEqual([4, 12]);
    expect(steps(byId.four_on_the_floor.hat)).toEqual([2, 6, 10, 14]);
    expect(steps(byId.boom_bap.kick)).toEqual([0, 7, 10]);
    expect(steps(byId.boom_bap.snare)).toEqual([4, 12]);
    expect(steps(byId.boom_bap.hat)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(steps(byId.trap.kick)).toEqual([0, 6, 10]);
    expect(steps(byId.trap.snare)).toEqual([8]);
    expect(steps(byId.trap.hat)).toHaveLength(16);
    expect(steps(byId.breakbeat.kick)).toEqual([0, 10]);
    expect(steps(byId.breakbeat.openHat)).toEqual([14]);
    expect(steps(byId.half_time.kick)).toEqual([0, 10]);
    expect(steps(byId.half_time.snare)).toEqual([8]);
  });

  it("builds a default beat: straight, 0 dB, every block, fresh pattern", () => {
    const created = defaultBeat("trap", "808");
    expect(created).toMatchObject({ kit: "808", swing: 0, gainDb: 0, blocks: null });
    expect(defaultBeat("trap").kit).toBe("punchy");
    created.pattern.kick[1] = true;
    expect(BEAT_PRESETS[2].pattern.kick[1]).toBe(false);
  });

  it("recognizes the active preset and toggles steps", () => {
    const created = defaultBeat("boom_bap");
    expect(activeBeatPresetId(created)).toBe("boom_bap");
    const toggled = toggleBeatStep(created, "kick", 1);
    expect(toggled.pattern.kick[1]).toBe(true);
    expect(created.pattern.kick[1]).toBe(false);
    expect(activeBeatPresetId(toggled)).toBeNull();
    expect(toggleBeatStep(created, "kick", 16)).toBe(created);
  });

  it("needs a bar grid with a tempo", () => {
    expect(beatGridAvailable({ kind: "bars", bpm: 120 })).toBe(true);
    expect(beatGridAvailable({ kind: "bars", bpm: null })).toBe(false);
    expect(beatGridAvailable({ kind: "time", bpm: 120 })).toBe(false);
    expect(beatGridAvailable(null)).toBe(false);
  });
});

describe("beat timing and render", () => {
  it("anchors bars at each block start and drops hits past its end", () => {
    const short: RemixBeatSegment[] = [{ section: 0, outStartSec: 0, outEndSec: 3 }];
    const hits = beatHits(defaultBeat("four_on_the_floor"), { ...grid, sections: [grid.sections[0]] }, short);
    // 2 s bars: bar 1 complete, bar 2 cut at 3 s (kick 2, hat 2.25, clap+kick 2.5, hat 2.75).
    expect(hits.filter((hit) => hit.instrument === "kick").map((hit) => hit.timeSec)).toEqual([
      0, 0.5, 1, 1.5, 2, 2.5,
    ]);
    expect(hits.every((hit) => hit.timeSec < 3)).toBe(true);
  });

  it("swings odd sixteenths and skips blocks turned off", () => {
    const swung = beatHits(
      beat({ swing: 0.5, blocks: [false, true] }),
      grid,
      segments,
    );
    expect(swung[0].timeSec).toBe(16);
    const hats = swung.filter((hit) => hit.instrument === "hat");
    // Hats on even steps: unaffected by swing.
    expect(hats[0].timeSec).toBe(16.25);
    const offbeat = beatHits(
      beat({ pattern: { ...defaultBeat("trap").pattern }, swing: 0.5 }),
      grid,
      segments,
    ).filter((hit) => hit.instrument === "hat");
    // Step 1 (0.125 s) delayed by 0.5 × 0.125 / 2.
    expect(offbeat[1].timeSec).toBeCloseTo(0.125 + 0.03125, 9);
  });

  it("has no hits without a tempo", () => {
    expect(beatHits(beat(), { ...grid, bpm: null }, segments)).toEqual([]);
  });

  it("renders a track long enough for the last hit to ring out", () => {
    const kits: RemixBeatKitId[] = ["punchy", "808"];
    for (const kit of kits) {
      const track = renderBeatTrack(beat({ kit }), grid, segments, 8000);
      expect(track.length).toBe(
        beatTrackLength(kit, segments, 8000),
      );
      expect(track.length).toBe(32 * 8000 + (kit === "808" ? 1.4 : 0.9) * 8000);
      expect(track[0]).toBe(0); // kick starts at sin(0)
      expect(Math.abs(track[10])).toBeGreaterThan(0);
    }
  });

  it("keys the render by what shapes the audio (not the level)", () => {
    const key = beatRenderKey(beat(), grid, segments);
    expect(beatRenderKey(beat({ gainDb: -6 }), grid, segments)).toBe(key);
    expect(beatRenderKey(beat({ swing: 0.2 }), grid, segments)).not.toBe(key);
    expect(beatRenderKey(beat({ kit: "lofi" }), grid, segments)).not.toBe(key);
    expect(beatRenderKey(beat({ blocks: [true, false] }), grid, segments)).not.toBe(key);
    expect(beatRenderKey(beat(), grid, segments.slice(0, 1))).not.toBe(key);
  });
});

describe("beatBlocksAfterStructureEdit", () => {
  const structureGrid = {
    sections: grid.sections.concat([{ startSec: 32, endSec: 48 }]),
    durationSeconds: 48,
  };
  const state = structureEditState(structureGrid, null, { drums: [true, false, true] });

  it("repeats, removes and moves the beat's blocks like a stem mask", () => {
    const repeated = beatBlocksAfterStructureEdit(state, [false, true, true], (s) =>
      repeatBlock(s, 0, structureGrid),
    );
    expect(repeated?.blocks).toEqual([false, false, true, true]);
    expect(repeated?.result.masks).toEqual({ drums: [true, true, false, true] });
    expect(REMIX_BEAT_LANE_ID in (repeated?.result.masks ?? {})).toBe(false);

    const removed = beatBlocksAfterStructureEdit(state, [false, true, true], (s) =>
      removeBlock(s, 0),
    );
    expect(removed?.blocks).toBeNull(); // all on → null
    expect(removed?.result.masks.drums).toEqual([false, true]);

    const moved = beatBlocksAfterStructureEdit(state, [false, true, true], (s) =>
      moveBlock(s, 0, 1),
    );
    expect(moved?.blocks).toEqual([true, false, true]);
  });

  it("treats a null or stale beat mask as all on, and passes refusals", () => {
    const repeated = beatBlocksAfterStructureEdit(state, [false], (s) =>
      repeatBlock(s, 1, structureGrid),
    );
    expect(repeated?.blocks).toBeNull();
    expect(beatBlocksAfterStructureEdit(state, null, (s) => removeBlock(s, 9))).toBeNull();
    const reset = beatBlocksAfterStructureEdit(state, [true, false, true], (s) =>
      resetStructure(s, structureGrid),
    );
    expect(reset?.blocks).toEqual([true, false, true]);
  });
});

describe("beat mute (#1902)", () => {
  it("keeps muted only when true and leaves the render key alone", () => {
    expect(normalizeRemixBeat({ ...defaultBeat("trap"), muted: true })?.muted).toBe(true);
    for (const muted of [false, "yes", undefined]) {
      const normalized = normalizeRemixBeat({ ...defaultBeat("trap"), muted });
      expect(normalized).not.toHaveProperty("muted");
    }
    const muted = withBeatMuted(defaultBeat("trap"), true);
    expect(muted.muted).toBe(true);
    expect(withBeatMuted(muted, false)).toEqual(defaultBeat("trap"));
    expect(withBeatMuted(muted, false)).not.toHaveProperty("muted");
    expect(sameRemixBeat(muted, defaultBeat("trap"))).toBe(false);
    expect(beatRenderKey(muted, grid, segments)).toBe(
      beatRenderKey(defaultBeat("trap"), grid, segments),
    );
  });
});

describe("beatTimingAtSpeed: keep-pitch beat in output time (#1898)", () => {
  // The backend spec's grid (remix-stretch-render.spec.ts): a 6 s pickup,
  // three 16 s bars sections and a 4 s tail at 120 BPM.
  const GRID: RemixBeatGrid = {
    sectionSeconds: 16,
    bpm: 120,
    sections: [
      { startSec: 0, endSec: 6 },
      { startSec: 6, endSec: 22 },
      { startSec: 22, endSec: 38 },
      { startSec: 38, endSec: 54 },
      { startSec: 54, endSec: 58 },
    ],
  };
  const recipe: RemixBeatRecipe = {
    ...defaultBeat("four_on_the_floor"),
    kit: "punchy",
    pattern: {
      ...defaultBeat("four_on_the_floor").pattern,
      kick: Array.from({ length: 16 }, (_, step) => step % 4 === 0),
      snare: Array.from({ length: 16 }, () => false),
      clap: Array.from({ length: 16 }, () => false),
      hat: Array.from({ length: 16 }, (_, step) => step % 2 === 1),
      openHat: Array.from({ length: 16 }, () => false),
    },
    swing: 0.3,
    blocks: null,
  };
  const segments: RemixBeatSegment[] = structureTimeline(GRID, [
    { section: 0 },
    { section: 2 },
    { section: 1 },
  ]).segments;

  it("places every hit at its timeline time ÷ speed, pickup rule unchanged", () => {
    const speed = 0.85;
    const scaled = beatTimingAtSpeed(GRID, segments, speed);
    const original = beatHits(recipe, GRID, segments);
    const stretched = beatHits(recipe, scaled.grid, scaled.segments);
    expect(original.length).toBeGreaterThan(0);
    expect(stretched.map((hit) => hit.instrument)).toEqual(
      original.map((hit) => hit.instrument),
    );
    stretched.forEach((hit, index) => {
      expect(Math.abs(hit.timeSec - original[index].timeSec / speed)).toBeLessThan(2e-9);
    });
    // The 6 s pickup block (section 0) still gets no beat.
    expect(original[0].timeSec).toBeCloseTo(6, 9);
    expect(stretched[0].timeSec).toBeCloseTo(6 / speed, 9);
    expect(scaled.grid.bpm).toBeCloseTo(120 * speed, 12);
    expect(scaled.grid.sections).toBe(GRID.sections);
  });

  it("keeps the one-shots untouched: the track is the timeline ÷ speed plus the same decay room", () => {
    const speed = 1.25;
    const scaled = beatTimingAtSpeed(GRID, segments, speed);
    const plain = renderBeatTrack(recipe, GRID, segments, 48_000);
    const fast = renderBeatTrack(recipe, scaled.grid, scaled.segments, 48_000);
    const timeline = segments[segments.length - 1].outEndSec;
    const decay = plain.length - Math.ceil(timeline * 48_000);
    expect(fast.length).toBe(Math.ceil((timeline / speed) * 48_000) + decay);
    const start = Math.round((6 / speed) * 48_000);
    const plainStart = Math.round(6 * 48_000);
    for (let i = 0; i < 2000; i += 1) {
      expect(fast[start + i]).toBe(plain[plainStart + i]);
    }
  });

  it("is the identity at speed 1 (and for invalid speeds)", () => {
    const same = beatTimingAtSpeed(GRID, segments, 1);
    expect(same.grid).toBe(GRID);
    expect(same.segments).toBe(segments);
    expect(beatTimingAtSpeed(GRID, segments, 0).segments).toBe(segments);
    expect(beatTimingAtSpeed(GRID, segments, Number.NaN).grid).toBe(GRID);
  });

  it("keeps a missing tempo missing", () => {
    expect(beatTimingAtSpeed({ ...GRID, bpm: null }, segments, 0.9).grid.bpm).toBeNull();
  });
});
