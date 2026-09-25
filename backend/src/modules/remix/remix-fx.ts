/**
 * Shared Remix Studio effects recipe `remix-fx/v1` (#1897).
 *
 * One versioned recipe is persisted on `RemixProject.effects` and executed by
 * both engines: the server ffmpeg render (stem-audio-mixer.ts) and the browser
 * WebAudio preview. The DSP mapping below is the single contract; the
 * committed parity fixture `remix-fx-v1.parity.json` pins every number both
 * engines must reproduce (within 1e-9). Changing any mapping requires a new
 * {@link REMIX_FX_DSP_VERSION} so older drafts stay auditable.
 *
 * Effects are deterministic DSP, not AI: they never change a render's
 * grounding, cost nothing, and never interpolate user strings into a graph.
 */

import { writeFile } from "fs/promises";

export const REMIX_FX_SCHEMA_VERSION = "remix-fx/v1";
export const REMIX_FX_DSP_VERSION = "remix-fx-dsp/v1";

export type RemixFxMaster = {
  /** Varispeed factor (pitch follows speed); default 1. */
  speed?: number;
  /** Master reverb send 0..1; default 0. */
  space?: number;
  /** Tilt −1 (darker, low-pass) .. 1 (brighter, high-pass); default 0. */
  tone?: number;
  /** tanh saturation amount 0..1; default 0. */
  warmth?: number;
};

export type RemixFxStem = {
  space?: number;
  echo?: number;
  tone?: number;
};

export type RemixFxRecipe = {
  schemaVersion: typeof REMIX_FX_SCHEMA_VERSION;
  master?: RemixFxMaster;
  /** Keyed by project stem id (the `stemId` of a RemixProjectStem row). */
  stems?: Record<string, RemixFxStem>;
};

/** Render-time fx context: the recipe plus the grid tempo (bar grids only). */
export type RemixRenderFx = {
  effects: RemixFxRecipe;
  /** Section-grid bpm when the grid is `kind: "bars"`; null otherwise. */
  bpm: number | null;
};

type FieldSpec = { min: number; max: number; defaultValue: number };

const MASTER_FIELDS: Record<keyof RemixFxMaster, FieldSpec> = {
  speed: { min: 0.75, max: 1.25, defaultValue: 1 },
  space: { min: 0, max: 1, defaultValue: 0 },
  tone: { min: -1, max: 1, defaultValue: 0 },
  warmth: { min: 0, max: 1, defaultValue: 0 },
};

const STEM_FIELDS: Record<keyof RemixFxStem, FieldSpec> = {
  space: { min: 0, max: 1, defaultValue: 0 },
  echo: { min: 0, max: 1, defaultValue: 0 },
  tone: { min: -1, max: 1, defaultValue: 0 },
};

/** Round to 2 decimals; −0 collapses to 0 so it reads as the default. */
function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value)
  );
}

function normalizeFields<T extends Record<string, number | undefined>>(
  value: unknown,
  fields: Record<string, FieldSpec>,
  path: string,
): { value: T | null } | { error: string } {
  if (value === undefined || value === null) return { value: null };
  if (!isPlainObject(value)) {
    return { error: `${path} must be an object` };
  }
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const spec = fields[key];
    if (!spec) {
      return {
        error: `${path}.${key} is not a supported effect (allowed: ${Object.keys(fields).join(", ")})`,
      };
    }
    if (raw === undefined) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return { error: `${path}.${key} must be a finite number` };
    }
    if (raw < spec.min || raw > spec.max) {
      return {
        error: `${path}.${key} must be between ${spec.min} and ${spec.max}`,
      };
    }
    const rounded = round2(raw);
    if (rounded !== spec.defaultValue) out[key] = rounded;
  }
  return { value: Object.keys(out).length > 0 ? (out as T) : null };
}

/**
 * Validate + normalize a PATCH `effects` payload. Values round to 2 decimals,
 * defaults are omitted, stems left with no non-default value are dropped, and
 * an all-default recipe normalizes to null (untouched). Callers must skip this
 * for `undefined` (field absent = unchanged).
 *
 * @param projectStemIds ids allowed as `stems` keys; null skips membership
 *   checks (tolerant reads of an already-stored recipe).
 */
export function normalizeRemixFxInput(
  value: unknown,
  projectStemIds: Iterable<string> | null,
): { value: RemixFxRecipe | null } | { error: string } {
  if (value === null || value === undefined) return { value: null };
  if (!isPlainObject(value)) {
    return { error: "effects must be an object or null" };
  }
  for (const key of Object.keys(value)) {
    if (key !== "schemaVersion" && key !== "master" && key !== "stems") {
      return {
        error: `effects.${key} is not supported (allowed: schemaVersion, master, stems)`,
      };
    }
  }
  if (
    value.schemaVersion !== undefined &&
    value.schemaVersion !== REMIX_FX_SCHEMA_VERSION
  ) {
    return {
      error: `effects.schemaVersion must be "${REMIX_FX_SCHEMA_VERSION}"`,
    };
  }

  const master = normalizeFields<RemixFxMaster>(
    value.master,
    MASTER_FIELDS,
    "effects.master",
  );
  if ("error" in master) return master;

  let stems: Record<string, RemixFxStem> | null = null;
  if (value.stems !== undefined && value.stems !== null) {
    if (!isPlainObject(value.stems)) {
      return { error: "effects.stems must be an object keyed by stem id" };
    }
    const allowed = projectStemIds ? new Set(projectStemIds) : null;
    for (const [stemId, stemValue] of Object.entries(value.stems)) {
      if (!stemId) {
        return { error: "effects.stems keys must be non-empty stem ids" };
      }
      if (allowed && !allowed.has(stemId)) {
        return { error: `effects.stems.${stemId} is not part of this project` };
      }
      const stem = normalizeFields<RemixFxStem>(
        stemValue,
        STEM_FIELDS,
        `effects.stems.${stemId}`,
      );
      if ("error" in stem) return stem;
      if (stem.value) {
        stems ??= {};
        stems[stemId] = stem.value;
      }
    }
  }

  if (!master.value && !stems) return { value: null };
  return {
    value: {
      schemaVersion: REMIX_FX_SCHEMA_VERSION,
      ...(master.value ? { master: master.value } : {}),
      ...(stems ? { stems } : {}),
    },
  };
}

/**
 * Tolerant read of the stored column: anything malformed, foreign-versioned,
 * or all-default reads as null so a bad row never breaks a project response
 * or a render.
 */
export function readStoredRemixFx(stored: unknown): RemixFxRecipe | null {
  if (!isPlainObject(stored)) return null;
  if (stored.schemaVersion !== REMIX_FX_SCHEMA_VERSION) return null;
  const normalized = normalizeRemixFxInput(stored, null);
  return "error" in normalized ? null : normalized.value;
}

// --- DSP mapping (identical in both engines; pinned by the parity fixture) ---

export const REMIX_FX_FILTER_Q = 0.7071;

export type RemixFxToneFilter = {
  type: "lowpass" | "highpass";
  frequencyHz: number;
  q: number;
};

/**
 * tone t: t < −0.01 → low-pass at 20000·(800/20000)^(−t) Hz; t > 0.01 →
 * high-pass at 20·(1200/20)^t Hz; Q 0.7071 (linear); |t| ≤ 0.01 → no filter.
 */
export function toneFilter(t: number): RemixFxToneFilter | null {
  if (!Number.isFinite(t)) return null;
  if (t < -0.01) {
    return {
      type: "lowpass",
      frequencyHz: 20000 * Math.pow(800 / 20000, -t),
      q: REMIX_FX_FILTER_Q,
    };
  }
  if (t > 0.01) {
    return {
      type: "highpass",
      frequencyHz: 20 * Math.pow(1200 / 20, t),
      q: REMIX_FX_FILTER_Q,
    };
  }
  return null;
}

export type RemixFxEchoTap = { delaySec: number; gain: number };

/**
 * echo e > 0: 4 feed-forward taps at k·d (k = 1..4) added to the dry signal,
 * d = a dotted eighth in OUTPUT tempo = 0.75·60/(bpm·s), or 0.375/s without a
 * bar grid; tap gain 0.5·e·0.6^(k−1).
 */
export function echoTaps(
  e: number,
  bpm: number | null,
  speed: number,
): RemixFxEchoTap[] {
  if (!Number.isFinite(e) || e <= 0) return [];
  const s = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const d =
    bpm !== null && Number.isFinite(bpm) && bpm > 0
      ? (0.75 * 60) / (bpm * s)
      : 0.375 / s;
  const taps: RemixFxEchoTap[] = [];
  for (let k = 1; k <= 4; k += 1) {
    taps.push({ delaySec: k * d, gain: 0.5 * e * Math.pow(0.6, k - 1) });
  }
  return taps;
}

/** Reverb wet level for one send: 0.7·(1 − (1 − stem)(1 − master)). */
export function reverbWet(stemSpace: number, masterSpace: number): number {
  return 0.7 * (1 - (1 - stemSpace) * (1 - masterSpace));
}

/** warmth w → saturation drive k = 1 + 4w. */
export function warmthK(w: number): number {
  return 1 + 4 * w;
}

/** warmth w > 0: y = tanh(k·x)/tanh(k); w ≤ 0 is the identity. */
export function warmthCurve(w: number, x: number): number {
  if (!(w > 0)) return x;
  const k = warmthK(w);
  return Math.tanh(k * x) / Math.tanh(k);
}

// --- Reverb impulse response -------------------------------------------------

export const REMIX_FX_IMPULSE = Object.freeze({
  sampleRate: 48_000,
  lengthSeconds: 2.8,
  predelaySeconds: 0.02,
  /** exp(−6.9·t/2.8): 60 dB of decay over the IR length. */
  decayConstant: 6.9,
  seeds: Object.freeze({ left: 1896, right: 1897 }),
});

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

/**
 * One channel of the deterministic, code-generated reverb IR (no licensing,
 * exact parity): round(2.8·sr) samples, the first round(0.02·sr) silent (the
 * PRNG does not advance during the predelay), then (2·mulberry32() − 1) ×
 * exp(−6.9·t/2.8) with t = i/sr, energy-normalized so √Σx² = 1. Computed in
 * double precision.
 */
export function generateReverbImpulse(
  sampleRate: number,
  seed: number,
): Float64Array {
  const { lengthSeconds, predelaySeconds, decayConstant } = REMIX_FX_IMPULSE;
  const length = Math.round(lengthSeconds * sampleRate);
  const predelay = Math.round(predelaySeconds * sampleRate);
  const rng = mulberry32(seed);
  const samples = new Float64Array(length);
  for (let i = predelay; i < length; i += 1) {
    const t = i / sampleRate;
    samples[i] =
      (rng() * 2 - 1) * Math.exp((-decayConstant * t) / lengthSeconds);
  }
  let energy = 0;
  for (let i = 0; i < length; i += 1) energy += samples[i] * samples[i];
  const norm = Math.sqrt(energy);
  if (norm > 0) {
    for (let i = 0; i < length; i += 1) samples[i] /= norm;
  }
  return samples;
}

let impulseWavCache: Buffer | null = null;

/**
 * The stereo IR (L seed 1896, R seed 1897) as a 48 kHz, 32-bit float WAV —
 * the second input of the render's ffmpeg `afir` reverb bus. Memoized: the
 * bytes are deterministic.
 */
export function buildImpulseWav(): Buffer {
  if (impulseWavCache) return impulseWavCache;
  const { sampleRate, seeds } = REMIX_FX_IMPULSE;
  const channels = [
    generateReverbImpulse(sampleRate, seeds.left),
    generateReverbImpulse(sampleRate, seeds.right),
  ];
  const frames = channels[0].length;
  const channelCount = channels.length;
  const bytesPerSample = 4;
  const dataBytes = frames * channelCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(3, 20); // WAVE_FORMAT_IEEE_FLOAT
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  // DataView with explicit little-endian writes: fast and host-independent.
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let ch = 0; ch < channelCount; ch += 1) {
      view.setFloat32(offset, channels[ch][i], true);
      offset += bytesPerSample;
    }
  }
  impulseWavCache = buffer;
  return buffer;
}

/** Write the stereo reverb IR WAV (see {@link buildImpulseWav}) to `path`. */
export async function writeImpulseWav(path: string): Promise<void> {
  await writeFile(path, buildImpulseWav());
}
