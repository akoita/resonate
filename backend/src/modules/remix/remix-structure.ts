/**
 * Remix Studio structure blocks, recipe `remix-structure/v2` (#1899, #1908).
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
 * Build-ups (#1908, `remix-structure/v2`): a block can carry `buildUp: true`
 * — a rising high-pass sweep plus a gain ramp across it, leading into the
 * next block (the drop). v2 only adds that field: a structure without
 * build-ups still normalizes to `remix-structure/v1` (byte-identical recipe,
 * timeline and render), and stored v1 rows read unchanged. The build-up DSP
 * rules are {@link REMIX_STRUCTURE_BUILDUP_DSP_VERSION}, pinned by
 * `remix-structure-v2.parity.json`; the ffmpeg stage is measured against a
 * per-sample model of the WebAudio graph in
 * `remix-structure-buildup.integration.spec.ts`.
 *
 * Structure is deterministic editing, not AI: it never changes a render's
 * grounding, costs nothing, and never interpolates user strings into a graph.
 */

import type { SectionGrid, SectionInterval } from "./remix-arrangement";

/** The original schema: blocks with fades only (#1899). */
export const REMIX_STRUCTURE_SCHEMA_VERSION_V1 = "remix-structure/v1";
/** Current schema: v1 plus `buildUp` per block (#1908). */
export const REMIX_STRUCTURE_SCHEMA_VERSION = "remix-structure/v2";
export type RemixStructureSchemaVersion =
  | typeof REMIX_STRUCTURE_SCHEMA_VERSION_V1
  | typeof REMIX_STRUCTURE_SCHEMA_VERSION;
/** Version of the timeline/fade rules below, recorded with every render. */
export const REMIX_STRUCTURE_DSP_VERSION = "remix-structure-dsp/v1";
/**
 * Timeline/fade rules plus the build-up stage (#1908); recorded instead of
 * {@link REMIX_STRUCTURE_DSP_VERSION} when a structure has build-ups.
 */
export const REMIX_STRUCTURE_BUILDUP_DSP_VERSION = "remix-structure-dsp/v2";

/** Build-up high-pass cutoff at the block start, Hz (#1908). */
export const BUILDUP_START_HZ = 30;
/** Build-up high-pass cutoff at the block end (just before the drop), Hz. */
export const BUILDUP_END_HZ = 1500;
/** Build-up gain at the block start (−6 dB), ramping linearly to 1. */
export const BUILDUP_START_GAIN = 0.5;
/** Butterworth Q (linear) of the build-up high-pass, RBJ cookbook. */
export const BUILDUP_FILTER_Q = Math.SQRT1_2;
/**
 * The render approximates the continuous exponential sweep with this many
 * equal steps per build-up (each at its midpoint cutoff); measured against
 * the continuous preview (see the v2 parity fixture).
 */
export const BUILDUP_SWEEP_STEPS = 48;
/**
 * Build-up edges snap to this output-time grid in both engines (1 ms = the
 * render stage's 48-sample frame at 48 kHz), so the drop lands on the same
 * sample in each.
 */
export const BUILDUP_EDGE_GRID_PER_SECOND = 1000;
/** Build-up blocks per structure (bounds the render's command list). */
export const MAX_BUILDUP_BLOCKS = 24;
export const TOO_MANY_BUILDUPS_ERROR = `A remix can have at most ${MAX_BUILDUP_BLOCKS} build-ups.`;
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
  /** Build-up across the block (#1908, v2; omitted when false). */
  buildUp?: true;
};

export type RemixStructure = {
  /** v2 exactly when a block has a build-up; v1 otherwise. */
  schemaVersion: RemixStructureSchemaVersion;
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
  /**
   * Build-up across the block (#1908). Present only when true, so v1
   * timelines (and the v1 parity fixture) keep their exact shape.
   */
  buildUp?: true;
};

/**
 * One build-up (#1908): across [startSec, endSec) the whole mix runs
 * through a high-pass whose cutoff rises exponentially fromHz → toHz, times
 * a gain rising linearly fromGain → toGain; outside every build-up the mix
 * is untouched (the high-pass is switched out).
 */
export type RemixBuildUpRamp = {
  startSec: number;
  endSec: number;
  fromHz: number;
  toHz: number;
  fromGain: number;
  toGain: number;
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
    value.schemaVersion !== REMIX_STRUCTURE_SCHEMA_VERSION &&
    value.schemaVersion !== REMIX_STRUCTURE_SCHEMA_VERSION_V1
  ) {
    return {
      error: `structure.schemaVersion must be "${REMIX_STRUCTURE_SCHEMA_VERSION}" or "${REMIX_STRUCTURE_SCHEMA_VERSION_V1}"`,
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
      if (
        key !== "section" &&
        key !== "fadeIn" &&
        key !== "fadeOut" &&
        key !== "buildUp"
      ) {
        return {
          error: `structure.blocks[].${key} is not supported (allowed: section, fadeIn, fadeOut, buildUp)`,
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
    for (const flag of ["fadeIn", "fadeOut", "buildUp"] as const) {
      if (raw[flag] !== undefined && typeof raw[flag] !== "boolean") {
        return { error: `structure.blocks[].${flag} must be a boolean` };
      }
    }
    blocks.push({
      section,
      ...(raw.fadeIn === true ? { fadeIn: true as const } : {}),
      ...(raw.fadeOut === true ? { fadeOut: true as const } : {}),
      ...(raw.buildUp === true ? { buildUp: true as const } : {}),
    });
  }
  const buildUps = blocks.filter((block) => block.buildUp).length;
  if (buildUps > MAX_BUILDUP_BLOCKS) return { error: TOO_MANY_BUILDUPS_ERROR };

  const identity =
    sectionCount !== null &&
    blocks.length === sectionCount &&
    blocks.every(
      (block, index) =>
        block.section === index &&
        !block.fadeIn &&
        !block.fadeOut &&
        !block.buildUp,
    );
  if (identity) return { value: null };
  return {
    value: {
      // v1 stays v1 (and byte-identical) until a build-up needs v2.
      schemaVersion:
        buildUps > 0
          ? REMIX_STRUCTURE_SCHEMA_VERSION
          : REMIX_STRUCTURE_SCHEMA_VERSION_V1,
      blocks,
    },
  };
}

/** True when any block carries a build-up (#1908). */
export function structureHasBuildUps(
  structure: Pick<RemixStructure, "blocks"> | null | undefined,
): boolean {
  return !!structure && structure.blocks.some((block) => block.buildUp);
}

/** The DSP rules version a render of this structure records (#1908). */
export function remixStructureDspVersion(
  structure: Pick<RemixStructure, "blocks"> | null | undefined,
): string {
  return structureHasBuildUps(structure)
    ? REMIX_STRUCTURE_BUILDUP_DSP_VERSION
    : REMIX_STRUCTURE_DSP_VERSION;
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
  if (
    stored.schemaVersion !== REMIX_STRUCTURE_SCHEMA_VERSION &&
    stored.schemaVersion !== REMIX_STRUCTURE_SCHEMA_VERSION_V1
  ) {
    return null;
  }
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
      ...(block.buildUp === true ? { buildUp: true as const } : {}),
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

// --- Build-ups (#1908) -------------------------------------------------------

/** Build-up ramps on the timeline, in block order (timeline time). */
export function buildUpRamps(
  segments: RemixStructureSegment[],
): RemixBuildUpRamp[] {
  return segments
    .filter((segment) => segment.buildUp === true)
    .map((segment) => ({
      startSec: segment.outStartSec,
      endSec: segment.outEndSec,
      fromHz: BUILDUP_START_HZ,
      toHz: BUILDUP_END_HZ,
      fromGain: BUILDUP_START_GAIN,
      toGain: 1,
    }));
}

/** Snap an output-time second to the build-up edge grid (1 ms). */
export function snapBuildUpEdge(sec: number): number {
  return (
    Math.round(sec * BUILDUP_EDGE_GRID_PER_SECOND) /
    BUILDUP_EDGE_GRID_PER_SECOND
  );
}

/**
 * The build-ups in OUTPUT time (timeline ÷ speed), edges snapped to the
 * 1 ms grid; spans that snap to nothing are dropped. Both engines schedule
 * exactly these spans.
 */
export function buildUpOutputRamps(
  ramps: RemixBuildUpRamp[],
  speed = 1,
): RemixBuildUpRamp[] {
  return ramps
    .map((ramp) => ({
      ...ramp,
      startSec: snapBuildUpEdge(ramp.startSec / speed),
      endSec: snapBuildUpEdge(ramp.endSec / speed),
    }))
    .filter((ramp) => ramp.endSec > ramp.startSec);
}

function buildUpProgress(ramp: RemixBuildUpRamp, atSec: number): number {
  const length = ramp.endSec - ramp.startSec;
  const t = length > 0 ? (atSec - ramp.startSec) / length : 1;
  return Math.min(1, Math.max(0, t));
}

/** The exponential cutoff of a build-up at `atSec` (clamped to the span). */
export function buildUpCutoffHzAt(
  ramp: RemixBuildUpRamp,
  atSec: number,
): number {
  return (
    ramp.fromHz *
    Math.pow(ramp.toHz / ramp.fromHz, buildUpProgress(ramp, atSec))
  );
}

/** The linear gain of a build-up at `atSec` (clamped to the span). */
export function buildUpGainAt(ramp: RemixBuildUpRamp, atSec: number): number {
  return (
    ramp.fromGain +
    (ramp.toGain - ramp.fromGain) * buildUpProgress(ramp, atSec)
  );
}

/**
 * The render's stepped sweep for one (output-time) build-up:
 * {@link BUILDUP_SWEEP_STEPS} equal steps, each set at its start to the
 * cutoff at its midpoint.
 */
export function buildUpSweepSteps(
  ramp: RemixBuildUpRamp,
): Array<{ atSec: number; hz: number }> {
  const length = ramp.endSec - ramp.startSec;
  return Array.from({ length: BUILDUP_SWEEP_STEPS }, (_, step) => ({
    atSec: ramp.startSec + (length * step) / BUILDUP_SWEEP_STEPS,
    hz: buildUpCutoffHzAt(
      ramp,
      ramp.startSec + (length * (step + 0.5)) / BUILDUP_SWEEP_STEPS,
    ),
  }));
}
