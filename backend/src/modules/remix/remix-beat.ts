/**
 * Remix Studio beat maker, recipe `remix-beat/v1` (#1902).
 *
 * A code-synthesized drum kit (no samples, no licensing): 5 instruments,
 * 3 kits, a 1-bar 16-step (sixteenth-note) pattern in 4/4 repeated across the
 * song, swing, a level and a per-block on/off list. The recipe persists on
 * `RemixProject.beat`; `null` means no beat.
 *
 * Both engines render the beat with the math below: the server ffmpeg render
 * (stem-audio-mixer.ts) writes it as one extra 48 kHz input over the
 * (structured) timeline, the browser preview as one extra buffer source. The
 * committed parity fixture `remix-beat-v1.parity.json` pins the one-shots,
 * the hit list and track samples (within 1e-9). Changing any rule requires a
 * new {@link REMIX_BEAT_DSP_VERSION} so older drafts stay auditable.
 *
 * A synthesized beat is neither AI nor source audio: it never changes a
 * render's grounding, costs nothing, and never interpolates user strings into
 * a graph.
 */

import { open } from "fs/promises";
import type { SectionGrid } from "./remix-arrangement";
import type { RemixStructureSegment } from "./remix-structure";

export const REMIX_BEAT_SCHEMA_VERSION = "remix-beat/v1";
/** Version of the synthesis + timing rules below, recorded with every render. */
export const REMIX_BEAT_DSP_VERSION = "remix-beat-dsp/v1";
/** The render's beat track rate (the preview uses its context rate). */
export const REMIX_BEAT_RENDER_SAMPLE_RATE = 48_000;
export const BEAT_STEPS = 16;
export const BEAT_SWING_MAX = 0.6;
export const BEAT_GAIN_DB_MIN = -24;
export const BEAT_GAIN_DB_MAX = 6;

/** PATCH reason when the source has no bar grid (no measured tempo). */
export const BEAT_NEEDS_TEMPO_ERROR =
  "A beat needs the song's measured tempo, and this source doesn't have one yet.";

export const BEAT_INSTRUMENTS = [
  "kick",
  "snare",
  "clap",
  "hat",
  "openHat",
] as const;
export type BeatInstrument = (typeof BEAT_INSTRUMENTS)[number];

export type BeatKitId = "punchy" | "808" | "lofi";

export type BeatKickParams = {
  f0: number;
  f1: number;
  tauF: number;
  tauA: number;
  dur: number;
};
export type BeatSnareParams = {
  bodyHz: number;
  bodyTau: number;
  noiseTau: number;
  hpHz: number;
  body: number;
  noise: number;
  dur: number;
};
export type BeatClapParams = {
  hpHz: number;
  lpHz: number;
  tail: number;
  dur: number;
};
export type BeatHatParams = {
  hpHz: number;
  tau: number;
  level: number;
  dur: number;
};

export type BeatKit = {
  gain: number;
  /** Extra one-pole low-pass over every one-shot (lo-fi); null = none. */
  lowpassHz: number | null;
  kick: BeatKickParams;
  snare: BeatSnareParams;
  clap: BeatClapParams;
  hat: BeatHatParams;
  openHat: BeatHatParams;
};

/** Fixed mulberry32 seeds of the noise-based instruments. */
export const BEAT_NOISE_SEEDS = Object.freeze({
  snare: 3001,
  clap: 3002,
  hat: 3003,
  openHat: 3004,
});

export const BEAT_KITS: Readonly<Record<BeatKitId, BeatKit>> = Object.freeze({
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
});

/** Picker order (explicit: "808" is an integer-like key and sorts first). */
export const BEAT_KIT_IDS: readonly BeatKitId[] = ["punchy", "808", "lofi"];

export type RemixBeatPattern = Record<BeatInstrument, boolean[]>;

export type RemixBeat = {
  schemaVersion: typeof REMIX_BEAT_SCHEMA_VERSION;
  kit: BeatKitId;
  /** One 16-step row per instrument (sixteenth notes of one 4/4 bar). */
  pattern: RemixBeatPattern;
  /** Delays odd sixteenths by swing × step / 2; 0..0.6. */
  swing: number;
  /** Beat level in dB, −24..6. */
  gainDb: number;
  /** Per-timeline-block on/off; null = on in every block. */
  blocks: boolean[] | null;
  /**
   * Beat lane muted (omitted when false): the recipe is kept but the render
   * skips the beat entirely — no input, no `addedParts`.
   */
  muted?: true;
};

/** What the DSP reads from a recipe (a pattern may omit silent rows). */
export type RemixBeatDspRecipe = {
  kit: BeatKitId;
  pattern: Partial<RemixBeatPattern>;
  swing?: number;
  blocks?: boolean[] | null;
};

/** The grid fields the beat timing reads (a bar grid with a tempo). */
export type BeatGrid = Pick<SectionGrid, "sections" | "sectionSeconds"> & {
  bpm: number | null;
};

/** The timeline fields the beat timing reads. */
export type BeatSegment = Pick<
  RemixStructureSegment,
  "section" | "outStartSec" | "outEndSec"
>;

/**
 * Render-time beat context: the recipe, its bar grid and the timeline. Never
 * built for a muted beat.
 */
export type RemixRenderBeat = {
  beat: RemixBeat;
  grid: SectionGrid;
  segments: RemixStructureSegment[];
};

export type BeatHit = { timeSec: number; instrument: BeatInstrument };

// --- Normalisation -----------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value)
  );
}

const BEAT_KEYS = [
  "schemaVersion",
  "kit",
  "pattern",
  "swing",
  "gainDb",
  "blocks",
  "muted",
];

/** Round to 2 decimals (like the web client); −0 collapses to 0. */
function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Shape validation shared by the PATCH and the tolerant read.
 * `blockCount` null skips the blocks-length check.
 */
function normalizeBeatShape(
  value: Record<string, unknown>,
  blockCount: number | null,
): { value: RemixBeat } | { error: string } {
  for (const key of Object.keys(value)) {
    if (!BEAT_KEYS.includes(key)) {
      return {
        error: `beat.${key} is not supported (allowed: ${BEAT_KEYS.join(", ")})`,
      };
    }
  }
  if (
    value.schemaVersion !== undefined &&
    value.schemaVersion !== REMIX_BEAT_SCHEMA_VERSION
  ) {
    return { error: `beat.schemaVersion must be "${REMIX_BEAT_SCHEMA_VERSION}"` };
  }
  const kit = value.kit;
  if (typeof kit !== "string" || !BEAT_KIT_IDS.includes(kit as BeatKitId)) {
    return { error: `beat.kit must be one of: ${BEAT_KIT_IDS.join(", ")}` };
  }

  if (!isPlainObject(value.pattern)) {
    return { error: "beat.pattern must be an object of 16-step rows" };
  }
  const rawPattern = value.pattern;
  for (const key of Object.keys(rawPattern)) {
    if (!(BEAT_INSTRUMENTS as readonly string[]).includes(key)) {
      return {
        error: `beat.pattern.${key} is not an instrument (allowed: ${BEAT_INSTRUMENTS.join(", ")})`,
      };
    }
  }
  const pattern = {} as RemixBeatPattern;
  for (const instrument of BEAT_INSTRUMENTS) {
    const row = rawPattern[instrument];
    if (row === undefined) {
      // An omitted row is silent.
      pattern[instrument] = new Array<boolean>(BEAT_STEPS).fill(false);
      continue;
    }
    if (
      !Array.isArray(row) ||
      row.length !== BEAT_STEPS ||
      !row.every((step) => typeof step === "boolean")
    ) {
      return {
        error: `beat.pattern.${instrument} must be ${BEAT_STEPS} booleans`,
      };
    }
    pattern[instrument] = [...(row as boolean[])];
  }

  let swing = 0;
  if (value.swing !== undefined) {
    if (
      typeof value.swing !== "number" ||
      !Number.isFinite(value.swing) ||
      value.swing < 0 ||
      value.swing > BEAT_SWING_MAX
    ) {
      return { error: `beat.swing must be a number between 0 and ${BEAT_SWING_MAX}` };
    }
    swing = round2(value.swing);
  }

  let gainDb = 0;
  if (value.gainDb !== undefined) {
    if (
      typeof value.gainDb !== "number" ||
      !Number.isFinite(value.gainDb) ||
      value.gainDb < BEAT_GAIN_DB_MIN ||
      value.gainDb > BEAT_GAIN_DB_MAX
    ) {
      return {
        error: `beat.gainDb must be a number between ${BEAT_GAIN_DB_MIN} and ${BEAT_GAIN_DB_MAX}`,
      };
    }
    gainDb = round2(value.gainDb);
  }

  let blocks: boolean[] | null = null;
  if (value.blocks !== undefined && value.blocks !== null) {
    const raw = value.blocks;
    if (!Array.isArray(raw) || !raw.every((flag) => typeof flag === "boolean")) {
      return { error: "beat.blocks must be null or an array of booleans" };
    }
    if (blockCount !== null && raw.length !== blockCount) {
      return {
        error: `beat.blocks must have exactly ${blockCount} entries (one per block)`,
      };
    }
    if (raw.length === 0) {
      return { error: "beat.blocks must be null or a non-empty array of booleans" };
    }
    // Every block on is the default.
    blocks = raw.every(Boolean) ? null : [...(raw as boolean[])];
  }

  if (value.muted !== undefined && typeof value.muted !== "boolean") {
    return { error: "beat.muted must be a boolean" };
  }

  return {
    value: {
      schemaVersion: REMIX_BEAT_SCHEMA_VERSION,
      kit: kit as BeatKitId,
      pattern,
      swing,
      gainDb,
      blocks,
      ...(value.muted === true ? { muted: true as const } : {}),
    },
  };
}

/**
 * Validate + normalise a PATCH `beat` payload. A beat needs a bar grid with a
 * measured tempo; `blocks` must have one entry per timeline block (the block
 * count after the PATCH) and all-on normalises to null; an all-off pattern is
 * kept (the recipe stays and plays silence). Callers must skip this for
 * `undefined` (field absent = unchanged); null clears the beat.
 */
export function normalizeRemixBeatInput(
  value: unknown,
  blockCount: number,
  grid: Pick<SectionGrid, "kind" | "bpm"> | null,
): { value: RemixBeat | null } | { error: string } {
  if (value === null || value === undefined) return { value: null };
  if (!grid || grid.kind !== "bars" || !(grid.bpm && grid.bpm > 0)) {
    return { error: BEAT_NEEDS_TEMPO_ERROR };
  }
  if (!isPlainObject(value)) {
    return { error: "beat must be an object or null" };
  }
  return normalizeBeatShape(value, blockCount);
}

/**
 * Tolerant read of the stored column: anything malformed or foreign-versioned
 * reads as null so a bad row never breaks a project response or a render. A
 * `blocks` list whose length no longer matches the block count (structure
 * edited without remapping) fails open to null — on in every block.
 *
 * @param blockCount current timeline block count; null skips the length check
 *   (lineage of an already-rendered recipe).
 */
export function readStoredRemixBeat(
  stored: unknown,
  blockCount: number | null,
): RemixBeat | null {
  if (!isPlainObject(stored)) return null;
  if (stored.schemaVersion !== REMIX_BEAT_SCHEMA_VERSION) return null;
  const normalized = normalizeBeatShape(stored, null);
  if ("error" in normalized) return null;
  const beat = normalized.value;
  if (blockCount !== null && beat.blocks && beat.blocks.length !== blockCount) {
    return { ...beat, blocks: null };
  }
  return beat;
}

// --- Synthesis (identical in both engines; pinned by the parity fixture) -----

/** mulberry32 PRNG → [0, 1). Exact 32-bit integer arithmetic. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One-pole high-pass coefficient a = RC / (RC + dt), RC = 1/(2π·fc). */
function highpassCoefficient(fc: number, sampleRate: number): number {
  const rc = 1 / (2 * Math.PI * fc);
  const dt = 1 / sampleRate;
  return rc / (rc + dt);
}

/** One-pole low-pass coefficient b = dt / (RC + dt). */
function lowpassCoefficient(fc: number, sampleRate: number): number {
  const rc = 1 / (2 * Math.PI * fc);
  const dt = 1 / sampleRate;
  return dt / (rc + dt);
}

/** y[i] = a·(y[i−1] + x[i] − x[i−1]), zero initial state. */
function onePoleHighpass(
  x: Float64Array,
  fc: number,
  sampleRate: number,
): Float64Array {
  const a = highpassCoefficient(fc, sampleRate);
  const y = new Float64Array(x.length);
  let py = 0;
  let px = 0;
  for (let i = 0; i < x.length; i += 1) {
    py = a * (py + x[i] - px);
    px = x[i];
    y[i] = py;
  }
  return y;
}

/** y[i] = y[i−1] + b·(x[i] − y[i−1]), zero initial state. */
function onePoleLowpass(
  x: Float64Array,
  fc: number,
  sampleRate: number,
): Float64Array {
  const b = lowpassCoefficient(fc, sampleRate);
  const y = new Float64Array(x.length);
  let py = 0;
  for (let i = 0; i < x.length; i += 1) {
    py = py + b * (x[i] - py);
    y[i] = py;
  }
  return y;
}

/** n samples of uniform noise in [−1, 1) from mulberry32(seed). */
function seededNoise(n: number, seed: number): Float64Array {
  const rng = mulberry32(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = rng() * 2 - 1;
  return out;
}

/** Clap burst onsets (s) before the tail. */
const CLAP_BURSTS = [0, 0.012, 0.024];
const CLAP_BURST_TAU = 0.006;
const CLAP_TAIL_START = 0.024;
const CLAP_TAIL_LEVEL = 0.6;

/**
 * One drum hit, round(dur·sr) samples, in double precision:
 *  - kick: sin(phase)·exp(−t/tauA), f(t) = f1 + (f0 − f1)·exp(−t/tauF),
 *    phase advanced by 2π·f/sr after each sample;
 *  - snare: body·sin(2π·bodyHz·t)·exp(−t/bodyTau) + noise·HP(noise)·exp(−t/noiseTau);
 *  - clap: LP(HP(noise))·(Σ burst exp(−(t−ti)/0.006) + 0.6·exp(−(t−0.024)/tail));
 *  - hats: level·HP(HP(noise))·exp(−t/tau);
 * then the kit's optional one-pole low-pass, then × kit gain.
 */
export function beatOneShot(
  kitId: BeatKitId,
  instrument: BeatInstrument,
  sampleRate: number,
): Float64Array {
  const kit = BEAT_KITS[kitId];
  const params = kit[instrument];
  const n = Math.round(params.dur * sampleRate);
  let y: Float64Array = new Float64Array(n);
  if (instrument === "kick") {
    const p = kit.kick;
    let phase = 0;
    for (let i = 0; i < n; i += 1) {
      const t = i / sampleRate;
      const f = p.f1 + (p.f0 - p.f1) * Math.exp(-t / p.tauF);
      y[i] = Math.sin(phase) * Math.exp(-t / p.tauA);
      phase += (2 * Math.PI * f) / sampleRate;
    }
  } else if (instrument === "snare") {
    const p = kit.snare;
    const nz = onePoleHighpass(
      seededNoise(n, BEAT_NOISE_SEEDS.snare),
      p.hpHz,
      sampleRate,
    );
    for (let i = 0; i < n; i += 1) {
      const t = i / sampleRate;
      y[i] =
        p.body * Math.sin(2 * Math.PI * p.bodyHz * t) * Math.exp(-t / p.bodyTau) +
        p.noise * nz[i] * Math.exp(-t / p.noiseTau);
    }
  } else if (instrument === "clap") {
    const p = kit.clap;
    const nz = onePoleLowpass(
      onePoleHighpass(seededNoise(n, BEAT_NOISE_SEEDS.clap), p.hpHz, sampleRate),
      p.lpHz,
      sampleRate,
    );
    for (let i = 0; i < n; i += 1) {
      const t = i / sampleRate;
      let env = 0;
      for (const ti of CLAP_BURSTS) {
        if (t >= ti) env += Math.exp(-(t - ti) / CLAP_BURST_TAU);
      }
      if (t >= CLAP_TAIL_START) {
        env += CLAP_TAIL_LEVEL * Math.exp(-(t - CLAP_TAIL_START) / p.tail);
      }
      y[i] = nz[i] * env;
    }
  } else {
    const p = kit[instrument];
    const nz = onePoleHighpass(
      onePoleHighpass(
        seededNoise(n, BEAT_NOISE_SEEDS[instrument]),
        p.hpHz,
        sampleRate,
      ),
      p.hpHz,
      sampleRate,
    );
    for (let i = 0; i < n; i += 1) {
      const t = i / sampleRate;
      y[i] = p.level * nz[i] * Math.exp(-t / p.tau);
    }
  }
  if (kit.lowpassHz) y = onePoleLowpass(y, kit.lowpassHz, sampleRate);
  for (let i = 0; i < n; i += 1) y[i] *= kit.gain;
  return y;
}

// --- Timing -----------------------------------------------------------------

/** Pickup fraction: a first section shorter than this × a section is a pickup. */
const PICKUP_FRACTION = 0.75;
/** Boundary epsilon for bar starts / hits at a block's end. */
const EDGE_EPSILON = 1e-9;

/** Round to 9 decimals (the shared hit-time grid of both engines). */
function round9(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}

/**
 * A pickup block plays section 0 of a multi-section grid whose first section
 * is shorter than 0.75 × a section — a lead-in before the first downbeat, so
 * it gets no beat.
 */
export function isBeatPickupSection(grid: BeatGrid, section: number): boolean {
  if (section !== 0 || grid.sections.length <= 1) return false;
  const first = grid.sections[0];
  return first.endSec - first.startSec < PICKUP_FRACTION * grid.sectionSeconds;
}

/**
 * Every drum hit on the timeline, sorted by time then instrument order.
 * Bars (240/bpm s, 16 steps each) anchor at each block's timeline start;
 * blocks turned off and pickup blocks are skipped; odd sixteenths are delayed
 * by swing × step / 2; hits at or past a block's end are dropped. Hit times
 * are rounded to 9 decimals.
 */
export function beatHits(
  recipe: RemixBeatDspRecipe,
  grid: BeatGrid,
  segments: BeatSegment[],
): BeatHit[] {
  const bpm = grid.bpm;
  if (!bpm || !(bpm > 0)) return [];
  const barSec = 240 / bpm;
  const stepSec = barSec / BEAT_STEPS;
  const swing = recipe.swing ?? 0;
  const out: BeatHit[] = [];
  segments.forEach((segment, blockIndex) => {
    if (recipe.blocks && recipe.blocks[blockIndex] === false) return;
    if (isBeatPickupSection(grid, segment.section)) return;
    for (let bar = 0; ; bar += 1) {
      const barStart = segment.outStartSec + bar * barSec;
      if (barStart >= segment.outEndSec - EDGE_EPSILON) break;
      for (let step = 0; step < BEAT_STEPS; step += 1) {
        for (const instrument of BEAT_INSTRUMENTS) {
          if (!recipe.pattern[instrument]?.[step]) continue;
          const t =
            barStart +
            step * stepSec +
            (step % 2 === 1 ? swing * stepSec * 0.5 : 0);
          if (t < segment.outEndSec - EDGE_EPSILON) {
            out.push({ timeSec: round9(t), instrument });
          }
        }
      }
    }
  });
  return out.sort(
    (a, b) =>
      a.timeSec - b.timeSec ||
      BEAT_INSTRUMENTS.indexOf(a.instrument) -
        BEAT_INSTRUMENTS.indexOf(b.instrument),
  );
}

// --- Track rendering ----------------------------------------------------------

type PreparedBeat = {
  shots: Record<BeatInstrument, Float64Array>;
  /** Sorted hits with their start sample. */
  hits: Array<{ start: number; shot: Float64Array }>;
  length: number;
  maxShotLength: number;
};

function prepareBeat(
  recipe: RemixBeatDspRecipe,
  grid: BeatGrid,
  segments: BeatSegment[],
  sampleRate: number,
): PreparedBeat {
  const duration =
    segments.length > 0 ? segments[segments.length - 1].outEndSec : 0;
  const shots = {} as Record<BeatInstrument, Float64Array>;
  for (const instrument of BEAT_INSTRUMENTS) {
    shots[instrument] = beatOneShot(recipe.kit, instrument, sampleRate);
  }
  const maxShotLength = Math.max(
    ...BEAT_INSTRUMENTS.map((instrument) => shots[instrument].length),
  );
  const hits = beatHits(recipe, grid, segments).map((hit) => ({
    start: Math.round(hit.timeSec * sampleRate),
    shot: shots[hit.instrument],
  }));
  return {
    shots,
    hits,
    // Timeline length plus room for the longest one-shot's natural decay.
    length: Math.ceil(duration * sampleRate) + maxShotLength,
    maxShotLength,
  };
}

/**
 * Sum the hits overlapping [offset, offset + out.length) into `out`, in hit
 * order — per sample the additions happen in exactly the order of a
 * whole-track render, so any chunking is bit-identical. `from` is the first
 * hit that may still overlap; the next chunk's `from` is returned.
 */
function mixHitsInto(
  out: Float64Array,
  offset: number,
  prepared: PreparedBeat,
  from: number,
): number {
  const end = offset + out.length;
  let first = from;
  while (
    first < prepared.hits.length &&
    prepared.hits[first].start + prepared.maxShotLength <= offset
  ) {
    first += 1;
  }
  for (let h = first; h < prepared.hits.length; h += 1) {
    const { start, shot } = prepared.hits[h];
    if (start >= end) break;
    const i0 = Math.max(0, offset - start);
    const i1 = Math.min(shot.length, end - start);
    for (let i = i0; i < i1; i += 1) out[start + i - offset] += shot[i];
  }
  return first;
}

/**
 * The beat as a mono PCM track over the timeline, in double precision:
 * ceil(timeline·sr) + the longest one-shot samples, each hit's one-shot added
 * at round(timeSec·sr). Starts at timeline 0; block on/off is baked in.
 */
export function renderBeatTrack(
  recipe: RemixBeatDspRecipe,
  grid: BeatGrid,
  segments: BeatSegment[],
  sampleRate: number,
): Float64Array {
  const prepared = prepareBeat(recipe, grid, segments, sampleRate);
  const out = new Float64Array(prepared.length);
  mixHitsInto(out, 0, prepared, 0);
  return out;
}

/** Frames rendered per chunk by {@link writeBeatWav} (1 s at 48 kHz). */
const WAV_CHUNK_FRAMES = 48_000;
const WAV_HEADER_BYTES = 44;

function floatWavHeader(
  frames: number,
  channels: number,
  sampleRate: number,
): Buffer {
  const bytesPerSample = 4;
  const dataBytes = frames * channels * bytesPerSample;
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // WAVE_FORMAT_IEEE_FLOAT
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(bytesPerSample * 8, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

/**
 * Write the beat track (see {@link renderBeatTrack}) as a mono 32-bit float
 * WAV — the render's extra ffmpeg input. Rendered in 1 s chunks straight to
 * the file, so memory stays flat for any timeline length; the samples are
 * bit-identical to the whole-track render before the float32 conversion.
 */
export async function writeBeatWav(
  path: string,
  recipe: RemixBeatDspRecipe,
  grid: BeatGrid,
  segments: BeatSegment[],
  sampleRate: number = REMIX_BEAT_RENDER_SAMPLE_RATE,
): Promise<{ frames: number }> {
  const prepared = prepareBeat(recipe, grid, segments, sampleRate);
  const frames = prepared.length;
  const handle = await open(path, "w");
  try {
    await handle.write(floatWavHeader(frames, 1, sampleRate));
    const chunk = new Float64Array(WAV_CHUNK_FRAMES);
    const bytes = Buffer.alloc(WAV_CHUNK_FRAMES * 4);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    let from = 0;
    for (let offset = 0; offset < frames; offset += WAV_CHUNK_FRAMES) {
      const count = Math.min(WAV_CHUNK_FRAMES, frames - offset);
      const window: Float64Array =
        count === WAV_CHUNK_FRAMES ? chunk : chunk.subarray(0, count);
      window.fill(0);
      from = mixHitsInto(window, offset, prepared, from);
      for (let i = 0; i < count; i += 1) {
        view.setFloat32(i * 4, window[i], true);
      }
      await handle.write(bytes, 0, count * 4);
    }
  } finally {
    await handle.close();
  }
  return { frames };
}
