/**
 * Shared definitions of the punch compressor parity fixture (#1903 S6b):
 * the deterministic test signal and the cases pinned in
 * remix-fx-dyn-v1.parity.json. web/src/lib/remixPunchCompressor.test.ts
 * replays the same signal (keep the two `punchSignal` copies identical).
 */

import { join } from "path";
import type { RemixFxPunchCompressor } from "../modules/remix/remix-fx";

export const DYN_FIXTURE_PATH = join(
  __dirname,
  "../modules/remix/remix-fx-dyn-v1.parity.json",
);

/** Punch amounts whose mapping the fixture pins (0 = no stage). */
export const DYN_PUNCH_POINTS = [0, 0.01, 0.25, 0.5, 0.75, 1] as const;

/** Signal cases whose ffmpeg output the fixture pins. */
export const DYN_SIGNAL_CASES = [
  { punch: 0.25, sampleRate: 48_000, channels: 2 },
  { punch: 0.5, sampleRate: 48_000, channels: 2 },
  { punch: 1, sampleRate: 48_000, channels: 2 },
  { punch: 0.5, sampleRate: 44_100, channels: 2 },
  { punch: 0.75, sampleRate: 48_000, channels: 1 },
] as const;

/**
 * 0.5 s: a quiet passage (0.05), a loud one (0.9) and a mid one (0.2), so
 * the attack, the release and the knee are all exercised. Channel 0 is a
 * 220 Hz sine, channel 1 a 331 Hz sine at 0.6× with a 0.3 rad phase.
 */
export function punchSignal(sampleRate: number, channels: number): Float64Array[] {
  const frames = Math.round(0.5 * sampleRate);
  const out = Array.from({ length: channels }, () => new Float64Array(frames));
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const env = t < 0.125 ? 0.05 : t < 0.29 ? 0.9 : 0.2;
    out[0][i] = env * Math.sin(2 * Math.PI * 220 * t);
    if (channels > 1) out[1][i] = env * 0.6 * Math.sin(2 * Math.PI * 331 * t + 0.3);
  }
  return out;
}

export type DynFixture = {
  schemaVersion: string;
  dspVersion: string;
  note: string;
  ffmpegVersion: string;
  mapping: Array<{ punch: number; compressor: RemixFxPunchCompressor | null }>;
  filter: Array<{ punch: number; filter: string }>;
  checkpointEvery: number;
  signals: Array<{
    punch: number;
    sampleRate: number;
    channels: number;
    checkpoints: number[][];
  }>;
};
