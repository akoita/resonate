/**
 * Beat maker remix-beat/v1 (#1902) — pure unit tests.
 *
 * The parity block replays the committed fixture the web preview is also
 * tested against, so both engines synthesize the same one-shots, place the
 * same hits and render the same track samples (1e-9 at 48 kHz).
 */

import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { SectionGrid } from "../modules/remix/remix-arrangement";
import {
  BEAT_INSTRUMENTS,
  BEAT_KITS,
  BEAT_NEEDS_TEMPO_ERROR,
  BEAT_NOISE_SEEDS,
  beatHits,
  beatOneShot,
  isBeatPickupSection,
  normalizeRemixBeatInput,
  readStoredRemixBeat,
  REMIX_BEAT_DSP_VERSION,
  REMIX_BEAT_SCHEMA_VERSION,
  renderBeatTrack,
  writeBeatWav,
  type BeatInstrument,
  type BeatKitId,
  type BeatSegment,
  type RemixBeatDspRecipe,
} from "../modules/remix/remix-beat";
import { structureTimeline } from "../modules/remix/remix-structure";

type ParityFixture = {
  schemaVersion: string;
  sampleRate: number;
  instruments: string[];
  seeds: Record<string, number>;
  kits: unknown;
  oneShots: Record<
    string,
    Record<
      string,
      { length: number; first: number[]; at2400: number; peak: number }
    >
  >;
  scenario: {
    grid: SectionGrid;
    segments: BeatSegment[];
    recipe: RemixBeatDspRecipe & { schemaVersion: string; gainDb: number };
  };
  hits: Array<{ timeSec: number; instrument: BeatInstrument }>;
  track: { length: number; at: Record<string, number> };
};

const fixture: ParityFixture = JSON.parse(
  readFileSync(
    join(__dirname, "../modules/remix/remix-beat-v1.parity.json"),
    "utf8",
  ),
);

const EPS = 1e-9;
const r9 = (value: number) => Math.round(value * 1e9) / 1e9;

describe("remix-beat/v1 parity fixture (#1902)", () => {
  it("pins the schema, instruments, seeds and kits", () => {
    expect(fixture.schemaVersion).toBe(REMIX_BEAT_SCHEMA_VERSION);
    expect(fixture.sampleRate).toBe(48_000);
    expect(fixture.instruments).toEqual([...BEAT_INSTRUMENTS]);
    expect(fixture.seeds).toEqual(BEAT_NOISE_SEEDS);
    expect(fixture.kits).toEqual(BEAT_KITS);
  });

  describe.each(Object.keys(fixture.oneShots))("kit %s one-shots", (kit) => {
    it.each([...BEAT_INSTRUMENTS])("%s matches the fixture", (instrument) => {
      const expected = fixture.oneShots[kit][instrument];
      const shot = beatOneShot(kit as BeatKitId, instrument, fixture.sampleRate);
      expect(shot.length).toBe(expected.length);
      expected.first.forEach((value, index) => {
        expect(Math.abs(r9(shot[index]) - value)).toBeLessThanOrEqual(EPS);
      });
      expect(Math.abs(r9(shot[2400] ?? 0) - expected.at2400)).toBeLessThanOrEqual(EPS);
      let peak = 0;
      for (const value of shot) peak = Math.max(peak, Math.abs(value));
      expect(Math.abs(r9(peak) - expected.peak)).toBeLessThanOrEqual(EPS);
    });
  });

  it("places the same hits (pickup skipped, block off, swing)", () => {
    const { grid, segments, recipe } = fixture.scenario;
    const hits = beatHits(recipe, grid, segments);
    expect(hits).toHaveLength(fixture.hits.length);
    hits.forEach((hit, index) => {
      expect(hit.instrument).toBe(fixture.hits[index].instrument);
      expect(Math.abs(hit.timeSec - fixture.hits[index].timeSec)).toBeLessThanOrEqual(EPS);
    });
  });

  it("renders the same track samples", () => {
    const { grid, segments, recipe } = fixture.scenario;
    const track = renderBeatTrack(recipe, grid, segments, fixture.sampleRate);
    expect(track.length).toBe(fixture.track.length);
    for (const [index, value] of Object.entries(fixture.track.at)) {
      expect(Math.abs(r9(track[Number(index)]) - value)).toBeLessThanOrEqual(EPS);
    }
  });

  it("the fixture recipe normalizes (omitted rows are silent)", () => {
    const { grid, recipe } = fixture.scenario;
    const normalized = normalizeRemixBeatInput(recipe, 3, grid);
    expect("value" in normalized && normalized.value).toMatchObject({
      schemaVersion: REMIX_BEAT_SCHEMA_VERSION,
      kit: "punchy",
      swing: 0.3,
      gainDb: 0,
      blocks: [true, true, false],
    });
    const value = (normalized as { value: { pattern: Record<string, boolean[]> } }).value;
    expect(value.pattern.snare).toEqual(new Array(16).fill(false));
    expect(value.pattern.kick).toEqual(recipe.pattern.kick);
  });
});

describe("writeBeatWav (#1902)", () => {
  it("streams a mono 32-bit float 48 kHz WAV bit-identical to the track (as float32)", async () => {
    const { grid, segments, recipe } = fixture.scenario;
    const dir = mkdtempSync(join(tmpdir(), "remix-beat-spec-"));
    try {
      const path = join(dir, "beat.wav");
      const { frames } = await writeBeatWav(path, recipe, grid, segments);
      const track = renderBeatTrack(recipe, grid, segments, 48_000);
      expect(frames).toBe(track.length);
      const wav = readFileSync(path);
      expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
      expect(wav.readUInt16LE(20)).toBe(3); // IEEE float
      expect(wav.readUInt16LE(22)).toBe(1); // mono
      expect(wav.readUInt32LE(24)).toBe(48_000);
      expect(wav.readUInt16LE(34)).toBe(32);
      expect(wav.readUInt32LE(40)).toBe(track.length * 4);
      expect(wav.length).toBe(44 + track.length * 4);
      const expected = Float32Array.from(track);
      let mismatches = 0;
      for (let i = 0; i < track.length; i += 1) {
        if (wav.readFloatLE(44 + i * 4) !== expected[i]) mismatches += 1;
      }
      expect(mismatches).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const BAR_GRID: SectionGrid = {
  kind: "bars",
  bpm: 120,
  sectionSeconds: 16,
  durationSeconds: 38,
  sections: [
    { startSec: 0, endSec: 6 },
    { startSec: 6, endSec: 22 },
    { startSec: 22, endSec: 38 },
  ],
};
const row = (...steps: number[]) =>
  Array.from({ length: 16 }, (_, step) => steps.includes(step));
const KICK_ONLY: RemixBeatDspRecipe = {
  kit: "punchy",
  pattern: { kick: row(0, 8) },
};

describe("beatHits timing (#1902)", () => {
  it("skips pickup blocks; a pickup is only a short first section of a multi-section grid", () => {
    expect(isBeatPickupSection(BAR_GRID, 0)).toBe(true);
    expect(isBeatPickupSection(BAR_GRID, 1)).toBe(false);
    expect(
      isBeatPickupSection({ ...BAR_GRID, sections: [{ startSec: 0, endSec: 6 }] }, 0),
    ).toBe(false);
    expect(
      isBeatPickupSection(
        { ...BAR_GRID, sections: [{ startSec: 0, endSec: 12 }, { startSec: 12, endSec: 28 }] },
        0,
      ),
    ).toBe(false);
    const hits = beatHits(KICK_ONLY, BAR_GRID, structureTimeline(BAR_GRID, null));
    // Section 0 (6 s pickup) gets nothing; section 1 starts at 6 s.
    expect(hits[0]).toEqual({ timeSec: 6, instrument: "kick" });
    // A repeated pickup block is skipped wherever it lands.
    const repeated = structureTimeline(BAR_GRID, [{ section: 1 }, { section: 0 }]);
    expect(beatHits(KICK_ONLY, BAR_GRID, repeated).every((hit) => hit.timeSec < 16)).toBe(true);
  });

  it("anchors bars at each block's timeline start and drops blocks turned off", () => {
    const segments = structureTimeline(BAR_GRID, [
      { section: 1 },
      { section: 2 },
      { section: 1 },
    ]);
    const hits = beatHits(
      { ...KICK_ONLY, blocks: [true, false, true] },
      BAR_GRID,
      segments,
    );
    // Bar = 2 s at 120 bpm; kicks on steps 0 and 8 → every 1 s.
    expect(hits.map((hit) => hit.timeSec)).toEqual([
      ...Array.from({ length: 16 }, (_, k) => k),
      ...Array.from({ length: 16 }, (_, k) => 32 + k),
    ]);
  });

  it("delays odd sixteenths by swing × step / 2", () => {
    const segments = structureTimeline(BAR_GRID, [{ section: 1 }]);
    const hits = beatHits(
      { kit: "punchy", pattern: { hat: row(0, 1, 2, 3) }, swing: 0.5 },
      BAR_GRID,
      segments,
    ).slice(0, 4);
    // step = 0.125 s; odd steps + 0.5 × 0.125 / 2 = 0.03125 s.
    expect(hits.map((hit) => hit.timeSec)).toEqual([0, 0.15625, 0.25, 0.40625]);
  });

  it("truncates at a block's end, including a partial last bar and swing past the end", () => {
    // A 3.3 s block: bars at 0 and 2; the second bar keeps hits < 3.3 s.
    const grid: SectionGrid = {
      kind: "bars",
      bpm: 120,
      sectionSeconds: 16,
      durationSeconds: 3.3,
      sections: [{ startSec: 0, endSec: 3.3 }],
    };
    const segments = structureTimeline(grid, null);
    const hits = beatHits(
      { kit: "808", pattern: { kick: row(0, 4, 8, 12), snare: row(4, 12) } },
      grid,
      segments,
    );
    expect(hits.every((hit) => hit.timeSec < 3.3)).toBe(true);
    expect(hits.map((hit) => `${hit.timeSec}:${hit.instrument}`)).toEqual([
      "0:kick", "0.5:kick", "0.5:snare", "1:kick", "1.5:kick", "1.5:snare",
      "2:kick", "2.5:kick", "2.5:snare", "3:kick",
    ]);
    // A hit exactly at the end is dropped (block ends on a step boundary).
    const exact = structureTimeline(
      { ...grid, durationSeconds: 3, sections: [{ startSec: 0, endSec: 3 }] },
      null,
    );
    expect(
      beatHits({ kit: "808", pattern: { kick: row(0, 4, 8, 12) } }, grid, exact).at(-1),
    ).toEqual({ timeSec: 2.5, instrument: "kick" });
  });

  it("returns no hits without a tempo", () => {
    expect(
      beatHits(KICK_ONLY, { ...BAR_GRID, bpm: null }, structureTimeline(BAR_GRID, null)),
    ).toEqual([]);
  });

  it("an all-off pattern renders silence over the timeline", () => {
    const segments = structureTimeline(BAR_GRID, null);
    const track = renderBeatTrack(
      { kit: "lofi", pattern: {} },
      BAR_GRID,
      segments,
      8000,
    );
    expect(track.length).toBe(38 * 8000 + Math.round(0.9 * 8000));
    expect(track.every((value) => value === 0)).toBe(true);
  });
});

const PATTERN = {
  kick: row(0, 8),
  snare: row(4, 12),
  clap: row(),
  hat: row(0, 2, 4, 6, 8, 10, 12, 14),
  openHat: row(),
};

describe("normalizeRemixBeatInput (#1902)", () => {
  const normalize = (value: unknown, blockCount = 3) =>
    normalizeRemixBeatInput(value, blockCount, BAR_GRID);

  it("fills defaults, keeps an all-off pattern, and normalizes all-on blocks to null", () => {
    expect(normalize({ kit: "808", pattern: PATTERN })).toEqual({
      value: {
        schemaVersion: REMIX_BEAT_SCHEMA_VERSION,
        kit: "808",
        pattern: PATTERN,
        swing: 0,
        gainDb: 0,
        blocks: null,
      },
    });
    expect(
      normalize({ kit: "punchy", pattern: {}, blocks: [true, true, true] }),
    ).toMatchObject({ value: { blocks: null, pattern: { kick: row() } } });
    expect(
      normalize({
        schemaVersion: "remix-beat/v1",
        kit: "lofi",
        pattern: PATTERN,
        swing: 0.6,
        gainDb: -24,
        blocks: [false, true, false],
      }),
    ).toMatchObject({
      value: { swing: 0.6, gainDb: -24, blocks: [false, true, false] },
    });
    expect(normalize(null)).toEqual({ value: null });
  });

  it("rounds swing and gainDb to 2 decimals after the range check", () => {
    expect(
      normalize({ kit: "808", pattern: {}, swing: 0.333, gainDb: -3.456 }),
    ).toMatchObject({ value: { swing: 0.33, gainDb: -3.46 } });
    expect(
      normalize({ kit: "808", pattern: {}, swing: 0.004, gainDb: -0.001 }),
    ).toMatchObject({ value: { swing: 0, gainDb: 0 } });
    expect(normalize({ kit: "808", pattern: {}, swing: 0.604 })).toMatchObject({
      error: expect.stringMatching(/beat.swing/),
    });
  });

  it("keeps muted: true and omits muted: false", () => {
    const muted = normalize({ kit: "808", pattern: PATTERN, muted: true });
    expect(muted).toMatchObject({ value: { kit: "808", muted: true } });
    const unmuted = normalize({ kit: "808", pattern: PATTERN, muted: false });
    expect("value" in unmuted && unmuted.value && "muted" in unmuted.value).toBe(
      false,
    );
    expect(normalize({ kit: "808", pattern: PATTERN, muted: "yes" })).toEqual({
      error: "beat.muted must be a boolean",
    });
  });

  it.each([
    ["not an object", "four on the floor", /beat must be an object/],
    ["unknown key", { kit: "808", pattern: {}, tempo: 90 }, /beat.tempo is not supported/],
    ["foreign version", { schemaVersion: "remix-beat/v2", kit: "808", pattern: {} }, /schemaVersion/],
    ["unknown kit", { kit: "909", pattern: {} }, /beat.kit must be one of: punchy, 808, lofi/],
    ["missing pattern", { kit: "808" }, /beat.pattern must be an object/],
    ["unknown instrument", { kit: "808", pattern: { cowbell: row() } }, /beat.pattern.cowbell/],
    ["short row", { kit: "808", pattern: { kick: [true] } }, /16 booleans/],
    ["non-boolean step", { kit: "808", pattern: { kick: [...row(), 1].slice(1) } }, /16 booleans/],
    ["swing too high", { kit: "808", pattern: {}, swing: 0.61 }, /beat.swing/],
    ["negative swing", { kit: "808", pattern: {}, swing: -0.1 }, /beat.swing/],
    ["gain too high", { kit: "808", pattern: {}, gainDb: 7 }, /beat.gainDb/],
    ["gain not finite", { kit: "808", pattern: {}, gainDb: Number.NaN }, /beat.gainDb/],
    ["blocks not booleans", { kit: "808", pattern: {}, blocks: [1, 0, 1] }, /beat.blocks/],
    ["blocks length", { kit: "808", pattern: {}, blocks: [true, false] }, /exactly 3 entries/],
  ])("rejects %s", (_label, value, message) => {
    const result = normalize(value);
    expect("error" in result && result.error).toMatch(message);
  });

  it("needs a bar grid with a measured tempo", () => {
    const beat = { kit: "808", pattern: PATTERN };
    expect(normalizeRemixBeatInput(beat, 3, null)).toEqual({
      error: BEAT_NEEDS_TEMPO_ERROR,
    });
    expect(
      normalizeRemixBeatInput(beat, 3, { kind: "time", bpm: null }),
    ).toEqual({ error: BEAT_NEEDS_TEMPO_ERROR });
    // Clearing never needs a grid.
    expect(normalizeRemixBeatInput(null, 0, null)).toEqual({ value: null });
  });
});

describe("readStoredRemixBeat (#1902)", () => {
  const stored = {
    schemaVersion: "remix-beat/v1",
    kit: "808",
    pattern: PATTERN,
    swing: 0.2,
    gainDb: -3,
    blocks: [true, false, true],
  };

  it("reads a valid row and fails a stale blocks length open to all-on", () => {
    expect(readStoredRemixBeat(stored, 3)).toMatchObject({
      kit: "808",
      blocks: [true, false, true],
    });
    expect(readStoredRemixBeat(stored, 5)).toMatchObject({
      kit: "808",
      swing: 0.2,
      blocks: null,
    });
    // Lineage reads skip the length check.
    expect(readStoredRemixBeat(stored, null)?.blocks).toEqual([true, false, true]);
    expect(readStoredRemixBeat({ ...stored, muted: true }, 5)).toMatchObject({
      muted: true,
      blocks: null,
    });
  });

  it.each([
    ["null", null],
    ["no version", { ...stored, schemaVersion: undefined }],
    ["foreign version", { ...stored, schemaVersion: "remix-beat/v0" }],
    ["unknown kit", { ...stored, kit: "tr909" }],
    ["bad pattern", { ...stored, pattern: { kick: "x---x---" } }],
    ["array", [stored]],
  ])("reads a malformed row (%s) as null", (_label, value) => {
    expect(readStoredRemixBeat(value, 3)).toBeNull();
  });

  it("exposes the DSP version", () => {
    expect(REMIX_BEAT_DSP_VERSION).toBe("remix-beat-dsp/v1");
  });
});
