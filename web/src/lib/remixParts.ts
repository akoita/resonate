import { clampGainDb, GAIN_DB_MAX, GAIN_DB_MIN } from "./remixGain";
import {
  isBeatPickupSection,
  type RemixBeatGrid,
  type RemixBeatSegment,
} from "./remixBeat";
import {
  normalizeBlockMask,
  REMIX_STRUCTURE_JOIN_FADE_SECONDS,
} from "./remixStructure";

/**
 * Remix Studio AI parts `remix-parts/v1` (#1901): up to 4 lanes, each one
 * instrument role playing one conformed take (exactly N bars at the song's
 * tempo) looped on the timeline blocks it is on, with the beat lane's block
 * semantics. The recipe is stored on the project (`RemixProject.parts`;
 * null = no parts); the takes come with the project (`partTakes`).
 *
 * The placement math mirrors the backend render (`remix-parts.ts`) and is
 * pinned by the committed fixture
 * `backend/src/modules/remix/remix-parts-v1.parity.json`: the WebAudio
 * preview and the ffmpeg render place every part on exactly the same spans.
 */

export const REMIX_PARTS_SCHEMA_VERSION = "remix-parts/v1" as const;

export const REMIX_PART_ROLES = [
  "drums",
  "bass",
  "keys",
  "pad",
  "strings",
  "guitar",
] as const;
export type RemixPartRole = (typeof REMIX_PART_ROLES)[number];

/** At most this many part lanes per project (the backend limit). */
export const REMIX_PARTS_MAX = 4;
export const REMIX_PART_ID_PATTERN = /^[a-z0-9-]{1,32}$/;
const PART_TAKE_ID_MAX_CHARS = 64;
/** Part lane level range: the stem gain range. */
export const REMIX_PART_GAIN_RANGE = { min: GAIN_DB_MIN, max: GAIN_DB_MAX } as const;
/** Fade-out where a span cuts the loop mid-way: the structure join fade. */
export const REMIX_PART_SPAN_FADE_SECONDS = REMIX_STRUCTURE_JOIN_FADE_SECONDS;
/** A span is a whole number of loops when within this of one (seconds). */
export const REMIX_PART_LOOP_MULTIPLE_EPSILON = 1e-6;
/**
 * Preview reverb send of a part: the AI-layer law with no stem space
 * (`reverbWet(0, master.space)` = 0.7 × master space), like the beat.
 */
export const REMIX_PART_REVERB_SEND = 0.7;

export type RemixPart = {
  /** Client-chosen short id, [a-z0-9-]{1,32}. */
  id: string;
  role: RemixPartRole;
  takeId: string;
  /** Lane level in dB (stem gain range); omitted = 0. */
  gainDb?: number;
  /** Lane muted; omitted = false. */
  muted?: true;
  /** Per-timeline-block on/off; omitted = on everywhere. */
  blocks?: boolean[];
};

export type RemixParts = {
  schemaVersion: typeof REMIX_PARTS_SCHEMA_VERSION;
  parts: RemixPart[];
};

// ---------------------------------------------------------------------------
// Lanes.

const PART_LANE_PREFIX = "remix-part:";

/**
 * Solo/lane id of a part: `remix-part:{partId}` — never a project stem id
 * nor the beat's, so soloing a part silences every stem and the beat.
 */
export function partLaneId(partId: string): string {
  return `${PART_LANE_PREFIX}${partId}`;
}

/** The part id of a part lane id, or null for any other lane. */
export function partIdFromLaneId(laneId: string | null | undefined): string | null {
  return typeof laneId === "string" && laneId.startsWith(PART_LANE_PREFIX)
    ? laneId.slice(PART_LANE_PREFIX.length) || null
    : null;
}

// ---------------------------------------------------------------------------
// Musical rules shared with the backend.

export function isPitchedPartRole(role: string): boolean {
  return role !== "drums";
}

/** The loop length of an N-bar take at the song's tempo (4/4). */
export function partLengthSeconds(bpm: number, bars: number): number {
  return (bars * 4 * 60) / bpm;
}

/**
 * The time-stretch stage of one part (#1898): pitched parts take the
 * recipe's tempo and key shift like stems; drum parts the tempo only (never
 * transposed). Null when that stage is the identity. Mirrors the backend.
 */
export function partStretchPlan(
  role: string,
  plan: { tempo: number; semitones: number } | null,
): { tempo: number; semitones: number } | null {
  if (!plan) return null;
  const semitones = isPitchedPartRole(role) ? plan.semitones : 0;
  if (plan.tempo === 1 && semitones === 0) return null;
  return { tempo: plan.tempo, semitones };
}

// ---------------------------------------------------------------------------
// Placement (pinned by remix-parts-v1.parity.json).

/** One timeline span where a part plays its loop (timeline time). */
export type RemixPartSpan = {
  outStartSec: number;
  outEndSec: number;
  /** A 10 ms fade-out ending at `outEndSec`: the span cuts the loop. */
  fadeOut: boolean;
};

function round9(value: number): number {
  const rounded = Math.round(value * 1e9) / 1e9;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Where a part plays: one span per timeline block that is on for the part
 * (`blocks[i] !== false`) and is not a pickup block (the beat's rule). In a
 * span the loop restarts at phase 0 at `outStartSec` and repeats until
 * `outEndSec`; `fadeOut` is set when the span is not a whole number of
 * `loopSec` loops (within 1e-6). Times are rounded to 9 decimals. Mirrors
 * the backend `partPlacementSpans`.
 */
export function partPlacementSpans(
  part: { blocks?: boolean[] | null },
  grid: RemixBeatGrid,
  segments: readonly RemixBeatSegment[],
  loopSec: number,
): RemixPartSpan[] {
  if (!Number.isFinite(loopSec) || !(loopSec > 0)) return [];
  const spans: RemixPartSpan[] = [];
  segments.forEach((segment, blockIndex) => {
    if (part.blocks && part.blocks[blockIndex] === false) return;
    if (isBeatPickupSection(grid, segment.section)) return;
    const outStartSec = round9(segment.outStartSec);
    const outEndSec = round9(segment.outEndSec);
    const length = round9(outEndSec - outStartSec);
    if (!(length > 0)) return;
    const loops = Math.round(length / loopSec);
    const wholeLoops =
      loops >= 1 &&
      Math.abs(round9(length - loops * loopSec)) <=
        REMIX_PART_LOOP_MULTIPLE_EPSILON;
    spans.push({ outStartSec, outEndSec, fadeOut: !wholeLoops });
  });
  return spans;
}

// ---------------------------------------------------------------------------
// Normalization.

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

function isRole(value: unknown): value is RemixPartRole {
  return (
    typeof value === "string" &&
    (REMIX_PART_ROLES as readonly string[]).includes(value)
  );
}

function normalizePart(value: unknown, blockCount?: number | null): RemixPart | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !REMIX_PART_ID_PATTERN.test(raw.id)) return null;
  if (!isRole(raw.role)) return null;
  if (
    typeof raw.takeId !== "string" ||
    !raw.takeId ||
    raw.takeId.length > PART_TAKE_ID_MAX_CHARS
  ) {
    return null;
  }
  const gainDb =
    typeof raw.gainDb === "number" && Number.isFinite(raw.gainDb)
      ? round2(clampGainDb(raw.gainDb))
      : 0;
  let blocks: boolean[] | null = null;
  if (Array.isArray(raw.blocks)) {
    const flags = (raw.blocks as unknown[]).map((flag) => flag === true);
    if (typeof blockCount === "number") {
      blocks = normalizeBlockMask(flags, blockCount);
    } else if (flags.length > 0 && !flags.every(Boolean)) {
      blocks = flags;
    }
  }
  return {
    id: raw.id,
    role: raw.role,
    takeId: raw.takeId,
    ...(gainDb !== 0 ? { gainDb } : {}),
    ...(raw.muted === true ? { muted: true as const } : {}),
    ...(blocks ? { blocks } : {}),
  };
}

/**
 * Normalize a stored or edited `remix-parts/v1` recipe. The client clamps
 * and drops where the backend rejects: not an object or another schema
 * version → null; an invalid part (id pattern, role, take id) or a repeated
 * id is dropped; at most 4 parts are kept; gain clamps to the stem range
 * (2 decimals, omitted at 0); `muted` is kept only when true; `blocks`
 * against `blockCount` blocks (when given) reads as on-everywhere (omitted)
 * when stale or all on, like the backend's tolerant read. Null when no part
 * remains.
 */
export function normalizeRemixParts(
  value: unknown,
  blockCount?: number | null,
): RemixParts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== undefined &&
    raw.schemaVersion !== REMIX_PARTS_SCHEMA_VERSION
  ) {
    return null;
  }
  if (!Array.isArray(raw.parts)) return null;
  const parts: RemixPart[] = [];
  const ids = new Set<string>();
  for (const entry of raw.parts as unknown[]) {
    if (parts.length >= REMIX_PARTS_MAX) break;
    const part = normalizePart(entry, blockCount);
    if (!part || ids.has(part.id)) continue;
    ids.add(part.id);
    parts.push(part);
  }
  return parts.length > 0
    ? { schemaVersion: REMIX_PARTS_SCHEMA_VERSION, parts }
    : null;
}

/** Structural equality of two recipes after normalization. */
export function sameRemixParts(
  left: unknown,
  right: unknown,
  blockCount?: number | null,
): boolean {
  return (
    JSON.stringify(normalizeRemixParts(left, blockCount)) ===
    JSON.stringify(normalizeRemixParts(right, blockCount))
  );
}

// ---------------------------------------------------------------------------
// Edit helpers (the lane UI arrives with the generate flow).

function withParts(parts: RemixPart[]): RemixParts | null {
  return normalizeRemixParts({ schemaVersion: REMIX_PARTS_SCHEMA_VERSION, parts });
}

function mapPart(
  recipe: RemixParts | null,
  partId: string,
  change: (part: RemixPart) => RemixPart,
): RemixParts | null {
  if (!recipe) return null;
  return withParts(
    recipe.parts.map((part) => (part.id === partId ? change(part) : part)),
  );
}

/**
 * Add a part, or replace the part with the same id in place (e.g. another
 * take). Refused (the recipe unchanged) when it would be a fifth part or the
 * part is invalid.
 */
export function withPart(recipe: RemixParts | null, part: RemixPart): RemixParts | null {
  const normalized = normalizePart(part);
  if (!normalized) return recipe;
  const current = recipe?.parts ?? [];
  if (current.some((existing) => existing.id === normalized.id)) {
    return withParts(
      current.map((existing) => (existing.id === normalized.id ? normalized : existing)),
    );
  }
  if (current.length >= REMIX_PARTS_MAX) return recipe;
  return withParts([...current, normalized]);
}

/** Remove a part; null once none remains. */
export function withoutPart(recipe: RemixParts | null, partId: string): RemixParts | null {
  if (!recipe) return null;
  return withParts(recipe.parts.filter((part) => part.id !== partId));
}

/** A part's per-block on/off (null or all on = everywhere). */
export function withPartBlocks(
  recipe: RemixParts | null,
  partId: string,
  blocks: boolean[] | null,
): RemixParts | null {
  return mapPart(recipe, partId, (part) => {
    const next: RemixPart = { ...part };
    delete next.blocks;
    return blocks && blocks.length > 0 && !blocks.every(Boolean)
      ? { ...next, blocks: blocks.map((flag) => flag === true) }
      : next;
  });
}

/** A part's level (clamped to the stem range, 2 decimals). */
export function withPartGain(
  recipe: RemixParts | null,
  partId: string,
  gainDb: number,
): RemixParts | null {
  return mapPart(recipe, partId, (part) => ({ ...part, gainDb }));
}

/** A part muted or unmuted (`muted` omitted when false). */
export function withPartMuted(
  recipe: RemixParts | null,
  partId: string,
  muted: boolean,
): RemixParts | null {
  return mapPart(recipe, partId, (part) => {
    const next: RemixPart = { ...part };
    delete next.muted;
    return muted ? { ...next, muted: true } : next;
  });
}
