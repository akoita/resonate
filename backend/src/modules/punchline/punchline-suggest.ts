/**
 * Suggested golden-moment ranges (#1476 slice 3).
 *
 * Pure helpers: turn decoded audio into a loudness envelope, then rank
 * non-overlapping candidate ranges on it (the loudest stretch, or a lift after
 * a quieter passage), snapped to the measured beat grid when one is known.
 * Suggestions only: the artist always picks and adjusts the range.
 */

/** Window of the loudness envelope. */
export const SUGGEST_WINDOW_MS = 250;
/** Sample rate the scan decodes to (mono, 16-bit). Loudness needs no more. */
export const SUGGEST_SAMPLE_RATE = 8000;
/** Preferred moment length before snapping to bars and bounds. */
export const SUGGEST_TARGET_MS = 8000;
/** Default number of suggestions. */
export const SUGGEST_MAX_COUNT = 3;

const SILENCE_FLOOR_DB = -90;
/** A candidate quieter than this on average is not worth suggesting. */
const MIN_MEAN_DB = -50;
/** Rise over the preceding stretch that makes a candidate a "lift". */
const LIFT_THRESHOLD_DB = 3;
const LIFT_WEIGHT = 0.5;

export type SuggestedRangeReason = "peak" | "lift";

export interface SuggestedRange {
  startMs: number;
  endMs: number;
  /** Mean loudness of the range in dBFS (rounded). */
  loudnessDb: number;
  /** Loudness rise over the stretch just before it, in dB (rounded). */
  liftDb: number;
  reason: SuggestedRangeReason;
}

export interface SuggestOptions {
  durationMs: number;
  windowMs: number;
  minMs: number;
  maxMs: number;
  tempoBpm?: number | null;
  firstBeatSec?: number | null;
  count?: number;
}

/** RMS loudness in dBFS per window of mono signed 16-bit little-endian PCM. */
export function loudnessEnvelope(pcm: Buffer, sampleRate: number, windowMs: number): number[] {
  const samplesPerWindow = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const totalSamples = Math.floor(pcm.length / 2);
  const envelope: number[] = [];
  for (let start = 0; start < totalSamples; start += samplesPerWindow) {
    const end = Math.min(totalSamples, start + samplesPerWindow);
    let sumSquares = 0;
    for (let i = start; i < end; i++) {
      const sample = pcm.readInt16LE(i * 2) / 32768;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
    envelope.push(rms > 0 ? Math.max(SILENCE_FLOOR_DB, 20 * Math.log10(rms)) : SILENCE_FLOOR_DB);
  }
  return envelope;
}

function beatMsOf(tempoBpm?: number | null): number | null {
  return tempoBpm && Number.isFinite(tempoBpm) && tempoBpm > 0 ? 60000 / tempoBpm : null;
}

/**
 * The suggested length: about 8 s, rounded to whole bars (4 beats) when the
 * tempo is known, and always inside the layer's bounds.
 */
export function suggestedLengthMs(minMs: number, maxMs: number, tempoBpm?: number | null): number {
  const clamp = (ms: number) => Math.min(maxMs, Math.max(minMs, ms));
  const beatMs = beatMsOf(tempoBpm);
  if (!beatMs) return clamp(SUGGEST_TARGET_MS);
  const barMs = beatMs * 4;
  const bars = Math.max(1, Math.round(SUGGEST_TARGET_MS / barMs));
  for (let b = bars; b >= 1; b--) {
    const ms = Math.round(b * barMs);
    if (ms >= minMs && ms <= maxMs) return ms;
  }
  // No whole bar fits: fall back to whole beats, then to the plain target.
  const beats = Math.floor(maxMs / beatMs);
  const beatLength = Math.round(beats * beatMs);
  return beatLength >= minMs ? beatLength : clamp(SUGGEST_TARGET_MS);
}

/** Move a start time to the nearest beat of the grid, never before 0. */
function snapToBeat(ms: number, beatMs: number | null, firstBeatSec?: number | null): number {
  if (!beatMs) return ms;
  const origin = (firstBeatSec ?? 0) * 1000;
  const k = Math.round((ms - origin) / beatMs);
  let snapped = origin + k * beatMs;
  while (snapped < 0) snapped += beatMs;
  return Math.round(snapped);
}

/**
 * Rank up to `count` non-overlapping ranges on the envelope. The score is the
 * range's mean loudness plus half of its rise over the equally long stretch
 * before it, so a chorus that lifts out of a verse beats a flat loud bed.
 */
export function suggestMomentRanges(envelope: number[], options: SuggestOptions): SuggestedRange[] {
  const { durationMs, windowMs, minMs, maxMs } = options;
  const count = options.count ?? SUGGEST_MAX_COUNT;
  if (envelope.length === 0 || durationMs < minMs || count <= 0) return [];

  const lengthMs = Math.min(suggestedLengthMs(minMs, maxMs, options.tempoBpm), durationMs);
  if (lengthMs < minMs) return [];
  const span = Math.max(1, Math.round(lengthMs / windowMs));
  if (span > envelope.length) return [];

  const prefix = [0];
  for (const value of envelope) prefix.push(prefix[prefix.length - 1]! + value);
  const mean = (from: number, to: number) => (prefix[to]! - prefix[from]!) / (to - from);

  const candidates: Array<{ index: number; score: number; loudness: number; lift: number }> = [];
  for (let i = 0; i + span <= envelope.length; i++) {
    const loudness = mean(i, i + span);
    if (loudness < MIN_MEAN_DB) continue;
    const before = i >= span ? mean(i - span, i) : i > 0 ? mean(0, i) : loudness;
    const lift = loudness - before;
    candidates.push({ index: i, score: loudness + LIFT_WEIGHT * Math.max(0, lift), loudness, lift });
  }
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);

  const beatMs = beatMsOf(options.tempoBpm);
  const picked: SuggestedRange[] = [];
  for (const candidate of candidates) {
    if (picked.length >= count) break;
    let startMs = snapToBeat(candidate.index * windowMs, beatMs, options.firstBeatSec);
    if (startMs + lengthMs > durationMs) {
      startMs = Math.max(0, durationMs - lengthMs);
      if (beatMs) {
        const snapped = snapToBeat(startMs, beatMs, options.firstBeatSec);
        startMs = snapped + lengthMs <= durationMs ? snapped : Math.max(0, Math.round(snapped - beatMs));
      }
    }
    const endMs = startMs + lengthMs;
    if (endMs > durationMs) continue;
    if (picked.some((range) => startMs < range.endMs && endMs > range.startMs)) continue;
    picked.push({
      startMs,
      endMs,
      loudnessDb: Math.round(candidate.loudness),
      liftDb: Math.round(candidate.lift),
      reason: candidate.lift >= LIFT_THRESHOLD_DB ? "lift" : "peak",
    });
  }
  return picked.sort((a, b) => a.startMs - b.startMs);
}
