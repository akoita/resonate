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
import {
  GRID_OVERRIDE_MAX_FIRST_BEAT_SEC,
  type SectionGrid,
} from "./remix-arrangement";
import { timelineDownbeats } from "./remix-cues";
import { structureTimeline } from "./remix-structure";

export const REMIX_MASHUP_SCHEMA_VERSION = "remix-mashup/v1" as const;
/**
 * How the render and the preview conform B (#2559): each B stem is
 * stretched by B's ratio and key (the pinned Signalsmith engine), shifted
 * by whole samples onto A's bar and cut at A's end, in A's source time;
 * the master's tempo and key then apply to it like any stem. Changing any
 * of it changes every mashup render, so it needs a new version.
 */
export const REMIX_MASHUP_DSP_VERSION = "remix-mashup-dsp/v1" as const;

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

/**
 * How one of B's stems is conformed to A's source time (#2559): stretched by
 * `tempo` with its key moved `semitones`, then shifted by `shiftSec` (a
 * positive shift delays it, a negative one trims its start) and cut at
 * `endSec`, A's length. All in A's source time, before the master stretch.
 */
export type MashupConform = {
  tempo: number;
  semitones: number;
  shiftSec: number;
  endSec: number | null;
};

export type MashupConformSkip =
  | "no_lead_grid"
  | "offset_past_end";

/**
 * The conform plan for B (#2559), or why the render plays B as it is:
 * A needs a bar grid, and B's bar 1 must land on one of A's downbeats.
 * B's first downbeat is the recipe's correction, else its measured one,
 * else 0. A's downbeats are the unstructured timeline's, the same bars the
 * studio, the cues and the beat count.
 */
export function mashupConformPlan(input: {
  leadGrid: SectionGrid | null;
  secondaryStems: Array<{ audioFeatures?: unknown }>;
  mashup: RemixMashup;
}): { conform: MashupConform } | { skipped: MashupConformSkip } {
  const { leadGrid, mashup } = input;
  if (!leadGrid || leadGrid.kind !== "bars" || !leadGrid.bpm) {
    return { skipped: "no_lead_grid" };
  }
  const downbeats = timelineDownbeats(
    leadGrid,
    structureTimeline(leadGrid, null),
  );
  const target = downbeats[mashup.secondary.offsetBars];
  if (target === undefined) return { skipped: "offset_past_end" };
  const secondaryFirstBeat =
    mashup.secondary.firstBeatSec ??
    measuredTempo(input.secondaryStems).firstBeatSec ??
    0;
  const { tempoRatio, semitones } = mashup.secondary;
  return {
    conform: {
      tempo: tempoRatio,
      semitones,
      shiftSec: round9(target - secondaryFirstBeat / tempoRatio),
      endSec: leadGrid.durationSeconds,
    },
  };
}

/**
 * A source's measured tempo and first downbeat (#2559): the stem with the
 * most confident measured tempo, as the section grid picks it.
 */
export function measuredTempo(stems: Array<{ audioFeatures?: unknown }>): {
  bpm: number | null;
  firstBeatSec: number | null;
} {
  let best: { bpm: number; firstBeatSec: number | null; confidence: number } | null =
    null;
  for (const stem of stems) {
    const features = stem.audioFeatures as Record<string, unknown> | null | undefined;
    if (!features || typeof features !== "object") continue;
    const bpm = features.tempoBpm;
    if (typeof bpm !== "number" || !Number.isFinite(bpm) || bpm < 30 || bpm > 300) {
      continue;
    }
    const confidence =
      typeof features.tempoConfidence === "number" &&
      Number.isFinite(features.tempoConfidence)
        ? features.tempoConfidence
        : 0;
    const first = features.firstBeatSec;
    if (!best || confidence > best.confidence) {
      best = {
        bpm,
        firstBeatSec:
          typeof first === "number" && Number.isFinite(first) && first >= 0
            ? first
            : null,
        confidence,
      };
    }
  }
  return { bpm: best?.bpm ?? null, firstBeatSec: best?.firstBeatSec ?? null };
}

function round9(value: number): number {
  return Math.round(value * 1e9) / 1e9;
}
