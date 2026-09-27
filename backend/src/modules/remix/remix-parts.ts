/**
 * Bounded AI parts (#1901): the `remix-parts/v1` recipe, the server-side
 * prompt template `remix-part-prompt/v1`, style sanitization and the quote.
 *
 * "Add an AI part": one instrument role, 4 or 8 bars, optional style words;
 * the studio generates takes (one 30 s model generation each, charged at the
 * canonical GENERATION_PRICE_CENTS_PER_30S — ADR-BM-6 line 2, no new price),
 * conforms each to the song (remix-part-conform.ts) and the user places the
 * chosen take on structure blocks as a lane, with the beat lane's block
 * semantics (#1902).
 *
 * The user's style words are only ever a prompt fragment: sanitized here,
 * never interpolated into a filtergraph, a path or a shell argument.
 */

import { execFile } from "child_process";
import { open, readFile, rm } from "fs/promises";
import { promisify } from "util";
import type { SectionGrid } from "./remix-arrangement";
import {
  floatWavHeader,
  isBeatPickupSection,
  type BeatGrid,
  type BeatSegment,
} from "./remix-beat";
import {
  JOIN_FADE_SECONDS,
  type RemixStructureSegment,
} from "./remix-structure";
import {
  isValidRemixStemGainDb,
  REMIX_STEM_GAIN_DB_MAX,
  REMIX_STEM_GAIN_DB_MIN,
} from "./remix-gain";
import {
  PART_CHANNELS,
  PART_SAMPLE_RATE,
  PITCH_CLASS_NAMES,
  tonicPitchClass,
  type PartKey,
} from "./remix-part-conform";

const execFileAsync = promisify(execFile);

export const REMIX_PARTS_SCHEMA_VERSION = "remix-parts/v1";
export const REMIX_PART_PROMPT_VERSION = "remix-part-prompt/v1";
export const REMIX_PART_TAKE_JOB = "generate-remix-part-take";

export const PART_ROLES = [
  "drums",
  "bass",
  "keys",
  "pad",
  "strings",
  "guitar",
] as const;
export type PartRole = (typeof PART_ROLES)[number];

export const PART_BAR_OPTIONS = [4, 8] as const;
export const PART_TAKES_MIN = 1;
export const PART_TAKES_MAX = 4;
export const PART_TAKES_DEFAULT = 3;
export const PART_STYLE_MAX_CHARS = 80;
/** Raw request bound before sanitization (whitespace collapses). */
export const PART_STYLE_RAW_MAX_CHARS = 200;
export const PARTS_MAX = 4;
export const PART_TAKES_PER_PROJECT_MAX = 24;
/** Every take is one model generation of this length. */
export const PART_CLIP_SECONDS = 30;
/** A cut must fit in the clip after the 0.25 s downbeat search start. */
export const PART_MAX_LENGTH_SECONDS = PART_CLIP_SECONDS - 0.25;
export const PART_ID_PATTERN = /^[a-z0-9-]{1,32}$/;
const PART_TAKE_ID_MAX_CHARS = 64;

/** Grounding of every take: prompt conditioned on measured tempo/key, then conformed. */
export const PART_TAKE_GROUNDING = "feature_conditioned";

export const PART_TAKE_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;
export type PartTakeStatus = (typeof PART_TAKE_STATUSES)[number];

/** Safe failure codes stored on a take (never provider or internal text). */
export const PART_TAKE_ERROR_CODES = [
  "provider_disabled",
  "provider_rejected",
  "provider_unavailable",
  "invalid_input",
  "parts_unsupported",
  "no_tempo_grid",
  "not_eligible",
  "project_not_draft",
  "insufficient_credits",
  "conform_failed",
  "storage_failed",
  "queue_unavailable",
  "stale",
  "internal_error",
] as const;
export type PartTakeErrorCode = (typeof PART_TAKE_ERROR_CODES)[number];

export function isPitchedPartRole(role: string): boolean {
  return role !== "drums";
}

export function partLengthSeconds(bpm: number, bars: number): number {
  return (bars * 4 * 60) / bpm;
}

// --- Request validation ----------------------------------------------------------

export type PartGenerateRequest = {
  role: PartRole;
  bars: 4 | 8;
  style: string | null;
  takes: number;
};

/**
 * Strip control/format characters (incl. bidi overrides and zero-width
 * marks), collapse whitespace, trim and cap at 80 characters (by code point).
 * Empty → null.
 */
export function sanitizePartStyle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return null;
  const capped = Array.from(cleaned).slice(0, PART_STYLE_MAX_CHARS).join("").trim();
  return capped || null;
}

/** Service-side validation of a generate request (the DTO also bounds it). */
export function normalizePartGenerateRequest(
  input: unknown,
): { value: PartGenerateRequest } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "The request body must be an object" };
  }
  const body = input as Record<string, unknown>;
  if (typeof body.role !== "string" || !PART_ROLES.includes(body.role as PartRole)) {
    return { error: `role must be one of: ${PART_ROLES.join(", ")}` };
  }
  if (!PART_BAR_OPTIONS.includes(body.bars as 4 | 8)) {
    return { error: `bars must be one of: ${PART_BAR_OPTIONS.join(", ")}` };
  }
  let takes = PART_TAKES_DEFAULT;
  if (body.takes !== undefined && body.takes !== null) {
    if (
      typeof body.takes !== "number" ||
      !Number.isInteger(body.takes) ||
      body.takes < PART_TAKES_MIN ||
      body.takes > PART_TAKES_MAX
    ) {
      return {
        error: `takes must be an integer between ${PART_TAKES_MIN} and ${PART_TAKES_MAX}`,
      };
    }
    takes = body.takes;
  }
  if (body.style !== undefined && body.style !== null) {
    if (typeof body.style !== "string") {
      return { error: "style must be a string or null" };
    }
    if (body.style.length > PART_STYLE_RAW_MAX_CHARS) {
      return {
        error: `style must be at most ${PART_STYLE_RAW_MAX_CHARS} characters`,
      };
    }
  }
  return {
    value: {
      role: body.role as PartRole,
      bars: body.bars as 4 | 8,
      style: sanitizePartStyle(body.style),
      takes,
    },
  };
}

// --- Quote --------------------------------------------------------------------------

/**
 * Credits for a batch: every take is one 30 s generation at the canonical
 * price — `perTakeCents` is `GenerationCreditsService.costForDurationCents(30)`
 * = price per 30 s × ceil(30 / 30).
 */
export function quotePartTakesCents(takes: number, perTakeCents: number): number {
  if (!Number.isInteger(takes) || takes < 0) {
    throw new RangeError("takes must be a non-negative integer");
  }
  if (!Number.isInteger(perTakeCents) || perTakeCents < 0) {
    throw new RangeError("perTakeCents must be a non-negative integer");
  }
  return takes * perTakeCents;
}

// --- Song key --------------------------------------------------------------------------

/**
 * The song's key: the highest-confidence `stem-audio-features/v1` key across
 * the project's stems (muted or not — the song's key does not depend on the
 * mix). Tonics are enum-validated: they reach the vendor prompt.
 */
export function deriveSongKey(
  stems: Array<{ audioFeatures?: unknown }>,
): PartKey | null {
  let best: PartKey | null = null;
  let bestConfidence = -Infinity;
  for (const stem of stems) {
    const features = stem.audioFeatures as
      | {
          schemaVersion?: unknown;
          key?: { tonic?: unknown; mode?: unknown; confidence?: unknown } | null;
        }
      | null
      | undefined;
    if (!features || features.schemaVersion !== "stem-audio-features/v1") continue;
    const key = features.key;
    if (!key || typeof key.tonic !== "string") continue;
    const pc = tonicPitchClass(key.tonic);
    if (pc === null || (key.mode !== "major" && key.mode !== "minor")) continue;
    const confidence =
      typeof key.confidence === "number" && Number.isFinite(key.confidence)
        ? Math.min(1, Math.max(0, key.confidence))
        : null;
    const rank = confidence ?? -1;
    if (rank > bestConfidence) {
      bestConfidence = rank;
      best = { tonic: PITCH_CLASS_NAMES[pc], mode: key.mode, confidence };
    }
  }
  return best;
}

// --- Prompt template ----------------------------------------------------------------------

const ROLE_DESCRIPTORS: Readonly<Record<PartRole, string>> = Object.freeze({
  drums: "tight drum groove",
  bass: "deep groovy bass line",
  keys: "piano and keys part",
  pad: "warm evolving synth pad",
  strings: "expressive string section part",
  guitar: "clean electric guitar part",
});

const DRUM_NEGATIVE = "bass, melody, chords, vocals, full mix";
const PITCHED_NEGATIVE = "drums, percussion, vocals, full mix, other instruments";

export type PartPrompt = {
  promptVersion: typeof REMIX_PART_PROMPT_VERSION;
  prompt: string;
  negativePrompt: string;
};

/**
 * `remix-part-prompt/v1`: "{role descriptor}, solo {role}, isolated
 * instrument, {style words}, {bpm} BPM, {key}, loopable, instrumental, no
 * vocals" plus role-specific exclusions. The key is omitted for drums.
 */
export function buildPartPrompt(input: {
  role: PartRole;
  style: string | null;
  bpm: number;
  key: PartKey | null;
}): PartPrompt {
  const style = sanitizePartStyle(input.style);
  const bpm = Math.round(input.bpm);
  const keyPc = input.key ? tonicPitchClass(input.key.tonic) : null;
  const key =
    input.key && keyPc !== null && isPitchedPartRole(input.role)
      ? `${PITCH_CLASS_NAMES[keyPc]} ${input.key.mode}`
      : null;
  const parts = [
    ROLE_DESCRIPTORS[input.role],
    `solo ${input.role}`,
    "isolated instrument",
    ...(style ? [style] : []),
    `${bpm} BPM`,
    ...(key ? [key] : []),
    "loopable",
    "instrumental",
    "no vocals",
  ];
  return {
    promptVersion: REMIX_PART_PROMPT_VERSION,
    prompt: parts.join(", "),
    negativePrompt: input.role === "drums" ? DRUM_NEGATIVE : PITCHED_NEGATIVE,
  };
}

// --- The remix-parts/v1 recipe -------------------------------------------------------------

export type RemixPart = {
  /** Client-chosen short id, [a-z0-9-]{1,32}. */
  id: string;
  role: PartRole;
  takeId: string;
  /** Lane level in dB (stem gain range); omitted = 0. */
  gainDb?: number;
  /** Lane muted; omitted = false. */
  muted?: true;
  /** Per-timeline-block on/off (the beat's semantics); omitted = on everywhere. */
  blocks?: boolean[];
};

export type RemixParts = {
  schemaVersion: typeof REMIX_PARTS_SCHEMA_VERSION;
  parts: RemixPart[];
};

/** PATCH reason when the source has no bar grid (no measured tempo). */
export const PARTS_NEED_TEMPO_ERROR =
  "AI parts need the song's measured tempo, and this source doesn't have one yet.";

const RECIPE_KEYS = ["schemaVersion", "parts"];
const PART_KEYS = ["id", "role", "takeId", "gainDb", "muted", "blocks"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function round2(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/**
 * One part's shape. `blockCount` null skips the blocks-length check (a
 * stale list is handled by the caller).
 */
function normalizePartShape(
  value: unknown,
  index: number,
  blockCount: number | null,
): { value: RemixPart } | { error: string } {
  const at = `parts[${index}]`;
  if (!isPlainObject(value)) return { error: `${at} must be an object` };
  for (const key of Object.keys(value)) {
    if (!PART_KEYS.includes(key)) {
      return {
        error: `${at}.${key} is not supported (allowed: ${PART_KEYS.join(", ")})`,
      };
    }
  }
  if (typeof value.id !== "string" || !PART_ID_PATTERN.test(value.id)) {
    return { error: `${at}.id must match [a-z0-9-]{1,32}` };
  }
  if (typeof value.role !== "string" || !PART_ROLES.includes(value.role as PartRole)) {
    return { error: `${at}.role must be one of: ${PART_ROLES.join(", ")}` };
  }
  if (
    typeof value.takeId !== "string" ||
    !value.takeId ||
    value.takeId.length > PART_TAKE_ID_MAX_CHARS
  ) {
    return { error: `${at}.takeId must be a take id` };
  }
  let gainDb = 0;
  if (value.gainDb !== undefined && value.gainDb !== null) {
    if (!isValidRemixStemGainDb(value.gainDb)) {
      return {
        error: `${at}.gainDb must be a number between ${REMIX_STEM_GAIN_DB_MIN} and ${REMIX_STEM_GAIN_DB_MAX}`,
      };
    }
    gainDb = round2(value.gainDb);
  }
  if (value.muted !== undefined && typeof value.muted !== "boolean") {
    return { error: `${at}.muted must be a boolean` };
  }
  // Blocks follow the beat recipe exactly (#1902): one flag per timeline
  // block after this PATCH, non-empty, all-on normalizes to the default.
  let blocks: boolean[] | null = null;
  if (value.blocks !== undefined && value.blocks !== null) {
    const raw = value.blocks;
    if (!Array.isArray(raw) || !raw.every((flag) => typeof flag === "boolean")) {
      return { error: `${at}.blocks must be null or an array of booleans` };
    }
    if (blockCount !== null && raw.length !== blockCount) {
      return {
        error: `${at}.blocks must have exactly ${blockCount} entries (one per block)`,
      };
    }
    if (raw.length === 0) {
      return { error: `${at}.blocks must be null or a non-empty array of booleans` };
    }
    blocks = raw.every(Boolean) ? null : [...(raw as boolean[])];
  }
  return {
    value: {
      id: value.id,
      role: value.role as PartRole,
      takeId: value.takeId,
      ...(gainDb !== 0 ? { gainDb } : {}),
      ...(value.muted === true ? { muted: true as const } : {}),
      ...(blocks ? { blocks } : {}),
    },
  };
}

/**
 * Validate + normalise a PATCH `parts` payload (shape only — the caller
 * checks every takeId against the project's COMPLETED takes of the same role
 * under the project row lock). Parts need a bar grid; `blocks` is measured
 * against the block count after the PATCH. An empty list normalises to null.
 * Callers must skip this for `undefined` (field absent = unchanged).
 */
export function normalizeRemixPartsInput(
  value: unknown,
  blockCount: number,
  grid: Pick<SectionGrid, "kind" | "bpm"> | null,
): { value: RemixParts | null } | { error: string } {
  if (value === null || value === undefined) return { value: null };
  if (!isPlainObject(value)) return { error: "parts must be an object or null" };
  for (const key of Object.keys(value)) {
    if (!RECIPE_KEYS.includes(key)) {
      return {
        error: `parts.${key} is not supported (allowed: ${RECIPE_KEYS.join(", ")})`,
      };
    }
  }
  if (
    value.schemaVersion !== undefined &&
    value.schemaVersion !== REMIX_PARTS_SCHEMA_VERSION
  ) {
    return { error: `parts.schemaVersion must be "${REMIX_PARTS_SCHEMA_VERSION}"` };
  }
  if (!Array.isArray(value.parts)) {
    return { error: "parts.parts must be an array" };
  }
  if (value.parts.length > PARTS_MAX) {
    return { error: `At most ${PARTS_MAX} AI parts are allowed` };
  }
  if (value.parts.length === 0) return { value: null };
  if (!grid || grid.kind !== "bars" || !(grid.bpm && grid.bpm > 0)) {
    return { error: PARTS_NEED_TEMPO_ERROR };
  }
  const parts: RemixPart[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < value.parts.length; i += 1) {
    const normalized = normalizePartShape(value.parts[i], i, blockCount);
    if ("error" in normalized) return normalized;
    if (ids.has(normalized.value.id)) {
      return { error: `parts[${i}].id "${normalized.value.id}" is used twice` };
    }
    ids.add(normalized.value.id);
    parts.push(normalized.value);
  }
  return { value: { schemaVersion: REMIX_PARTS_SCHEMA_VERSION, parts } };
}

/**
 * Tolerant read of the stored column: invalid parts are dropped one by one
 * (a part whose take is not a completed take of this project with the same
 * role, when `takes` is given); a stale `blocks` list (structure edited
 * without remapping) fails open to on-everywhere, like the beat. Null when
 * nothing valid remains.
 *
 * @param blockCount current timeline block count; null skips the length check.
 */
export function readStoredRemixParts(
  stored: unknown,
  blockCount: number | null,
  takes?: Array<{ id: string; role: string; status: string }>,
): RemixParts | null {
  if (!isPlainObject(stored)) return null;
  if (stored.schemaVersion !== REMIX_PARTS_SCHEMA_VERSION) return null;
  if (!Array.isArray(stored.parts)) return null;
  const takeById = takes ? new Map(takes.map((take) => [take.id, take])) : null;
  const parts: RemixPart[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < stored.parts.length && parts.length < PARTS_MAX; i += 1) {
    const normalized = normalizePartShape(stored.parts[i], i, null);
    if ("error" in normalized) continue;
    const part = normalized.value;
    if (ids.has(part.id)) continue;
    if (takeById) {
      const take = takeById.get(part.takeId);
      if (!take || take.status !== "completed" || take.role !== part.role) continue;
    }
    ids.add(part.id);
    if (blockCount !== null && part.blocks && part.blocks.length !== blockCount) {
      const { blocks: _stale, ...rest } = part;
      parts.push(rest);
    } else {
      parts.push(part);
    }
  }
  return parts.length ? { schemaVersion: REMIX_PARTS_SCHEMA_VERSION, parts } : null;
}

/**
 * Every takeId mentioned by the stored column, valid or not: eviction and
 * DELETE must never remove a take a (possibly malformed) part still names.
 */
export function referencedTakeIds(stored: unknown): Set<string> {
  const ids = new Set<string>();
  if (!isPlainObject(stored) || !Array.isArray(stored.parts)) return ids;
  for (const part of stored.parts) {
    if (isPlainObject(part) && typeof part.takeId === "string") {
      ids.add(part.takeId);
    }
  }
  return ids;
}

// --- Take read shape ---------------------------------------------------------------------------

export type PartTakeRow = {
  id: string;
  batchId: string;
  role: string;
  bars: number;
  style: string | null;
  seed: number;
  status: string;
  promptVersion: string;
  provider: string | null;
  model: string | null;
  grounding: string;
  costCents: number;
  storageUri: string | null;
  mimeType: string | null;
  durationSec: number | null;
  conform: unknown;
  errorCode: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

/**
 * What the studio sees of a take: no storage URI (audio streams through the
 * owner-only endpoint) and no user id. Every take is AI-generated.
 */
export function toPartTakeResponse(take: PartTakeRow) {
  return {
    id: take.id,
    batchId: take.batchId,
    role: take.role,
    bars: take.bars,
    style: take.style,
    seed: take.seed,
    status: take.status,
    promptVersion: take.promptVersion,
    provider: take.provider,
    model: take.model,
    grounding: take.grounding,
    aiGenerated: true as const,
    costCents: take.costCents,
    mimeType: take.mimeType,
    durationSec: take.durationSec,
    conform: take.conform ?? null,
    errorCode: take.errorCode,
    createdAt: take.createdAt,
    startedAt: take.startedAt,
    completedAt: take.completedAt,
  };
}

// --- Placement (both engines; pinned by remix-parts-v1.parity.json) -----------------------

/**
 * Version of the placement + part-track rules below, recorded with every
 * render that includes parts. Changing any rule (span, loop phase, fade)
 * requires a new version so older drafts stay auditable.
 */
export const REMIX_PARTS_DSP_VERSION = "remix-parts-dsp/v1";
/** Fade-out where a span cuts a loop mid-way: the structure join fade. */
export const PART_SPAN_FADE_SECONDS = JOIN_FADE_SECONDS;
/** A span is a whole number of loops when within this of one (seconds). */
export const PART_LOOP_MULTIPLE_EPSILON = 1e-6;

/** One timeline span where a part plays its loop (timeline time). */
export type PartPlacementSpan = {
  outStartSec: number;
  outEndSec: number;
  /** A 10 ms fade-out ending at `outEndSec`: the span cuts the loop mid-way. */
  fadeOut: boolean;
};

/** Round to 9 decimals (the shared time grid of both engines, like beatHits). */
function round9(value: number): number {
  const rounded = Math.round(value * 1e9) / 1e9;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Where a part plays on the timeline: one span per block that is on for the
 * part (`blocks[i] !== false`) and is not a pickup block (the beat's rule,
 * {@link isBeatPickupSection}). In a span the loop restarts at phase 0 at
 * `outStartSec` and repeats until `outEndSec`; `fadeOut` is set when the
 * span is not a whole number of `loopSec` loops (within 1e-6), i.e. it cuts
 * the loop mid-way. Times are rounded to 9 decimals. Mirrored by the web
 * preview (`web/src/lib/remixParts.ts`).
 */
export function partPlacementSpans(
  part: { blocks?: boolean[] | null },
  grid: BeatGrid,
  segments: BeatSegment[],
  loopSec: number,
): PartPlacementSpan[] {
  if (!Number.isFinite(loopSec) || !(loopSec > 0)) return [];
  const spans: PartPlacementSpan[] = [];
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
      Math.abs(round9(length - loops * loopSec)) <= PART_LOOP_MULTIPLE_EPSILON;
    spans.push({ outStartSec, outEndSec, fadeOut: !wholeLoops });
  });
  return spans;
}

/**
 * The time-stretch stage of one part (#1898): pitched parts take the
 * recipe's tempo and key shift like stems; drum parts take the tempo only
 * (never transposed). Null when the stage would be the identity.
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

// --- Render context --------------------------------------------------------------------------

/** Why a saved part was left out of a render (recorded, never an error). */
export type PartSkippedReason = "take_missing" | "take_not_ready";

/** One audible part at render time (read from the owned project's takes). */
export type RemixRenderPart = {
  partId: string;
  role: PartRole;
  takeId: string;
  gainDb: number;
  blocks: boolean[] | null;
  bars: number;
  /** Internal: where the conformed FLAC lives. Never recorded. */
  storageUri: string;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  conformVersion: string | null;
};

/**
 * Render-time parts context (#1901): the audible parts (unmuted, with a
 * completed take of this project and role), the parts left out with a
 * reason, and the bar grid + timeline they are placed on. Never built
 * without a bar grid.
 */
export type RemixRenderParts = {
  parts: RemixRenderPart[];
  skipped: Array<{ partId: string; takeId: string; reason: PartSkippedReason }>;
  grid: SectionGrid;
  segments: RemixStructureSegment[];
};

/** Lineage of one part mixed into a render (renderMetadata / publish). */
export type RemixRenderedPart = {
  partId: string;
  role: string;
  takeId: string;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  conformVersion: string | null;
  bars: number;
  gainDb: number;
};

export function renderedPartLineage(part: RemixRenderPart): RemixRenderedPart {
  return {
    partId: part.partId,
    role: part.role,
    takeId: part.takeId,
    provider: part.provider,
    model: part.model,
    promptVersion: part.promptVersion,
    conformVersion: part.conformVersion,
    bars: part.bars,
    gainDb: part.gainDb,
  };
}

/**
 * Tolerant read of recorded part lineage (render metadata, conditioning
 * provenance): entries without the identifying strings are dropped; ids are
 * kept verbatim (they were validated when the render ran).
 */
export function readRenderedParts(value: unknown): RemixRenderedPart[] {
  if (!Array.isArray(value)) return [];
  const out: RemixRenderedPart[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    if (
      typeof entry.partId !== "string" ||
      typeof entry.role !== "string" ||
      typeof entry.takeId !== "string"
    ) {
      continue;
    }
    out.push({
      partId: entry.partId,
      role: entry.role,
      takeId: entry.takeId,
      provider: typeof entry.provider === "string" ? entry.provider : null,
      model: typeof entry.model === "string" ? entry.model : null,
      promptVersion:
        typeof entry.promptVersion === "string"
          ? entry.promptVersion
          : REMIX_PART_PROMPT_VERSION,
      conformVersion:
        typeof entry.conformVersion === "string" ? entry.conformVersion : null,
      bars: typeof entry.bars === "number" ? entry.bars : 0,
      gainDb: typeof entry.gainDb === "number" ? entry.gainDb : 0,
    });
  }
  return out;
}

// --- Part track rendering ------------------------------------------------------------------------

/** A decoded take longer than this is refused (takes are ≤ 29.75 s). */
export const PART_TAKE_MAX_DECODE_SECONDS = 32;
const PART_DECODE_TIMEOUT_MS = 60_000;
/** Frames rendered per chunk by {@link writePartTrackWav} (1 s at 48 kHz). */
const PART_WAV_CHUNK_FRAMES = 48_000;

/**
 * ffmpeg args decoding a take to raw interleaved 32-bit float stereo at
 * 48 kHz, capped at {@link PART_TAKE_MAX_DECODE_SECONDS}. Paths are argv
 * entries, never shell-interpolated; no user string reaches ffmpeg.
 */
export function buildPartDecodeArgs(inputPath: string, outputPath: string): string[] {
  return [
    "-y",
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-vn",
    "-t",
    String(PART_TAKE_MAX_DECODE_SECONDS),
    "-f",
    "f32le",
    "-c:a",
    "pcm_f32le",
    "-ac",
    String(PART_CHANNELS),
    "-ar",
    String(PART_SAMPLE_RATE),
    outputPath,
  ];
}

/**
 * Decode a take file (in the render's temp dir) to its loop: interleaved
 * stereo float at 48 kHz. The raw intermediate is deleted before returning.
 * Memory: the loop only (≤ 32 s of stereo float).
 */
export async function decodePartTakeLoop(
  inputPath: string,
  rawPath: string,
): Promise<Float32Array> {
  try {
    await execFileAsync("ffmpeg", buildPartDecodeArgs(inputPath, rawPath), {
      timeout: PART_DECODE_TIMEOUT_MS,
    });
    const bytes = await readFile(rawPath);
    const frames = Math.floor(bytes.length / (4 * PART_CHANNELS));
    if (frames === 0) throw new Error("The take decoded to no audio.");
    const loop = new Float32Array(frames * PART_CHANNELS);
    for (let i = 0; i < loop.length; i += 1) loop[i] = bytes.readFloatLE(i * 4);
    return loop;
  } finally {
    await rm(rawPath, { force: true });
  }
}

/**
 * Render a part's track over [offset, offset + frames) into `out`
 * (interleaved stereo): for each span the loop restarts at phase 0 at
 * round(outStartSec·sr) and repeats until round(outEndSec·sr); a `fadeOut`
 * span gets a linear 10 ms fade ending at its last frame. Frames outside
 * every span are left untouched (zero).
 */
export function renderPartTrackInto(
  out: Float32Array | Float64Array,
  offset: number,
  frames: number,
  loop: Float32Array,
  spans: PartPlacementSpan[],
  sampleRate: number = PART_SAMPLE_RATE,
): void {
  const loopFrames = Math.floor(loop.length / PART_CHANNELS);
  if (loopFrames === 0) return;
  const end = offset + frames;
  const fadeLength = Math.round(PART_SPAN_FADE_SECONDS * sampleRate);
  for (const span of spans) {
    const s0 = Math.round(span.outStartSec * sampleRate);
    const s1 = Math.round(span.outEndSec * sampleRate);
    if (s1 <= offset || s0 >= end || s1 <= s0) continue;
    const fadeFrames = span.fadeOut ? Math.min(fadeLength, s1 - s0) : 0;
    const fadeStart = s1 - fadeFrames;
    const from = Math.max(s0, offset);
    const to = Math.min(s1, end);
    let phase = (from - s0) % loopFrames;
    for (let f = from; f < to; f += 1) {
      const gain = f >= fadeStart && fadeFrames > 0 ? (s1 - f) / fadeFrames : 1;
      const o = (f - offset) * PART_CHANNELS;
      const i = phase * PART_CHANNELS;
      out[o] = loop[i] * gain;
      out[o + 1] = loop[i + 1] * gain;
      phase += 1;
      if (phase === loopFrames) phase = 0;
    }
  }
}

/**
 * Write a part's track in TIMELINE time as a stereo 32-bit float 48 kHz WAV
 * — the render's extra ffmpeg input — ceil(durationSec·sr) frames long,
 * streamed in 1 s chunks so memory stays at the loop plus one chunk for any
 * timeline length. Block on/off and the loop phase reset are baked in.
 */
export async function writePartTrackWav(
  path: string,
  loop: Float32Array,
  spans: PartPlacementSpan[],
  durationSec: number,
  sampleRate: number = PART_SAMPLE_RATE,
): Promise<{ frames: number }> {
  const frames = Math.max(1, Math.ceil(Math.max(0, durationSec) * sampleRate));
  const handle = await open(path, "w");
  try {
    await handle.write(floatWavHeader(frames, PART_CHANNELS, sampleRate));
    const chunk = new Float32Array(PART_WAV_CHUNK_FRAMES * PART_CHANNELS);
    const bytes = Buffer.alloc(chunk.length * 4);
    for (let offset = 0; offset < frames; offset += PART_WAV_CHUNK_FRAMES) {
      const count = Math.min(PART_WAV_CHUNK_FRAMES, frames - offset);
      chunk.fill(0);
      renderPartTrackInto(chunk, offset, count, loop, spans, sampleRate);
      for (let i = 0; i < count * PART_CHANNELS; i += 1) {
        bytes.writeFloatLE(chunk[i], i * 4);
      }
      await handle.write(bytes, 0, count * PART_CHANNELS * 4);
    }
  } finally {
    await handle.close();
  }
  return { frames };
}
