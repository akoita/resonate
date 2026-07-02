import type { RemixSectionGrid, RemixSectionInterval } from "./api";

/**
 * Section-grid arrangement helpers (#1314). The grid itself is SERVED by the
 * backend on project reads (one derivation for studio, validation, and
 * render) — this module only interprets masks against it for the UI and the
 * WebAudio preview.
 */

export const REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION =
  "remix-stem-arrangement/v1";

export type RemixStemArrangement = {
  schemaVersion: typeof REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION;
  sections: boolean[];
};

/** Build the PATCH payload for a mask. */
export function arrangementPayload(sections: boolean[]): RemixStemArrangement {
  return {
    schemaVersion: REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION,
    sections: [...sections],
  };
}

/**
 * Read a persisted arrangement into a mask for this grid. Returns null for
 * legacy/foreign shapes or masks authored on a different grid — the stem then
 * renders as fully active, matching the backend's fail-open rule.
 */
export function parseArrangementSections(
  value: unknown,
  sectionCount: number,
): boolean[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== REMIX_STEM_ARRANGEMENT_SCHEMA_VERSION) {
    return null;
  }
  if (
    !Array.isArray(record.sections) ||
    record.sections.length !== sectionCount ||
    !record.sections.every((flag) => typeof flag === "boolean")
  ) {
    return null;
  }
  return record.sections as boolean[];
}

/**
 * Concrete preview/play spans for a mask: null = fully active (no gating),
 * [] = silent, otherwise merged adjacent on-sections — mirroring the backend's
 * activeIntervalsForArrangement so preview and render gate identically.
 */
export function activeIntervalsFromSections(
  grid: RemixSectionGrid,
  sections: boolean[] | null,
): RemixSectionInterval[] | null {
  if (!sections || sections.length !== grid.sections.length) return null;
  if (sections.every(Boolean)) return null;
  const intervals: RemixSectionInterval[] = [];
  for (let i = 0; i < grid.sections.length; i += 1) {
    if (!sections[i]) continue;
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

/** Honest grid description: what a column means and where it came from. */
export function sectionGridSummaryLabel(grid: RemixSectionGrid): string {
  return grid.kind === "bars"
    ? `8-bar sections · measured ${Math.round(grid.bpm ?? 0)} BPM`
    : "16-second sections · tempo not measured";
}

/** Column header label: the section's start time as m:ss. */
export function sectionStartLabel(interval: RemixSectionInterval): string {
  const total = Math.max(0, Math.round(interval.startSec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
