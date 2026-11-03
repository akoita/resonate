/**
 * Grid correction helpers (#2539, Remix Studio Pro S6c of #1903): tap tempo
 * and a downbeat nudge. The corrected tempo and first downbeat are saved as a
 * project-level override; the server derives the section grid from it, so
 * the studio, the beat maker, AI parts, the preview and the render all read
 * the same grid. The measured analysis is never changed.
 */
import type { RemixGridOverride, RemixSectionGrid } from "./api";

export const GRID_MIN_BPM = 30;
export const GRID_MAX_BPM = 300;
/** Taps further apart than this start a new count. */
export const TAP_RESET_MS = 2000;
/** Only the most recent taps count, so a drifting hand settles quickly. */
export const TAP_WINDOW = 8;
export const NUDGE_FINE_MS = 10;

/** Tap times (ms) after a new tap: a long gap starts over; the window is capped. */
export function addTap(taps: readonly number[], now: number): number[] {
  const last = taps[taps.length - 1];
  const next = last !== undefined && now - last <= TAP_RESET_MS ? [...taps, now] : [now];
  return next.slice(-TAP_WINDOW);
}

/**
 * BPM from tap times: 60 000 / the median interval, rounded to 0.1. Needs
 * at least four taps (three intervals); null outside the accepted range.
 */
export function tapTempoBpm(taps: readonly number[]): number | null {
  if (taps.length < 4) return null;
  const intervals = taps.slice(1).map((t, i) => t - taps[i]!).sort((a, b) => a - b);
  const mid = Math.floor(intervals.length / 2);
  const median = intervals.length % 2 ? intervals[mid]! : (intervals[mid - 1]! + intervals[mid]!) / 2;
  if (!(median > 0)) return null;
  const bpm = Math.round((60_000 / median) * 10) / 10;
  return bpm >= GRID_MIN_BPM && bpm <= GRID_MAX_BPM ? bpm : null;
}

/**
 * Move the first downbeat by whole beats and milliseconds. It never goes
 * below 0: an earlier downbeat wraps forward by one bar (4 beats), which is
 * the same grid one bar later.
 */
export function nudgeFirstBeat(firstBeatSec: number, bpm: number, beats: number, ms: number): number {
  const beatSec = 60 / bpm;
  const barSec = 4 * beatSec;
  let next = firstBeatSec + beats * beatSec + ms / 1000;
  while (next < 0) next += barSec;
  return Math.round(next * 1000) / 1000;
}

export type GridDraft = { tempoBpm: number; firstBeatSec: number };

/** The grid the studio starts the editor from: the current (served) values. */
export function gridDraftFrom(grid: RemixSectionGrid): GridDraft | null {
  if (grid.kind !== "bars" || !grid.bpm) {
    const measuredBpm = grid.measured?.bpm;
    return measuredBpm ? { tempoBpm: measuredBpm, firstBeatSec: grid.measured?.firstBeatSec ?? 0 } : null;
  }
  return { tempoBpm: Math.round(grid.bpm * 1000) / 1000, firstBeatSec: grid.firstBeatSec ?? 0 };
}

/** PATCH body for a draft, or null when the tempo is out of range. */
export function gridOverridePayload(draft: GridDraft): RemixGridOverride | null {
  if (!Number.isFinite(draft.tempoBpm) || draft.tempoBpm < GRID_MIN_BPM || draft.tempoBpm > GRID_MAX_BPM) return null;
  if (!Number.isFinite(draft.firstBeatSec) || draft.firstBeatSec < 0) return null;
  return {
    schemaVersion: "remix-grid-override/v1",
    tempoBpm: Math.round(draft.tempoBpm * 1000) / 1000,
    firstBeatSec: Math.round(draft.firstBeatSec * 1000) / 1000,
  };
}

/** True when the draft differs from what the grid already uses. */
export function gridDraftChanged(grid: RemixSectionGrid, draft: GridDraft): boolean {
  const current = gridDraftFrom(grid);
  if (!current) return true;
  return Math.abs(current.tempoBpm - draft.tempoBpm) > 1e-6 || Math.abs(current.firstBeatSec - draft.firstBeatSec) > 1e-6;
}

export function formatBpm(bpm: number): string {
  return `${bpm.toFixed(1)} BPM`;
}

export function formatSeconds(sec: number): string {
  return `${sec.toFixed(3)} s`;
}
