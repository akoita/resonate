/**
 * Section-grid arrangement (#1314, P1 of epic #1311).
 *
 * Divides the source timeline into sections a stem can be switched on/off in —
 * the smallest real "arrangement changes over time" canvas. The grid is derived
 * DETERMINISTICALLY from the stems' measured audio features (#1184): the
 * highest-confidence tempo + its first-beat anchor define 8-bar sections;
 * tracks without a measured tempo fall back to fixed 16-second time sections.
 * Nothing about the grid is stored — identical features always derive the
 * identical grid, so persisted per-stem masks stay auditable and reproducible.
 *
 * Per-stem masks persist in the existing `RemixProjectStem.arrangement` JSON
 * (`remix-stem-arrangement/v1`); `null` keeps today's behavior (always on).
 */

export const REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION =
  "remix-stem-arrangement/v1";

export const SECTION_BARS = 8;
export const BEATS_PER_BAR = 4; // 4/4 assumed; time-signature detection is v2
export const FALLBACK_SECTION_SECONDS = 16;
export const MIN_SECTION_COUNT = 2;
export const MAX_SECTION_COUNT = 64;
/** Edge fade applied when a stem enters/leaves a section (click prevention). */
export const SECTION_FADE_SECONDS = 0.05;
/** Grid slivers shorter than this fraction of a section merge into a neighbor. */
const MIN_SPAN_FRACTION = 0.25;

export type StemSectionArrangement = {
  schemaVersion: typeof REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION;
  /** One flag per grid section, index-aligned with SectionGrid.sections. */
  sections: boolean[];
};

export type SectionInterval = { startSec: number; endSec: number };

export type SectionGrid = {
  kind: "bars" | "time";
  /** Concrete section spans covering [0, durationSeconds]. */
  sections: SectionInterval[];
  sectionSeconds: number;
  durationSeconds: number;
  /** Measured tempo the bar grid was derived from; null for the time fallback. */
  bpm: number | null;
};

type MeasuredFeatures = {
  tempoBpm: number | null;
  tempoConfidence: number;
  firstBeatSec: number | null;
  durationSeconds: number | null;
};

function readFeatures(value: unknown): MeasuredFeatures | null {
  if (!value || typeof value !== "object") return null;
  const features = value as Record<string, unknown>;
  const tempoBpm =
    typeof features.tempoBpm === "number" &&
    Number.isFinite(features.tempoBpm) &&
    features.tempoBpm >= 30 &&
    features.tempoBpm <= 300
      ? features.tempoBpm
      : null;
  const tempoConfidence =
    typeof features.tempoConfidence === "number" &&
    Number.isFinite(features.tempoConfidence)
      ? features.tempoConfidence
      : 0;
  const firstBeatSec =
    typeof features.firstBeatSec === "number" &&
    Number.isFinite(features.firstBeatSec) &&
    features.firstBeatSec >= 0
      ? features.firstBeatSec
      : null;
  const durationSeconds =
    typeof features.durationSeconds === "number" &&
    Number.isFinite(features.durationSeconds) &&
    features.durationSeconds > 0
      ? features.durationSeconds
      : null;
  return { tempoBpm, tempoConfidence, firstBeatSec, durationSeconds };
}

/**
 * Derive the project's section grid from its stems' measured features.
 * Returns null when no stem has a measured duration or when the derived grid
 * has fewer than {@link MIN_SECTION_COUNT} sections (nothing to arrange).
 */
export function deriveSectionGrid(
  stems: Array<{ audioFeatures?: unknown }>,
): SectionGrid | null {
  const measured = stems
    .map((stem) => readFeatures(stem.audioFeatures))
    .filter((features): features is MeasuredFeatures => features !== null);
  if (measured.length === 0) return null;

  const durationSeconds = Math.max(
    0,
    ...measured.map((features) => features.durationSeconds ?? 0),
  );
  if (durationSeconds <= 0) return null;

  // Highest-confidence measured tempo wins (mirrors the feature-hint rule).
  const tempoSource = measured
    .filter((features) => features.tempoBpm !== null)
    .sort((a, b) => b.tempoConfidence - a.tempoConfidence)[0];

  const kind: SectionGrid["kind"] = tempoSource ? "bars" : "time";
  const bpm = tempoSource?.tempoBpm ?? null;
  const sectionSeconds = bpm
    ? (SECTION_BARS * BEATS_PER_BAR * 60) / bpm
    : FALLBACK_SECTION_SECONDS;

  // Boundaries anchor to the first beat so sections land on musical downbeats;
  // the anchor is reduced modulo one section so section 0 stays short-ish
  // rather than starting the grid mid-track.
  const rawAnchor = tempoSource?.firstBeatSec ?? 0;
  const anchor = rawAnchor > 0 ? rawAnchor % sectionSeconds : 0;

  const boundaries: number[] = [];
  const minSpan = sectionSeconds * MIN_SPAN_FRACTION;
  let cursor = anchor > minSpan ? anchor : anchor + sectionSeconds;
  while (cursor < durationSeconds - minSpan) {
    boundaries.push(round(cursor));
    cursor += sectionSeconds;
    if (boundaries.length > MAX_SECTION_COUNT) return null;
  }

  const edges = [0, ...boundaries, round(durationSeconds)];
  const sections: SectionInterval[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    sections.push({ startSec: edges[i], endSec: edges[i + 1] });
  }
  if (sections.length < MIN_SECTION_COUNT || sections.length > MAX_SECTION_COUNT) {
    return null;
  }

  return { kind, sections, sectionSeconds: round(sectionSeconds), durationSeconds: round(durationSeconds), bpm };
}

/** Lenient read of a persisted arrangement; null for legacy/foreign shapes. */
export function parseStemArrangement(
  value: unknown,
): StemSectionArrangement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION) {
    return null;
  }
  if (
    !Array.isArray(record.sections) ||
    record.sections.length === 0 ||
    !record.sections.every((flag) => typeof flag === "boolean")
  ) {
    return null;
  }
  return {
    schemaVersion: REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION,
    sections: record.sections as boolean[],
  };
}

/**
 * Strict validation for PATCH payloads. Returns an error message (the caller
 * wraps it in its HTTP exception) or null when the payload is acceptable.
 * `null` payloads are allowed — they restore the always-on default.
 */
export function validateStemArrangementInput(
  value: unknown,
  grid: SectionGrid | null,
): string | null {
  if (value === null) return null;
  const parsed = parseStemArrangement(value);
  if (!parsed) {
    return `arrangement must be null or { schemaVersion: "${REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION}", sections: boolean[] }`;
  }
  if (!grid) {
    return "This source has no section grid to arrange (no measured stem duration).";
  }
  if (parsed.sections.length !== grid.sections.length) {
    return `arrangement.sections must have exactly ${grid.sections.length} entries for this source's grid`;
  }
  return null;
}

/**
 * Concrete play intervals for a stem given its mask. Returns:
 *  - null when the stem is fully active (no mask, or every section on) — the
 *    render path applies no gating at all, byte-identical to pre-#1314;
 *  - [] when every section is off (the stem is effectively muted);
 *  - merged adjacent spans otherwise.
 */
export function activeIntervalsForArrangement(
  grid: SectionGrid,
  arrangement: StemSectionArrangement | null,
): SectionInterval[] | null {
  if (!arrangement) return null;
  // Masks authored against a different grid (features re-measured) fail open
  // to fully-active rather than gating at wrong boundaries.
  if (arrangement.sections.length !== grid.sections.length) return null;
  if (arrangement.sections.every(Boolean)) return null;

  const intervals: SectionInterval[] = [];
  for (let i = 0; i < grid.sections.length; i += 1) {
    if (!arrangement.sections[i]) continue;
    const span = grid.sections[i];
    const last = intervals[intervals.length - 1];
    if (last && Math.abs(last.endSec - span.startSec) < 1e-6) {
      last.endSec = span.endSec;
    } else {
      intervals.push({ ...span });
    }
  }
  return intervals;
}

/**
 * ffmpeg volume expression gating a stem to its active intervals with
 * {@link SECTION_FADE_SECONDS} linear edge fades. Shape per interval:
 * a trapezoid `min(min((t-start)/F, (end-t)/F), 1)` clamped at 0; disjoint
 * trapezoids sum, and the total clamps at 1. Numbers only — the expression is
 * built from validated numeric spans, never from user strings.
 */
export function buildSectionGateVolumeExpression(
  intervals: SectionInterval[],
  fadeSeconds: number = SECTION_FADE_SECONDS,
): string {
  if (intervals.length === 0) return "0";
  const fade = Math.max(fadeSeconds, 0.001);
  const terms = intervals.map((interval) => {
    const start = round(interval.startSec);
    const end = round(interval.endSec);
    // Sections starting at 0 need no fade-in: the track simply begins.
    const rise =
      start <= 0 ? "1" : `min((t-${start})/${round(fade)}\\,1)`;
    return `max(0\\,min(${rise}\\,min((${end}-t)/${round(fade)}\\,1)))`;
  });
  const sum = terms.join("+");
  return `min(1\\,${sum})`;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
