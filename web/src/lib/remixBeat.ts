import type { RemixSectionGrid } from "./api";
import {
  normalizeBlockMask,
  type RemixStructureEditResult,
  type RemixStructureEditState,
  type RemixStructureSegment,
} from "./remixStructure";

/**
 * Remix Studio beat maker `remix-beat/v1` (#1902): a code-synthesized drum
 * kit playing a 1-bar, 16-step (sixteenth-note, 4/4) pattern repeated across
 * the song. The pure math is shared by the WebAudio preview and (mirrored in
 * the backend) the ffmpeg render: both render the beat to one PCM track with
 * `renderBeatTrack` and play it as one extra source.
 *
 * The recipe is stored on the project (`RemixProject.beat`; null = no beat).
 * A beat needs a bar grid with a measured tempo. Bars are anchored at each
 * timeline block's start; a pickup block gets no beat and hits past a
 * block's end are dropped. Every DSP number below is guarded by the
 * committed parity fixture `backend/src/modules/remix/remix-beat-v1.parity.json`
 * (48 kHz): the preview and the render must reproduce it within 1e-9.
 */

export const REMIX_BEAT_SCHEMA_VERSION = "remix-beat/v1" as const;

/** Steps per bar (sixteenth notes in 4/4). */
export const REMIX_BEAT_STEPS = 16;

export const REMIX_BEAT_INSTRUMENTS = [
  "kick",
  "snare",
  "clap",
  "hat",
  "openHat",
] as const;
export type RemixBeatInstrument = (typeof REMIX_BEAT_INSTRUMENTS)[number];

export const REMIX_BEAT_KIT_IDS = ["punchy", "808", "lofi"] as const;
export type RemixBeatKitId = (typeof REMIX_BEAT_KIT_IDS)[number];

export type RemixBeatPattern = Record<RemixBeatInstrument, boolean[]>;

export type RemixBeatRecipe = {
  schemaVersion: typeof REMIX_BEAT_SCHEMA_VERSION;
  kit: RemixBeatKitId;
  pattern: RemixBeatPattern;
  /** Delay of odd sixteenths, as a share of half a step: 0..0.6. */
  swing: number;
  /** Beat level, −24..6 dB. */
  gainDb: number;
  /** Per-timeline-block on/off; null = on in every block. */
  blocks: boolean[] | null;
  /**
   * Muted beat: kept (and editable) but silent in the preview and skipped
   * by the render. Omitted when false.
   */
  muted?: true;
};

export const REMIX_BEAT_SWING_RANGE = { min: 0, max: 0.6 } as const;
export const REMIX_BEAT_GAIN_RANGE = { min: -24, max: 6 } as const;

/**
 * Preview reverb send of the beat: the stem send law with no stem space
 * (`reverbWet(0, master.space)` = 0.7 × master space).
 */
export const REMIX_BEAT_REVERB_SEND = 0.7;

/**
 * Solo id of the beat lane: never a project stem id, so soloing the beat
 * silences every stem and soloing a stem silences the beat.
 */
export const REMIX_BEAT_LANE_ID = "remix-beat";

/** Noise seeds (mulberry32), fixed so both engines hear the same hits. */
export const REMIX_BEAT_SEEDS = {
  snare: 3001,
  clap: 3002,
  hat: 3003,
  openHat: 3004,
} as const;

type KickParams = { f0: number; f1: number; tauF: number; tauA: number; dur: number };
type SnareParams = {
  bodyHz: number;
  bodyTau: number;
  noiseTau: number;
  hpHz: number;
  body: number;
  noise: number;
  dur: number;
};
type ClapParams = { hpHz: number; lpHz: number; tail: number; dur: number };
type HatParams = { hpHz: number; tau: number; level: number; dur: number };

export type RemixBeatKit = {
  gain: number;
  /** Extra one-pole low-pass on every one-shot (lo-fi); null = none. */
  lowpassHz: number | null;
  kick: KickParams;
  snare: SnareParams;
  clap: ClapParams;
  hat: HatParams;
  openHat: HatParams;
};

export const REMIX_BEAT_KITS: Record<RemixBeatKitId, RemixBeatKit> = {
  punchy: {
    gain: 0.8,
    lowpassHz: null,
    kick: { f0: 150, f1: 50, tauF: 0.04, tauA: 0.25, dur: 0.9 },
    snare: { bodyHz: 185, bodyTau: 0.08, noiseTau: 0.15, hpHz: 1200, body: 0.5, noise: 0.7, dur: 0.4 },
    clap: { hpHz: 800, lpHz: 4000, tail: 0.12, dur: 0.5 },
    hat: { hpHz: 7000, tau: 0.045, level: 0.6, dur: 0.2 },
    openHat: { hpHz: 7000, tau: 0.28, level: 0.5, dur: 0.7 },
  },
  "808": {
    gain: 0.8,
    lowpassHz: null,
    kick: { f0: 120, f1: 45, tauF: 0.06, tauA: 0.6, dur: 1.4 },
    snare: { bodyHz: 170, bodyTau: 0.1, noiseTau: 0.12, hpHz: 1500, body: 0.4, noise: 0.6, dur: 0.4 },
    clap: { hpHz: 900, lpHz: 3500, tail: 0.15, dur: 0.55 },
    hat: { hpHz: 8000, tau: 0.035, level: 0.55, dur: 0.2 },
    openHat: { hpHz: 8000, tau: 0.35, level: 0.45, dur: 0.8 },
  },
  lofi: {
    gain: 0.8,
    lowpassHz: 5000,
    kick: { f0: 110, f1: 52, tauF: 0.05, tauA: 0.3, dur: 0.9 },
    snare: { bodyHz: 190, bodyTau: 0.07, noiseTau: 0.13, hpHz: 1000, body: 0.55, noise: 0.55, dur: 0.4 },
    clap: { hpHz: 700, lpHz: 3000, tail: 0.1, dur: 0.5 },
    hat: { hpHz: 6000, tau: 0.04, level: 0.45, dur: 0.2 },
    openHat: { hpHz: 6000, tau: 0.25, level: 0.4, dur: 0.7 },
  },
};

/** Plain names for the UI. */
export const REMIX_BEAT_KIT_LABELS: Record<RemixBeatKitId, string> = {
  punchy: "Punchy",
  "808": "808",
  lofi: "Lo-fi",
};

export const REMIX_BEAT_INSTRUMENT_LABELS: Record<RemixBeatInstrument, string> = {
  kick: "Kick",
  snare: "Snare",
  clap: "Clap",
  hat: "Hat",
  openHat: "Open hat",
};

// ---------------------------------------------------------------------------
// Normalization.

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

function clampRounded(
  raw: unknown,
  range: { min: number; max: number },
  fallback: number,
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return round2(Math.min(range.max, Math.max(range.min, raw)));
}

/** An empty 16-step row. */
export function emptyBeatRow(): boolean[] {
  return new Array<boolean>(REMIX_BEAT_STEPS).fill(false);
}

/** An empty pattern (every row off). */
export function emptyBeatPattern(): RemixBeatPattern {
  return {
    kick: emptyBeatRow(),
    snare: emptyBeatRow(),
    clap: emptyBeatRow(),
    hat: emptyBeatRow(),
    openHat: emptyBeatRow(),
  };
}

function isKitId(value: unknown): value is RemixBeatKitId {
  return (
    typeof value === "string" &&
    (REMIX_BEAT_KIT_IDS as readonly string[]).includes(value)
  );
}

/**
 * Normalize a stored or edited beat. The client clamps and nulls where the
 * backend rejects: not an object, another schema version, an unknown kit or
 * a pattern row that is not 16 booleans → null. A missing row is all off;
 * swing clamps to 0..0.6 and gain to −24..6 dB (2 decimals; non-numbers → 0).
 * `blocks` against `blockCount` blocks (when given): null when absent,
 * stale (another length) or all on. `muted` is kept only when true. Every
 * other key is always present.
 */
export function normalizeRemixBeat(
  value: unknown,
  blockCount?: number | null,
): RemixBeatRecipe | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== undefined &&
    raw.schemaVersion !== REMIX_BEAT_SCHEMA_VERSION
  ) {
    return null;
  }
  if (!isKitId(raw.kit)) return null;
  const rawPattern = raw.pattern;
  if (
    rawPattern !== undefined &&
    (!rawPattern || typeof rawPattern !== "object" || Array.isArray(rawPattern))
  ) {
    return null;
  }
  const patternSource = (rawPattern ?? {}) as Record<string, unknown>;
  const pattern = emptyBeatPattern();
  for (const instrument of REMIX_BEAT_INSTRUMENTS) {
    const row = patternSource[instrument];
    if (row === undefined) continue;
    if (!Array.isArray(row) || row.length !== REMIX_BEAT_STEPS) return null;
    if (!row.every((step) => typeof step === "boolean")) return null;
    pattern[instrument] = row.map((step) => step === true);
  }
  let blocks: boolean[] | null = null;
  if (Array.isArray(raw.blocks)) {
    const flags = raw.blocks as unknown[];
    if (typeof blockCount === "number") {
      blocks = normalizeBlockMask(
        flags.map((flag) => flag === true),
        blockCount,
      );
    } else if (flags.length > 0 && !flags.every((flag) => flag === true)) {
      blocks = flags.map((flag) => flag === true);
    }
  }
  return {
    schemaVersion: REMIX_BEAT_SCHEMA_VERSION,
    kit: raw.kit,
    pattern,
    swing: clampRounded(raw.swing, REMIX_BEAT_SWING_RANGE, 0),
    gainDb: clampRounded(raw.gainDb, REMIX_BEAT_GAIN_RANGE, 0),
    blocks,
    ...(raw.muted === true ? { muted: true as const } : {}),
  };
}

/** The beat muted or unmuted (`muted` omitted when false). */
export function withBeatMuted(
  beat: RemixBeatRecipe,
  muted: boolean,
): RemixBeatRecipe {
  const next: RemixBeatRecipe = { ...beat };
  delete next.muted;
  return muted ? { ...next, muted: true } : next;
}

/** Structural equality of two beats after normalization. */
export function sameRemixBeat(
  left: unknown,
  right: unknown,
  blockCount?: number | null,
): boolean {
  return (
    JSON.stringify(normalizeRemixBeat(left, blockCount)) ===
    JSON.stringify(normalizeRemixBeat(right, blockCount))
  );
}

/** A beat needs a bar grid with a measured tempo. */
export function beatGridAvailable(
  grid: Pick<RemixSectionGrid, "kind" | "bpm"> | null | undefined,
): boolean {
  return (
    !!grid &&
    grid.kind === "bars" &&
    typeof grid.bpm === "number" &&
    Number.isFinite(grid.bpm) &&
    grid.bpm > 0
  );
}

// ---------------------------------------------------------------------------
// Presets.

export type RemixBeatPresetId =
  | "four_on_the_floor"
  | "boom_bap"
  | "trap"
  | "breakbeat"
  | "half_time";

function row(steps: readonly number[]): boolean[] {
  const out = emptyBeatRow();
  for (const step of steps) out[step] = true;
  return out;
}

const EVERY_2 = [0, 2, 4, 6, 8, 10, 12, 14];
const EVERY_1 = Array.from({ length: REMIX_BEAT_STEPS }, (_, step) => step);

export const BEAT_PRESETS: readonly {
  id: RemixBeatPresetId;
  label: string;
  description: string;
  pattern: RemixBeatPattern;
}[] = [
  {
    id: "four_on_the_floor",
    label: "Four on the floor",
    description: "A kick on every beat — dance and house",
    pattern: {
      kick: row([0, 4, 8, 12]),
      snare: row([]),
      clap: row([4, 12]),
      hat: row([2, 6, 10, 14]),
      openHat: row([]),
    },
  },
  {
    id: "boom_bap",
    label: "Boom bap",
    description: "Laid-back hip-hop groove",
    pattern: {
      kick: row([0, 7, 10]),
      snare: row([4, 12]),
      clap: row([]),
      hat: row(EVERY_2),
      openHat: row([]),
    },
  },
  {
    id: "trap",
    label: "Trap",
    description: "Sparse kicks, rolling hats",
    pattern: {
      kick: row([0, 6, 10]),
      snare: row([8]),
      clap: row([]),
      hat: row(EVERY_1),
      openHat: row([]),
    },
  },
  {
    id: "breakbeat",
    label: "Breakbeat",
    description: "Broken, funky drums",
    pattern: {
      kick: row([0, 10]),
      snare: row([4, 12]),
      clap: row([]),
      hat: row(EVERY_2),
      openHat: row([14]),
    },
  },
  {
    id: "half_time",
    label: "Half-time",
    description: "Heavy and slow-feeling",
    pattern: {
      kick: row([0, 10]),
      snare: row([8]),
      clap: row([]),
      hat: row(EVERY_2),
      openHat: row([]),
    },
  },
];

function copyPattern(pattern: RemixBeatPattern): RemixBeatPattern {
  return {
    kick: [...pattern.kick],
    snare: [...pattern.snare],
    clap: [...pattern.clap],
    hat: [...pattern.hat],
    openHat: [...pattern.openHat],
  };
}

/** A preset's pattern (a fresh copy); an empty pattern for an unknown id. */
export function beatPresetPattern(presetId: RemixBeatPresetId): RemixBeatPattern {
  const preset = BEAT_PRESETS.find((entry) => entry.id === presetId);
  return preset ? copyPattern(preset.pattern) : emptyBeatPattern();
}

/** A new beat: the preset's pattern, straight, at 0 dB, on in every block. */
export function defaultBeat(
  presetId: RemixBeatPresetId,
  kit: RemixBeatKitId = "punchy",
): RemixBeatRecipe {
  return {
    schemaVersion: REMIX_BEAT_SCHEMA_VERSION,
    kit,
    pattern: beatPresetPattern(presetId),
    swing: 0,
    gainDb: 0,
    blocks: null,
  };
}

/** The preset whose pattern the beat plays exactly, else null. */
export function activeBeatPresetId(
  beat: Pick<RemixBeatRecipe, "pattern"> | null | undefined,
): RemixBeatPresetId | null {
  if (!beat) return null;
  const sameRow = (left: boolean[] | undefined, right: boolean[]) =>
    !!left &&
    left.length === right.length &&
    left.every((step, index) => step === right[index]);
  return (
    BEAT_PRESETS.find((preset) =>
      REMIX_BEAT_INSTRUMENTS.every((instrument) =>
        sameRow(beat.pattern[instrument], preset.pattern[instrument]),
      ),
    )?.id ?? null
  );
}

/** The beat with one step toggled. */
export function toggleBeatStep(
  beat: RemixBeatRecipe,
  instrument: RemixBeatInstrument,
  step: number,
): RemixBeatRecipe {
  if (!Number.isInteger(step) || step < 0 || step >= REMIX_BEAT_STEPS) return beat;
  const pattern = copyPattern(beat.pattern);
  pattern[instrument][step] = !pattern[instrument][step];
  return { ...beat, pattern };
}

// ---------------------------------------------------------------------------
// Structure edits (#1899): the beat's `blocks` move with their blocks.

/**
 * Run a structure edit op with the beat's per-block on/off riding along as
 * one more mask (so it repeats, drops and moves exactly like a stem mask).
 * Returns the op's result without the beat's mask, plus the remapped (and
 * normalized) beat blocks; null when the op refuses.
 */
export function beatBlocksAfterStructureEdit(
  state: RemixStructureEditState,
  beatBlocks: boolean[] | null | undefined,
  run: (state: RemixStructureEditState) => RemixStructureEditResult | null,
): { result: RemixStructureEditResult; blocks: boolean[] | null } | null {
  const withBeat: RemixStructureEditState = {
    ...state,
    masks: {
      ...state.masks,
      [REMIX_BEAT_LANE_ID]: normalizeBlockMask(beatBlocks, state.blocks.length),
    },
  };
  const result = run(withBeat);
  if (!result) return null;
  const { [REMIX_BEAT_LANE_ID]: blocks = null, ...masks } = result.masks;
  return { result: { ...result, masks }, blocks };
}

// ---------------------------------------------------------------------------
// Synthesis.

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One-pole high-pass coefficient a = RC/(RC + dt). */
function highpassCoefficient(cutoffHz: number, sampleRate: number): number {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  return rc / (rc + dt);
}

/** One-pole low-pass coefficient b = dt/(RC + dt). */
function lowpassCoefficient(cutoffHz: number, sampleRate: number): number {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  return dt / (rc + dt);
}

function highpass(x: Float64Array, cutoffHz: number, sampleRate: number): Float64Array {
  const a = highpassCoefficient(cutoffHz, sampleRate);
  const y = new Float64Array(x.length);
  let previousY = 0;
  let previousX = 0;
  for (let i = 0; i < x.length; i += 1) {
    previousY = a * (previousY + x[i] - previousX);
    previousX = x[i];
    y[i] = previousY;
  }
  return y;
}

function lowpass(x: Float64Array, cutoffHz: number, sampleRate: number): Float64Array {
  const b = lowpassCoefficient(cutoffHz, sampleRate);
  const y = new Float64Array(x.length);
  let previousY = 0;
  for (let i = 0; i < x.length; i += 1) {
    previousY = previousY + b * (x[i] - previousY);
    y[i] = previousY;
  }
  return y;
}

function noise(length: number, seed: number): Float64Array {
  const random = mulberry32(seed);
  const out = new Float64Array(length);
  for (let i = 0; i < length; i += 1) out[i] = random() * 2 - 1;
  return out;
}

const CLAP_BURST_OFFSETS = [0, 0.012, 0.024] as const;
const CLAP_BURST_TAU = 0.006;
const CLAP_TAIL_LEVEL = 0.6;

/**
 * One drum hit of a kit at `sampleRate` (Float64, kit gain applied):
 * - kick: a sine whose pitch drops exponentially f1 + (f0 − f1)·e^(−t/τF),
 *   with an exponential amplitude decay e^(−t/τA);
 * - snare: a decaying sine body plus high-passed seeded noise;
 * - clap: band-limited noise (one-pole high- then low-pass) under three
 *   6 ms bursts at 0/12/24 ms plus a 0.6-level tail from 24 ms;
 * - hats: noise through a two-stage one-pole high-pass, decaying.
 * The lo-fi kit low-passes every one-shot once more.
 */
export function beatOneShot(
  kitId: RemixBeatKitId,
  instrument: RemixBeatInstrument,
  sampleRate: number,
): Float64Array {
  const kit = REMIX_BEAT_KITS[kitId];
  let y: Float64Array;
  if (instrument === "kick") {
    const p = kit.kick;
    const n = Math.round(p.dur * sampleRate);
    y = new Float64Array(n);
    let phase = 0;
    for (let i = 0; i < n; i += 1) {
      const t = i / sampleRate;
      const f = p.f1 + (p.f0 - p.f1) * Math.exp(-t / p.tauF);
      y[i] = Math.sin(phase) * Math.exp(-t / p.tauA);
      phase += (2 * Math.PI * f) / sampleRate;
    }
  } else if (instrument === "snare") {
    const p = kit.snare;
    const n = Math.round(p.dur * sampleRate);
    y = new Float64Array(n);
    const nz = highpass(noise(n, REMIX_BEAT_SEEDS.snare), p.hpHz, sampleRate);
    for (let i = 0; i < n; i += 1) {
      const t = i / sampleRate;
      y[i] =
        p.body * Math.sin(2 * Math.PI * p.bodyHz * t) * Math.exp(-t / p.bodyTau) +
        p.noise * nz[i] * Math.exp(-t / p.noiseTau);
    }
  } else if (instrument === "clap") {
    const p = kit.clap;
    const n = Math.round(p.dur * sampleRate);
    y = new Float64Array(n);
    const nz = lowpass(
      highpass(noise(n, REMIX_BEAT_SEEDS.clap), p.hpHz, sampleRate),
      p.lpHz,
      sampleRate,
    );
    const tailStart = CLAP_BURST_OFFSETS[CLAP_BURST_OFFSETS.length - 1];
    for (let i = 0; i < n; i += 1) {
      const t = i / sampleRate;
      let envelope = 0;
      for (const offset of CLAP_BURST_OFFSETS) {
        if (t >= offset) envelope += Math.exp(-(t - offset) / CLAP_BURST_TAU);
      }
      if (t >= tailStart) {
        envelope += CLAP_TAIL_LEVEL * Math.exp(-(t - tailStart) / p.tail);
      }
      y[i] = nz[i] * envelope;
    }
  } else {
    const p = kit[instrument];
    const n = Math.round(p.dur * sampleRate);
    y = new Float64Array(n);
    const nz = highpass(
      highpass(noise(n, REMIX_BEAT_SEEDS[instrument]), p.hpHz, sampleRate),
      p.hpHz,
      sampleRate,
    );
    for (let i = 0; i < n; i += 1) {
      const t = i / sampleRate;
      y[i] = p.level * nz[i] * Math.exp(-t / p.tau);
    }
  }
  if (kit.lowpassHz) y = lowpass(y, kit.lowpassHz, sampleRate);
  for (let i = 0; i < y.length; i += 1) y[i] *= kit.gain;
  return y;
}

// ---------------------------------------------------------------------------
// Timing.

/** The grid fields the beat timing reads. */
export type RemixBeatGrid = Pick<RemixSectionGrid, "sections" | "sectionSeconds"> & {
  bpm: number | null;
};

/** The segment fields the beat timing reads (timeline blocks, in order). */
export type RemixBeatSegment = Pick<
  RemixStructureSegment,
  "section" | "outStartSec" | "outEndSec"
>;

export type RemixBeatHit = { timeSec: number; instrument: RemixBeatInstrument };

const round9 = (value: number) => Math.round(value * 1e9) / 1e9;

function isPickupSection(grid: RemixBeatGrid, section: number): boolean {
  const first = grid.sections[0];
  return (
    section === 0 &&
    grid.sections.length > 1 &&
    !!first &&
    first.endSec - first.startSec < 0.75 * grid.sectionSeconds
  );
}

/**
 * Hit times on the output timeline (seconds, rounded to 1e-9), sorted by
 * time then instrument order. Bars (240/bpm s) start at each block's
 * timeline start and repeat while they start inside the block; a hit at or
 * past the block's end is dropped. Blocks turned off in `recipe.blocks`
 * (by index) and pickup blocks get no hits. Swing delays odd sixteenths by
 * swing × step / 2. No tempo → no hits.
 */
export function beatHits(
  recipe: Pick<RemixBeatRecipe, "pattern" | "swing" | "blocks">,
  grid: RemixBeatGrid,
  segments: readonly RemixBeatSegment[],
): RemixBeatHit[] {
  const bpm = grid.bpm;
  if (typeof bpm !== "number" || !Number.isFinite(bpm) || bpm <= 0) return [];
  const barSec = 240 / bpm;
  const stepSec = barSec / REMIX_BEAT_STEPS;
  const swing = recipe.swing ?? 0;
  const out: RemixBeatHit[] = [];
  segments.forEach((segment, blockIndex) => {
    if (recipe.blocks && recipe.blocks[blockIndex] === false) return;
    if (isPickupSection(grid, segment.section)) return;
    for (let bar = 0; ; bar += 1) {
      const barStart = segment.outStartSec + bar * barSec;
      if (barStart >= segment.outEndSec - 1e-9) break;
      for (let step = 0; step < REMIX_BEAT_STEPS; step += 1) {
        for (const instrument of REMIX_BEAT_INSTRUMENTS) {
          if (!recipe.pattern[instrument]?.[step]) continue;
          const t =
            barStart +
            step * stepSec +
            (step % 2 === 1 ? swing * stepSec * 0.5 : 0);
          if (t < segment.outEndSec - 1e-9) {
            out.push({ timeSec: round9(t), instrument });
          }
        }
      }
    }
  });
  const order = (instrument: RemixBeatInstrument) =>
    REMIX_BEAT_INSTRUMENTS.indexOf(instrument);
  return out.sort(
    (a, b) => a.timeSec - b.timeSec || order(a.instrument) - order(b.instrument),
  );
}

// ---------------------------------------------------------------------------
// Rendering.

/**
 * Samples in a rendered beat track: the timeline (last block's end) plus
 * the kit's longest one-shot, so the last hit rings out.
 */
export function beatTrackLength(
  kitId: RemixBeatKitId,
  segments: readonly RemixBeatSegment[],
  sampleRate: number,
): number {
  const durationSec =
    segments.length > 0 ? segments[segments.length - 1].outEndSec : 0;
  const kit = REMIX_BEAT_KITS[kitId];
  const longest = Math.max(
    ...REMIX_BEAT_INSTRUMENTS.map((instrument) =>
      Math.round(kit[instrument].dur * sampleRate),
    ),
  );
  return Math.ceil(durationSec * sampleRate) + longest;
}

/**
 * Mix every hit's one-shot into `target` (zeroed, at least
 * `beatTrackLength` long) at round(time × rate); returns `target`. Float64
 * targets match the parity fixture exactly; the preview renders into the
 * Float32 channel of an AudioBuffer.
 */
export function renderBeatInto<T extends Float32Array | Float64Array>(
  target: T,
  recipe: RemixBeatRecipe,
  grid: RemixBeatGrid,
  segments: readonly RemixBeatSegment[],
  sampleRate: number,
): T {
  const shots = new Map<RemixBeatInstrument, Float64Array>();
  for (const hit of beatHits(recipe, grid, segments)) {
    let shot = shots.get(hit.instrument);
    if (!shot) {
      shot = beatOneShot(recipe.kit, hit.instrument, sampleRate);
      shots.set(hit.instrument, shot);
    }
    const start = Math.round(hit.timeSec * sampleRate);
    const end = Math.min(shot.length, target.length - start);
    for (let i = 0; i < end; i += 1) target[start + i] += shot[i];
  }
  return target;
}

/**
 * The beat as one mono PCM track on the output timeline (the sum of the
 * one-shots at the hit times), `beatTrackLength` samples long.
 */
export function renderBeatTrack(
  recipe: RemixBeatRecipe,
  grid: RemixBeatGrid,
  segments: readonly RemixBeatSegment[],
  sampleRate: number,
): Float32Array {
  return renderBeatInto(
    new Float32Array(beatTrackLength(recipe.kit, segments, sampleRate)),
    recipe,
    grid,
    segments,
    sampleRate,
  );
}

/**
 * Signature of everything that shapes the rendered track (not the level):
 * equal keys render identical audio, so a built buffer can be reused.
 */
export function beatRenderKey(
  recipe: RemixBeatRecipe,
  grid: RemixBeatGrid,
  segments: readonly RemixBeatSegment[],
): string {
  return JSON.stringify([
    recipe.kit,
    REMIX_BEAT_INSTRUMENTS.map((instrument) =>
      (recipe.pattern[instrument] ?? []).map((step) => (step ? 1 : 0)).join(""),
    ),
    recipe.swing,
    recipe.blocks,
    grid.bpm,
    grid.sectionSeconds,
    grid.sections.map((section) => [section.startSec, section.endSec]),
    segments.map((segment) => [
      segment.section,
      segment.outStartSec,
      segment.outEndSec,
    ]),
  ]);
}
