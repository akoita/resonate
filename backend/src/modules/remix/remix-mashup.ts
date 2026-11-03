/**
 * Mashups (#2558, Remix Studio Pro S6f-3a of #1903).
 *
 * A mashup project has a second source track B next to its leading source A
 * (`RemixProject.sourceTrackId`). A leads: bars, structure, cues, automation,
 * the beat and AI parts all count on A's grid. The `remix-mashup/v1` recipe
 * says how B is conformed to A: stretched by `tempoRatio` (pitch kept),
 * shifted by its own `semitones`, its downbeat optionally corrected
 * (`firstBeatSec`), and its bar 1 placed on A's bar `offsetBars`. The render
 * applies it in S6f-3b (#2559); see docs/rfc/remix-mashups.md.
 */
import { REMIX_FX_SEMITONES_MAX, REMIX_FX_SEMITONES_MIN } from "./remix-fx";
import { GRID_OVERRIDE_MAX_FIRST_BEAT_SEC } from "./remix-arrangement";

export const REMIX_MASHUP_SCHEMA_VERSION = "remix-mashup/v1" as const;

/**
 * Stretch range for B (owner decision D5): beyond about ±4 semitones' worth
 * of time the stretch artefacts are audible, and the studio says the two
 * tracks are too far apart.
 */
export const MASHUP_TEMPO_RATIO_MIN = 0.75;
export const MASHUP_TEMPO_RATIO_MAX = 1.33;
/** B's own key shift shares the master's range. */
export const MASHUP_SEMITONES_MIN = REMIX_FX_SEMITONES_MIN;
export const MASHUP_SEMITONES_MAX = REMIX_FX_SEMITONES_MAX;
/** Highest bar of A that B's bar 1 may start on (as for the cues). */
export const MASHUP_MAX_OFFSET_BARS = 2000;
export const MASHUP_MAX_FIRST_BEAT_SEC = GRID_OVERRIDE_MAX_FIRST_BEAT_SEC;

export type RemixMashupSecondary = {
  /** A's BPM divided by B's: B plays this many times faster. */
  tempoRatio: number;
  /** B's own key shift, whole semitones. */
  semitones: number;
  /** A's bar (bar 1 = 0) that B's bar 1 lands on. */
  offsetBars: number;
  /** Corrected first downbeat of B, seconds in B's own audio; absent = measured. */
  firstBeatSec?: number;
};

export type RemixMashup = {
  schemaVersion: typeof REMIX_MASHUP_SCHEMA_VERSION;
  secondary: RemixMashupSecondary;
};

export class RemixMashupValidationError extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Validates a PATCH value: null clears the recipe; an object must be a
 * complete, in-range `remix-mashup/v1` (the schema version may be omitted).
 * Throws {@link RemixMashupValidationError} with a field-level message.
 */
export function normalizeRemixMashupInput(value: unknown): RemixMashup | null {
  if (value === null) return null;
  if (!isPlainObject(value)) {
    throw new RemixMashupValidationError("mashup must be an object or null");
  }
  if (
    value.schemaVersion !== undefined &&
    value.schemaVersion !== REMIX_MASHUP_SCHEMA_VERSION
  ) {
    throw new RemixMashupValidationError(
      `mashup.schemaVersion must be ${REMIX_MASHUP_SCHEMA_VERSION}`,
    );
  }
  const secondary = value.secondary;
  if (!isPlainObject(secondary)) {
    throw new RemixMashupValidationError("mashup.secondary must be an object");
  }
  const { tempoRatio, semitones, offsetBars, firstBeatSec } = secondary;
  if (
    typeof tempoRatio !== "number" ||
    !Number.isFinite(tempoRatio) ||
    tempoRatio < MASHUP_TEMPO_RATIO_MIN ||
    tempoRatio > MASHUP_TEMPO_RATIO_MAX
  ) {
    throw new RemixMashupValidationError(
      `mashup.secondary.tempoRatio must be between ${MASHUP_TEMPO_RATIO_MIN} and ${MASHUP_TEMPO_RATIO_MAX}; the two tracks are too far apart in tempo otherwise`,
    );
  }
  if (
    typeof semitones !== "number" ||
    !Number.isInteger(semitones) ||
    semitones < MASHUP_SEMITONES_MIN ||
    semitones > MASHUP_SEMITONES_MAX
  ) {
    throw new RemixMashupValidationError(
      `mashup.secondary.semitones must be a whole number between ${MASHUP_SEMITONES_MIN} and ${MASHUP_SEMITONES_MAX}`,
    );
  }
  if (
    typeof offsetBars !== "number" ||
    !Number.isInteger(offsetBars) ||
    offsetBars < 0 ||
    offsetBars > MASHUP_MAX_OFFSET_BARS
  ) {
    throw new RemixMashupValidationError(
      `mashup.secondary.offsetBars must be a whole number between 0 and ${MASHUP_MAX_OFFSET_BARS}`,
    );
  }
  if (
    firstBeatSec !== undefined &&
    firstBeatSec !== null &&
    (typeof firstBeatSec !== "number" ||
      !Number.isFinite(firstBeatSec) ||
      firstBeatSec < 0 ||
      firstBeatSec > MASHUP_MAX_FIRST_BEAT_SEC)
  ) {
    throw new RemixMashupValidationError(
      `mashup.secondary.firstBeatSec must be null or between 0 and ${MASHUP_MAX_FIRST_BEAT_SEC} seconds`,
    );
  }
  return {
    schemaVersion: REMIX_MASHUP_SCHEMA_VERSION,
    secondary: {
      tempoRatio: round6(tempoRatio),
      semitones,
      offsetBars,
      ...(typeof firstBeatSec === "number"
        ? { firstBeatSec: round6(firstBeatSec) }
        : {}),
    },
  };
}

/** Reads a stored recipe tolerantly: anything invalid reads as null. */
export function parseRemixMashup(value: unknown): RemixMashup | null {
  if (value === null || value === undefined) return null;
  try {
    return normalizeRemixMashupInput(value);
  } catch {
    return null;
  }
}

/** Whether a PATCH sets a recipe that differs from the stored one. */
export function mashupChanged(
  next: RemixMashup | null,
  stored: RemixMashup | null,
): boolean {
  return next !== null && JSON.stringify(next) !== JSON.stringify(stored);
}
