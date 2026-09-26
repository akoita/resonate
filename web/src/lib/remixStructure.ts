import type { RemixSectionGrid, RemixSectionInterval } from "./api";

/**
 * Remix Studio structure recipe `remix-structure/v1` (#1899): the pure math
 * shared by the WebAudio preview and (mirrored in the backend) the ffmpeg
 * render, plus the studio's structure edit operations.
 *
 * A structure is an ordered sequence of the source grid's sections
 * ("blocks"), stored on the project (`RemixProject.structure`; null = the
 * original order). Sections can repeat, be dropped or be reordered; the
 * identity order with no fades normalizes to null. Blocks play back to back
 * on the output TIMELINE. Stem on/off masks are indexed by block (timeline
 * position), not by source section.
 *
 * Every timeline number below is guarded by the committed parity fixture
 * `backend/src/modules/remix/remix-structure-v1.parity.json`: the preview
 * and the render must reproduce it within 1e-9.
 */

export const REMIX_STRUCTURE_SCHEMA_VERSION = "remix-structure/v1" as const;

/** Click-free join fade where the audio jumps, in source seconds. */
export const REMIX_STRUCTURE_JOIN_FADE_SECONDS = 0.01;

/** A structure has 1..96 blocks. */
export const REMIX_STRUCTURE_MAX_BLOCKS = 96;

/**
 * Timeline length cap (enforced by the backend too): a structure plays at
 * most min(MAX_TIMELINE_FACTOR × the source grid's duration,
 * MAX_TIMELINE_SECONDS) seconds, within 1e-6.
 */
export const MAX_TIMELINE_FACTOR = 2;
export const MAX_TIMELINE_SECONDS = 900;
const TIMELINE_CAP_EPSILON = 1e-6;

export type RemixStructureBlock = {
  /** Index into the source grid's sections. */
  section: number;
  /** Master fade-in across the block (first half when both fades are set). */
  fadeIn?: boolean;
  /** Master fade-out across the block (second half when both are set). */
  fadeOut?: boolean;
};

export type RemixStructure = {
  schemaVersion: typeof REMIX_STRUCTURE_SCHEMA_VERSION;
  blocks: RemixStructureBlock[];
};

/** One block placed on the output timeline. */
export type RemixStructureSegment = {
  /** Block index (timeline position). */
  index: number;
  section: number;
  /** Output (timeline) span, seconds. */
  outStartSec: number;
  outEndSec: number;
  /** Source span played by the block, seconds. */
  srcStartSec: number;
  srcEndSec: number;
  /** 10 ms join fade-in (the audio jumps into this block). */
  joinFadeIn: boolean;
  /** 10 ms join fade-out (the audio jumps out of this block). */
  joinFadeOut: boolean;
  /** User fades (master, whole mix). */
  fadeIn: boolean;
  fadeOut: boolean;
};

/** A master gain ramp on the output timeline. */
export type RemixMasterFadeRamp = {
  startSec: number;
  endSec: number;
  from: number;
  to: number;
  /**
   * Fade-outs only: true when the ramp ends the timeline, so the master
   * holds silence afterwards (the reverb/echo tail never pops back in).
   */
  holdAfter?: boolean;
};

export type RemixStructureTimeline = {
  /** Output length, seconds. */
  durationSec: number;
  segments: RemixStructureSegment[];
  masterFades: RemixMasterFadeRamp[];
};

/** Per-stem on/off masks indexed by block; null = every block on. */
export type RemixBlockMasks = Record<string, boolean[] | null>;

// ---------------------------------------------------------------------------
// Normalization.

/** The identity order (every section once, in order, no fades). */
export function identityBlocks(sectionCount: number): RemixStructureBlock[] {
  const count = Number.isInteger(sectionCount) && sectionCount > 0 ? sectionCount : 0;
  return Array.from({ length: count }, (_, section) => ({ section }));
}

function isIdentity(blocks: RemixStructureBlock[], sectionCount: number): boolean {
  return (
    blocks.length === sectionCount &&
    blocks.every(
      (block, index) => block.section === index && !block.fadeIn && !block.fadeOut,
    )
  );
}

function cleanBlock(block: RemixStructureBlock): RemixStructureBlock {
  return {
    section: block.section,
    ...(block.fadeIn === true ? { fadeIn: true } : {}),
    ...(block.fadeOut === true ? { fadeOut: true } : {}),
  };
}

/**
 * Normalize a stored or edited structure against a grid of `sectionCount`
 * sections. The client returns null where the backend rejects (not an
 * object, another schema version, 0 or more than 96 blocks, a section
 * outside 0..sectionCount−1, non-boolean fades); for valid input the output
 * equals the backend normalization: false fades are omitted and the
 * identity order with no fades is null.
 */
export function normalizeRemixStructure(
  value: unknown,
  sectionCount: number,
): RemixStructure | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { schemaVersion?: unknown; blocks?: unknown };
  if (
    raw.schemaVersion !== undefined &&
    raw.schemaVersion !== REMIX_STRUCTURE_SCHEMA_VERSION
  ) {
    return null;
  }
  if (!Number.isInteger(sectionCount) || sectionCount < 1) return null;
  if (
    !Array.isArray(raw.blocks) ||
    raw.blocks.length < 1 ||
    raw.blocks.length > REMIX_STRUCTURE_MAX_BLOCKS
  ) {
    return null;
  }
  const blocks: RemixStructureBlock[] = [];
  for (const entry of raw.blocks as unknown[]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const block = entry as Record<string, unknown>;
    const section = block.section;
    if (
      typeof section !== "number" ||
      !Number.isInteger(section) ||
      section < 0 ||
      section >= sectionCount
    ) {
      return null;
    }
    for (const key of ["fadeIn", "fadeOut"] as const) {
      if (block[key] !== undefined && typeof block[key] !== "boolean") return null;
    }
    blocks.push(
      cleanBlock({
        section,
        fadeIn: block.fadeIn as boolean | undefined,
        fadeOut: block.fadeOut as boolean | undefined,
      }),
    );
  }
  if (isIdentity(blocks, sectionCount)) return null;
  return { schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION, blocks };
}

/** Structural equality of two structures after normalization. */
export function sameRemixStructure(
  left: unknown,
  right: unknown,
  sectionCount: number,
): boolean {
  return (
    JSON.stringify(normalizeRemixStructure(left, sectionCount)) ===
    JSON.stringify(normalizeRemixStructure(right, sectionCount))
  );
}

// ---------------------------------------------------------------------------
// Timeline.

/**
 * Place blocks back to back on the output timeline (null/empty = the
 * identity order). A 10 ms join fade is flagged only where the audio jumps:
 * into a block whose section does not follow the previous block's (or a
 * first block that is not section 0), and out of a block whose
 * section is not followed by the next one (or a last block that is not the
 * grid's final section). Consecutive blocks join seamlessly. Blocks naming
 * a section outside the grid are skipped.
 */
export function structureTimeline(
  grid: Pick<RemixSectionGrid, "sections">,
  blocks: RemixStructureBlock[] | null | undefined,
): RemixStructureTimeline {
  const sectionCount = grid.sections.length;
  const source = (blocks && blocks.length > 0 ? blocks : identityBlocks(sectionCount))
    .filter(
      (block) =>
        Number.isInteger(block.section) &&
        block.section >= 0 &&
        block.section < sectionCount,
    );
  const segments: RemixStructureSegment[] = [];
  let cursor = 0;
  source.forEach((block, index) => {
    const span = grid.sections[block.section];
    const previous = source[index - 1];
    const next = source[index + 1];
    const outStartSec = cursor;
    const outEndSec = outStartSec + (span.endSec - span.startSec);
    cursor = outEndSec;
    segments.push({
      index,
      section: block.section,
      outStartSec,
      outEndSec,
      srcStartSec: span.startSec,
      srcEndSec: span.endSec,
      joinFadeIn: previous
        ? block.section !== previous.section + 1
        : block.section !== 0,
      joinFadeOut: next
        ? next.section !== block.section + 1
        : block.section !== sectionCount - 1,
      fadeIn: block.fadeIn === true,
      fadeOut: block.fadeOut === true,
    });
  });
  return {
    durationSec: cursor,
    segments,
    masterFades: masterFadeRamps(segments),
  };
}

/**
 * The full timeline for server-served segments (`RemixProject.timeline`):
 * duration = the last block's output end (0 for none), plus the master
 * fade ramps.
 */
export function timelineFromSegments(
  segments: RemixStructureSegment[],
): RemixStructureTimeline {
  return {
    durationSec:
      segments.length > 0 ? segments[segments.length - 1].outEndSec : 0,
    segments,
    masterFades: masterFadeRamps(segments),
  };
}

/**
 * Master fade ramps for the user fades, in output time. A fade-in ramps
 * 0 → 1 across its block, a fade-out 1 → 0; a block with both fades in over
 * its first half and out over its second. A fade-out on the last block
 * holds silence afterwards (`holdAfter`).
 */
export function masterFadeRamps(
  segments: RemixStructureSegment[],
): RemixMasterFadeRamp[] {
  const ramps: RemixMasterFadeRamp[] = [];
  const lastIndex = segments.length - 1;
  segments.forEach((segment, position) => {
    const { outStartSec: start, outEndSec: end } = segment;
    const holdAfter = position === lastIndex;
    if (segment.fadeIn && segment.fadeOut) {
      const mid = (start + end) / 2;
      ramps.push({ startSec: start, endSec: mid, from: 0, to: 1 });
      ramps.push({ startSec: mid, endSec: end, from: 1, to: 0, holdAfter });
    } else if (segment.fadeIn) {
      ramps.push({ startSec: start, endSec: end, from: 0, to: 1 });
    } else if (segment.fadeOut) {
      ramps.push({ startSec: start, endSec: end, from: 1, to: 0, holdAfter });
    }
  });
  return ramps;
}

/**
 * Master fade level at one timeline position: inside a ramp, its linear
 * value; after a `holdAfter` ramp, 0; otherwise 1.
 */
export function masterFadeValueAt(
  ramps: RemixMasterFadeRamp[],
  atSec: number,
): number {
  let value = 1;
  for (const ramp of ramps) {
    if (atSec >= ramp.startSec && atSec < ramp.endSec) {
      const length = ramp.endSec - ramp.startSec;
      const t = length > 0 ? (atSec - ramp.startSec) / length : 1;
      return ramp.from + (ramp.to - ramp.from) * t;
    }
    if (atSec >= ramp.endSec && ramp.holdAfter) value = 0;
  }
  return value;
}

/**
 * Gate spans for a per-block mask, in output time: null = no gating (no
 * mask, every block on, or a stale mask whose length is not the block
 * count — fail-open, like the backend); [] = silent; otherwise the merged
 * spans of the on-blocks.
 */
export function gateIntervalsForBlocks(
  segments: RemixStructureSegment[],
  mask: boolean[] | null | undefined,
): RemixSectionInterval[] | null {
  if (!mask || mask.length !== segments.length) return null;
  if (mask.every(Boolean)) return null;
  const intervals: RemixSectionInterval[] = [];
  segments.forEach((segment, index) => {
    if (!mask[index]) return;
    const last = intervals[intervals.length - 1];
    if (last && Math.abs(last.endSec - segment.outStartSec) < 1e-6) {
      last.endSec = segment.outEndSec;
    } else {
      intervals.push({ startSec: segment.outStartSec, endSec: segment.outEndSec });
    }
  });
  return intervals;
}

/**
 * Whether a timeline plays the source straight through (every block at its
 * own source position, no join or user fades) — i.e. no structure. The
 * preview then keeps its plain one-source-per-stem graph.
 */
export function isIdentityTimeline(
  timeline: Pick<RemixStructureTimeline, "segments"> | null | undefined,
): boolean {
  if (!timeline || timeline.segments.length === 0) return true;
  return timeline.segments.every(
    (segment) =>
      Math.abs(segment.outStartSec - segment.srcStartSec) < 1e-9 &&
      Math.abs(segment.outEndSec - segment.srcEndSec) < 1e-9 &&
      !segment.joinFadeIn &&
      !segment.joinFadeOut &&
      !segment.fadeIn &&
      !segment.fadeOut,
  );
}

/** The longest timeline a structure may have on this grid, seconds. */
export function maxTimelineSeconds(
  grid: Pick<RemixSectionGrid, "durationSeconds">,
): number {
  return Math.min(MAX_TIMELINE_FACTOR * grid.durationSeconds, MAX_TIMELINE_SECONDS);
}

/**
 * Why a longer structure is refused (shared wording with the backend): the
 * 15-minute ceiling when it is the binding limit (2 × the source is over
 * 900 s), otherwise "twice as long as the original".
 */
export function structureTooLongReason(
  grid: Pick<RemixSectionGrid, "durationSeconds">,
): string {
  return MAX_TIMELINE_FACTOR * grid.durationSeconds > MAX_TIMELINE_SECONDS
    ? "That would make the remix longer than 15 minutes."
    : "That would make the remix more than twice as long as the original.";
}

/** Whether `blocks` fit the timeline cap (`maxTimelineSeconds`). */
export function withinTimelineCap(
  grid: Pick<RemixSectionGrid, "sections" | "durationSeconds">,
  blocks: RemixStructureBlock[],
): boolean {
  return (
    structureTimeline(grid, blocks).durationSec <=
    maxTimelineSeconds(grid) + TIMELINE_CAP_EPSILON
  );
}

// ---------------------------------------------------------------------------
// Edit operations. Each returns the new blocks AND the remapped per-stem
// masks (columns move with their blocks), both normalized, plus the
// structure to PATCH. A refused operation returns null (so the UI can
// disable the matching menu entry).

export type RemixStructureEditState = {
  /** Section count of the project's grid. */
  sectionCount: number;
  /** Explicit blocks: the identity order when the project has no structure. */
  blocks: RemixStructureBlock[];
  /**
   * Per-stem masks indexed by block; null = all on. A mask whose length is
   * not the block count counts as all on (fail-open, like the backend).
   */
  masks: RemixBlockMasks;
};

export type RemixStructureEditResult = RemixStructureEditState & {
  /** Normalized recipe for the PATCH; null = the original order. */
  structure: RemixStructure | null;
};

/** Edit state for a project: its structure's blocks (or identity) and masks. */
export function structureEditState(
  grid: Pick<RemixSectionGrid, "sections">,
  structure: unknown,
  masks: RemixBlockMasks,
): RemixStructureEditState {
  const sectionCount = grid.sections.length;
  const normalized = normalizeRemixStructure(structure, sectionCount);
  const blocks = normalized?.blocks ?? identityBlocks(sectionCount);
  const nextMasks: RemixBlockMasks = {};
  for (const [stemId, mask] of Object.entries(masks)) {
    nextMasks[stemId] = normalizeBlockMask(mask, blocks.length);
  }
  return { sectionCount, blocks, masks: nextMasks };
}

/** A mask for `blockCount` blocks, or null when absent, stale or all on. */
export function normalizeBlockMask(
  mask: boolean[] | null | undefined,
  blockCount: number,
): boolean[] | null {
  if (!Array.isArray(mask) || mask.length !== blockCount) return null;
  if (mask.every((flag) => flag === true)) return null;
  return mask.map((flag) => flag === true);
}

/** Explicit columns: a stale or null mask is all on. */
function maskColumns(mask: boolean[] | null | undefined, blockCount: number): boolean[] {
  return Array.isArray(mask) && mask.length === blockCount
    ? mask.map((flag) => flag === true)
    : Array.from({ length: blockCount }, () => true);
}

function finishEdit(
  sectionCount: number,
  blocks: RemixStructureBlock[],
  masks: Record<string, boolean[]>,
): RemixStructureEditResult | null {
  if (blocks.length < 1 || blocks.length > REMIX_STRUCTURE_MAX_BLOCKS) return null;
  const structure = normalizeRemixStructure(
    { schemaVersion: REMIX_STRUCTURE_SCHEMA_VERSION, blocks },
    sectionCount,
  );
  const nextBlocks = structure?.blocks ?? identityBlocks(sectionCount);
  if (!structure && nextBlocks.length !== blocks.length) return null;
  const nextMasks: RemixBlockMasks = {};
  for (const [stemId, mask] of Object.entries(masks)) {
    nextMasks[stemId] = normalizeBlockMask(mask, nextBlocks.length);
  }
  return { sectionCount, blocks: nextBlocks, masks: nextMasks, structure };
}

function mapColumns(
  state: RemixStructureEditState,
  remap: (columns: boolean[]) => boolean[],
): Record<string, boolean[]> {
  const out: Record<string, boolean[]> = {};
  for (const [stemId, mask] of Object.entries(state.masks)) {
    out[stemId] = remap(maskColumns(mask, state.blocks.length));
  }
  return out;
}

function validIndex(state: RemixStructureEditState, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < state.blocks.length;
}

/**
 * Repeat block `index`: a copy of the block's SECTION (without its fades)
 * is inserted right after it and every stem's mask copies the block's
 * column. Refused (null) at 96 blocks, past the timeline cap
 * (`maxTimelineSeconds`) or for an invalid index.
 */
export function repeatBlock(
  state: RemixStructureEditState,
  index: number,
  grid: Pick<RemixSectionGrid, "sections" | "durationSeconds">,
): RemixStructureEditResult | null {
  if (!validIndex(state, index)) return null;
  if (state.blocks.length >= REMIX_STRUCTURE_MAX_BLOCKS) return null;
  const blocks = [...state.blocks];
  blocks.splice(index + 1, 0, { section: state.blocks[index].section });
  if (!withinTimelineCap(grid, blocks)) return null;
  const masks = mapColumns(state, (columns) => {
    const next = [...columns];
    next.splice(index + 1, 0, columns[index]);
    return next;
  });
  return finishEdit(state.sectionCount, blocks, masks);
}

/**
 * Remove block `index` and its mask column. Refused (null) for the last
 * remaining block or an invalid index.
 */
export function removeBlock(
  state: RemixStructureEditState,
  index: number,
): RemixStructureEditResult | null {
  if (!validIndex(state, index) || state.blocks.length <= 1) return null;
  const blocks = state.blocks.filter((_, position) => position !== index);
  const masks = mapColumns(state, (columns) =>
    columns.filter((_, position) => position !== index),
  );
  return finishEdit(state.sectionCount, blocks, masks);
}

/**
 * Move block `index` one place earlier (-1) or later (1), with its mask
 * column. Refused (null) past either end.
 */
export function moveBlock(
  state: RemixStructureEditState,
  index: number,
  direction: -1 | 1,
): RemixStructureEditResult | null {
  const target = index + direction;
  if (!validIndex(state, index) || target < 0 || target >= state.blocks.length) {
    return null;
  }
  const swap = <T>(items: T[]): T[] => {
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  };
  return finishEdit(
    state.sectionCount,
    swap(state.blocks),
    mapColumns(state, swap),
  );
}

/** Toggle block `index`'s master fade-in or fade-out; masks are unchanged. */
export function toggleFade(
  state: RemixStructureEditState,
  index: number,
  which: "in" | "out",
): RemixStructureEditResult | null {
  if (!validIndex(state, index)) return null;
  const key = which === "in" ? "fadeIn" : "fadeOut";
  const blocks = state.blocks.map((block, position) =>
    position === index ? { ...block, [key]: !block[key] } : block,
  );
  return finishEdit(state.sectionCount, blocks, mapColumns(state, (c) => c));
}

/**
 * Per-source-section mask values: each section takes the value of the
 * FIRST block that plays it; sections no block plays are on.
 */
function perSectionColumns(
  state: RemixStructureEditState,
  sectionCount: number,
): Record<string, boolean[]> {
  return mapColumns(state, (columns) =>
    Array.from({ length: sectionCount }, (_, section) => {
      const first = state.blocks.findIndex((block) => block.section === section);
      return first === -1 ? true : columns[first];
    }),
  );
}

function withSectionMasks(
  state: RemixStructureEditState,
  sectionCount: number,
  blocks: RemixStructureBlock[],
): RemixStructureEditResult | null {
  const perSection = perSectionColumns(state, sectionCount);
  const masks: Record<string, boolean[]> = {};
  for (const [stemId, values] of Object.entries(perSection)) {
    masks[stemId] = blocks.map((block) => values[block.section]);
  }
  return finishEdit(sectionCount, blocks, masks);
}

/**
 * Back to the original order (structure null). Each source section's mask
 * value is that of the FIRST block that plays it; on when no block does.
 */
export function resetStructure(
  state: RemixStructureEditState,
  grid: Pick<RemixSectionGrid, "sections">,
): RemixStructureEditResult | null {
  const sectionCount = grid.sections.length;
  if (sectionCount < 1) return null;
  return withSectionMasks(state, sectionCount, identityBlocks(sectionCount));
}

/**
 * Whether section 0 is a pickup: more than one section and section 0 spans
 * less than 0.75 × `grid.sectionSeconds`.
 */
export function hasPickup(
  grid: Pick<RemixSectionGrid, "sections" | "sectionSeconds">,
): boolean {
  const first = grid.sections[0];
  return (
    grid.sections.length > 1 &&
    !!first &&
    first.endSec - first.startSec < 0.75 * grid.sectionSeconds
  );
}

/**
 * "Extended mix" (DJ-friendly): drop the pickup (see `hasPickup`), play the
 * first full section twice, then the rest in order, then the last section
 * again with a fade-out. With a single remaining section it plays twice,
 * fading out on the second. Masks take the per-section values as in
 * `resetStructure` (first block that plays the section; else on). Null when
 * the result would exceed 96 blocks or the timeline cap
 * (`maxTimelineSeconds`), or the grid is empty.
 */
export function extendedMix(
  grid: Pick<RemixSectionGrid, "sections" | "sectionSeconds" | "durationSeconds">,
  state: RemixStructureEditState,
): RemixStructureEditResult | null {
  const sectionCount = grid.sections.length;
  if (sectionCount < 1) return null;
  const firstFull = hasPickup(grid) ? 1 : 0;
  const kept: RemixStructureBlock[] = [];
  for (let section = firstFull; section < sectionCount; section += 1) {
    kept.push({ section });
  }
  const blocks: RemixStructureBlock[] = [{ section: firstFull }, ...kept];
  if (kept.length > 1) blocks.push({ section: sectionCount - 1 });
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], fadeOut: true };
  if (!withinTimelineCap(grid, blocks)) return null;
  return withSectionMasks(state, sectionCount, blocks);
}

/**
 * "Short edit": keep the first ceil(0.6·N) sections of the original order
 * (N = section count) and fade out the last kept block. Masks take the
 * per-section values as in `resetStructure`. Null for an empty grid.
 */
export function shortEdit(
  grid: Pick<RemixSectionGrid, "sections">,
  state: RemixStructureEditState,
): RemixStructureEditResult | null {
  const sectionCount = grid.sections.length;
  if (sectionCount < 1) return null;
  // Integer arithmetic: ceil(3N/5) avoids 0.6·N float noise.
  const keep = Math.ceil((3 * sectionCount) / 5);
  const blocks: RemixStructureBlock[] = identityBlocks(keep);
  blocks[keep - 1] = { ...blocks[keep - 1], fadeOut: true };
  return withSectionMasks(state, sectionCount, blocks);
}
