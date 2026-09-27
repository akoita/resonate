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

import type { SectionGrid } from "./remix-arrangement";
import {
  isValidRemixStemGainDb,
  REMIX_STEM_GAIN_DB_MAX,
  REMIX_STEM_GAIN_DB_MIN,
} from "./remix-gain";
import {
  PITCH_CLASS_NAMES,
  tonicPitchClass,
  type PartKey,
} from "./remix-part-conform";

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
