/**
 * Remix Studio effects recipe `remix-fx/v1` (#1897): the pure math shared by
 * the WebAudio preview and (mirrored in the backend) the ffmpeg render.
 *
 * A recipe is stored on the project (`RemixProject.effects`; null =
 * untouched). Values are rounded to 2 decimals, defaults are omitted and an
 * all-default recipe is null. Every DSP number below is guarded by the
 * committed parity fixture
 * `backend/src/modules/remix/remix-fx-v1.parity.json`: the preview and the
 * render must reproduce it within 1e-9.
 */

export const REMIX_FX_SCHEMA_VERSION = "remix-fx/v1" as const;

export type RemixFxMaster = {
  /** Varispeed (pitch follows), 0.75..1.25, default 1. */
  speed?: number;
  /** Reverb send, 0..1, default 0. */
  space?: number;
  /** Darker (-1) … brighter (1), default 0. */
  tone?: number;
  /** Soft saturation, 0..1, default 0. */
  warmth?: number;
};

export type RemixFxStem = {
  /** Reverb send, 0..1, default 0. */
  space?: number;
  /** Tempo-synced echo, 0..1, default 0. */
  echo?: number;
  /** Darker (-1) … brighter (1), default 0. */
  tone?: number;
};

export type RemixFxRecipe = {
  schemaVersion: typeof REMIX_FX_SCHEMA_VERSION;
  master?: RemixFxMaster;
  /** Keyed by project stem id. */
  stems?: Record<string, RemixFxStem>;
};

type Range = { min: number; max: number; default: number };

export const REMIX_FX_MASTER_RANGES: Record<keyof RemixFxMaster, Range> = {
  speed: { min: 0.75, max: 1.25, default: 1 },
  space: { min: 0, max: 1, default: 0 },
  tone: { min: -1, max: 1, default: 0 },
  warmth: { min: 0, max: 1, default: 0 },
};

export const REMIX_FX_STEM_RANGES: Record<keyof RemixFxStem, Range> = {
  space: { min: 0, max: 1, default: 0 },
  echo: { min: 0, max: 1, default: 0 },
  tone: { min: -1, max: 1, default: 0 },
};

const MASTER_KEYS = ["speed", "space", "tone", "warmth"] as const;
const STEM_KEYS = ["space", "echo", "tone"] as const;

/** Round to 2 decimals; -0 becomes 0. */
function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** Clamped, rounded value, or null when it is (or rounds to) the default. */
function normalizeValue(raw: unknown, range: Range): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const value = round2(Math.min(range.max, Math.max(range.min, raw)));
  return value === range.default ? null : value;
}

function normalizeGroup<K extends string>(
  raw: unknown,
  keys: readonly K[],
  ranges: Record<K, Range>,
): Partial<Record<K, number>> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const group: Partial<Record<K, number>> = {};
  let any = false;
  for (const key of keys) {
    const value = normalizeValue(source[key], ranges[key]);
    if (value !== null) {
      group[key] = value;
      any = true;
    }
  }
  return any ? group : null;
}

/**
 * Normalize any stored or edited recipe. The client clamps instead of
 * rejecting (the backend rejects out-of-range input); for valid input the
 * output equals the backend normalization. A recipe of another schema
 * version normalizes to null. `projectStemIds`, when given,
 * drops stem entries that are not in the project. Empty groups are omitted;
 * an all-default recipe is null.
 */
export function normalizeRemixFx(
  value: unknown,
  projectStemIds?: Iterable<string> | null,
): RemixFxRecipe | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as {
    schemaVersion?: unknown;
    master?: unknown;
    stems?: unknown;
  };
  // Another recipe version is not ours to reinterpret (mirrors the backend).
  if (
    raw.schemaVersion !== undefined &&
    raw.schemaVersion !== REMIX_FX_SCHEMA_VERSION
  ) {
    return null;
  }
  const allowed = projectStemIds ? new Set(projectStemIds) : null;
  const master = normalizeGroup(raw.master, MASTER_KEYS, REMIX_FX_MASTER_RANGES);
  const stems: Record<string, RemixFxStem> = {};
  if (raw.stems && typeof raw.stems === "object" && !Array.isArray(raw.stems)) {
    const entries = Object.entries(raw.stems as Record<string, unknown>).sort(
      ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
    );
    for (const [stemId, stemFx] of entries) {
      if (allowed && !allowed.has(stemId)) continue;
      const group = normalizeGroup(stemFx, STEM_KEYS, REMIX_FX_STEM_RANGES);
      if (group) stems[stemId] = group;
    }
  }
  const hasStems = Object.keys(stems).length > 0;
  if (!master && !hasStems) return null;
  return {
    schemaVersion: REMIX_FX_SCHEMA_VERSION,
    ...(master ? { master } : {}),
    ...(hasStems ? { stems } : {}),
  };
}

/** Structural equality of two recipes after normalization. */
export function sameRemixFx(
  left: unknown,
  right: unknown,
  projectStemIds?: Iterable<string> | null,
): boolean {
  const ids = projectStemIds ? [...projectStemIds] : null;
  return (
    JSON.stringify(normalizeRemixFx(left, ids)) ===
    JSON.stringify(normalizeRemixFx(right, ids))
  );
}

/** Effective master values (defaults filled in). */
export function remixFxMaster(
  recipe: RemixFxRecipe | null | undefined,
): Required<RemixFxMaster> {
  const master = recipe?.master ?? {};
  return {
    speed: master.speed ?? REMIX_FX_MASTER_RANGES.speed.default,
    space: master.space ?? REMIX_FX_MASTER_RANGES.space.default,
    tone: master.tone ?? REMIX_FX_MASTER_RANGES.tone.default,
    warmth: master.warmth ?? REMIX_FX_MASTER_RANGES.warmth.default,
  };
}

/** Effective per-stem values (defaults filled in). */
export function remixFxStem(
  recipe: RemixFxRecipe | null | undefined,
  stemId: string,
): Required<RemixFxStem> {
  const stem = recipe?.stems?.[stemId] ?? {};
  return {
    space: stem.space ?? REMIX_FX_STEM_RANGES.space.default,
    echo: stem.echo ?? REMIX_FX_STEM_RANGES.echo.default,
    tone: stem.tone ?? REMIX_FX_STEM_RANGES.tone.default,
  };
}

/** Whether a stem has any non-default fx. */
export function stemHasFx(
  recipe: RemixFxRecipe | null | undefined,
  stemId: string,
): boolean {
  const stem = recipe?.stems?.[stemId];
  return !!stem && Object.keys(stem).length > 0;
}

/** Set one master value; returns the normalized recipe. */
export function withMasterFx(
  recipe: RemixFxRecipe | null,
  key: keyof RemixFxMaster,
  value: number,
): RemixFxRecipe | null {
  return normalizeRemixFx({
    ...recipe,
    master: { ...recipe?.master, [key]: value },
  });
}

/** Set one per-stem value; returns the normalized recipe. */
export function withStemFx(
  recipe: RemixFxRecipe | null,
  stemId: string,
  key: keyof RemixFxStem,
  value: number,
): RemixFxRecipe | null {
  return normalizeRemixFx({
    ...recipe,
    stems: {
      ...recipe?.stems,
      [stemId]: { ...recipe?.stems?.[stemId], [key]: value },
    },
  });
}

// ---------------------------------------------------------------------------
// DSP mapping (identical in both engines).

/** Butterworth Q, as a linear Q factor (the ffmpeg `width_type=q` value). */
export const REMIX_FX_TONE_Q = 0.7071;
/** |tone| at or below this means no filter. */
export const REMIX_FX_TONE_DEADBAND = 0.01;

export type RemixToneFilter = {
  type: "lowpass" | "highpass";
  frequencyHz: number;
  /** Linear Q factor. */
  q: number;
};

/**
 * tone < -0.01 → low-pass at 20000·(800/20000)^(−t) Hz; tone > 0.01 →
 * high-pass at 20·(1200/20)^t Hz; otherwise no filter.
 */
export function toneFilter(tone: number): RemixToneFilter | null {
  if (!Number.isFinite(tone) || Math.abs(tone) <= REMIX_FX_TONE_DEADBAND) {
    return null;
  }
  if (tone < 0) {
    return {
      type: "lowpass",
      frequencyHz: 20000 * Math.pow(800 / 20000, -tone),
      q: REMIX_FX_TONE_Q,
    };
  }
  return {
    type: "highpass",
    frequencyHz: 20 * Math.pow(1200 / 20, tone),
    q: REMIX_FX_TONE_Q,
  };
}

/**
 * WebAudio's BiquadFilterNode interprets Q in dB for lowpass/highpass
 * (αQdB = sin ω0 / (2·10^(Q/20))), unlike ffmpeg's linear Q. The preview sets
 * this value so both engines compute the same RBJ biquad.
 */
export function biquadQDb(linearQ: number): number {
  return 20 * Math.log10(linearQ);
}

export type RemixEchoTap = { delaySec: number; gain: number };

export const REMIX_FX_ECHO_TAPS = 4;

/**
 * Dotted-eighth echo in output tempo: d = 0.75·60/(bpm·speed), or
 * 0.375/speed without a bar grid. Tap k (1..4) at k·d with gain
 * 0.5·e·0.6^(k−1), added to the dry signal. No taps when e ≤ 0.
 */
export function echoTaps(
  echo: number,
  bpm: number | null | undefined,
  speed: number,
): RemixEchoTap[] {
  if (!Number.isFinite(echo) || echo <= 0) return [];
  const d = echoTapSpacing(bpm, speed);
  const taps: RemixEchoTap[] = [];
  for (let k = 1; k <= REMIX_FX_ECHO_TAPS; k += 1) {
    taps.push({ delaySec: k * d, gain: 0.5 * echo * Math.pow(0.6, k - 1) });
  }
  return taps;
}

/** Seconds between echo taps (see `echoTaps`). */
export function echoTapSpacing(
  bpm: number | null | undefined,
  speed: number,
): number {
  const validBpm =
    typeof bpm === "number" && Number.isFinite(bpm) && bpm > 0 ? bpm : null;
  return validBpm !== null ? (0.75 * 60) / (validBpm * speed) : 0.375 / speed;
}

/** Reverb wet level: 0.7·(1 − (1 − stemSpace)(1 − masterSpace)). */
export function reverbWet(stemSpace: number, masterSpace: number): number {
  return 0.7 * (1 - (1 - stemSpace) * (1 - masterSpace));
}

/** Warmth drive: k = 1 + 4w. */
export function warmthK(warmth: number): number {
  return 1 + 4 * warmth;
}

/** Warmth transfer function y = tanh(k·x)/tanh(k); identity when w ≤ 0. */
export function warmthAt(warmth: number, x: number): number {
  if (!(warmth > 0)) return x;
  const k = warmthK(warmth);
  return Math.tanh(k * x) / Math.tanh(k);
}

export const REMIX_FX_WARMTH_CURVE_POINTS = 4096;

/**
 * WaveShaper curve for `warmthAt`. WebAudio maps the input range [-1, 1]
 * onto the curve (index i ↔ x = 2i/(n−1) − 1) and holds the end values
 * beyond it; `inputRange` stretches the curve over [-range, range] so a
 * preview that pre-scales its input by 1/range keeps the tanh shape for
 * sums louder than full scale, like the render does.
 */
export function warmthCurve(
  warmth: number,
  points: number = REMIX_FX_WARMTH_CURVE_POINTS,
  inputRange = 1,
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i += 1) {
    const x = ((2 * i) / (points - 1) - 1) * inputRange;
    curve[i] = warmthAt(warmth, x);
  }
  return curve;
}

// ---------------------------------------------------------------------------
// Reverb impulse response: deterministic, code-generated.

export const REMIX_FX_REVERB_SECONDS = 2.8;
export const REMIX_FX_REVERB_PREDELAY_SECONDS = 0.02;
export const REMIX_FX_REVERB_SEEDS = { left: 1896, right: 1897 } as const;

/** mulberry32 PRNG, uniform in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One reverb IR channel: 2.8 s at `sampleRate`, 20 ms of leading silence,
 * then mulberry32 noise (2·u − 1, drawn only after the silence) times
 * exp(−6.9·t/2.8) (60 dB decay over the IR, t in seconds from the start),
 * energy-normalized so √Σx² = 1.
 */
export function generateReverbImpulse(
  sampleRate: number,
  seed: number,
): Float64Array {
  const length = Math.round(REMIX_FX_REVERB_SECONDS * sampleRate);
  const predelay = Math.round(REMIX_FX_REVERB_PREDELAY_SECONDS * sampleRate);
  const random = mulberry32(seed);
  const samples = new Float64Array(length);
  let energy = 0;
  for (let i = predelay; i < length; i += 1) {
    const t = i / sampleRate;
    const sample =
      (random() * 2 - 1) * Math.exp((-6.9 * t) / REMIX_FX_REVERB_SECONDS);
    samples[i] = sample;
    energy += sample * sample;
  }
  const norm = Math.sqrt(energy);
  if (norm > 0) {
    for (let i = predelay; i < length; i += 1) samples[i] /= norm;
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Vibe starters: one click sets visible controls the listener can tweak.

export type RemixVibeId =
  | "slowed_reverb"
  | "sped_up"
  | "lofi"
  | "dreamy"
  | "club"
  | "none";

export type RemixVibe = {
  id: RemixVibeId;
  label: string;
  description: string;
  /** Replaces the master controls; null = Original (clears everything). */
  master: RemixFxMaster | null;
  /** Per-stem entries set by stem type; other stems are left untouched. */
  stemsByType?: { types: readonly string[]; fx: RemixFxStem };
};

const VOCAL_TYPES = ["vocals", "vocal"] as const;

export const REMIX_VIBES: readonly RemixVibe[] = [
  {
    id: "slowed_reverb",
    label: "Slowed + reverb",
    description: "Slower, deeper and roomy.",
    master: { speed: 0.85, space: 0.45, tone: -0.15 },
  },
  {
    id: "sped_up",
    label: "Sped up",
    description: "Faster and brighter-pitched.",
    master: { speed: 1.2, space: 0.1 },
  },
  {
    id: "lofi",
    label: "Lo-fi",
    description: "Dusty, warm and a little slower.",
    master: { speed: 0.95, tone: -0.45, warmth: 0.5, space: 0.15 },
  },
  {
    id: "dreamy",
    label: "Dreamy",
    description: "Floating vocals with a soft echo.",
    master: { speed: 0.92, space: 0.6, tone: -0.25 },
    stemsByType: { types: VOCAL_TYPES, fx: { echo: 0.35 } },
  },
  {
    id: "club",
    label: "Club",
    description: "A touch faster with some punch.",
    master: { speed: 1.05, space: 0.1, warmth: 0.2 },
  },
  {
    // Not "Original": that name belongs to the transport's A/B source (the
    // untouched full mix); this one removes every effect from the remix.
    id: "none",
    label: "No effects",
    description: "Remove every effect.",
    master: null,
  },
];

/**
 * Apply a vibe: replaces the master controls and sets only the vibe's
 * per-stem entries (merged into those stems' fx); other stems keep their fx.
 * "No effects" clears everything (null).
 */
export function applyVibe(
  vibeId: RemixVibeId,
  current: RemixFxRecipe | null,
  stems: Array<{ stemId: string; type: string }>,
): RemixFxRecipe | null {
  const vibe = REMIX_VIBES.find((entry) => entry.id === vibeId);
  if (!vibe || vibe.master === null) return null;
  const nextStems: Record<string, RemixFxStem> = { ...current?.stems };
  if (vibe.stemsByType) {
    const types = new Set(vibe.stemsByType.types);
    for (const stem of stems) {
      if (!types.has(stem.type.trim().toLowerCase())) continue;
      nextStems[stem.stemId] = {
        ...nextStems[stem.stemId],
        ...vibe.stemsByType.fx,
      };
    }
  }
  return normalizeRemixFx({
    schemaVersion: REMIX_FX_SCHEMA_VERSION,
    master: { ...vibe.master },
    stems: nextStems,
  });
}

/**
 * The vibe the master controls match exactly, or null. "No effects" matches
 * only a recipe with no effects at all.
 */
export function activeVibeId(
  recipe: RemixFxRecipe | null | undefined,
): RemixVibeId | null {
  const normalized = normalizeRemixFx(recipe);
  if (normalized === null) return "none";
  const master = remixFxMaster(normalized);
  for (const vibe of REMIX_VIBES) {
    if (vibe.master === null) continue;
    const target = remixFxMaster({
      schemaVersion: REMIX_FX_SCHEMA_VERSION,
      master: vibe.master,
    });
    if (MASTER_KEYS.every((key) => master[key] === target[key])) {
      return vibe.id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Plain-language value labels for the controls.

/** Speed as a multiplier, e.g. "0.85×". */
export function formatFxSpeed(speed: number): string {
  return `${speed.toFixed(2)}×`;
}

/** A 0..1 amount as a percentage, e.g. "45%". */
export function formatFxAmount(amount: number): string {
  return `${Math.round(amount * 100)}%`;
}

/** Tone as "Neutral", "Darker 25%" or "Brighter 40%". */
export function formatFxTone(tone: number): string {
  if (Math.abs(tone) <= REMIX_FX_TONE_DEADBAND) return "Neutral";
  return `${tone < 0 ? "Darker" : "Brighter"} ${Math.round(Math.abs(tone) * 100)}%`;
}
