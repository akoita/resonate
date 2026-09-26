"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import {
  exportRemixDraftBlob,
  generateRemixDraft,
  getCreditsBalance,
  getRemixEligibility,
  getRemixProject,
  publishRemixProject,
  requestGenerationCredits,
  updateRemixProject,
  type GenerationCreditBalance,
  type RemixEligibilityResponse,
  type RemixGenerationAttribution,
  type RemixGenerationMetadata,
  type RemixProject,
  type RemixProjectAvailableStem,
  type RemixProjectPatch,
  type RemixProjectSource,
  type RemixSectionGrid,
  type RemixStemTransform,
} from "../../lib/api";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { CreditBalanceMeter } from "../credits/CreditBalanceMeter";
import { canAffordGeneration } from "../../lib/credits";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import {
  activePresetLabel,
  presetsForMode,
} from "../../lib/remixPromptPresets";
import {
  remixDraftOutputUri,
  type PreviewBeat,
  type PreviewLevel,
  type PreviewStemState,
  type StemArrangementPreviewHandle,
} from "../../lib/remixAudioPreview";
import {
  activeIntervalsFromSections,
  arrangementPayload,
  parseArrangementSections,
  sectionGridSummaryLabel,
} from "../../lib/remixArrangement";
import { isFullMixStemType } from "../../lib/remixStems";
import {
  intentFromState,
  stateForIntent,
  type RemixIntent,
} from "../../lib/remixIntent";
import { applicableRecipes, applyRecipe } from "../../lib/remixRecipes";
import {
  beatBlocksAfterStructureEdit,
  beatGridAvailable,
  normalizeRemixBeat,
  REMIX_BEAT_KIT_LABELS,
  withBeatMuted,
  REMIX_BEAT_LANE_ID,
  sameRemixBeat,
  type RemixBeatRecipe,
} from "../../lib/remixBeat";
import type {
  RemixDescribeContext,
  RemixDescribeEdits,
} from "../../lib/remixDescribe";
import {
  applyVibe,
  normalizeRemixFx,
  remixFxStem,
  sameRemixFx,
  withMasterFx,
  withStemFx,
  type RemixFxMaster,
  type RemixFxRecipe,
  type RemixFxStem,
  type RemixVibeId,
} from "../../lib/remixFx";
import {
  gateIntervalsForBlocks,
  normalizeRemixStructure,
  sameRemixStructure,
  structureEditState,
  structureTimeline,
  type RemixBlockMasks,
  type RemixStructure,
  type RemixStructureBlock,
  type RemixStructureEditResult,
  type RemixStructureEditState,
  type RemixStructureTimeline,
} from "../../lib/remixStructure";
import {
  blockActionResult,
  RemixSessionLanes,
  sectionColumnLabels,
  type LaneBeat,
  type LaneBlockAction,
  type LaneStem,
} from "./RemixSessionLanes";
import { RemixTransportBar } from "./RemixTransportBar";
import {
  RemixCreatePanel,
  structureShapeOptions,
  structureShapeResult,
  type RemixStructureShapeId,
} from "./RemixCreatePanel";
import {
  RemixDraftsPanel,
  type RemixCurrentDraft,
  type RemixDraftVersion,
} from "./RemixDraftsPanel";
import { useRemixTransport, type TransportSource } from "./useRemixTransport";

// Shared helpers moved to lib (#1879) so the lanes, recipes and drafts panel
// use them without importing the editor; re-exported for existing callers.
export { clampGainDb, GAIN_DB_MAX, GAIN_DB_MIN } from "../../lib/remixGain";
export { isFullMixStemType } from "../../lib/remixStems";
export { formatDraftCost } from "../../lib/remixFormat";

/** Maps apiRequest error messages ("API <status>: ...") to a load state. */
export function classifyProjectLoadError(
  message: string,
): "forbidden" | "missing" | "error" {
  if (message.startsWith("API 403:")) return "forbidden";
  if (message.startsWith("API 404:")) return "missing";
  return "error";
}

export type StemEdit = {
  gainDb: number | null;
  muted: boolean;
  /**
   * On/off mask (#1314), indexed by timeline BLOCK (#1899); without a
   * structure the blocks are the grid's sections. null = every block on.
   */
  sections: boolean[] | null;
};

export type ProjectEdits = {
  title: string;
  prompt: string;
  mode: string;
  stems: Record<string, StemEdit>;
  /** Studio AI intent (#1882), saved with the project; whole = default. */
  aiTarget: AiTargetEdit;
  /** Effects recipe `remix-fx/v1` (#1897), normalized; null = untouched. */
  effects: RemixFxRecipe | null;
  /**
   * Structure recipe `remix-structure/v1` (#1899), normalized against the
   * grid; null = the original order.
   */
  structure: RemixStructure | null;
  /**
   * Beat recipe `remix-beat/v1` (#1902), normalized against the block
   * count (a stale `blocks` list is null = every block); null = no beat.
   */
  beat: RemixBeatRecipe | null;
};

export type AiTargetEdit = { kind: AiTargetKind; stemId: string | null };

const AI_TARGET_KINDS: ReadonlySet<string> = new Set([
  "whole",
  "add_layer",
  "replace_stem",
]);

/**
 * Normalizes a saved AI target (#1882): absent or unknown kinds become the
 * whole track, only replace_stem keeps a stem, and a stem that is no longer
 * in the project is dropped.
 */
export function normalizeAiTarget(
  target: unknown,
  stems: Array<{ stemId: string }>,
): AiTargetEdit {
  if (!target || typeof target !== "object") {
    return { kind: "whole", stemId: null };
  }
  const { kind, stemId } = target as { kind?: unknown; stemId?: unknown };
  if (typeof kind !== "string" || !AI_TARGET_KINDS.has(kind)) {
    return { kind: "whole", stemId: null };
  }
  if (kind !== "replace_stem") {
    return { kind: kind as AiTargetKind, stemId: null };
  }
  const validStem =
    typeof stemId === "string" && stems.some((stem) => stem.stemId === stemId);
  return { kind: "replace_stem", stemId: validStem ? stemId : null };
}

/**
 * A project's normalized structure (#1899) and its block count: the
 * structure's blocks, else the grid's sections (0 without a grid).
 */
export function projectStructure(
  project: Pick<RemixProject, "sectionGrid" | "structure">,
): { structure: RemixStructure | null; blockCount: number } {
  const sectionCount = project.sectionGrid?.sections.length ?? 0;
  const structure =
    sectionCount > 0
      ? normalizeRemixStructure(project.structure, sectionCount)
      : null;
  return { structure, blockCount: structure?.blocks.length ?? sectionCount };
}

/** Block count of edits on a grid: the structure's blocks, else the sections. */
function editBlockCount(
  sectionCount: number,
  structure: RemixStructure | null | undefined,
): number {
  if (sectionCount <= 0) return 0;
  return structure?.blocks.length ?? sectionCount;
}

export function initialEdits(project: RemixProject): ProjectEdits {
  // Masks are indexed by block (#1899), so they parse against the block count.
  const { structure, blockCount } = projectStructure(project);
  const stems: Record<string, StemEdit> = {};
  for (const stem of project.stems) {
    stems[stem.stemId] = {
      gainDb: stem.gainDb,
      muted: stem.muted,
      sections:
        blockCount > 0
          ? parseArrangementSections(stem.arrangement, blockCount)
          : null,
    };
  }
  return {
    title: project.title,
    prompt: project.prompt ?? "",
    mode: project.mode,
    stems,
    aiTarget: normalizeAiTarget(project.aiTarget, project.stems),
    effects: normalizeRemixFx(
      project.effects,
      project.stems.map((stem) => stem.stemId),
    ),
    structure,
    beat: normalizeRemixBeat(project.beat, blockCount > 0 ? blockCount : null),
  };
}

/**
 * Computes the minimal PATCH payload between the persisted project and the
 * local edits. Returns an empty object when nothing changed, which doubles
 * as the dirty-state check.
 */
export function buildProjectPatch(
  project: RemixProject,
  edits: ProjectEdits,
): RemixProjectPatch {
  const patch: RemixProjectPatch = {};
  const title = edits.title.trim();
  if (title && title !== project.title) {
    patch.title = title;
  }
  const prompt = edits.prompt.trim() === "" ? null : edits.prompt;
  if (prompt !== (project.prompt ?? null)) {
    patch.prompt = prompt;
  }
  if (edits.mode !== project.mode) {
    patch.mode = edits.mode;
  }
  const savedTarget = normalizeAiTarget(project.aiTarget, project.stems);
  const editTarget = normalizeAiTarget(edits.aiTarget, project.stems);
  if (
    savedTarget.kind !== editTarget.kind ||
    savedTarget.stemId !== editTarget.stemId
  ) {
    // null clears back to the whole-track default server-side (#1882).
    patch.aiTarget =
      editTarget.kind === "whole"
        ? null
        : { kind: editTarget.kind, stemId: editTarget.stemId };
  }
  const projectStemIds = project.stems.map((stem) => stem.stemId);
  if (!sameRemixFx(project.effects, edits.effects, projectStemIds)) {
    // null clears the recipe server-side (#1897).
    patch.effects = normalizeRemixFx(edits.effects, projectStemIds);
  }
  const sectionCount = project.sectionGrid?.sections.length ?? 0;
  const editStructure = edits.structure ?? null;
  if (
    sectionCount > 0 &&
    !sameRemixStructure(project.structure, editStructure, sectionCount)
  ) {
    // null restores the original order server-side (#1899); the remapped
    // masks travel in the same PATCH and are validated against it.
    patch.structure = normalizeRemixStructure(editStructure, sectionCount);
  }
  // Persisted masks read against the PERSISTED block count; one of another
  // length counts as null (fail-open, like the render).
  const persistedBlockCount = projectStructure(project).blockCount;
  const nextBlockCount = editBlockCount(
    sectionCount,
    normalizeRemixStructure(editStructure, sectionCount),
  );
  const stemPatches: NonNullable<RemixProjectPatch["stems"]> = [];
  for (const stem of project.stems) {
    const edit = edits.stems[stem.stemId];
    if (!edit) continue;
    const stemPatch: {
      stemId: string;
      gainDb?: number | null;
      muted?: boolean;
      arrangement?: unknown;
    } = {
      stemId: stem.stemId,
    };
    if (edit.gainDb !== stem.gainDb) {
      stemPatch.gainDb = edit.gainDb;
    }
    if (edit.muted !== stem.muted) {
      stemPatch.muted = edit.muted;
    }
    if (sectionCount > 0) {
      const persisted = parseArrangementSections(
        stem.arrangement,
        persistedBlockCount,
      );
      if (!sameSections(edit.sections, persisted)) {
        // null clears back to the always-on default server-side (#1314).
        stemPatch.arrangement =
          edit.sections === null ? null : arrangementPayload(edit.sections);
      } else if (
        patch.structure !== undefined &&
        edit.sections === null &&
        stem.arrangement != null &&
        (persisted === null ||
          parseArrangementSections(stem.arrangement, nextBlockCount) === null)
      ) {
        // A structure change clears a stale persisted mask (#1899): one that
        // fits neither the old nor the new block count must not come back
        // to life when the block count happens to match its length.
        stemPatch.arrangement = null;
      }
    }
    if (
      stemPatch.gainDb !== undefined ||
      stemPatch.muted !== undefined ||
      "arrangement" in stemPatch
    ) {
      stemPatches.push(stemPatch);
    }
  }
  if (stemPatches.length > 0) {
    patch.stems = stemPatches;
  }
  // Beat (#1902): the whole normalized recipe, or null to remove it. Its
  // blocks read against the persisted vs the edited block count.
  const beatCount = (count: number) => (sectionCount > 0 ? count : null);
  const persistedBeat = normalizeRemixBeat(
    project.beat,
    beatCount(persistedBlockCount),
  );
  const editBeat = normalizeRemixBeat(edits.beat ?? null, beatCount(nextBlockCount));
  if (!sameRemixBeat(persistedBeat, editBeat)) {
    patch.beat = editBeat;
  } else if (
    editBeat &&
    patch.structure !== undefined &&
    editBeat.blocks === null &&
    Array.isArray(project.beat?.blocks)
  ) {
    // A structure change clears a stale persisted beat mask, like a stem's.
    patch.beat = editBeat;
  }
  return patch;
}

function sameSections(
  left: boolean[] | null,
  right: boolean[] | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.length === right.length &&
    left.every((flag, index) => flag === right[index])
  );
}

export function describeSourceRights(source: RemixProjectSource): {
  label: string;
  tone: "ok" | "warning";
} {
  if (source.contentStatus !== "clean") {
    return { label: "Source under review", tone: "warning" };
  }
  if (source.rightsRoute === "TRUSTED_FAST_PATH") {
    return { label: "Rights verified · trusted source", tone: "ok" };
  }
  if (source.rightsRoute === "STANDARD_ESCROW") {
    return { label: "Rights verified · standard", tone: "ok" };
  }
  return { label: "Rights state restricted", tone: "warning" };
}

/** The studio action for a sibling stem that isn't in the session yet (#1312). */
export type AvailableStemAction =
  | { kind: "add"; label: string }
  | { kind: "license"; label: string; href: string | null }
  | { kind: "blocked"; label: string };

export function describeAvailableStemAction(
  stem: RemixProjectAvailableStem,
): AvailableStemAction {
  if (stem.addable) {
    return { kind: "add", label: "Add to session" };
  }
  if (stem.remixable === false) {
    return { kind: "blocked", label: "Minted without remix rights" };
  }
  if (!stem.licensed) {
    return {
      kind: "license",
      label: "Get remix license",
      // The stem page is the remix-tier buy surface (#1141/#1306).
      href: stem.tokenId ? `/stem/${stem.tokenId}` : null,
    };
  }
  // Licensed and remixable but the source itself is blocked right now
  // (consent flip, quarantine) — the same state that gates generation.
  return { kind: "blocked", label: "Source is not remixable right now" };
}

/**
 * Full-mix stems that act as an A/B reference rather than a mixer channel:
 * summed with separated stems they double every part. A lone full-mix stem
 * (nothing separated yet) stays a normal channel.
 */
export function referenceStemIds(
  stems: Array<{ stemId: string; type: string }>,
): Set<string> {
  const hasSeparatedStem = stems.some((stem) => !isFullMixStemType(stem.type));
  if (!hasSeparatedStem) return new Set();
  return new Set(
    stems.filter((stem) => isFullMixStemType(stem.type)).map((stem) => stem.stemId),
  );
}

/**
 * Reference stems that are actually doubling the mix right now: unmuted in
 * the current edits while at least one separated stem is unmuted too. An
 * unmuted original over all-muted siblings (e.g. a session started from the
 * original's stem page) plays the track once — no doubling, no warning yet.
 */
export function doublingReferenceStemIds(
  stems: Array<{ stemId: string; type: string; muted: boolean }>,
  edits: Pick<ProjectEdits, "stems">,
): Set<string> {
  const references = referenceStemIds(stems);
  const audible = (stem: { stemId: string; muted: boolean }) =>
    !(edits.stems[stem.stemId]?.muted ?? stem.muted);
  const separatedAudible = stems.some(
    (stem) => !references.has(stem.stemId) && audible(stem),
  );
  if (!separatedAudible) return new Set();
  return new Set(
    stems
      .filter((stem) => references.has(stem.stemId) && audible(stem))
      .map((stem) => stem.stemId),
  );
}

const KEY_VOTE_EXCLUDED_STEM_TYPES = new Set(["drums", "percussion"]);
const DEFAULT_KEY_VOTE_WEIGHT = 0.5;

/**
 * One project-level musical summary instead of per-stem chips that contradict
 * each other (#1184/#1318). Tempo comes only from the served bar grid (the
 * same tempo the arrangement uses); key is a confidence-weighted vote across
 * pitched stems — drums/percussion carry no reliable key. No measurement → no
 * claim.
 */
export function projectMusicalSummary(
  project: Pick<RemixProject, "sectionGrid" | "stems">,
): { bpm: number | null; key: string | null } {
  const grid = project.sectionGrid;
  const bpm =
    grid?.kind === "bars" &&
    typeof grid.bpm === "number" &&
    Number.isFinite(grid.bpm) &&
    grid.bpm > 0
      ? Math.round(grid.bpm)
      : null;

  const votes = new Map<string, number>();
  for (const stem of project.stems) {
    if (KEY_VOTE_EXCLUDED_STEM_TYPES.has(stem.type.trim().toLowerCase())) {
      continue;
    }
    const key = stem.audioFeatures?.key;
    if (!key?.tonic || !key.mode) continue;
    const weight =
      typeof key.confidence === "number" && Number.isFinite(key.confidence)
        ? key.confidence
        : DEFAULT_KEY_VOTE_WEIGHT;
    const label = `${key.tonic} ${key.mode}`;
    // Map insertion order keeps first-seen order for tie-breaking.
    votes.set(label, (votes.get(label) ?? 0) + weight);
  }
  let key: string | null = null;
  let best = -Infinity;
  for (const [label, total] of votes) {
    if (total > best) {
      best = total;
      key = label;
    }
  }
  return { bpm, key };
}

export function stemDisplayName(stem: {
  type: string;
  title: string | null;
}): string {
  if (stem.title) return stem.title;
  return stem.type.charAt(0).toUpperCase() + stem.type.slice(1);
}

/**
 * Tempo for tempo-synced echo (#1897): the served bar grid's bpm, unrounded
 * (the render uses the same value); null for time grids or no grid.
 */
export function effectsBpm(
  grid: RemixProject["sectionGrid"] | null | undefined,
): number | null {
  return grid?.kind === "bars" &&
    typeof grid.bpm === "number" &&
    Number.isFinite(grid.bpm) &&
    grid.bpm > 0
    ? grid.bpm
    : null;
}

/** Footer save-state copy; pure so the title/dirty interplay is testable. */
export function saveStatusLabel(input: {
  saving: boolean;
  dirty: boolean;
  titleBlank: boolean;
  /** The last autosave failed and nothing changed since (#1879). */
  error?: boolean;
}): string {
  if (input.saving) return "Saving...";
  if (input.error) return "Couldn't save your changes.";
  if (input.titleBlank) return "Title is required";
  if (input.dirty) return "Unsaved changes";
  return "All changes saved";
}

/** Gate copy while autosave catches up with the latest edits (#1879). */
export const SAVING_LATEST_CHANGES_REASON = "Saving your latest changes…";

/** Idle time after the last edit before the studio autosaves (#1879). */
export const AUTOSAVE_DELAY_MS = 800;

/**
 * Whether an autosave should be scheduled (#1879): only real, valid changes
 * on an editable project, one request at a time, and not after a failure
 * until the user edits again or retries.
 */
export function shouldAutosave(input: {
  dirty: boolean;
  titleBlank: boolean;
  saving: boolean;
  published: boolean;
  blocked: boolean;
}): boolean {
  return (
    input.dirty &&
    !input.titleBlank &&
    !input.saving &&
    !input.published &&
    !input.blocked
  );
}

/**
 * Edits after a successful save (#1879): untouched since the request
 * started → re-baseline on the saved project; otherwise keep what the user
 * typed meanwhile so it stays dirty and autosaves next.
 */
export function editsAfterSave(
  prev: ProjectEdits,
  snapshot: ProjectEdits,
  updated: RemixProject,
): ProjectEdits {
  return prev === snapshot ? initialEdits(updated) : prev;
}

export type StudioShortcutAction =
  | { kind: "toggle_playback" }
  | { kind: "toggle_mute"; stemId: string }
  | { kind: "toggle_solo"; stemId: string }
  | { kind: "clear_loop" };

const SHORTCUT_TEXT_ENTRY_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const SHORTCUT_NATIVE_ACTIVATION_TAGS = new Set(["BUTTON", "A"]);

/**
 * Studio keyboard shortcuts (#1879): Space plays/stops, M/S mute/solo the
 * focused lane row, Escape clears the loop. Never fires with modifiers, while
 * typing, or (for Space) on a focused button/link that Space activates.
 */
export function studioShortcutAction(input: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  /** Upper-case tagName of the event target. */
  targetTag: string | null;
  targetEditable: boolean;
  /** `data-stem-id` of the lane row holding focus, if any. */
  focusedStemId: string | null;
  published: boolean;
}): StudioShortcutAction | null {
  if (input.ctrlKey || input.metaKey || input.altKey) return null;
  const tag = input.targetTag?.toUpperCase() ?? null;
  if (input.targetEditable || (tag && SHORTCUT_TEXT_ENTRY_TAGS.has(tag))) {
    return null;
  }
  switch (input.key) {
    case " ":
    case "Spacebar":
      if (input.repeat) return null;
      if (tag && SHORTCUT_NATIVE_ACTIVATION_TAGS.has(tag)) return null;
      return { kind: "toggle_playback" };
    case "m":
    case "M":
      if (input.repeat || input.published || !input.focusedStemId) return null;
      return { kind: "toggle_mute", stemId: input.focusedStemId };
    case "s":
    case "S":
      if (input.repeat || !input.focusedStemId) return null;
      return { kind: "toggle_solo", stemId: input.focusedStemId };
    case "Escape":
      return { kind: "clear_loop" };
    default:
      return null;
  }
}

/**
 * Transport loop chip copy, named like the lane ruler (#1879). The loop is
 * on a timeline block (#1899): with `blocks`, it is named after the block's
 * source section.
 */
export function transportLoopLabel(
  grid: RemixSectionGrid,
  blockIndex: number,
  blocks?: RemixStructureBlock[] | null,
): string | null {
  const section = blocks ? blocks[blockIndex]?.section : blockIndex;
  if (section === undefined) return null;
  const label = sectionColumnLabels(grid)[section];
  if (label === undefined) return null;
  if (grid.kind !== "bars") return `Looping ${label}`;
  return label === "Pickup" ? "Looping the pickup" : `Looping bar ${label}`;
}

/**
 * Whether the Generate button is actionable, and the honest reason when it
 * is not (#1162). Prompt-based modes only; stem_mix drafts are arranged in
 * the studio, and pretending a text prompt regenerates the mix would
 * misrepresent the result.
 */
export function describeGenerateAvailability(input: {
  mode: string;
  prompt: string;
  saving: boolean;
  dirty: boolean;
  generating: boolean;
  generationActive?: boolean;
}): { enabled: boolean; reason: string | null } {
  if (input.generationActive) {
    return {
      enabled: false,
      reason: "Generation is already queued for this draft.",
    };
  }
  // stem_mix renders the arranged stems server-side (#1189) — no prompt,
  // no AI. Prompted modes still require direction.
  if (input.mode !== "stem_mix" && input.prompt.trim() === "") {
    return {
      enabled: false,
      reason: "Write a prompt first — generation follows your direction.",
    };
  }
  // Autosave (#1879) settles dirty edits within a second.
  if (input.dirty) {
    return { enabled: false, reason: SAVING_LATEST_CHANGES_REASON };
  }
  if (input.saving || input.generating) {
    return { enabled: false, reason: null };
  }
  return { enabled: true, reason: null };
}

/**
 * The Mix → Add AI switch always asks for "reimagine" (the panel can't see
 * the saved target). Coming back from a stem mix, restore the saved variation
 * target instead (#1882), so "Add a new part" / "Replace a stem" survive a
 * detour through Mix stems. Any other request passes through unchanged.
 */
export function intentReturningFromMix(
  prevMode: string,
  savedTarget: { kind: AiTargetKind },
  requested: RemixIntent,
): RemixIntent {
  if (prevMode !== "stem_mix" || requested !== "reimagine") return requested;
  if (savedTarget.kind === "add_layer") return "add_part";
  if (savedTarget.kind === "replace_stem") return "replace_stem";
  return requested;
}

/** Studio AI-target selection (#1316): whole track, new layer, or replace. */
export type AiTargetKind = "whole" | "add_layer" | "replace_stem";

/**
 * Client-side transform resolution for Generate. Returns the request payload
 * or the honest reason the button is not actionable yet; the server re-runs
 * its own validation regardless.
 */
export function stemTransformForGenerate(
  kind: AiTargetKind,
  stemId: string | null,
  stems: Array<{ stemId: string }>,
  edits: ProjectEdits,
): {
  transform?: { kind: "replace_stem" | "add_layer"; stemId?: string };
  problem?: string;
} {
  if (kind === "whole") return {};
  if (kind === "add_layer") return { transform: { kind: "add_layer" } };
  if (!stemId || !stems.some((stem) => stem.stemId === stemId)) {
    return { problem: "Pick the stem to replace first." };
  }
  const bedHasAudio = stems.some(
    (stem) =>
      stem.stemId !== stemId && !(edits.stems[stem.stemId]?.muted ?? false),
  );
  if (!bedHasAudio) {
    return {
      problem:
        "Replacing this stem would leave nothing to condition on — unmute another stem first.",
    };
  }
  return { transform: { kind: "replace_stem", stemId } };
}

/** Honest description of a completed transform for the draft panel (#1316). */
export function describeStemTransform(
  transform: RemixStemTransform | undefined,
): string | null {
  if (!transform) return null;
  if (transform.kind === "replace_stem") {
    const label = transform.stemLabel?.trim() || "stem";
    return `AI ${label} replacement — generated to take the ${label}'s place over your other stems.`;
  }
  return "New AI layer — generated to sit on top of your arranged stems.";
}

/**
 * What a draft is, in a few words (#1320/#1879): the targeted transform when
 * there is one, a stem-mix render, or an AI draft. A queued job has no
 * grounding yet, so its mode tells a stem-mix render apart. Cost and time
 * are rendered separately by the drafts panel.
 */
export function draftKindLabel(
  grounding: string | null | undefined,
  transform: RemixStemTransform | null | undefined,
  mode?: string | null,
): string {
  if (transform?.kind === "replace_stem") {
    return `AI ${transform.stemLabel?.trim() || "stem"} replacement`;
  }
  if (transform?.kind === "add_layer") return "AI layer added";
  if (grounding === "stem_audio") return "Stem mix render";
  if (!grounding && mode === "stem_mix") return "Stem mix render";
  return "AI draft";
}

/** Toast copy per normalized provider error code (#1162). */
export function generationErrorMessage(code: string, message: string): string {
  switch (code) {
    case "provider_disabled":
      return "AI generation is not enabled on this environment yet.";
    case "provider_rejected":
      return "The provider rejected this prompt. Adjust it and try again.";
    case "insufficient_credits":
    case "payment_required":
      return "You're out of generation credits. Request a top-up from an operator and try again.";
    case "invalid_input":
    case "provider_unavailable":
    // The transport strips the normalized code but keeps the server's
    // human-readable message — show it rather than a generic fallback.
    case "server_message":
      return message;
    default:
      return "Generation failed. Please try again later.";
  }
}

export function remixGenerationStatus(
  metadata: RemixGenerationMetadata | null,
): RemixGenerationMetadata["status"] | null {
  const status = metadata?.status;
  return status === "pending" ||
    status === "processing" ||
    status === "completed" ||
    status === "failed"
    ? status
    : null;
}

export function remixGenerationIsActive(
  metadata: RemixGenerationMetadata | null,
): boolean {
  const status = remixGenerationStatus(metadata);
  return status === "pending" || status === "processing";
}

export function remixGenerationPlayableOutputUri(
  metadata: RemixGenerationMetadata | null,
): string | null {
  const status = remixGenerationStatus(metadata);
  if (status && status !== "completed") return null;
  return remixDraftOutputUri(metadata);
}

/**
 * Honest draft provenance (#1181): says exactly what of the source audio
 * shaped the draft, including the prompt-only case where nothing did.
 */
export function groundingDescription(
  metadata: RemixGenerationMetadata | null,
): string | null {
  if (!metadata?.grounding) return null;
  switch (metadata.grounding) {
    case "stem_audio":
      return "High-fidelity stem render: the draft contains the licensed source audio with normalized headroom while preserving your relative gain choices.";
    case "stem_plus_ai":
      return "Your licensed stems plus AI-generated layers: the source audio stays in the draft, with generated additions combined in one normalized final mix.";
    case "audio_conditioned":
      return "AI draft conditioned on your stem audio — the model heard the arranged stems, but the output is draft quality, not a master.";
    case "feature_conditioned": {
      const hints = metadata.sourceFeatureHints;
      const measured = [
        hints?.bpm ? `${hints.bpm} BPM` : null,
        hints?.key ?? null,
      ]
        .filter(Boolean)
        .join(", ");
      return `AI-generated from your prompt, matched to the stems' measured ${
        measured || "tempo and key"
      }. The model does not hear the source audio.`;
    }
    case "prompt_only":
      return "AI-generated from your prompt only — not derived from the source audio. (The source stems have no measured features yet.)";
    default:
      return null;
  }
}

/**
 * "Powered by Stability AI" attribution badge (#1342). Rendered in the studio
 * only when the server reports that the active generation provider requires it
 * — i.e. the self-hosted Stable Audio 3 (audio-conditioned) provider, per the
 * Stability AI Community License §IV(a). `attribution` is the server-driven
 * `generationAttribution` from the eligibility response; null renders nothing,
 * so Lyria / stem-plus-AI show no notice.
 */
export function RemixGenerationAttributionBadge({
  attribution,
}: {
  attribution: RemixGenerationAttribution | null | undefined;
}) {
  if (!attribution) return null;
  return (
    <p className="mt-3 pt-2 text-xs text-zinc-300 remix-generation-attribution">
      <span className="font-medium text-zinc-200">{attribution.poweredBy}</span>
      {" — "}
      {attribution.model} draft engine.{" "}
      <a
        href={attribution.licenseUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="underline hover:text-white"
      >
        {attribution.licenseName}
      </a>
    </p>
  );
}

export function remixGenerationFailureMessage(
  metadata: RemixGenerationMetadata | null,
): string | null {
  if (remixGenerationStatus(metadata) !== "failed") return null;
  return generationErrorMessage(
    metadata?.errorCode ?? "unknown",
    metadata?.errorMessage ?? "Generation failed. Please try again later.",
  );
}

/**
 * The output timeline for the current edits (#1899), computed locally so
 * unsaved structure edits play at once; null without a grid.
 */
export function editsTimeline(
  project: Pick<RemixProject, "sectionGrid">,
  edits: Pick<ProjectEdits, "structure">,
): RemixStructureTimeline | null {
  const grid = project.sectionGrid ?? null;
  if (!grid || grid.sections.length === 0) return null;
  const structure = normalizeRemixStructure(
    edits.structure ?? null,
    grid.sections.length,
  );
  return structureTimeline(grid, structure?.blocks ?? null);
}

/** Structure edit state (#1899) for the current edits: blocks + stem masks. */
export function structureEditStateFor(
  grid: RemixSectionGrid,
  edits: Pick<ProjectEdits, "structure" | "stems">,
): RemixStructureEditState {
  const masks: RemixBlockMasks = {};
  for (const [stemId, edit] of Object.entries(edits.stems)) {
    masks[stemId] = edit.sections;
  }
  return structureEditState(grid, edits.structure ?? null, masks);
}

/**
 * Applies a structure op's result (#1899) in one update: the new structure
 * plus every stem's remapped block mask.
 */
export function editsWithStructure(
  edits: ProjectEdits,
  result: RemixStructureEditResult,
  beatBlocks?: boolean[] | null,
): ProjectEdits {
  const stems = { ...edits.stems };
  for (const [stemId, mask] of Object.entries(result.masks)) {
    const current = stems[stemId];
    if (current) stems[stemId] = { ...current, sections: mask };
  }
  const beat =
    edits.beat && beatBlocks !== undefined
      ? { ...edits.beat, blocks: beatBlocks }
      : edits.beat;
  return { ...edits, structure: result.structure, stems, beat };
}

/**
 * Runs a structure op (#1899) on the current edits in one update: stem
 * masks and the beat's blocks (#1902) move with their blocks. The edits
 * are returned unchanged when the op refuses.
 */
export function editsAfterStructureOp(
  edits: ProjectEdits,
  grid: RemixSectionGrid,
  run: (state: RemixStructureEditState) => RemixStructureEditResult | null,
): ProjectEdits {
  const outcome = beatBlocksAfterStructureEdit(
    structureEditStateFor(grid, edits),
    edits.beat?.blocks ?? null,
    run,
  );
  if (!outcome) return edits;
  return editsWithStructure(
    edits,
    outcome.result,
    edits.beat ? outcome.blocks : undefined,
  );
}

/**
 * The beat as the preview plays it (#1902): normalized against the edited
 * timeline's blocks and rendered over them; null without a beat, a bar
 * grid with a tempo, or a timeline.
 */
export function editsPreviewBeat(
  project: Pick<RemixProject, "sectionGrid">,
  edits: Pick<ProjectEdits, "structure" | "beat">,
): PreviewBeat | null {
  const grid = project.sectionGrid ?? null;
  if (!edits.beat || !grid || !beatGridAvailable(grid)) return null;
  const timeline = editsTimeline(project, edits);
  if (!timeline || timeline.segments.length === 0) return null;
  const recipe = normalizeRemixBeat(edits.beat, timeline.segments.length);
  if (!recipe) return null;
  return { recipe, grid, segments: timeline.segments };
}

/**
 * Sets a "Describe it" result (#1900) in one update: the mute/mask state of
 * the project's stems, the effects and the structure. Everything else
 * (title, prompt, gains, AI target) keeps the latest value, so a proposal
 * computed a moment ago never clobbers unrelated typing.
 */
export function applyDescribedEdits(
  edits: ProjectEdits,
  next: RemixDescribeEdits,
): ProjectEdits {
  const stems = { ...edits.stems };
  for (const [stemId, edit] of Object.entries(next.stems)) {
    const current = stems[stemId];
    if (current) {
      stems[stemId] = { ...current, muted: edit.muted, sections: edit.sections };
    }
  }
  return {
    ...edits,
    stems,
    effects: next.effects,
    structure: next.structure,
  };
}

export function stemPreviewStates(
  project: RemixProject,
  edits: ProjectEdits,
): PreviewStemState[] {
  const grid = project.sectionGrid ?? null;
  const references = referenceStemIds(project.stems);
  const sectionCount = grid?.sections.length ?? 0;
  const structure =
    grid && sectionCount > 0
      ? normalizeRemixStructure(edits.structure ?? null, sectionCount)
      : null;
  // With a structure (#1899) the gate spans are per block, in timeline time.
  const segments =
    grid && structure ? structureTimeline(grid, structure.blocks).segments : null;
  const blockCount = editBlockCount(sectionCount, structure);
  return project.stems.map((stem) => {
    const edit = edits.stems[stem.stemId];
    const sections =
      edit?.sections !== undefined
        ? edit.sections
        : grid
          ? parseArrangementSections(stem.arrangement, blockCount)
          : null;
    return {
      stemId: stem.stemId,
      gainDb: edit?.gainDb ?? stem.gainDb,
      muted: edit?.muted ?? stem.muted,
      // Preview gates at the same spans the server render will use (#1314).
      // A muted full-mix reference is out of the render, so it plays whole:
      // A/B compares against the untouched original. An unmuted (legacy)
      // one is a real channel and gates exactly like the render.
      ...(grid && !(references.has(stem.stemId) && (edit?.muted ?? stem.muted))
        ? {
            activeIntervals: segments
              ? gateIntervalsForBlocks(segments, sections)
              : activeIntervalsFromSections(grid, sections),
          }
        : {}),
    };
  });
}

/**
 * Whether "Publish on Resonate" is actionable, plus the honest reason when it
 * is not (#1196). Publishing re-checks eligibility server-side, but the studio
 * gates the button so a denied publish is explained before the round-trip:
 * only a completed, saved draft on an allowed source can publish.
 */
export function describePublishAvailability(input: {
  status: string;
  generationStatus: RemixGenerationMetadata["status"] | null;
  hasDraftOutput: boolean;
  dirty: boolean;
  publishing: boolean;
  eligibility: RemixEligibilityResponse | null;
}): { enabled: boolean; reason: string | null; reasonCode: string } {
  if (input.status === "published") {
    return {
      enabled: false,
      reason: "This remix is already published on Resonate.",
      reasonCode: "publish_already_published",
    };
  }
  if (input.status !== "draft") {
    return {
      enabled: false,
      reason: "Only draft projects can be published.",
      reasonCode: "publish_not_draft",
    };
  }
  if (input.generationStatus !== "completed" || !input.hasDraftOutput) {
    return {
      enabled: false,
      reason:
        "Render or generate a draft and wait for it to finish before publishing.",
      reasonCode: "publish_needs_completed_draft",
    };
  }
  if (input.dirty) {
    return {
      enabled: false,
      reason: SAVING_LATEST_CHANGES_REASON,
      reasonCode: "publish_dirty",
    };
  }
  if (!input.eligibility) {
    return {
      enabled: false,
      reason: "Checking whether this source can be published…",
      reasonCode: "publish_eligibility_loading",
    };
  }
  if (
    !input.eligibility.allowed ||
    !input.eligibility.allowedActions.includes("publish_resonate")
  ) {
    return {
      enabled: false,
      reason:
        "Publishing isn't allowed for this source right now. Its rights or consent state may have changed.",
      reasonCode: "publish_not_allowed",
    };
  }
  if (input.publishing) {
    return { enabled: false, reason: null, reasonCode: "publish_in_progress" };
  }
  return { enabled: true, reason: null, reasonCode: "publish_available" };
}

// Export/download (#1323) is commercial-license gated: the studio enables the
// button only when server eligibility grants the `export` action on top of a
// completed, saved draft. Otherwise it stays honestly locked with the
// export_rights_required reason and its demand-signal analytics.
export const EXPORT_RIGHTS_REQUIRED_REASON =
  "Export requires a commercial license on the source stems. Your remix license covers private drafts and in-Resonate publishing only.";

/**
 * Whether "Export audio" is actionable, plus the honest reason and stable
 * analytics reasonCode when it is not (#1323). Mirrors describePublishAvailability
 * but gates on the `export` action (granted by a commercial license). The
 * export_rights_required code is the demand signal for the locked state.
 */
export function describeExportAvailability(input: {
  status: string;
  generationStatus: RemixGenerationMetadata["status"] | null;
  hasDraftOutput: boolean;
  dirty: boolean;
  exporting: boolean;
  eligibility: RemixEligibilityResponse | null;
}): { enabled: boolean; reason: string | null; reasonCode: string } {
  if (input.status !== "draft") {
    return {
      enabled: false,
      reason: "Only draft projects can be exported.",
      reasonCode: "export_not_draft",
    };
  }
  if (input.generationStatus !== "completed" || !input.hasDraftOutput) {
    return {
      enabled: false,
      reason:
        "Render or generate a draft and wait for it to finish before exporting.",
      reasonCode: "export_needs_completed_draft",
    };
  }
  if (input.dirty) {
    return {
      enabled: false,
      reason: SAVING_LATEST_CHANGES_REASON,
      reasonCode: "export_dirty",
    };
  }
  if (!input.eligibility) {
    return {
      enabled: false,
      reason: "Checking whether this source can be exported…",
      reasonCode: "export_eligibility_loading",
    };
  }
  if (
    !input.eligibility.allowed ||
    !input.eligibility.allowedActions.includes("export")
  ) {
    // The honest locked state: a valid remix (but not commercial) license.
    return {
      enabled: false,
      reason: EXPORT_RIGHTS_REQUIRED_REASON,
      reasonCode: "export_rights_required",
    };
  }
  if (input.exporting) {
    return { enabled: false, reason: null, reasonCode: "export_in_progress" };
  }
  return { enabled: true, reason: null, reasonCode: "export_available" };
}

/**
 * Confirm-dialog body stating exactly what becomes public: the title, the
 * source attribution, and the honest AI-provenance label (#1194 copy).
 */
export function publishConfirmMessage(input: {
  title: string;
  source: RemixProjectSource;
  grounding: string | null;
}): string {
  const attribution = `Remix of "${input.source.trackTitle}"${
    input.source.artistName ? ` by ${input.source.artistName}` : ""
  }.`;
  const lines = [
    `Publishing makes “${input.title}” a public remix release on Resonate.`,
    attribution,
  ];
  if (input.grounding) lines.push(input.grounding);
  lines.push(
    "Anyone on Resonate will be able to find and play it. You won't be able to edit the draft afterward.",
  );
  return lines.join("\n\n");
}

/**
 * "List this remix for sale" bridge CTA (#1413, creation→commerce bridge).
 * The backend is the sole source of truth for sell-eligibility (the `export`
 * rights gate on the source stems, or creator-owner) — this component only
 * renders what `commerce` says, honestly:
 *  - no `commerce` data (unpublished, or not yet loaded) → render nothing;
 *  - `sellable` with a `publishedReleaseId` → an enabled link into the
 *    existing mint-and-list flow on the release page's NFT Marketplace
 *    section (`#nft-marketplace`);
 *  - published but not sellable → a non-navigating, aria-disabled control
 *    with the server's honest `reason` shown beneath it. Never a dead button.
 */
export function RemixSellCta({
  commerce,
}: {
  commerce: RemixProject["commerce"] | null | undefined;
}) {
  if (!commerce || commerce.sellable == null) return null;

  if (commerce.sellable && commerce.publishedReleaseId) {
    return (
      <Link
        href={`/release/${commerce.publishedReleaseId}#nft-marketplace`}
        className="ui-btn ui-btn-primary mt-3 inline-flex remix-sell-cta"
      >
        List this remix for sale
      </Link>
    );
  }

  return (
    <div className="mt-3 remix-sell-cta-locked">
      <button
        type="button"
        aria-disabled="true"
        title={commerce.reason ?? undefined}
        className="ui-btn ui-btn-ghost opacity-60 cursor-not-allowed inline-flex remix-sell-cta remix-sell-cta--disabled"
      >
        List this remix for sale
      </button>
      {commerce.reason && (
        <p className="text-xs text-emerald-100/60 mt-1 max-w-sm remix-sell-cta-reason">
          {commerce.reason}
        </p>
      )}
    </div>
  );
}

export const PREVIEW_METER_FLOOR_DB = -48;

/** Peak (linear) → dBFS clamped to the meter's -48..0 range. */
export function previewMeterDb(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return PREVIEW_METER_FLOOR_DB;
  return Math.min(0, Math.max(PREVIEW_METER_FLOOR_DB, 20 * Math.log10(peak)));
}

const SILENT_PREVIEW_LEVEL: PreviewLevel = { peak: 0, limiting: false };

/**
 * Thin post-limiter output meter for the stem preview. Polls the live
 * handle once per animation frame; amber + "Limiting" while the master
 * limiter is holding the summed stems back from clipping.
 */
export function PreviewLevelMeter({
  handle,
}: {
  handle: StemArrangementPreviewHandle | null;
}) {
  const [level, setLevel] = useState<PreviewLevel>(SILENT_PREVIEW_LEVEL);
  useEffect(() => {
    if (!handle) return;
    let frame = 0;
    const tick = () => {
      setLevel(handle.level());
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      setLevel(SILENT_PREVIEW_LEVEL);
    };
  }, [handle]);
  const db = previewMeterDb(level.peak);
  const fraction = (db - PREVIEW_METER_FLOOR_DB) / -PREVIEW_METER_FLOOR_DB;
  return (
    <div className="flex items-center gap-2 remix-preview-meter">
      <div
        role="meter"
        aria-label="Preview output level"
        aria-valuemin={PREVIEW_METER_FLOOR_DB}
        aria-valuemax={0}
        aria-valuenow={Math.round(db)}
        aria-valuetext={`${Math.round(db)} dB${level.limiting ? ", limiting" : ""}`}
        className="w-20 h-1.5 rounded-full bg-zinc-800 overflow-hidden"
      >
        <div
          className={`h-full ${level.limiting ? "bg-amber-400" : "bg-emerald-400"}`}
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>
      {level.limiting && (
        <span className="text-[10px] font-medium text-amber-300">Limiting</span>
      )}
    </div>
  );
}

export function RemixStudioEditor({
  project: persistedProject,
}: {
  project: RemixProject;
}) {
  const { token } = useAuth();
  const { addToast } = useToast();
  const [project, setProject] = useState(persistedProject);
  const [edits, setEdits] = useState<ProjectEdits>(() =>
    initialEdits(persistedProject),
  );
  const [soloState, setSoloStemId] = useState<string | null>(null);
  const [addingStemId, setAddingStemId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // Generation-credit balance (#1422). The remix debit runs in a worker, so no
  // synchronous 402 reaches the studio — we surface the balance proactively and
  // gate Generate when it can't fund even one 30s block.
  const [credits, setCredits] = useState<GenerationCreditBalance | null>(null);
  const [creditRequestState, setCreditRequestState] = useState<
    "idle" | "sending" | "sent"
  >("idle");
  const [exporting, setExporting] = useState(false);
  const [confirmPublishOpen, setConfirmPublishOpen] = useState(false);
  const [eligibility, setEligibility] =
    useState<RemixEligibilityResponse | null>(null);
  // Autosave failure (#1879): the edits that failed to save. Autosave stays
  // blocked while the edits are unchanged; the next edit or Retry clears it.
  const [failedSaveEdits, setFailedSaveEdits] = useState<ProjectEdits | null>(
    null,
  );

  // Funnel (#1143): one open event per mounted project. Compact payload —
  // ids, counts, and mode only.
  const openedRef = useRef(false);
  useEffect(() => {
    if (!token || openedRef.current) return;
    openedRef.current = true;
    void recordProductAnalytics(token, "remix.studio_opened", {
      source: "remix_studio",
      subjectType: "remix_project",
      subjectId: persistedProject.id,
      payload: {
        projectId: persistedProject.id,
        sourceTrackId: persistedProject.sourceTrackId,
        stemCount: persistedProject.stems.length,
        mode: persistedProject.mode,
      },
    });
  }, [token, persistedProject]);

  const patch = buildProjectPatch(project, edits);
  const dirty = Object.keys(patch).length > 0;
  const availableStems =
    project.status === "draft" ? project.availableStems ?? [] : [];
  const sectionGrid =
    project.sectionGrid && project.sectionGrid.sections.length >= 2
      ? project.sectionGrid
      : null;
  const rights = describeSourceRights(project.source);
  const musicalSummary = projectMusicalSummary(project);
  const musicalSummaryLabel = [
    musicalSummary.bpm !== null ? `${musicalSummary.bpm} BPM` : null,
    musicalSummary.key,
  ]
    .filter(Boolean)
    .join(" · ");
  const referenceIds = referenceStemIds(project.stems);
  const referenceStemId =
    project.stems.find((stem) => referenceIds.has(stem.stemId))?.stemId ?? null;
  // A muted full-mix stem is a reference, not a channel: hide it from the
  // mixer and grid. Unmuted (legacy) it stays visible and editable, with a
  // warning once separated stems are audible alongside it (doubled mix).
  const isHiddenReference = (stemId: string) =>
    referenceIds.has(stemId) && (edits.stems[stemId]?.muted ?? false);
  const channelStems = project.stems.filter(
    (stem) => !isHiddenReference(stem.stemId),
  );
  const doublingIds = doublingReferenceStemIds(project.stems, edits);
  const doublingReferenceStems = project.stems.filter((stem) =>
    doublingIds.has(stem.stemId),
  );
  const titleBlank = edits.title.trim() === "";
  const generationStatus = remixGenerationStatus(project.generationMetadata);
  const generationActive = remixGenerationIsActive(project.generationMetadata);
  const generationFailure = remixGenerationFailureMessage(
    project.generationMetadata,
  );
  const draftOutputUri = remixGenerationPlayableOutputUri(
    project.generationMetadata,
  );
  const canAffordDraft = credits
    ? canAffordGeneration(credits.balanceCents, credits.priceCentsPer30s)
    : true;

  const handleRequestCredits = async () => {
    if (!token || creditRequestState !== "idle") return;
    setCreditRequestState("sending");
    try {
      await requestGenerationCredits(token);
      setCreditRequestState("sent");
      addToast({
        type: "success",
        title: "Operator notified",
        message: "You’ll get generation credits soon.",
      });
    } catch {
      setCreditRequestState("idle");
      addToast({
        type: "error",
        title: "Request failed",
        message: "Could not send the request. Please try again.",
      });
    }
  };

  const published = project.status === "published";

  // Structure (#1899): the local timeline plays unsaved edits immediately;
  // loops, the lanes and the gate spans all index timeline blocks.
  const timeline = editsTimeline(project, edits);
  const structureState = sectionGrid
    ? structureEditStateFor(sectionGrid, edits)
    : null;
  const blockCount = sectionGrid ? (structureState?.blocks.length ?? 0) : 0;
  // Beat (#1902): rendered over the local timeline; needs a bar grid.
  const beatAvailable = !!sectionGrid && beatGridAvailable(sectionGrid);
  const previewBeat = beatAvailable
    ? editsPreviewBeat(project, edits)
    : null;
  // A beat solo ends with the beat (removed, or no longer playable).
  const soloStemId =
    soloState === REMIX_BEAT_LANE_ID && !previewBeat ? null : soloState;

  // Studio transport (#1879): one owner for the arrangement preview, the
  // original full mix, and drafts — play/stop, seek, loop, source switch.
  const previousDraftIds = (project.generationMetadata?.previousDrafts ?? []).map(
    (entry) => entry.jobId,
  );
  const transport = useRemixTransport({
    token,
    projectId: project.id,
    stemIds: project.stems.map((stem) => stem.stemId),
    previewStems: stemPreviewStates(project, edits),
    soloStemId,
    referenceStemId,
    currentDraftJobId: draftOutputUri ? project.generationJobId : null,
    timelineSec: project.sectionGrid?.durationSeconds ?? null,
    effects: edits.effects,
    bpm: effectsBpm(project.sectionGrid),
    timeline,
    beat: previewBeat,
    onError: (kind) => {
      addToast(
        kind === "preview"
          ? {
              type: "error",
              title: "Preview unavailable",
              message: "The stem previews could not be loaded. Please try again.",
            }
          : {
              type: "error",
              title: "Draft playback unavailable",
              message: "The generated draft audio could not be loaded.",
            },
      );
    },
  });
  const {
    stop: stopTransport,
    setSource: setTransportSource,
    setLoop: setTransportLoop,
  } = transport;
  const transportSource = transport.source;
  const transportLoop = transport.loop;

  // A source that no longer exists (a draft replaced by a new generation, a
  // reference stem gone) falls back to the arrangement.
  const transportSourceUnavailable =
    transportSource.kind === "draft"
      ? transportSource.jobId === null
        ? !draftOutputUri
        : !previousDraftIds.includes(transportSource.jobId)
      : transportSource.kind === "original" && referenceStemId === null;
  useEffect(() => {
    if (!transportSourceUnavailable) return;
    stopTransport();
    setTransportSource({ kind: "arrangement" });
  }, [setTransportSource, stopTransport, transportSourceUnavailable]);

  // A loop on a block the timeline no longer has is dropped.
  const transportLoopStale =
    transportLoop !== null &&
    !(sectionGrid && timeline?.segments[transportLoop.sectionIndex]);
  useEffect(() => {
    if (transportLoopStale) setTransportLoop(null);
  }, [setTransportLoop, transportLoopStale]);

  // Loops are by block (#1899), over the block's timeline span.
  const loopSection = (index: number | null) => {
    const segment =
      index === null || !sectionGrid ? null : timeline?.segments[index];
    if (index === null || !segment) {
      transport.setLoop(null);
      return;
    }
    transport.setLoop({
      sectionIndex: index,
      startSec: segment.outStartSec,
      endSec: segment.outEndSec,
    });
  };

  const draftTransportState = (
    jobId: string | null,
  ): "idle" | "loading" | "playing" =>
    transportSource.kind === "draft" && transportSource.jobId === jobId
      ? transport.status
      : "idle";

  // Read by the generation poll, which must not re-subscribe per render.
  const currentDraftAudibleRef = useRef(false);
  const currentDraftAudible = draftTransportState(null) !== "idle";
  useEffect(() => {
    currentDraftAudibleRef.current = currentDraftAudible;
  }, [currentDraftAudible]);

  // "Play AI draft" / version buttons (#1320): the same transport, on that
  // draft; pressing the one that is playing stops it.
  const handleDraftPlayback = (jobId: string | null) => {
    if (draftTransportState(jobId) !== "idle") {
      transport.stop();
      return;
    }
    const next: TransportSource = { kind: "draft", jobId };
    if (transport.status === "idle") {
      transport.setSource(next);
      void transport.play();
    } else {
      // Already playing another source: switching restarts on the draft.
      transport.setSource(next);
    }
  };

  const laneStems: LaneStem[] = channelStems.map((stem) => {
    const edit = edits.stems[stem.stemId];
    return {
      stemId: stem.stemId,
      name: stemDisplayName(stem),
      type: stem.type,
      muted: edit?.muted ?? stem.muted,
      soloed: soloStemId === stem.stemId,
      soloedOut: soloStemId !== null && soloStemId !== stem.stemId,
      gainDb: edit?.gainDb ?? stem.gainDb,
      sections: edit?.sections ?? null,
      peaks: transport.peaks[stem.stemId] ?? null,
      fx: remixFxStem(edits.effects, stem.stemId),
    };
  });

  // Effects (#1897): every edit is normalized and autosaved like any other.
  const updateEffects = (
    change: (effects: RemixFxRecipe | null) => RemixFxRecipe | null,
  ) => {
    setEdits((prev) => {
      const effects = change(prev.effects);
      return sameRemixFx(effects, prev.effects)
        ? prev
        : { ...prev, effects };
    });
  };
  const handleMasterFxChange = (key: keyof RemixFxMaster, value: number) =>
    updateEffects((effects) => withMasterFx(effects, key, value));
  const handleStemFxChange = (
    stemId: string,
    key: keyof RemixFxStem,
    value: number,
  ) => updateEffects((effects) => withStemFx(effects, stemId, key, value));
  const handleApplyVibe = (vibeId: RemixVibeId) =>
    updateEffects((effects) => applyVibe(vibeId, effects, project.stems));

  // Structure edits (#1899) run through the shared ops so the masks move
  // with their blocks; a refused op changes nothing.
  const updateStructure = (
    run: (state: RemixStructureEditState) => RemixStructureEditResult | null,
  ) => {
    if (!sectionGrid || published) return;
    setEdits((prev) => editsAfterStructureOp(prev, sectionGrid, run));
  };

  // Beat (#1902): every edit is normalized against the block count and
  // autosaved like any other — mute included (the render skips a muted
  // beat); solo is preview-only, like the stems'.
  const handleBeatChange = (next: RemixBeatRecipe | null) => {
    if (published) return;
    setEdits((prev) => {
      const count = editBlockCount(
        sectionGrid?.sections.length ?? 0,
        prev.structure,
      );
      const beat = normalizeRemixBeat(next, count > 0 ? count : null);
      return sameRemixBeat(beat, prev.beat) ? prev : { ...prev, beat };
    });
  };
  const updateBeat = (change: (beat: RemixBeatRecipe) => RemixBeatRecipe) => {
    if (published) return;
    setEdits((prev) => (prev.beat ? { ...prev, beat: change(prev.beat) } : prev));
  };
  const laneBeat: LaneBeat | null = previewBeat
    ? {
        kitLabel: REMIX_BEAT_KIT_LABELS[previewBeat.recipe.kit],
        muted: previewBeat.recipe.muted === true,
        soloed: soloStemId === REMIX_BEAT_LANE_ID,
        soloedOut: soloStemId !== null && soloStemId !== REMIX_BEAT_LANE_ID,
        gainDb: previewBeat.recipe.gainDb,
        blocks: previewBeat.recipe.blocks,
        peaks: transport.beatPeaks,
        durationSec:
          previewBeat.segments[previewBeat.segments.length - 1]?.outEndSec ??
          null,
      }
    : null;
  const handleBlockAction = (index: number, action: LaneBlockAction) =>
    updateStructure((state) =>
      sectionGrid ? blockActionResult(state, index, action, sectionGrid) : null,
    );
  const handleApplyStructure = (id: RemixStructureShapeId) =>
    updateStructure((state) =>
      sectionGrid ? structureShapeResult(sectionGrid, state, id) : null,
    );

  const toggleStemMute = (stemId: string) => {
    setEdits((prev) => {
      const current = prev.stems[stemId];
      if (!current) return prev;
      return {
        ...prev,
        stems: { ...prev.stems, [stemId]: { ...current, muted: !current.muted } },
      };
    });
  };

  const toggleStemSolo = (stemId: string) => {
    setSoloStemId((prev) => (prev === stemId ? null : stemId));
  };

  // Unload guard (#1879): autosave needs a moment after the last edit.
  const unsavedWork = dirty || saving;
  useEffect(() => {
    if (!unsavedWork) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers only show the prompt with a returnValue set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [unsavedWork]);

  // Keyboard shortcuts (#1879). The listener is bound once and reads the
  // latest state through a ref.
  const shortcutStateRef = useRef({
    published,
    dialogOpen: confirmPublishOpen,
    loopActive: transportLoop !== null,
    toggle: transport.toggle,
    clearLoop: () => transport.setLoop(null),
    toggleMute: toggleStemMute,
    toggleSolo: toggleStemSolo,
  });
  useEffect(() => {
    shortcutStateRef.current = {
      published,
      dialogOpen: confirmPublishOpen,
      loopActive: transportLoop !== null,
      toggle: transport.toggle,
      clearLoop: () => transport.setLoop(null),
      toggleMute: toggleStemMute,
      toggleSolo: toggleStemSolo,
    };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = shortcutStateRef.current;
      if (event.defaultPrevented || state.dialogOpen) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const focused =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const action = studioShortcutAction({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        repeat: event.repeat,
        targetTag: target?.tagName ?? null,
        targetEditable: target?.isContentEditable ?? false,
        focusedStemId:
          focused?.closest<HTMLElement>("[data-stem-id]")?.dataset.stemId ??
          null,
        published: state.published,
      });
      if (!action) return;
      switch (action.kind) {
        case "toggle_playback":
          event.preventDefault();
          state.toggle();
          return;
        case "toggle_mute":
          event.preventDefault();
          state.toggleMute(action.stemId);
          return;
        case "toggle_solo":
          event.preventDefault();
          state.toggleSolo(action.stemId);
          return;
        case "clear_loop":
          if (!state.loopActive) return;
          event.preventDefault();
          state.clearLoop();
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Credit balance (#1422): fetch on mount and re-fetch whenever a generation
  // settles (the `remix_draft` debit lands in the worker), so the panel
  // decrements live. `generationStatus` flips to completed/failed when polling
  // picks up the worker result.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getCreditsBalance(token)
      .then((balance) => {
        if (!cancelled) setCredits(balance);
      })
      .catch(() => {
        /* a failed balance probe just leaves the panel empty */
      });
    return () => {
      cancelled = true;
    };
  }, [token, generationStatus]);

  useEffect(() => {
    if (!token || !generationActive) return;
    let cancelled = false;
    const refreshProject = async () => {
      try {
        const updated = await getRemixProject(token, project.id);
        if (cancelled) return;
        setProject(updated);
        if (!dirty) {
          setEdits(initialEdits(updated));
        }
        // A finished generation replaces the draft being heard: stop it
        // rather than keep playing the previous output.
        if (
          remixGenerationStatus(updated.generationMetadata) === "completed" &&
          currentDraftAudibleRef.current
        ) {
          stopTransport();
        }
      } catch {
        // Polling failures should not disrupt local editing; the next interval
        // or a manual reload can recover.
      }
    };
    const interval = window.setInterval(() => {
      void refreshProject();
    }, 4000);
    void refreshProject();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [dirty, generationActive, project.id, stopTransport, token]);

  // Publish + export gating (#1196/#1323): eligibility is re-checked
  // server-side at publish/export time, but the studio fetches it so the
  // buttons reflect the live source state (consent flips, quarantines, and the
  // export/commercial-license grant) instead of a stale creation-time decision.
  // Only relevant once a completed draft exists on a draft project.
  const draftReadyToPublish =
    project.status === "draft" && generationStatus === "completed";
  useEffect(() => {
    if (!token || !draftReadyToPublish) {
      setEligibility(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await getRemixEligibility(
          token,
          project.sourceTrackId,
          project.stems.map((stem) => stem.stemId),
        );
        if (!cancelled) setEligibility(result);
      } catch {
        // A failed eligibility probe leaves the button in its honest
        // "checking…" disabled state rather than enabling a publish that
        // the server would reject.
        if (!cancelled) setEligibility(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, draftReadyToPublish, project.id, project.sourceTrackId, project.stems]);

  const updateStemEdit = (stemId: string, update: Partial<StemEdit>) => {
    setEdits((prev) => ({
      ...prev,
      stems: {
        ...prev.stems,
        [stemId]: { ...prev.stems[stemId], ...update },
      },
    }));
  };

  const handleGenerate = async () => {
    if (!token || generating || generationActive) return;
    setGenerating(true);
    try {
      const retry = !!project.generationJobId && !generationActive;
      // Targeted transform (#1316): variation mode only; the server
      // re-validates against the live project.
      const target =
        edits.mode === "variation"
          ? stemTransformForGenerate(
              edits.aiTarget.kind,
              edits.aiTarget.stemId,
              project.stems,
              edits,
            )
          : {};
      const updated = await generateRemixDraft(token, project.id, {
        retry,
        ...(target.transform ? { stemTransform: target.transform } : {}),
      });
      setProject(updated);
      setEdits(initialEdits(updated));
      // Review fix (#1165): a queued generation has no playable output, so
      // the transport drops a draft source on its own (#1879) and the new
      // draft gets a fresh cache key — Play never replays the old output.
      addToast({
        type: "success",
        title: retry ? "Retry queued" : edits.mode === "stem_mix" ? "Render queued" : "Generation queued",
        message:
          edits.mode === "stem_mix"
            ? "Your stem mix is being rendered and this panel will update."
            : "Your AI remix job is queued and this panel will update.",
      });
      // No frontend analytics here: emitting studio_saved would muddy save
      // metrics, and the backend already records remix.generation_started.
    } catch (error) {
      // apiRequest throws Error("API <status>: <text>"), where <text> is the
      // server's extracted message field (the normalized error `code` is
      // discarded by the transport) or, rarely, a raw JSON body. Recover
      // whichever is present so the user sees the server's actual reason
      // instead of a generic fallback.
      let code = "unknown";
      let message = "Generation failed. Please try again later.";
      if (error instanceof Error) {
        const jsonStart = error.message.indexOf("{");
        if (jsonStart >= 0) {
          try {
            const parsed = JSON.parse(error.message.slice(jsonStart));
            code = parsed.code ?? code;
            message = parsed.message ?? message;
          } catch {
            // keep defaults
          }
        } else {
          const prefixed = error.message.match(/^API \d+: (.+)$/s);
          if (prefixed?.[1]?.trim()) {
            code = "server_message";
            message = prefixed[1].trim();
          }
        }
      }
      addToast({
        type: "error",
        title: "Generation failed",
        message: generationErrorMessage(code, message),
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleAddStem = async (stemId: string) => {
    if (!token || addingStemId) return;
    setAddingStemId(stemId);
    try {
      await updateRemixProject(token, project.id, { addStemIds: [stemId] });
      // Re-read the project: the fresh response carries both the grown stem
      // list and the server-recomputed availableStems for the panel.
      const fresh = await getRemixProject(token, project.id);
      setProject(fresh);
      setEdits(initialEdits(fresh));
      addToast({
        type: "success",
        title: "Stem added",
        message: "It joined your session unmuted.",
      });
    } catch {
      addToast({
        type: "error",
        title: "Couldn't add stem",
        message: "The stem could not be added. Please try again.",
      });
    } finally {
      setAddingStemId(null);
    }
  };

  const handleSave = async () => {
    if (!token || saving || published) return;
    // Snapshot: edits typed while the request runs must survive it (#1879).
    const snapshot = edits;
    const payload = buildProjectPatch(project, snapshot);
    if (Object.keys(payload).length === 0 || snapshot.title.trim() === "") {
      return;
    }
    setSaving(true);
    setFailedSaveEdits(null);
    try {
      const updated = await updateRemixProject(token, project.id, payload);
      // The PATCH response omits availableStems (a GET-only computation);
      // keep the panel's current list instead of dropping it (#1312).
      setProject((prev) => ({ ...updated, availableStems: prev.availableStems }));
      setEdits((prev) => editsAfterSave(prev, snapshot, updated));
      void recordProductAnalytics(token, "remix.studio_saved", {
        source: "remix_studio",
        subjectType: "remix_project",
        subjectId: updated.id,
        payload: { projectId: updated.id, mode: updated.mode },
      });
    } catch {
      // Blocks autosave until the next edit or Retry; the footer says so.
      setFailedSaveEdits(snapshot);
    } finally {
      setSaving(false);
    }
  };

  // Autosave (#1879): re-armed on every edit, fires after a short idle.
  const saveBlocked = failedSaveEdits !== null && failedSaveEdits === edits;
  const autosaveDue = shouldAutosave({
    dirty,
    titleBlank,
    saving,
    published,
    blocked: saveBlocked,
  });
  const handleSaveRef = useRef(handleSave);
  useEffect(() => {
    handleSaveRef.current = handleSave;
  });
  useEffect(() => {
    if (!autosaveDue) return;
    const timer = window.setTimeout(() => {
      void handleSaveRef.current();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [autosaveDue, edits]);

  const handlePublish = async () => {
    if (!token || publishing) return;
    setPublishing(true);
    try {
      const published = await publishRemixProject(token, project.id);
      setProject(published);
      setEdits(initialEdits(published));
      setConfirmPublishOpen(false);
      transport.stop();
      void recordProductAnalytics(token, "remix.published", {
        source: "remix_studio",
        subjectType: "remix_project",
        subjectId: published.id,
        payload: {
          projectId: published.id,
          releaseId: published.publishedRelease.releaseId,
          mode: published.mode,
        },
      });
      addToast({
        type: "success",
        title: "Published on Resonate",
        message: "Your remix is now a public release.",
      });
    } catch (error) {
      // Publishing re-checks eligibility server-side; surface the server's
      // reason (consent flip, quarantine, incomplete draft) rather than a
      // generic failure.
      let message =
        "Your remix could not be published. Please try again later.";
      if (error instanceof Error) {
        const prefixed = error.message.match(/^API \d+: (.+)$/s);
        if (prefixed?.[1]?.trim()) {
          const detail = prefixed[1].trim();
          const jsonStart = detail.indexOf("{");
          if (jsonStart >= 0) {
            try {
              const parsed = JSON.parse(detail.slice(jsonStart));
              message = parsed.message ?? message;
            } catch {
              message = detail;
            }
          } else {
            message = detail;
          }
        }
      }
      addToast({ type: "error", title: "Publish failed", message });
    } finally {
      setPublishing(false);
    }
  };

  const handleExport = async () => {
    if (!token || exporting) return;
    setExporting(true);
    try {
      const { blob, filename } = await exportRemixDraftBlob(token, project.id);
      // Blob + anchor download: the browser saves the render under the
      // server-sanitized filename.
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      addToast({
        type: "success",
        title: "Export started",
        message: `Downloading ${filename}.`,
      });
    } catch (error) {
      // Export re-checks eligibility server-side; surface the server's reason
      // (missing commercial license, consent flip, incomplete draft) rather
      // than a generic failure.
      let message =
        "Your remix could not be exported. Please try again later.";
      if (error instanceof Error) {
        const prefixed = error.message.match(/^API \d+: (.+)$/s);
        if (prefixed?.[1]?.trim()) {
          const detail = prefixed[1].trim();
          const jsonStart = detail.indexOf("{");
          if (jsonStart >= 0) {
            try {
              const parsed = JSON.parse(detail.slice(jsonStart));
              message = parsed.message ?? message;
            } catch {
              message = detail;
            }
          } else {
            message = detail;
          }
        }
      }
      addToast({ type: "error", title: "Export failed", message });
    } finally {
      setExporting(false);
    }
  };

  const publishAvailability = describePublishAvailability({
    status: project.status,
    generationStatus,
    hasDraftOutput: Boolean(draftOutputUri),
    dirty,
    publishing,
    eligibility,
  });
  const exportAvailability = describeExportAvailability({
    status: project.status,
    generationStatus,
    hasDraftOutput: Boolean(draftOutputUri),
    dirty,
    exporting,
    eligibility,
  });

  // Demand signal for gated publish/export clicks (#1143/#1196/#1323).
  const recordActionUnavailable = (
    action: "publish" | "export",
    reasonCode: string,
  ) => {
    void recordProductAnalytics(token, "remix.studio_action_unavailable", {
      source: "remix_studio",
      subjectType: "remix_project",
      subjectId: project.id,
      payload: { projectId: project.id, action, reasonCode },
    });
  };

  // Create panel (#1879): one intent picker over mode + AI target.
  const intent = intentFromState(edits.mode, edits.aiTarget.kind);
  const handleIntentChange = (requested: RemixIntent) => {
    // Mode and AI target (#1882) are part of the saved project; autosave
    // persists them. The AI target only applies to variations, so the mix
    // and extend intents keep a saved choice instead of clobbering it.
    setEdits((prev) => {
      const state = stateForIntent(
        intentReturningFromMix(prev.mode, prev.aiTarget, requested),
      );
      const aiTarget =
        state.mode !== "variation"
          ? prev.aiTarget
          : state.aiTargetKind === prev.aiTarget.kind
            ? prev.aiTarget
            : { kind: state.aiTargetKind, stemId: null };
      if (prev.mode === state.mode && aiTarget === prev.aiTarget) return prev;
      return { ...prev, mode: state.mode, aiTarget };
    });
  };
  const handleReplaceStemChange = (stemId: string | null) => {
    setEdits((prev) =>
      prev.aiTarget.stemId === stemId
        ? prev
        : { ...prev, aiTarget: { ...prev.aiTarget, stemId } },
    );
  };
  // Recipe masks cover the timeline's blocks (#1899).
  const recipes = applicableRecipes(project.stems, blockCount);
  const handleApplyRecipe = (recipeId: string) => {
    setEdits((prev) => {
      const count = editBlockCount(
        sectionGrid?.sections.length ?? 0,
        prev.structure,
      );
      return {
        ...prev,
        stems: applyRecipe(recipeId, project.stems, prev.stems, count),
      };
    });
  };
  const structureOptions =
    sectionGrid && structureState
      ? structureShapeOptions(sectionGrid, structureState)
      : [];
  // "Describe it" (#1900): proposals are computed from these edits; Apply
  // (and Undo) set the described slice in one update and autosave persists it.
  const describeContext: RemixDescribeContext<ProjectEdits> = {
    edits,
    stems: project.stems.map((stem) => ({
      stemId: stem.stemId,
      type: stem.type,
      name: stemDisplayName(stem),
      reference: referenceIds.has(stem.stemId),
    })),
    grid: sectionGrid,
  };
  const handleApplyDescribedEdits = (next: RemixDescribeEdits) => {
    if (published) return;
    setEdits((prev) => applyDescribedEdits(prev, next));
  };
  const replaceStemOptions = project.stems
    .filter((stem) => !referenceIds.has(stem.stemId))
    .map((stem) => ({ stemId: stem.stemId, name: stemDisplayName(stem) }));

  // Generate gating (#1162/#1316/#1422): saved-state and prompt gate, then
  // an incomplete replace selection, then the credit balance.
  const baseGenerateAvailability = describeGenerateAvailability({
    mode: edits.mode,
    prompt: edits.prompt,
    saving,
    dirty,
    generating,
    generationActive,
  });
  const transformCheck =
    edits.mode === "variation"
      ? stemTransformForGenerate(
          edits.aiTarget.kind,
          edits.aiTarget.stemId,
          project.stems,
          edits,
        )
      : {};
  const transformGated =
    baseGenerateAvailability.enabled && transformCheck.problem
      ? { enabled: false, reason: transformCheck.problem }
      : baseGenerateAvailability;
  const generateAvailability =
    transformGated.enabled && !canAffordDraft
      ? {
          enabled: false,
          reason: "You're out of generation credits.",
        }
      : transformGated;
  const generateLabel =
    generating || generationActive
      ? "Queued..."
      : generationStatus === "failed"
        ? edits.mode === "stem_mix"
          ? "Retry render"
          : "Retry generation"
        : project.generationJobId
          ? edits.mode === "stem_mix"
            ? "Re-render mix"
            : "Regenerate draft"
          : edits.mode === "stem_mix"
            ? "Render mix"
            : "Generate AI draft";

  // Drafts panel (#1320/#1879). Job ids are playback keys only, never shown.
  const generationMetadata = project.generationMetadata;
  const currentDraft: RemixCurrentDraft | null = project.generationJobId
    ? {
        status: generationActive
          ? "queued"
          : generationStatus === "failed"
            ? "failed"
            : draftOutputUri
              ? "completed"
              : "no_output",
        failureMessage: generationFailure,
        kindLabel: draftKindLabel(
          generationMetadata?.grounding,
          generationMetadata?.stemTransform,
          generationMetadata?.mode,
        ),
        provenance: generationMetadata?.grounding ?? null,
        addedParts: generationMetadata?.renderMetadata?.addedParts ?? null,
        groundingDetail: groundingDescription(generationMetadata),
        transformNote: describeStemTransform(generationMetadata?.stemTransform),
        costUsd: generationMetadata?.estimatedCostUsd ?? null,
        completedAt: generationMetadata?.completedAt ?? null,
        peaks: transport.draftPeaksFor(null),
        playing: draftTransportState(null) === "playing",
        loading: draftTransportState(null) === "loading",
      }
    : null;
  const draftVersions: RemixDraftVersion[] = (
    generationMetadata?.previousDrafts ?? []
  ).map((entry) => ({
    jobId: entry.jobId,
    label: draftKindLabel(entry.grounding, entry.stemTransform, entry.mode),
    provenance: entry.grounding,
    costUsd: entry.estimatedCostUsd,
    completedAt: entry.completedAt,
    peaks: transport.draftPeaksFor(entry.jobId),
    playing: draftTransportState(entry.jobId) === "playing",
    loading: draftTransportState(entry.jobId) === "loading",
  }));
  const draftsEmptyHint =
    edits.mode === "stem_mix"
      ? "No draft yet. Render your arranged stems into a mix, or choose Add AI to generate one."
      : "No AI draft yet. Write a prompt and generate one.";

  return (
    <div className="min-h-screen bg-black">
      <div className="bg-gradient-to-b from-purple-900/20 to-transparent">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="text-sm text-zinc-400 mb-2">Remix Studio</div>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              aria-label="Remix title"
              aria-invalid={titleBlank || undefined}
              className={`bg-transparent text-3xl font-bold text-white border-b focus:outline-none min-w-0 flex-1 ${
                titleBlank
                  ? "border-red-500/60"
                  : "border-transparent focus:border-zinc-600"
              }`}
              value={edits.title}
              disabled={published}
              onChange={(e) =>
                setEdits((prev) => ({ ...prev, title: e.target.value }))
              }
            />
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                published
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                  : "bg-purple-500/20 text-purple-300 border-purple-500/30"
              }`}
            >
              {project.status}
            </span>
            {/* Autosave status (#1879): lives with the title it saves. */}
            {!published && (
              <span className="flex items-center gap-2">
                <span
                  role="status"
                  className={`text-xs remix-save-status ${
                    (titleBlank || saveBlocked) && !saving
                      ? "text-red-400"
                      : "text-zinc-500"
                  }`}
                >
                  {saveStatusLabel({
                    saving,
                    dirty,
                    titleBlank,
                    error: saveBlocked,
                  })}
                </span>
                {saveBlocked && !saving && (
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost remix-save-retry"
                    onClick={() => void handleSave()}
                  >
                    Retry
                  </button>
                )}
              </span>
            )}
          </div>
          <p className="text-zinc-400 mt-2 text-sm remix-studio-attribution">
            Remix of{" "}
            <span className="text-zinc-200">{project.source.trackTitle}</span>
            {project.source.artistName ? (
              <>
                {" "}by <span className="text-zinc-200">{project.source.artistName}</span>
              </>
            ) : null}
            {" "}from{" "}
            <Link
              href={`/release/${project.source.releaseId}`}
              className="text-purple-300 hover:text-purple-200 underline-offset-2 hover:underline"
            >
              {project.source.releaseTitle}
            </Link>
          </p>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium border remix-rights-badge remix-rights-badge--${rights.tone} ${
                rights.tone === "ok"
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/30"
              }`}
            >
              {rights.label}
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
              {project.licenseType} license · private drafts
            </span>
            {musicalSummaryLabel && (
              <span
                className="px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-300 border border-zinc-700 remix-musical-summary"
                title="Measured from the stem audio"
              >
                {musicalSummaryLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Studio layout (#1879): Session then Drafts in the wide left
            column, Create in a sticky side column spanning both rows on large
            screens; stacked Session → Create → Drafts otherwise. The
            `auto 1fr` rows give any extra height from the spanning Create
            column to row 2, so Drafts sits right under the Session. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] remix-studio-layout">
          <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1 remix-studio-session-column">
            {published && (
              <section className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-5 remix-published-banner">
                <h2 className="text-base font-semibold text-emerald-200">
                  Published on Resonate
                </h2>
                <p className="text-sm text-emerald-100/80 mt-1">
                  This draft is now a public remix release. The studio is locked —
                  edits and re-generation are disabled so the release stays in sync.
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  {project.publishedReleaseId && (
                    <Link
                      href={`/release/${project.publishedReleaseId}`}
                      className="ui-btn ui-btn-primary mt-3 inline-flex remix-published-release-link"
                    >
                      View release page
                    </Link>
                  )}
                  <RemixSellCta commerce={project.commerce} />
                </div>
              </section>
            )}

            {/* Session: transport + one lane per stem (#1879) */}
            <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 remix-session">
              <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <h2 className="text-lg font-semibold text-white">Session</h2>
                  {sectionGrid && (
                    <span className="text-xs text-zinc-500">
                      {sectionGridSummaryLabel(sectionGrid)}
                    </span>
                  )}
                </div>
                {soloStemId && (
                  <button
                    type="button"
                    className="text-xs text-purple-300 hover:text-purple-200"
                    onClick={() => setSoloStemId(null)}
                  >
                    Clear solo
                  </button>
                )}
              </div>
              <p className="text-zinc-500 text-xs mb-4">
                The preview is unmastered, with a limiter keeping the summed stems
                from clipping; final renders are loudness-normalized, so they sound
                louder and more even. Mute, gain, and sections save automatically;
                solo changes playback only and is not saved.
                {Object.entries(edits.stems).some(
                  ([stemId, edit]) => edit.muted && !referenceIds.has(stemId),
                ) && (
                  <>
                    {" "}
                    Stems added from this track start muted — unmute a row to bring
                    it into your remix.
                  </>
                )}{" "}
                <span className="hidden text-zinc-400 md:inline remix-shortcut-hint">
                  Space play/stop · M mute · S solo on the focused row · Esc clears
                  the loop
                </span>
              </p>
              {doublingReferenceStems.map((stem) => (
                <div
                  key={stem.stemId}
                  role="alert"
                  className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 remix-reference-doubling-warning"
                >
                  <p className="text-xs text-amber-200 flex-1 min-w-[12rem]">
                    “{stemDisplayName(stem)}” is the full mix of the track, so it
                    plays every part your other stems already cover — your mix is
                    doubled. Use it only as a reference to compare against.
                  </p>
                  <button
                    type="button"
                    disabled={published}
                    className="px-2 py-1 rounded text-xs font-medium border bg-amber-500/20 text-amber-100 border-amber-500/40 hover:bg-amber-500/30 remix-use-as-reference-btn"
                    onClick={() => updateStemEdit(stem.stemId, { muted: true })}
                  >
                    Use as reference only
                  </button>
                </div>
              ))}
              <div className="rounded-md border border-zinc-800 overflow-hidden">
                <RemixTransportBar
                  status={transport.status}
                  getPositionSec={transport.getPositionSec}
                  durationSec={transport.durationSec}
                  source={transportSource}
                  hasOriginal={referenceStemId !== null}
                  hasDraft={Boolean(draftOutputUri)}
                  loopLabel={
                    sectionGrid && transportLoop
                      ? transportLoopLabel(
                          sectionGrid,
                          transportLoop.sectionIndex,
                          structureState?.blocks ?? null,
                        )
                      : null
                  }
                  meter={
                    transport.status === "playing" &&
                    transportSource.kind !== "draft" ? (
                      <PreviewLevelMeter handle={transport.previewHandle} />
                    ) : null
                  }
                  onToggle={transport.toggle}
                  onSourceChange={transport.setSource}
                  onClearLoop={() => transport.setLoop(null)}
                />
                <RemixSessionLanes
                  stems={laneStems}
                  grid={sectionGrid}
                  durationSec={transport.durationSec}
                  getPositionSec={transport.getPositionSec}
                  playing={transport.status === "playing"}
                  loopSectionIndex={transportLoop?.sectionIndex ?? null}
                  disabled={published}
                  onToggleMute={toggleStemMute}
                  onToggleSolo={toggleStemSolo}
                  onGainChange={(stemId, gainDb) =>
                    updateStemEdit(stemId, { gainDb })
                  }
                  onSetSections={(stemId, sections) =>
                    updateStemEdit(stemId, { sections })
                  }
                  onFxChange={handleStemFxChange}
                  onSeek={transport.seek}
                  onLoopSection={loopSection}
                  timeline={sectionGrid ? timeline : null}
                  structureState={structureState}
                  onBlockAction={handleBlockAction}
                  beat={laneBeat}
                  onToggleBeatMute={() =>
                    updateBeat((beat) => withBeatMuted(beat, beat.muted !== true))
                  }
                  onToggleBeatSolo={() => toggleStemSolo(REMIX_BEAT_LANE_ID)}
                  onBeatGainChange={(gainDb) =>
                    updateBeat((beat) => ({ ...beat, gainDb }))
                  }
                  onSetBeatBlocks={(blocks) =>
                    updateBeat((beat) => ({ ...beat, blocks }))
                  }
                />
              </div>

              {/* Sibling stems not in the session yet (#1312) */}
              {availableStems.length > 0 && (
                <div className="mt-5 border-t border-zinc-800 pt-4">
                  <h3 className="text-sm font-semibold text-zinc-200 mb-1">
                    Also on this track
                  </h3>
                  <p className="text-zinc-500 text-xs mb-3">
                    Licensed stems join your session instantly; the others link to
                    their license page.
                  </p>
                  <ul className="space-y-2">
                    {availableStems.map((stem) => {
                      const action = describeAvailableStemAction(stem);
                      return (
                        <li
                          key={stem.stemId}
                          className="border border-zinc-800 rounded-md px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-2"
                        >
                          <div className="min-w-[8rem] flex-1">
                            <div className="text-sm text-zinc-300">
                              {stemDisplayName(stem)}
                            </div>
                            <div className="text-xs text-zinc-500">{stem.type}</div>
                          </div>
                          {action.kind === "add" ? (
                            <button
                              type="button"
                              className="ui-btn ui-btn-ghost remix-add-stem-btn"
                              disabled={
                                published ||
                                saving ||
                                dirty ||
                                addingStemId !== null
                              }
                              title={
                                dirty || saving
                                  ? SAVING_LATEST_CHANGES_REASON
                                  : `Add ${stemDisplayName(stem)} to this session`
                              }
                              onClick={() => void handleAddStem(stem.stemId)}
                            >
                              {addingStemId === stem.stemId
                                ? "Adding..."
                                : action.label}
                            </button>
                          ) : action.kind === "license" && action.href ? (
                            <Link
                              href={action.href}
                              className="ui-btn ui-btn-ghost remix-license-stem-link"
                            >
                              {action.label}
                            </Link>
                          ) : (
                            <span
                              className="text-xs text-zinc-500"
                              aria-disabled="true"
                            >
                              {action.label}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>
          </div>

          <div className="min-w-0 self-start lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto remix-studio-create-column">
            <RemixCreatePanel
              intent={intent}
              onIntentChange={handleIntentChange}
              prompt={edits.prompt}
              onPromptChange={(prompt) =>
                setEdits((prev) => ({ ...prev, prompt }))
              }
              presets={presetsForMode(edits.mode)}
              activePresetLabel={activePresetLabel(edits.mode, edits.prompt)}
              replaceStemOptions={replaceStemOptions}
              replaceStemId={edits.aiTarget.stemId}
              onReplaceStemChange={handleReplaceStemChange}
              recipes={recipes}
              onApplyRecipe={handleApplyRecipe}
              effects={edits.effects}
              onApplyVibe={handleApplyVibe}
              onMasterFxChange={handleMasterFxChange}
              structureOptions={structureOptions}
              onApplyStructure={handleApplyStructure}
              describeContext={describeContext}
              onApplyEdits={handleApplyDescribedEdits}
              beat={edits.beat}
              beatAvailable={beatAvailable}
              onBeatChange={handleBeatChange}
              primary={{
                label: generateLabel,
                enabled: generateAvailability.enabled,
                reason: generateAvailability.reason,
                busy: generating || generationActive,
                onClick: () => void handleGenerate(),
              }}
              creditMeter={
                <CreditBalanceMeter
                  variant="inline"
                  balance={credits}
                  priceCentsPer30s={credits?.priceCentsPer30s ?? null}
                  onRequestCredits={handleRequestCredits}
                  requesting={creditRequestState === "sending"}
                />
              }
              attribution={
                // Stability AI Community License §IV(a) attribution (#1342):
                // server-driven, shown only when the active provider needs it.
                <RemixGenerationAttributionBadge
                  attribution={eligibility?.generationAttribution}
                />
              }
              locked={published}
            />
          </div>
          <div className="min-w-0 self-start lg:col-start-1 lg:row-start-2 remix-studio-drafts-column">
            <RemixDraftsPanel
              current={currentDraft}
              versions={draftVersions}
              onPlayCurrent={() => handleDraftPlayback(null)}
              onPlayVersion={(jobId) => handleDraftPlayback(jobId)}
              publish={{
                enabled: publishAvailability.enabled,
                reason: publishAvailability.reason,
                busy: publishing,
                reasonCode: publishAvailability.reasonCode,
                onClick: () => setConfirmPublishOpen(true),
                onLockedClick: () =>
                  recordActionUnavailable(
                    "publish",
                    publishAvailability.reasonCode,
                  ),
              }}
              exportAction={{
                enabled: exportAvailability.enabled,
                reason: exportAvailability.reason,
                busy: exporting,
                onClick: () => void handleExport(),
                onLockedClick: () =>
                  recordActionUnavailable(
                    "export",
                    exportAvailability.reasonCode,
                  ),
              }}
              published={published}
              emptyHint={draftsEmptyHint}
            />
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmPublishOpen}
        title="Publish this remix?"
        message={publishConfirmMessage({
          title: edits.title.trim() || project.title,
          source: project.source,
          grounding: groundingDescription(project.generationMetadata),
        })}
        confirmLabel={publishing ? "Publishing..." : "Publish on Resonate"}
        cancelLabel="Keep private"
        onConfirm={() => handlePublish()}
        onCancel={() => setConfirmPublishOpen(false)}
      />
    </div>
  );
}
