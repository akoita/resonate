/**
 * Remix Studio structure blocks, recipe `remix-structure/v1` (#1899).
 *
 * A structure is an ordered sequence of the source section grid's sections
 * (1..{@link MAX_STRUCTURE_BLOCKS} blocks): sections can repeat, be dropped
 * or be reordered, and a block can carry a whole-mix fade in / fade out. It
 * persists on `RemixProject.structure`; `null` means the original order, and
 * the identity order without fades normalises to `null`.
 *
 * Both engines — the server ffmpeg render (stem-audio-mixer.ts) and the
 * browser WebAudio preview — derive the same timeline from this module's
 * math; the committed parity fixture `remix-structure-v1.parity.json` pins
 * the timeline, join fades, gate intervals, master fade ramps and
 * normalisation (within 1e-9). Changing any rule requires a new
 * {@link REMIX_STRUCTURE_DSP_VERSION} so older drafts stay auditable.
 *
 * Stem on/off masks (`remix-stem-arrangement/v1`) are indexed by BLOCK
 * (timeline position) once a structure applies; with no structure the blocks
 * are the grid sections, so every existing mask keeps its meaning.
 *
 * Structure is deterministic editing, not AI: it never changes a render's
 * grounding, costs nothing, and never interpolates user strings into a graph.
 */

import type { SectionGrid, SectionInterval } from "./remix-arrangement";

export const REMIX_STRUCTURE_SCHEMA_VERSION = "remix-structure/v1";
/** Version of the timeline/fade rules below, recorded with every render. */
export const REMIX_STRUCTURE_DSP_VERSION = "remix-structure-dsp/v1";
/** Click-free join fade where the audio jumps between blocks. */
export const JOIN_FADE_SECONDS = 0.01;
export const MAX_STRUCTURE_BLOCKS = 96;
/**
 * Safety cap: a structure's timeline may be at most this multiple of the
 * source (grid) duration, and never longer than {@link MAX_TIMELINE_SECONDS}.
 * Bounds render time and memory; mirrored by the web lib.
 */
export const MAX_TIMELINE_FACTOR = 2;
export const MAX_TIMELINE_SECONDS = 900;
/** PATCH reason when the 2 × source limit binds. */
export const TIMELINE_CAP_FACTOR_ERROR =
  "That would make the remix more than twice as long as the original — remove a few repeats.";
/** PATCH reason when the 15-minute ceiling binds (2 × source > 900 s). */
export const TIMELINE_CAP_SECONDS_ERROR =
  "That would make the remix longer than 15 minutes.";

export const NO_SECTION_GRID_ERROR =
  "This source has no section grid to arrange (no measured stem duration).";

export type RemixStructureBlock = {
  /** Index into the project's SectionGrid.sections. */
  section: number;
  /** Whole-mix fade in across the block (omitted when false). */
  fadeIn?: true;
  /** Whole-mix fade out across the block (omitted when false). */
  fadeOut?: true;
};

export type RemixStructure = {
  schemaVersion: typeof REMIX_STRUCTURE_SCHEMA_VERSION;
  blocks: RemixStructureBlock[];
};

/** One block placed on the output timeline (timeline = pre-speed time). */
export type RemixStructureSegment = {
  index: number;
  section: number;
  outStartSec: number;
  outEndSec: number;
  srcStartSec: number;
  srcEndSec: number;
  /** 10 ms fade in: the audio jumps into this block. */
  joinFadeIn: boolean;
  /** 10 ms fade out: the audio jumps out of this block. */
  joinFadeOut: boolean;
  fadeIn: boolean;
  fadeOut: boolean;
};

/** A linear whole-mix gain ramp on the timeline. */
export type RemixMasterFadeRamp = {
  startSec: number;
  endSec: number;
  from: number;
  to: number;
  /**
   * Fade-outs only: hold silence after the ramp (last block), so a reverb or
   * echo tail never pops back in.
   */
  holdAfter?: boolean;
};

/** Render-time structure context: the recipe plus its derived timeline. */
export type RemixRenderStructure = {
  structure: RemixStructure;
  segments: RemixStructureSegment[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value)
  );
}

/**
 * Validate + normalise a PATCH `structure` payload against the project's
 * section count. `false` fades are omitted, and the identity order without
 * fades normalises to null (untouched). Callers must skip this for
 * `undefined` (field absent = unchanged).
 *
 * @param sectionCount the project grid's section count; 0 = no grid. `null`
 *   skips the range check (tolerant lineage reads of a rendered recipe).
 */
export function normalizeRemixStructureInput(
  value: unknown,
  sectionCount: number | null,
): { value: RemixStructure | null } | { error: string } {
  if (value === null || value === undefined) return { value: null };
  if (sectionCount !== null && !(sectionCount > 0)) {
    return { error: NO_SECTION_GRID_ERROR };
  }
  if (!isPlainObject(value)) {
    return { error: "structure must be an object or null" };
  }
  for (const key of Object.keys(value)) {
    if (key !== "schemaVersion" && key !== "blocks") {
      return {
        error: `structure.${key} is not supported (allowed: schemaVersion, blocks)`,
      };
    }
  }
  if (
    value.schemaVersion !== undefined &&
    value.schemaVersion !== REMIX_STRUCTURE_SCHEMA_VERSION
  ) {
    return {
      error: `structure.schemaVersion must be "${REMIX_STRUCTURE_SCHEMA_VERSION}"`,
    };
  }
  const rawBlocks = value.blocks;
  if (!Array.isArray(rawBlocks)) {
    return { error: "structure.blocks must be an array" };
  }
  if (rawBlocks.length < 1 || rawBlocks.length > MAX_STRUCTURE_BLOCKS) {
    return {
      error: `structure.blocks must have 1..${MAX_STRUCTURE_BLOCKS} entries`,
    };
  }

  const blocks: RemixStructureBlock[] = [];
  for (const raw of rawBlocks) {
    if (!isPlainObject(raw)) {
      return { error: "structure.blocks[] must be objects" };
    }
    for (const key of Object.keys(raw)) {
      if (key !== "section" && key !== "fadeIn" && key !== "fadeOut") {
        return {
          error: `structure.blocks[].${key} is not supported (allowed: section, fadeIn, fadeOut)`,
        };
      }
    }
    const section = raw.section;
    if (
      typeof section !== "number" ||
      !Number.isInteger(section) ||
      section < 0 ||
      (sectionCount !== null && section >= sectionCount)
    ) {
      return {
        error:
          sectionCount !== null
            ? `structure.blocks[].section must be an integer in 0..${sectionCount - 1}`
            : "structure.blocks[].section must be a non-negative integer",
      };
    }
    for (const fade of ["fadeIn", "fadeOut"] as const) {
      if (raw[fade] !== undefined && typeof raw[fade] !== "boolean") {
        return { error: `structure.blocks[].${fade} must be a boolean` };
      }
    }
    blocks.push({
      section,
      ...(raw.fadeIn === true ? { fadeIn: true as const } : {}),
      ...(raw.fadeOut === true ? { fadeOut: true as const } : {}),
    });
  }

  const identity =
    sectionCount !== null &&
    blocks.length === sectionCount &&
    blocks.every(
      (block, index) =>
        block.section === index && !block.fadeIn && !block.fadeOut,
    );
  if (identity) return { value: null };
  return { value: { schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION, blocks } };
}

/**
 * Tolerant read of the stored column: anything malformed, foreign-versioned,
 * identity, or referencing a section outside the current grid (features
 * re-measured) reads as null, so structure fails open to the original order
 * and a bad row never breaks a project response or a render.
 *
 * @param sectionCount current grid section count (0 = no grid → null);
 *   `null` skips the range check (lineage of an already-rendered recipe).
 */
export function readStoredRemixStructure(
  stored: unknown,
  sectionCount: number | null,
): RemixStructure | null {
  if (!isPlainObject(stored)) return null;
  if (stored.schemaVersion !== REMIX_STRUCTURE_SCHEMA_VERSION) return null;
  const normalized = normalizeRemixStructureInput(stored, sectionCount);
  return "error" in normalized ? null : normalized.value;
}

/** Number of arrangement-mask columns: blocks with a structure, else sections. */
export function structureBlockCount(
  grid: SectionGrid,
  structure: RemixStructure | null,
): number {
  return structure ? structure.blocks.length : grid.sections.length;
}

/**
 * Place the blocks back to back on the output timeline. `null` blocks = the
 * original order (every section once, no join fades). Join fades apply only
 * where the audio jumps: into a block whose predecessor is not the previous
 * section (or a first block that is not section 0), and out of a block whose
 * successor is not the next section (or a last block that is not the final
 * section). Consecutive blocks join seamlessly.
 */
export function structureTimeline(
  grid: SectionGrid,
  blocks: RemixStructureBlock[] | null,
): RemixStructureSegment[] {
  const lastSection = grid.sections.length - 1;
  const order: RemixStructureBlock[] =
    blocks ?? grid.sections.map((_, section) => ({ section }));
  const segments: RemixStructureSegment[] = [];
  let cursor = 0;
  order.forEach((block, index) => {
    const span = grid.sections[block.section];
    const previous = index > 0 ? order[index - 1] : null;
    const next = index < order.length - 1 ? order[index + 1] : null;
    const joinFadeIn = previous
      ? previous.section + 1 !== block.section
      : block.section !== 0;
    const joinFadeOut = next
      ? block.section + 1 !== next.section
      : block.section !== lastSection;
    const outStartSec = cursor;
    const outEndSec = cursor + (span.endSec - span.startSec);
    cursor = outEndSec;
    segments.push({
      index,
      section: block.section,
      outStartSec,
      outEndSec,
      srcStartSec: span.startSec,
      srcEndSec: span.endSec,
      joinFadeIn,
      joinFadeOut,
      fadeIn: block.fadeIn === true,
      fadeOut: block.fadeOut === true,
    });
  });
  return segments;
}

/** Timeline length: the last block's output end (0 for no blocks). */
export function timelineDurationSec(segments: RemixStructureSegment[]): number {
  return segments.length > 0 ? segments[segments.length - 1].outEndSec : 0;
}

/**
 * Timeline play intervals for a stem given its block-indexed mask:
 *  - null when the stem plays throughout (no mask, every block on, or a stale
 *    mask whose length differs from the block count — fails open);
 *  - [] when every block is off (the stem is effectively muted);
 *  - merged adjacent block spans otherwise.
 */
export function gateIntervalsForBlocks(
  segments: RemixStructureSegment[],
  mask: boolean[] | null | undefined,
): SectionInterval[] | null {
  if (!mask) return null;
  if (mask.length !== segments.length) return null;
  if (mask.every(Boolean)) return null;
  const intervals: SectionInterval[] = [];
  segments.forEach((segment, index) => {
    if (!mask[index]) return;
    const last = intervals[intervals.length - 1];
    if (last && Math.abs(last.endSec - segment.outStartSec) < 1e-6) {
      last.endSec = segment.outEndSec;
    } else {
      intervals.push({
        startSec: segment.outStartSec,
        endSec: segment.outEndSec,
      });
    }
  });
  return intervals;
}

/**
 * Whole-mix fade ramps on the timeline, in block order. A block with only a
 * fade in ramps 0→1 across it; only a fade out ramps 1→0 across it; both
 * fade in over its first half and out over its second. A fade-out on the last
 * block holds silence afterwards (`holdAfter`).
 */
export function masterFadeRamps(
  segments: RemixStructureSegment[],
): RemixMasterFadeRamp[] {
  const ramps: RemixMasterFadeRamp[] = [];
  const lastIndex = segments.length - 1;
  segments.forEach((segment, index) => {
    const start = segment.outStartSec;
    const end = segment.outEndSec;
    const mid = segment.fadeIn && segment.fadeOut ? (start + end) / 2 : null;
    if (segment.fadeIn) {
      ramps.push({ startSec: start, endSec: mid ?? end, from: 0, to: 1 });
    }
    if (segment.fadeOut) {
      ramps.push({
        startSec: mid ?? start,
        endSec: end,
        from: 1,
        to: 0,
        holdAfter: index === lastIndex,
      });
    }
  });
  return ramps;
}

/** Longest allowed timeline for a grid: min(2 × source, 900 s). */
export function maxTimelineSeconds(grid: SectionGrid): number {
  return Math.min(
    MAX_TIMELINE_FACTOR * grid.durationSeconds,
    MAX_TIMELINE_SECONDS,
  );
}

/**
 * The cap reason for this grid: the 15-minute ceiling when it binds
 * (2 × source > 900 s), else the 2 × source limit.
 */
export function timelineCapError(grid: SectionGrid): string {
  return MAX_TIMELINE_FACTOR * grid.durationSeconds > MAX_TIMELINE_SECONDS
    ? TIMELINE_CAP_SECONDS_ERROR
    : TIMELINE_CAP_FACTOR_ERROR;
}

/** True when the timeline exceeds {@link maxTimelineSeconds} (+1e-6). */
export function exceedsTimelineCap(
  grid: SectionGrid,
  segments: RemixStructureSegment[],
): boolean {
  return timelineDurationSec(segments) > maxTimelineSeconds(grid) + 1e-6;
}

/**
 * Tolerant read of the stored column against the CURRENT grid, including the
 * timeline cap: a malformed, out-of-grid, or over-cap structure resolves to
 * null (the original order). `overCap` lets render paths log the fail-open.
 */
export function resolveStoredRemixStructure(
  stored: unknown,
  grid: SectionGrid | null,
): { structure: RemixStructure | null; overCap: boolean } {
  if (!grid) return { structure: null, overCap: false };
  const structure = readStoredRemixStructure(stored, grid.sections.length);
  if (!structure) return { structure: null, overCap: false };
  if (exceedsTimelineCap(grid, structureTimeline(grid, structure.blocks))) {
    return { structure: null, overCap: true };
  }
  return { structure, overCap: false };
}
