/**
 * AI part take conform, `remix-part-conform/v1` (#1901).
 *
 * A generated take is a free-running 30 s model clip: its tempo drifts from
 * the prompt's BPM, its first downbeat lands anywhere and its key may differ
 * from the song's. Conform locks it to the song deterministically, so the
 * model never has to promise anything:
 *
 * 1. decode (ffmpeg) to 48 kHz stereo float;
 * 2. tempo: a log spectral-flux onset envelope (hop 512) scored against beat
 *    combs at ratios r ∈ [0.90, 1.10] of the target B, B/2 and 2B; the best
 *    comb wins, confidence = peak / mean of its ratio curve; a low
 *    confidence (sustained textures) keeps r = 1;
 * 3. beat phase: the comb phase with the most onset energy; the downbeat is
 *    the strongest of the first 4 beats at or after 0.25 s (strength summed
 *    over every bar of the clip);
 * 4. cut N bars at the take tempo B·r and stretch them with the #1898
 *    Signalsmith engine to exactly N·4·60/B seconds (sample-exact);
 * 5. key (pitched roles): STFT chroma + Krumhansl-Schmuckler, compared as
 *    pitch-class sets (a major key ≡ its relative minor); shift by the
 *    minimal −6..+5 semitones, skipped (with a recorded reason) when either
 *    estimate is not confident;
 * 6. loop-safe edges: a 3 ms fade-in, and an equal-power crossfade of the
 *    10 ms pre-roll (the audio just before the downbeat) into the tail, whose
 *    last 3 ms mirror the fade-in so the wrap is continuous;
 * 7. encode FLAC (16-bit, 48 kHz, stereo) — never mp3, whose encoder delay
 *    breaks sample-accurate loops.
 *
 * The analysis and the stretch are pure and deterministic; the whole DSP runs
 * in a `worker_threads` worker so the service's event loop never blocks. No
 * user string ever reaches ffmpeg: its argv is numbers and temp paths only.
 * Changing any rule below requires a new {@link REMIX_PART_CONFORM_VERSION}.
 */

import { execFile } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { isMainThread, parentPort, Worker, workerData } from "worker_threads";
import {
  createStretchEngine,
  stretchOffline,
  type StretchApi,
} from "./remix-stretch";

const execFileAsync = promisify(execFile);

export const REMIX_PART_CONFORM_VERSION = "remix-part-conform/v1";
export const PART_SAMPLE_RATE = 48_000;
export const PART_CHANNELS = 2;
export const PART_BEATS_PER_BAR = 4;

/** Tempo ratio search range around the target (and its half/double). */
export const PART_RATIO_MIN = 0.9;
export const PART_RATIO_MAX = 1.1;
/** Below this peak/mean comb score the tempo estimate is not trusted. */
export const PART_TEMPO_CONFIDENCE_MIN = 1.6;
/** The downbeat is searched at or after this time (skips the model's attack). */
export const PART_DOWNBEAT_MIN_SEC = 0.25;
/** Loop edge shaping. */
export const PART_FADE_IN_SEC = 0.003;
export const PART_CROSSFADE_SEC = 0.01;
/** Key confidence floors: the take's set margin, the song's stored margin. */
export const PART_TAKE_KEY_CONFIDENCE_MIN = 0.05;
export const PART_TRACK_KEY_CONFIDENCE_MIN = 0.05;

const ONSET_FFT = 2048;
const ONSET_HOP = 512;
const ONSET_LOG_GAIN = 1000;
/** Local-mean window (s) removed from the flux before rectification. */
const ONSET_MEAN_WINDOW_SEC = 0.25;
const COARSE_RATIO_STEP = 0.0005;
const FINE_RATIO_HALF_SPAN = 0.001;
const FINE_RATIO_STEP = 0.00005;
const TEMPO_OCTAVES = [1, 0.5, 2] as const;

const KEY_FFT = 16_384;
const KEY_HOP = 4096;
const KEY_FMIN_HZ = 55;
const KEY_FMAX_HZ = 5000;

/** Extra input kept after the cut so the tail never sits on the engine's end. */
const STRETCH_POST_ROLL_SEC = 0.05;

/** Bounds on provider audio before it is decoded. */
const MAX_TAKE_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_TAKE_DECODE_SEC = 40;
const FFMPEG_TIMEOUT_MS = 120_000;

// Krumhansl-Schmuckler profiles (the same ones the ingestion worker uses).
const KS_MAJOR = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const KS_MINOR = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];
export const PITCH_CLASS_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;
const TONIC_PITCH_CLASS: Readonly<Record<string, number>> = Object.freeze({
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
});

export type PartKey = {
  tonic: string;
  mode: "major" | "minor";
  /** Estimate confidence in [0, 1]; null when unknown. */
  confidence: number | null;
};

export type PartConformTarget = {
  /** The song's bar-grid tempo. */
  bpm: number;
  bars: number;
  /** Pitched roles get the key stage; drums never do. */
  pitched: boolean;
  /** The song's key (highest-confidence stem estimate); null if unmeasured. */
  key: PartKey | null;
};

export type PartKeySkippedReason =
  | "unpitched_role"
  | "no_track_key"
  | "low_track_key_confidence"
  | "no_take_key"
  | "low_take_key_confidence";

/** Recorded on every completed take. */
export type PartConformRecord = {
  conformVersion: typeof REMIX_PART_CONFORM_VERSION;
  targetBpm: number;
  /** Take tempo / target tempo (1 when the estimate was not confident). */
  estimatedRatio: number;
  tempoConfidence: number;
  /** Where the cut starts in the provider clip (the chosen downbeat). */
  startSec: number;
  keyShiftSemitones: number;
  /** The take's key-set confidence; null when no key stage ran. */
  keyConfidence: number | null;
  keySkippedReason?: PartKeySkippedReason;
  takeKey?: string;
  targetKey?: string;
  /** True only when the clip was too short and the cut was zero-padded. */
  padded?: true;
  lengthFrames: number;
};

// --- FFT ----------------------------------------------------------------------

type FftPlan = {
  n: number;
  cos: Float64Array;
  sin: Float64Array;
  rev: Uint32Array;
  hann: Float64Array;
};

const fftPlans = new Map<number, FftPlan>();

function fftPlan(n: number): FftPlan {
  const cached = fftPlans.get(n);
  if (cached) return cached;
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i += 1) {
    let r = 0;
    for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i += 1) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  const hann = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  }
  const plan = { n, cos, sin, rev, hann };
  fftPlans.set(n, plan);
  return plan;
}

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array, plan: FftPlan): void {
  const { n, rev, cos, sin } = plan;
  for (let i = 0; i < n; i += 1) {
    const j = rev[i];
    if (j > i) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k += 1) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/** Twiddles e^{−2πik/n}, k = 0..n/2, for the real-FFT split. */
const realTwiddles = new Map<number, { cos: Float64Array; sin: Float64Array }>();

function realTwiddle(n: number) {
  const cached = realTwiddles.get(n);
  if (cached) return cached;
  const cos = new Float64Array(n / 2 + 1);
  const sin = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k += 1) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = -Math.sin((2 * Math.PI * k) / n);
  }
  const twiddle = { cos, sin };
  realTwiddles.set(n, twiddle);
  return twiddle;
}

/**
 * Magnitude spectra (bins 0..n/2) of Hann-windowed frames: a real FFT of
 * size n computed as one complex FFT of size n/2 plus the standard split.
 */
function forEachSpectrum(
  mono: Float32Array,
  n: number,
  hop: number,
  visit: (frame: number, magnitude: Float64Array) => void,
): number {
  const half = n / 2;
  const plan = fftPlan(half);
  const window = fftPlan(n).hann;
  const twiddle = realTwiddle(n);
  const frames = mono.length >= n ? 1 + Math.floor((mono.length - n) / hop) : 0;
  const re = new Float64Array(half);
  const im = new Float64Array(half);
  const magnitude = new Float64Array(half + 1);
  const scale = 4 / n;
  for (let f = 0; f < frames; f += 1) {
    const offset = f * hop;
    for (let i = 0; i < half; i += 1) {
      re[i] = mono[offset + 2 * i] * window[2 * i];
      im[i] = mono[offset + 2 * i + 1] * window[2 * i + 1];
    }
    fft(re, im, plan);
    for (let k = 0; k <= half; k += 1) {
      const a = re[k % half];
      const b = im[k % half];
      const c = re[(half - k) % half];
      const d = im[(half - k) % half];
      // E = (Z[k] + conj Z[M−k]) / 2, O = (Z[k] − conj Z[M−k]) / 2i.
      const er = (a + c) / 2;
      const ei = (b - d) / 2;
      const or = (b + d) / 2;
      const oi = (c - a) / 2;
      const wr = twiddle.cos[k];
      const wi = twiddle.sin[k];
      const xr = er + wr * or - wi * oi;
      const xi = ei + wr * oi + wi * or;
      magnitude[k] = Math.sqrt(xr * xr + xi * xi) * scale;
    }
    visit(f, magnitude);
  }
  return frames;
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  const length = channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  const gain = 1 / Math.max(1, channels.length);
  for (const channel of channels) {
    for (let i = 0; i < length; i += 1) mono[i] += channel[i] * gain;
  }
  return mono;
}

// --- Tempo and beat analysis ------------------------------------------------------

export type OnsetEnvelope = {
  /** Rectified, mean-removed log spectral flux, one value per hop. */
  env: Float64Array;
  /**
   * Power spectral flux, rectified: dominated by the most energetic events
   * (the kick, the accented note) rather than broadband noise (snares,
   * hats), it scores downbeat candidates.
   */
  accent: Float64Array;
  /** Envelope frames per second. */
  frameRate: number;
  /**
   * Seconds of frame 0: frames are stamped at their window's centre, which
   * places an estimate a few ms BEFORE a sharp attack (log flux registers an
   * onset as it enters the window), so the fade-in never clips a transient.
   */
  frameOffsetSec: number;
};

/**
 * Log-compressed spectral flux (sum of positive bin increases), minus a
 * 0.25 s local mean, half-wave rectified; plus the power flux as the
 * downbeat accent envelope.
 */
export function onsetEnvelope(
  mono: Float32Array,
  sampleRate: number = PART_SAMPLE_RATE,
): OnsetEnvelope {
  const bins = ONSET_FFT / 2 + 1;
  const previous = new Float64Array(bins);
  const previousLinear = new Float64Array(bins);
  const flux: number[] = [];
  const accentFlux: number[] = [];
  forEachSpectrum(mono, ONSET_FFT, ONSET_HOP, (frame, magnitude) => {
    let sum = 0;
    let linear = 0;
    for (let k = 1; k < bins; k += 1) {
      const level = Math.log1p(ONSET_LOG_GAIN * magnitude[k]);
      const rise = level - previous[k];
      if (frame > 0 && rise > 0) sum += rise;
      previous[k] = level;
      const power = magnitude[k] * magnitude[k];
      const powerRise = power - previousLinear[k];
      if (frame > 0 && powerRise > 0) linear += powerRise;
      previousLinear[k] = power;
    }
    flux.push(sum);
    accentFlux.push(linear);
  });
  const frameRate = sampleRate / ONSET_HOP;
  const half = Math.max(1, Math.round((ONSET_MEAN_WINDOW_SEC * frameRate) / 2));
  const env = new Float64Array(flux.length);
  // Running-sum local mean.
  const prefix = new Float64Array(flux.length + 1);
  for (let i = 0; i < flux.length; i += 1) prefix[i + 1] = prefix[i] + flux[i];
  for (let i = 0; i < flux.length; i += 1) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(flux.length, i + half + 1);
    const mean = (prefix[hi] - prefix[lo]) / (hi - lo);
    env[i] = Math.max(0, flux[i] - mean);
  }
  return {
    env,
    accent: Float64Array.from(accentFlux),
    frameRate,
    frameOffsetSec: ONSET_FFT / 2 / sampleRate,
  };
}

/** Gaussian-smoothed copy (σ in frames). */
function smooth(env: Float64Array, sigma: number): Float64Array {
  const radius = Math.ceil(sigma * 3);
  const kernel: number[] = [];
  let total = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const w = Math.exp((-0.5 * i * i) / (sigma * sigma));
    kernel.push(w);
    total += w;
  }
  const out = new Float64Array(env.length);
  for (let i = 0; i < env.length; i += 1) {
    let sum = 0;
    for (let j = -radius; j <= radius; j += 1) {
      const idx = i + j;
      if (idx >= 0 && idx < env.length) sum += env[idx] * kernel[j + radius];
    }
    out[i] = sum / total;
  }
  return out;
}

function sampleAt(env: Float64Array, x: number): number {
  if (x < 0 || x > env.length - 1) return 0;
  const i = Math.floor(x);
  const frac = x - i;
  return i + 1 < env.length ? env[i] * (1 - frac) + env[i + 1] * frac : env[i];
}

/** Mean envelope value on the comb φ + k·period, maximised over φ. */
function combScore(
  env: Float64Array,
  period: number,
  phaseStep: number,
): { score: number; phase: number } {
  let best = -Infinity;
  let bestPhase = 0;
  const last = env.length - 1;
  for (let phase = 0; phase < period; phase += phaseStep) {
    let sum = 0;
    let count = 0;
    for (let k = 0; ; k += 1) {
      const x = phase + k * period;
      if (x > last) break;
      sum += sampleAt(env, x);
      count += 1;
    }
    if (count === 0) continue;
    const score = sum / count;
    if (score > best) {
      best = score;
      bestPhase = phase;
    }
  }
  return { score: best === -Infinity ? 0 : best, phase: bestPhase };
}

export type TempoEstimate = {
  /** Take tempo / target tempo. */
  ratio: number;
  /** Peak / mean of the winning comb's ratio curve (≥ 1). */
  confidence: number;
  /** Which comb won: 1 = beats, 0.5 = half time, 2 = double time. */
  octave: number;
};

/**
 * Tempo ratio of a take against the target: every ratio r ∈ [0.90, 1.10]
 * (0.05 % steps, refined to 0.005 %) is scored with beat combs at B·r, B/2·r
 * and 2B·r; the best comb's r wins.
 */
export function estimateTempoRatio(
  onset: OnsetEnvelope,
  targetBpm: number,
): TempoEstimate {
  const coarseEnv = smooth(onset.env, 2);
  const fineEnv = smooth(onset.env, 1);
  const steps = Math.round((PART_RATIO_MAX - PART_RATIO_MIN) / COARSE_RATIO_STEP);
  const periodFor = (octave: number, ratio: number) =>
    (60 * onset.frameRate) / (octave * targetBpm * ratio);
  let best = { ratio: 1, confidence: 1, octave: 1, score: -Infinity };
  for (const octave of TEMPO_OCTAVES) {
    let peak = -Infinity;
    let peakRatio = 1;
    let total = 0;
    for (let s = 0; s <= steps; s += 1) {
      const ratio = PART_RATIO_MIN + s * COARSE_RATIO_STEP;
      const { score } = combScore(coarseEnv, periodFor(octave, ratio), 1);
      total += score;
      if (score > peak) {
        peak = score;
        peakRatio = ratio;
      }
    }
    const mean = total / (steps + 1);
    if (peak > best.score) {
      best = {
        ratio: peakRatio,
        confidence: mean > 0 ? peak / mean : 1,
        octave,
        score: peak,
      };
    }
  }
  if (!(best.score > 0)) return { ratio: 1, confidence: 1, octave: 1 };
  let fineRatio = best.ratio;
  let fineScore = -Infinity;
  const fineSteps = Math.round((2 * FINE_RATIO_HALF_SPAN) / FINE_RATIO_STEP);
  for (let s = 0; s <= fineSteps; s += 1) {
    const ratio = best.ratio - FINE_RATIO_HALF_SPAN + s * FINE_RATIO_STEP;
    if (ratio < PART_RATIO_MIN || ratio > PART_RATIO_MAX) continue;
    const { score } = combScore(fineEnv, periodFor(best.octave, ratio), 0.5);
    if (score > fineScore) {
      fineScore = score;
      fineRatio = ratio;
    }
  }
  return {
    ratio: round6(fineRatio),
    confidence: round4(best.confidence),
    octave: best.octave,
  };
}

/** Peak of `env` within ±radius frames of x. */
function peakNear(env: Float64Array, x: number, radius: number): number {
  let peak = 0;
  const lo = Math.max(0, Math.floor(x - radius));
  const hi = Math.min(env.length - 1, Math.ceil(x + radius));
  for (let i = lo; i <= hi; i += 1) if (env[i] > peak) peak = env[i];
  return peak;
}

/**
 * The chosen downbeat (seconds): the beat comb's best phase, then the
 * strongest of the first 4 beats at or after {@link PART_DOWNBEAT_MIN_SEC},
 * strength = the accent envelope's peak at that beat summed over every bar.
 * Also returns every beat time of the comb.
 */
export function estimateDownbeat(
  onset: OnsetEnvelope,
  beatBpm: number,
): { downbeatSec: number; beatsSec: number[] } {
  const env = smooth(onset.env, 1);
  const period = (60 * onset.frameRate) / beatBpm;
  const { phase } = combScore(env, period, 0.1);
  const frameToSec = (x: number) => x / onset.frameRate + onset.frameOffsetSec;
  const secToFrame = (t: number) => (t - onset.frameOffsetSec) * onset.frameRate;
  // Beat j sits at frame phase + j·period (j may be negative: the comb
  // extends before the first analysed frame).
  const firstIndex = Math.floor(
    (secToFrame(0) - phase) / period,
  );
  const beatsSec: number[] = [];
  for (let j = firstIndex; ; j += 1) {
    const t = frameToSec(phase + j * period);
    if (t < 0) continue;
    if (secToFrame(t) > env.length - 1 + period) break;
    beatsSec.push(t);
  }
  const startIndex = beatsSec.findIndex((t) => t >= PART_DOWNBEAT_MIN_SEC);
  if (startIndex < 0) {
    return { downbeatSec: PART_DOWNBEAT_MIN_SEC, beatsSec };
  }
  let bestCandidate = 0;
  let bestStrength = -Infinity;
  for (let c = 0; c < PART_BEATS_PER_BAR; c += 1) {
    let strength = 0;
    for (let i = startIndex + c; i < beatsSec.length; i += PART_BEATS_PER_BAR) {
      strength += peakNear(onset.accent, secToFrame(beatsSec[i]), 2);
    }
    if (strength > bestStrength) {
      bestStrength = strength;
      bestCandidate = c;
    }
  }
  const index = Math.min(startIndex + bestCandidate, beatsSec.length - 1);
  return { downbeatSec: beatsSec[index], beatsSec };
}

// --- Key analysis --------------------------------------------------------------------

export function tonicPitchClass(tonic: string): number | null {
  const pc = TONIC_PITCH_CLASS[tonic];
  return pc === undefined ? null : pc;
}

/**
 * The key's pitch-class set as the tonic of its major key: a major key k and
 * its relative minor (k + 9) % 12 are the same set.
 */
export function keySetOf(tonicPc: number, mode: "major" | "minor"): number {
  return mode === "major" ? tonicPc % 12 : (tonicPc + 3) % 12;
}

/** Minimal shift (−6..+5 semitones) moving set `from` onto set `to`. */
export function minimalKeyShift(from: number, to: number): number {
  const d = (((to - from) % 12) + 12) % 12;
  return d > 5 ? d - 12 : d;
}

/** Mean chroma (55 Hz – 5 kHz, nearest pitch class, A4 = 440 Hz). */
export function chromaVector(
  mono: Float32Array,
  sampleRate: number = PART_SAMPLE_RATE,
): number[] {
  const chroma = new Array<number>(12).fill(0);
  const binPc: number[] = [];
  for (let k = 0; k <= KEY_FFT / 2; k += 1) {
    const hz = (k * sampleRate) / KEY_FFT;
    if (hz < KEY_FMIN_HZ || hz > KEY_FMAX_HZ) {
      binPc.push(-1);
      continue;
    }
    const midi = 69 + 12 * Math.log2(hz / 440);
    binPc.push(((Math.round(midi) % 12) + 12) % 12);
  }
  forEachSpectrum(mono, KEY_FFT, KEY_HOP, (_frame, magnitude) => {
    for (let k = 0; k < binPc.length; k += 1) {
      const pc = binPc[k];
      if (pc >= 0) chroma[pc] += magnitude[k];
    }
  });
  return chroma;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

export type KeyEstimate = {
  tonic: string;
  mode: "major" | "minor";
  /** Set index (major tonic of the set). */
  set: number;
  /** Relative margin between the best and second-best key SET, in [0, 1]. */
  confidence: number;
};

/**
 * Krumhansl-Schmuckler over a chroma vector, scored per pitch-class set (the
 * better of the major key and its relative minor): confidence is the relative
 * margin to the best different set — a major/minor tie is not ambiguity here.
 */
export function estimateKeyFromChroma(chroma: number[]): KeyEstimate | null {
  const max = Math.max(...chroma);
  if (!(max > 0)) return null;
  const mean = chroma.reduce((s, v) => s + v, 0) / 12;
  const variance = chroma.reduce((s, v) => s + (v - mean) ** 2, 0) / 12;
  if (!(variance > 0)) return null;
  const rotate = (profile: number[], shift: number) =>
    profile.map((_, i) => profile[(i - shift + 12) % 12]);
  const setScores: Array<{
    set: number;
    score: number;
    tonic: number;
    mode: "major" | "minor";
  }> = [];
  for (let set = 0; set < 12; set += 1) {
    const major = pearson(chroma, rotate(KS_MAJOR, set));
    const minorTonic = (set + 9) % 12;
    const minor = pearson(chroma, rotate(KS_MINOR, minorTonic));
    setScores.push(
      major >= minor
        ? { set, score: major, tonic: set, mode: "major" }
        : { set, score: minor, tonic: minorTonic, mode: "minor" },
    );
  }
  setScores.sort((a, b) => b.score - a.score || a.set - b.set);
  const [first, second] = setScores;
  if (!(first.score > 0)) return null;
  const margin = Math.max(0, first.score - second.score) / Math.abs(first.score);
  return {
    tonic: PITCH_CLASS_NAMES[first.tonic],
    mode: first.mode,
    set: first.set,
    confidence: round4(Math.min(1, margin)),
  };
}

export function formatKey(tonic: string, mode: "major" | "minor"): string {
  return `${tonic} ${mode}`;
}

/** The key stage's decision for a take. */
export function planKeyShift(
  take: KeyEstimate | null,
  target: PartConformTarget,
): {
  semitones: number;
  keyConfidence: number | null;
  skipped?: PartKeySkippedReason;
  takeKey?: string;
  targetKey?: string;
} {
  if (!target.pitched) {
    return { semitones: 0, keyConfidence: null, skipped: "unpitched_role" };
  }
  const targetPc = target.key ? tonicPitchClass(target.key.tonic) : null;
  const targetKey =
    target.key && targetPc !== null
      ? formatKey(PITCH_CLASS_NAMES[targetPc], target.key.mode)
      : undefined;
  const takeKey = take ? formatKey(take.tonic, take.mode) : undefined;
  const base = {
    keyConfidence: take ? take.confidence : null,
    ...(takeKey ? { takeKey } : {}),
    ...(targetKey ? { targetKey } : {}),
  };
  if (!target.key || targetPc === null) {
    return { semitones: 0, ...base, skipped: "no_track_key" };
  }
  if (
    target.key.confidence === null ||
    target.key.confidence < PART_TRACK_KEY_CONFIDENCE_MIN
  ) {
    return { semitones: 0, ...base, skipped: "low_track_key_confidence" };
  }
  if (!take) return { semitones: 0, ...base, skipped: "no_take_key" };
  if (take.confidence < PART_TAKE_KEY_CONFIDENCE_MIN) {
    return { semitones: 0, ...base, skipped: "low_take_key_confidence" };
  }
  const semitones = minimalKeyShift(
    take.set,
    keySetOf(targetPc, target.key.mode),
  );
  return { semitones, ...base };
}

// --- The conform -----------------------------------------------------------------------

/** Exact output length in frames: N bars of 4 beats at the target tempo. */
export function partLengthFrames(
  bpm: number,
  bars: number,
  sampleRate: number = PART_SAMPLE_RATE,
): number {
  return Math.round(((bars * PART_BEATS_PER_BAR * 60) / bpm) * sampleRate);
}

/** Copy [start, start + length) of each channel, zero-padded outside. */
function sliceChannels(
  channels: Float32Array[],
  start: number,
  length: number,
): Float32Array[] {
  return channels.map((channel) => {
    const out = new Float32Array(length);
    const s = Math.max(0, start);
    const e = Math.min(channel.length, start + length);
    if (e > s) out.set(channel.subarray(s, e), s - start);
    return out;
  });
}

/**
 * Pick the cut start: the chosen downbeat when N bars fit after it, else the
 * earliest bar-aligned beat that fits, else the earliest beat that fits, else
 * 0 (the cut is then zero-padded).
 */
function chooseStart(
  downbeatSec: number,
  beatsSec: number[],
  lengthSec: number,
  durationSec: number,
): { startSec: number; padded: boolean } {
  const fits = (t: number) => t >= 0 && t + lengthSec <= durationSec + 1e-9;
  if (fits(downbeatSec)) return { startSec: downbeatSec, padded: false };
  const downbeatIndex = beatsSec.findIndex(
    (t) => Math.abs(t - downbeatSec) < 1e-9,
  );
  if (downbeatIndex >= 0) {
    for (let i = downbeatIndex % PART_BEATS_PER_BAR; i < beatsSec.length; i += PART_BEATS_PER_BAR) {
      if (fits(beatsSec[i])) return { startSec: beatsSec[i], padded: false };
    }
  }
  const any = beatsSec.find(fits);
  if (any !== undefined) return { startSec: any, padded: false };
  return { startSec: 0, padded: lengthSec > durationSec + 1e-9 };
}

/** Loop-safe edges, in place (see the module comment). */
export function shapeLoopEdges(
  loop: Float32Array[],
  preRoll: Float32Array[],
  sampleRate: number = PART_SAMPLE_RATE,
): void {
  const length = loop[0].length;
  const fade = Math.max(1, Math.round(PART_FADE_IN_SEC * sampleRate));
  const cross = Math.min(
    Math.max(fade, Math.round(PART_CROSSFADE_SEC * sampleRate)),
    Math.floor(length / 2),
  );
  for (let c = 0; c < loop.length; c += 1) {
    const out = loop[c];
    const pre = Float32Array.from(preRoll[c]);
    // The pre-roll's last `fade` samples mirror the fade-in, so the loop's
    // end reaches 0 exactly where its (faded) start begins.
    for (let i = 0; i < fade && i < pre.length; i += 1) {
      pre[pre.length - 1 - i] *= Math.sin((Math.PI / 2) * ((i + 1) / (fade + 1)));
    }
    // Equal-power crossfade: tail → pre-roll.
    const offset = pre.length - cross;
    for (let i = 0; i < cross; i += 1) {
      const theta = (Math.PI / 2) * ((i + 1) / cross);
      const tailIndex = length - cross + i;
      const preSample = offset + i >= 0 ? pre[offset + i] : 0;
      out[tailIndex] = out[tailIndex] * Math.cos(theta) + preSample * Math.sin(theta);
    }
    for (let i = 0; i < fade; i += 1) {
      out[i] *= Math.sin((Math.PI / 2) * (i / fade));
    }
  }
}

/**
 * Conform decoded 48 kHz stereo audio to the target. Pure and deterministic
 * (the stretch engine is seeded); returns exactly
 * {@link partLengthFrames}(bpm, bars) frames per channel.
 */
export async function conformPartPcm(
  channels: Float32Array[],
  target: PartConformTarget,
  options: { stretchApi?: StretchApi } = {},
): Promise<{ channels: Float32Array[]; record: PartConformRecord }> {
  if (!(target.bpm > 0) || !(target.bars > 0)) {
    throw new RangeError("Conform needs a positive target tempo and bar count.");
  }
  const sampleRate = PART_SAMPLE_RATE;
  const stereo =
    channels.length >= 2 ? channels.slice(0, 2) : [channels[0], channels[0]];
  const durationSec = stereo[0].length / sampleRate;
  const mono = mixToMono(stereo);

  // Tempo + phase.
  const onset = onsetEnvelope(mono, sampleRate);
  const tempo = estimateTempoRatio(onset, target.bpm);
  const confident = tempo.confidence >= PART_TEMPO_CONFIDENCE_MIN;
  const ratio = confident ? tempo.ratio : 1;
  const takeBpm = target.bpm * ratio;
  const { downbeatSec, beatsSec } = estimateDownbeat(onset, takeBpm);

  // Cut.
  const lengthFrames = partLengthFrames(target.bpm, target.bars, sampleRate);
  const takeLengthSec = (target.bars * PART_BEATS_PER_BAR * 60) / takeBpm;
  const { startSec, padded } = chooseStart(
    downbeatSec,
    beatsSec,
    takeLengthSec,
    durationSec,
  );

  // Key.
  const keyPlan = planKeyShift(
    target.pitched ? estimateKeyFromChroma(chromaVector(mono, sampleRate)) : null,
    target,
  );

  // Stretch [start − pre, start + len + post) to the exact bar length.
  const crossFrames = Math.round(PART_CROSSFADE_SEC * sampleRate);
  const inLength = Math.round(takeLengthSec * sampleRate);
  const tempoFactor = inLength / lengthFrames; // engine playback rate
  const preIn = Math.ceil((crossFrames + 2) * tempoFactor);
  const postIn = Math.round(STRETCH_POST_ROLL_SEC * sampleRate);
  const startFrame = Math.round(startSec * sampleRate);
  const region = sliceChannels(stereo, startFrame - preIn, preIn + inLength + postIn);
  const identity =
    Math.abs(tempoFactor - 1) < 1e-9 && keyPlan.semitones === 0;
  let stretched: Float32Array[];
  let preOut: number;
  if (identity) {
    stretched = region;
    preOut = preIn;
  } else {
    const api = options.stretchApi ?? (await createStretchEngine());
    stretched = stretchOffline(api, region, sampleRate, {
      tempo: tempoFactor,
      semitones: keyPlan.semitones,
    }).out;
    preOut = Math.round(preIn / tempoFactor);
  }
  const loop = stretched.map((channel) => {
    const out = new Float32Array(lengthFrames);
    const available = Math.max(0, Math.min(lengthFrames, channel.length - preOut));
    out.set(channel.subarray(preOut, preOut + available));
    return out;
  });
  const preRoll = stretched.map((channel) =>
    channel.slice(Math.max(0, preOut - crossFrames), preOut),
  );
  shapeLoopEdges(loop, preRoll, sampleRate);

  const record: PartConformRecord = {
    conformVersion: REMIX_PART_CONFORM_VERSION,
    targetBpm: target.bpm,
    estimatedRatio: ratio,
    tempoConfidence: tempo.confidence,
    startSec: round6(startSec),
    keyShiftSemitones: keyPlan.semitones,
    keyConfidence: keyPlan.keyConfidence,
    ...(keyPlan.skipped ? { keySkippedReason: keyPlan.skipped } : {}),
    ...(keyPlan.takeKey ? { takeKey: keyPlan.takeKey } : {}),
    ...(keyPlan.targetKey ? { targetKey: keyPlan.targetKey } : {}),
    ...(padded ? { padded: true as const } : {}),
    lengthFrames,
  };
  return { channels: loop, record };
}

// --- ffmpeg edges -------------------------------------------------------------------------

/** Decode args: any container → raw f32le 48 kHz stereo, at most 40 s. */
export function buildPartDecodeArgs(inputPath: string, outputPath: string): string[] {
  return [
    "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
    "-t", String(MAX_TAKE_DECODE_SEC),
    "-i", inputPath,
    "-vn",
    "-f", "f32le", "-c:a", "pcm_f32le",
    "-ac", String(PART_CHANNELS), "-ar", String(PART_SAMPLE_RATE),
    outputPath,
  ];
}

/** Encode args: raw f32le 48 kHz stereo → 16-bit FLAC, bit-exact (no encoder tag). */
export function buildPartEncodeArgs(inputPath: string, outputPath: string): string[] {
  return [
    "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
    "-f", "f32le", "-ar", String(PART_SAMPLE_RATE), "-ac", String(PART_CHANNELS),
    "-i", inputPath,
    "-map_metadata", "-1",
    "-fflags", "+bitexact", "-flags:a", "+bitexact",
    "-c:a", "flac", "-sample_fmt", "s16",
    outputPath,
  ];
}

function interleave(channels: Float32Array[]): Buffer {
  const frames = channels[0].length;
  const nCh = channels.length;
  const out = Buffer.alloc(frames * nCh * 4);
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < nCh; c += 1) {
      out.writeFloatLE(channels[c][i], (i * nCh + c) * 4);
    }
  }
  return out;
}

function deinterleave(raw: Buffer, nCh: number): Float32Array[] {
  const frames = Math.floor(raw.length / (4 * nCh));
  const channels = Array.from({ length: nCh }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < nCh; c += 1) {
      channels[c][i] = raw.readFloatLE((i * nCh + c) * 4);
    }
  }
  return channels;
}

/** Safe, user-facing conform failure (internal detail goes to `logError`). */
export class PartConformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartConformError";
  }
}

export async function decodePartAudio(
  audio: Buffer,
  workDir: string,
): Promise<Float32Array[]> {
  if (audio.length === 0 || audio.length > MAX_TAKE_INPUT_BYTES) {
    throw new PartConformError("The generated clip has an unusable size.");
  }
  const inputPath = join(workDir, "take-input.bin");
  const rawPath = join(workDir, "take-decoded.f32");
  await writeFile(inputPath, audio);
  await execFileAsync("ffmpeg", buildPartDecodeArgs(inputPath, rawPath), {
    timeout: FFMPEG_TIMEOUT_MS,
  });
  const raw = await readFile(rawPath);
  const channels = deinterleave(raw, PART_CHANNELS);
  if (channels[0].length < PART_SAMPLE_RATE) {
    throw new PartConformError("The generated clip is too short to use.");
  }
  return channels;
}

export async function encodePartFlac(
  channels: Float32Array[],
  workDir: string,
): Promise<Buffer> {
  const rawPath = join(workDir, "take-conformed.f32");
  const flacPath = join(workDir, "take-conformed.flac");
  await writeFile(rawPath, interleave(channels));
  await execFileAsync("ffmpeg", buildPartEncodeArgs(rawPath, flacPath), {
    timeout: FFMPEG_TIMEOUT_MS,
  });
  return readFile(flacPath);
}

export type ConformedPartTake = {
  flac: Buffer;
  record: PartConformRecord;
  durationSec: number;
};

/**
 * Provider clip bytes in, conformed FLAC out. Temp files live in one private
 * directory removed on every path; the DSP runs in a worker thread unless
 * `useWorker` is false (tests).
 */
export async function conformPartClip(
  audio: Buffer,
  target: PartConformTarget,
  options: { useWorker?: boolean; logError?: (message: string) => void } = {},
): Promise<ConformedPartTake> {
  const workDir = await mkdtemp(join(tmpdir(), "remix-part-"));
  try {
    let decoded: Float32Array[];
    try {
      decoded = await decodePartAudio(audio, workDir);
    } catch (error) {
      options.logError?.(
        `part decode failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (error instanceof PartConformError) throw error;
      throw new PartConformError("The generated clip could not be decoded.");
    }
    const conformed =
      options.useWorker === false
        ? await conformPartPcm(decoded, target)
        : await conformPartPcmInWorker(decoded, target);
    let flac: Buffer;
    try {
      flac = await encodePartFlac(conformed.channels, workDir);
    } catch (error) {
      options.logError?.(
        `part encode failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new PartConformError("The conformed take could not be encoded.");
    }
    return {
      flac,
      record: conformed.record,
      durationSec: round6(conformed.record.lengthFrames / PART_SAMPLE_RATE),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// --- Worker thread -----------------------------------------------------------------------

const WORKER_KIND = "remix-part-conform/worker";

type ConformWorkerReply =
  | { ok: true; channels: Float32Array[]; record: PartConformRecord }
  | { ok: false; error: string };

/**
 * {@link conformPartPcm} in a `worker_threads` worker (one per take). Under
 * ts-node/jest the worker bootstraps ts-node (transpile-only), like the
 * #1898 stretch worker.
 */
export function conformPartPcmInWorker(
  channels: Float32Array[],
  target: PartConformTarget,
  { timeoutMs = 300_000 }: { timeoutMs?: number } = {},
): Promise<{ channels: Float32Array[]; record: PartConformRecord }> {
  const data = { kind: WORKER_KIND, channels, target };
  const worker = __filename.endsWith(".ts")
    ? new Worker(
        [
          `require("ts-node").register({ transpileOnly: true, skipProject: true, compilerOptions: { module: "CommonJS", target: "ES2022", esModuleInterop: true } });`,
          `require(${JSON.stringify(__filename)});`,
        ].join("\n"),
        { eval: true, workerData: data },
      )
    : new Worker(__filename, { workerData: data });
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      settle(() => reject(new Error("Part conform worker timed out.")));
      void worker.terminate();
    }, timeoutMs);
    worker.once("message", (message: ConformWorkerReply) => {
      settle(() => {
        if (message.ok) {
          resolvePromise({ channels: message.channels, record: message.record });
        } else reject(new Error(message.error));
      });
    });
    worker.once("error", (error) => settle(() => reject(error)));
    worker.once("exit", (code) =>
      settle(() => reject(new Error(`Part conform worker exited with code ${code}.`))),
    );
  });
}

if (
  !isMainThread &&
  parentPort &&
  (workerData as { kind?: unknown } | null)?.kind === WORKER_KIND
) {
  const port = parentPort;
  const { channels, target } = workerData as {
    channels: Float32Array[];
    target: PartConformTarget;
  };
  conformPartPcm(channels, target).then(
    (result) =>
      port.postMessage(
        { ok: true, ...result } satisfies ConformWorkerReply,
        result.channels.map((channel) => channel.buffer as ArrayBuffer),
      ),
    (error: unknown) =>
      port.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ConformWorkerReply),
  );
}

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
