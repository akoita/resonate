"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import {
  generateRemixDraft,
  getRemixEligibility,
  getRemixProject,
  getRemixDraftAudioBlob,
  getStemPreviewUrl,
  publishRemixProject,
  updateRemixProject,
  type RemixEligibilityResponse,
  type RemixGenerationMetadata,
  type RemixProject,
  type RemixProjectAvailableStem,
  type RemixProjectPatch,
  type RemixProjectSource,
  type RemixProjectStem,
  type RemixStemTransform,
} from "../../lib/api";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import {
  activePresetLabel,
  presetsForMode,
} from "../../lib/remixPromptPresets";
import {
  remixDraftOutputUri,
  startStemArrangementPreview,
  type PreviewStemState,
  type StemArrangementPreviewHandle,
} from "../../lib/remixAudioPreview";
import {
  activeIntervalsFromSections,
  arrangementPayload,
  parseArrangementSections,
  sectionGridSummaryLabel,
  sectionStartLabel,
} from "../../lib/remixArrangement";

export const GAIN_DB_MIN = -24;
export const GAIN_DB_MAX = 6;

export const REMIX_MODES = [
  { value: "stem_mix", label: "Stem mix" },
  { value: "variation", label: "Variation" },
  { value: "extension", label: "Extension" },
] as const;

/** Maps apiRequest error messages ("API <status>: ...") to a load state. */
export function classifyProjectLoadError(
  message: string,
): "forbidden" | "missing" | "error" {
  if (message.startsWith("API 403:")) return "forbidden";
  if (message.startsWith("API 404:")) return "missing";
  return "error";
}

export function clampGainDb(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(GAIN_DB_MAX, Math.max(GAIN_DB_MIN, value));
}

export type StemEdit = {
  gainDb: number | null;
  muted: boolean;
  /** Section mask (#1314): null = every section on (the default). */
  sections: boolean[] | null;
};

export type ProjectEdits = {
  title: string;
  prompt: string;
  mode: string;
  stems: Record<string, StemEdit>;
};

export function initialEdits(project: RemixProject): ProjectEdits {
  const sectionCount = project.sectionGrid?.sections.length ?? 0;
  const stems: Record<string, StemEdit> = {};
  for (const stem of project.stems) {
    stems[stem.stemId] = {
      gainDb: stem.gainDb,
      muted: stem.muted,
      sections:
        sectionCount > 0
          ? parseArrangementSections(stem.arrangement, sectionCount)
          : null,
    };
  }
  return {
    title: project.title,
    prompt: project.prompt ?? "",
    mode: project.mode,
    stems,
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
  const sectionCount = project.sectionGrid?.sections.length ?? 0;
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
      const persisted = parseArrangementSections(stem.arrangement, sectionCount);
      if (!sameSections(edit.sections, persisted)) {
        // null clears back to the always-on default server-side (#1314).
        stemPatch.arrangement =
          edit.sections === null ? null : arrangementPayload(edit.sections);
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
 * Compact musical chips ("104 BPM", "A minor") from the stem's measured audio
 * features (#1184). No chip is shown for missing measurements — no guessed
 * musical claims.
 */
export function stemFeatureChips(
  features: RemixProjectStem["audioFeatures"],
): string[] {
  if (!features) return [];
  const chips: string[] = [];
  const bpm = features.tempoBpm;
  if (typeof bpm === "number" && Number.isFinite(bpm) && bpm > 0) {
    chips.push(`${Math.round(bpm)} BPM`);
  }
  const key = features.key;
  if (key?.tonic && key.mode) {
    chips.push(`${key.tonic} ${key.mode}`);
  }
  return chips;
}

export function stemDisplayName(stem: {
  type: string;
  title: string | null;
}): string {
  if (stem.title) return stem.title;
  return stem.type.charAt(0).toUpperCase() + stem.type.slice(1);
}

/** Footer save-state copy; pure so the title/dirty interplay is testable. */
export function saveStatusLabel(input: {
  saving: boolean;
  dirty: boolean;
  titleBlank: boolean;
}): string {
  if (input.saving) return "Saving...";
  if (input.titleBlank) return "Title is required";
  if (input.dirty) return "Unsaved changes";
  return "All changes saved";
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
  if (input.dirty) {
    return {
      enabled: false,
      reason: "Save your changes first so generation uses the saved draft.",
    };
  }
  if (input.saving || input.generating) {
    return { enabled: false, reason: null };
  }
  return { enabled: true, reason: null };
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

/** Toast copy per normalized provider error code (#1162). */
export function generationErrorMessage(code: string, message: string): string {
  switch (code) {
    case "provider_disabled":
      return "AI generation is not enabled on this environment yet.";
    case "provider_rejected":
      return "The provider rejected this prompt. Adjust it and try again.";
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

export function remixGenerationFailureMessage(
  metadata: RemixGenerationMetadata | null,
): string | null {
  if (remixGenerationStatus(metadata) !== "failed") return null;
  return generationErrorMessage(
    metadata?.errorCode ?? "unknown",
    metadata?.errorMessage ?? "Generation failed. Please try again later.",
  );
}

export function stemPreviewStates(
  project: RemixProject,
  edits: ProjectEdits,
): PreviewStemState[] {
  const grid = project.sectionGrid ?? null;
  return project.stems.map((stem) => {
    const edit = edits.stems[stem.stemId];
    const sections =
      edit?.sections !== undefined
        ? edit.sections
        : grid
          ? parseArrangementSections(stem.arrangement, grid.sections.length)
          : null;
    return {
      stemId: stem.stemId,
      gainDb: edit?.gainDb ?? stem.gainDb,
      muted: edit?.muted ?? stem.muted,
      // Preview gates at the same spans the server render will use (#1314).
      ...(grid
        ? { activeIntervals: activeIntervalsFromSections(grid, sections) }
        : {}),
    };
  });
}

// Publishing inside Resonate is live (#1196); export stays honestly locked
// until exportable license terms exist (backlog E).
const UNAVAILABLE_ACTIONS = [
  {
    key: "export",
    label: "Export audio",
    // reasonCode is the analytics-safe identifier; reason stays human text.
    reasonCode: "export_rights_required",
    reason:
      "Export requires a license that explicitly grants export rights. Your remix license covers in-Resonate publishing only.",
  },
] as const;

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
      reason: "Save your changes first so you publish the saved draft.",
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
  const [soloStemId, setSoloStemId] = useState<string | null>(null);
  const [addingStemId, setAddingStemId] = useState<string | null>(null);
  const [aiTargetKind, setAiTargetKind] = useState<AiTargetKind>("whole");
  const [aiTargetStemId, setAiTargetStemId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmPublishOpen, setConfirmPublishOpen] = useState(false);
  const [eligibility, setEligibility] =
    useState<RemixEligibilityResponse | null>(null);
  const [stemPreviewStatus, setStemPreviewStatus] = useState<
    "idle" | "loading" | "playing"
  >("idle");
  const [draftPlaybackStatus, setDraftPlaybackStatus] = useState<
    "idle" | "loading" | "playing"
  >("idle");
  const stemPreviewRef = useRef<StemArrangementPreviewHandle | null>(null);
  const draftAudioRef = useRef<HTMLAudioElement | null>(null);
  const draftObjectUrlRef = useRef<string | null>(null);

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
  // Switching back to stem_mix keeps any stored prompt; generation (#896)
  // must ignore prompts when mode is stem_mix.
  const promptEnabled = edits.mode !== "stem_mix";
  const titleBlank = edits.title.trim() === "";
  const generationStatus = remixGenerationStatus(project.generationMetadata);
  const generationActive = remixGenerationIsActive(project.generationMetadata);
  const generationFailure = remixGenerationFailureMessage(
    project.generationMetadata,
  );
  const draftOutputUri = remixGenerationPlayableOutputUri(
    project.generationMetadata,
  );

  const stopStemPreview = () => {
    stemPreviewRef.current?.stop();
    stemPreviewRef.current = null;
    setStemPreviewStatus("idle");
  };

  const stopDraftPlayback = () => {
    draftAudioRef.current?.pause();
    draftAudioRef.current = null;
    if (draftObjectUrlRef.current) {
      URL.revokeObjectURL(draftObjectUrlRef.current);
      draftObjectUrlRef.current = null;
    }
    setDraftPlaybackStatus("idle");
  };

  useEffect(() => {
    return () => {
      stemPreviewRef.current?.stop();
      draftAudioRef.current?.pause();
      if (draftObjectUrlRef.current) {
        URL.revokeObjectURL(draftObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (stemPreviewStatus !== "playing" || !stemPreviewRef.current) return;
    stemPreviewRef.current.update(stemPreviewStates(project, edits), soloStemId);
  }, [edits, project, soloStemId, stemPreviewStatus]);

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
        if (
          remixGenerationStatus(updated.generationMetadata) === "completed"
        ) {
          stopDraftPlayback();
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
  }, [dirty, generationActive, project.id, token]);

  // Publish gating (#1196): eligibility is re-checked server-side at publish
  // time, but the studio fetches it so the button reflects the live source
  // state (consent flips, quarantines) instead of a stale creation-time
  // decision. Only relevant once a completed draft exists on a draft project.
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

  const toggleStemSection = (stemId: string, index: number) => {
    if (!sectionGrid) return;
    setEdits((prev) => {
      const current = prev.stems[stemId];
      const base =
        current?.sections ?? sectionGrid.sections.map(() => true);
      const next = base.map((flag, i) => (i === index ? !flag : flag));
      return {
        ...prev,
        stems: {
          ...prev.stems,
          [stemId]: {
            ...current,
            // All-on normalizes back to the null default so untouched
            // arrangements never persist a no-op mask (#1314).
            sections: next.every(Boolean) ? null : next,
          },
        },
      };
    });
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
              aiTargetKind,
              aiTargetStemId,
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
      // Review fix (#1165): a regenerated draft invalidates the cached
      // playback blob — otherwise Play draft replays the previous output.
      stopDraftPlayback();
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

  const handleStemPreview = async () => {
    if (stemPreviewStatus !== "idle") {
      stopStemPreview();
      return;
    }
    setStemPreviewStatus("loading");
    try {
      const handle = await startStemArrangementPreview({
        stems: stemPreviewStates(project, edits),
        soloStemId,
        urlForStem: getStemPreviewUrl,
        onEnded: () => {
          stemPreviewRef.current = null;
          setStemPreviewStatus("idle");
        },
      });
      stemPreviewRef.current = handle;
      setStemPreviewStatus("playing");
    } catch {
      stemPreviewRef.current = null;
      setStemPreviewStatus("idle");
      addToast({
        type: "error",
        title: "Preview unavailable",
        message: "The stem previews could not be loaded. Please try again.",
      });
    }
  };

  const handleDraftPlayback = async () => {
    if (draftPlaybackStatus !== "idle") {
      stopDraftPlayback();
      return;
    }
    if (!token || !draftOutputUri) return;
    setDraftPlaybackStatus("loading");
    try {
      const blob = await getRemixDraftAudioBlob(token, project.id);
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      draftObjectUrlRef.current = objectUrl;
      draftAudioRef.current = audio;
      audio.onended = stopDraftPlayback;
      audio.onerror = () => {
        stopDraftPlayback();
        addToast({
          type: "error",
          title: "Draft playback failed",
          message: "The generated draft could not be played.",
        });
      };
      await audio.play();
      setDraftPlaybackStatus("playing");
    } catch {
      stopDraftPlayback();
      addToast({
        type: "error",
        title: "Draft playback unavailable",
        message: "The generated draft audio could not be loaded.",
      });
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
    if (!token || !dirty || saving) return;
    setSaving(true);
    try {
      const updated = await updateRemixProject(token, project.id, patch);
      // The PATCH response omits availableStems (a GET-only computation);
      // keep the panel's current list instead of dropping it (#1312).
      setProject((prev) => ({ ...updated, availableStems: prev.availableStems }));
      setEdits(initialEdits(updated));
      void recordProductAnalytics(token, "remix.studio_saved", {
        source: "remix_studio",
        subjectType: "remix_project",
        subjectId: updated.id,
        payload: { projectId: updated.id, mode: updated.mode },
      });
    } catch {
      addToast({
        type: "error",
        title: "Save failed",
        message: "Your remix edits could not be saved. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!token || publishing) return;
    setPublishing(true);
    try {
      const published = await publishRemixProject(token, project.id);
      setProject(published);
      setEdits(initialEdits(published));
      setConfirmPublishOpen(false);
      stopStemPreview();
      stopDraftPlayback();
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

  const published = project.status === "published";
  const publishAvailability = describePublishAvailability({
    status: project.status,
    generationStatus,
    hasDraftOutput: Boolean(draftOutputUri),
    dirty,
    publishing,
    eligibility,
  });

  return (
    <div className="min-h-screen bg-black">
      <div className="bg-gradient-to-b from-purple-900/20 to-transparent">
        <div className="max-w-4xl mx-auto px-4 py-8">
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
              disabled={saving || published}
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
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {published && (
          <section className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-5 remix-published-banner">
            <h2 className="text-base font-semibold text-emerald-200">
              Published on Resonate
            </h2>
            <p className="text-sm text-emerald-100/80 mt-1">
              This draft is now a public remix release. The studio is locked —
              edits and re-generation are disabled so the release stays in sync.
            </p>
            {project.publishedReleaseId && (
              <Link
                href={`/release/${project.publishedReleaseId}`}
                className="ui-btn ui-btn-primary mt-3 inline-flex remix-published-release-link"
              >
                View release page
              </Link>
            )}
          </section>
        )}

        {/* Stem controls */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
            <h2 className="text-lg font-semibold text-white">Stems</h2>
            <div className="flex items-center gap-3">
              {soloStemId && (
                <button
                  type="button"
                  className="text-xs text-purple-300 hover:text-purple-200"
                  onClick={() => setSoloStemId(null)}
                >
                  Clear solo
                </button>
              )}
              <button
                type="button"
                className="ui-btn ui-btn-ghost remix-stem-preview-btn"
                onClick={() => void handleStemPreview()}
              >
                {stemPreviewStatus === "loading"
                  ? "Loading preview..."
                  : stemPreviewStatus === "playing"
                    ? "Stop preview"
                    : "Play preview"}
              </button>
            </div>
          </div>
          <p className="text-zinc-500 text-xs mb-4">
            Preview uses streaming-quality source stems. Mute and gain are
            saved with your draft; solo changes playback only and is not saved.
          </p>
          <ul className="space-y-3">
            {project.stems.map((stem) => {
              const edit = edits.stems[stem.stemId];
              const soloedOut = soloStemId !== null && soloStemId !== stem.stemId;
              const effectivelyMuted = edit.muted || soloedOut;
              return (
                <li
                  key={stem.stemId}
                  className={`border border-zinc-800 rounded-md px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 ${
                    effectivelyMuted ? "opacity-50" : ""
                  }`}
                >
                  <div className="min-w-[8rem] flex-1">
                    <div className="text-sm text-zinc-200">
                      {stemDisplayName(stem)}
                    </div>
                    <div className="text-xs text-zinc-500 flex items-center gap-2 flex-wrap">
                      <span>
                        {stem.type}
                        {soloedOut ? " · muted by solo (preview)" : ""}
                      </span>
                      {stemFeatureChips(stem.audioFeatures).map((chip) => (
                        <span
                          key={chip}
                          className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 text-[10px]"
                          title="Measured from the stem audio"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-pressed={edit.muted}
                    disabled={saving}
                    className={`px-2 py-1 rounded text-xs font-medium border ${
                      edit.muted
                        ? "bg-red-500/20 text-red-300 border-red-500/40"
                        : "bg-zinc-800 text-zinc-300 border-zinc-700"
                    }`}
                    onClick={() =>
                      updateStemEdit(stem.stemId, { muted: !edit.muted })
                    }
                  >
                    {edit.muted ? "Muted" : "Mute"}
                  </button>
                  <button
                    type="button"
                    aria-pressed={soloStemId === stem.stemId}
                    className={`px-2 py-1 rounded text-xs font-medium border ${
                      soloStemId === stem.stemId
                        ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                        : "bg-zinc-800 text-zinc-300 border-zinc-700"
                    }`}
                    onClick={() =>
                      setSoloStemId((prev) =>
                        prev === stem.stemId ? null : stem.stemId,
                      )
                    }
                  >
                    Solo
                  </button>
                  <label className="flex items-center gap-2 text-xs text-zinc-400">
                    Gain
                    <input
                      type="range"
                      min={GAIN_DB_MIN}
                      max={GAIN_DB_MAX}
                      step={0.5}
                      value={edit.gainDb ?? 0}
                      disabled={saving}
                      aria-label={`${stemDisplayName(stem)} gain in decibels`}
                      onChange={(e) =>
                        updateStemEdit(stem.stemId, {
                          gainDb: clampGainDb(parseFloat(e.target.value)),
                        })
                      }
                    />
                    <span className="w-14 text-right text-zinc-300">
                      {(edit.gainDb ?? 0).toFixed(1)} dB
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

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
                          disabled={saving || dirty || addingStemId !== null}
                          title={
                            dirty
                              ? "Save your changes first"
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

        {/* Arrangement section grid (#1314) */}
        {sectionGrid && (
          <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
              <h2 className="text-lg font-semibold text-white">Arrangement</h2>
              <span className="text-xs text-zinc-500">
                {sectionGridSummaryLabel(sectionGrid)}
              </span>
            </div>
            <p className="text-zinc-500 text-xs mb-4">
              Switch stems on or off per section — this is what makes the mix
              change over time. Renders fade at section edges; the preview picks
              up section changes the next time you press Play preview.
            </p>
            <div className="overflow-x-auto">
              <table className="remix-arrangement-grid text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-zinc-500 font-normal pr-3 pb-2">
                      Stem
                    </th>
                    {sectionGrid.sections.map((interval, index) => (
                      <th
                        key={index}
                        className="text-zinc-500 font-normal px-1 pb-2 text-center"
                        title={`Section ${index + 1} starts at ${sectionStartLabel(interval)}`}
                      >
                        {sectionStartLabel(interval)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {project.stems.map((stem) => {
                    const sections = edits.stems[stem.stemId]?.sections ?? null;
                    return (
                      <tr key={stem.stemId}>
                        <td className="text-zinc-300 pr-3 py-1 whitespace-nowrap">
                          {stemDisplayName(stem)}
                        </td>
                        {sectionGrid.sections.map((_, index) => {
                          const active =
                            sections === null ? true : sections[index];
                          return (
                            <td key={index} className="px-1 py-1 text-center">
                              <button
                                type="button"
                                aria-pressed={active}
                                aria-label={`${stemDisplayName(stem)}: section ${index + 1} ${active ? "on" : "off"}`}
                                disabled={saving}
                                className={`w-7 h-6 rounded border ${
                                  active
                                    ? "bg-purple-500/30 border-purple-500/50"
                                    : "bg-zinc-800 border-zinc-700"
                                }`}
                                onClick={() =>
                                  toggleStemSection(stem.stemId, index)
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Mode + prompt */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Remix mode</h2>
          <div className="inline-flex rounded-md border border-zinc-700 overflow-hidden">
            {REMIX_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                aria-pressed={edits.mode === mode.value}
                disabled={saving}
                className={`px-4 py-2 text-sm ${
                  edits.mode === mode.value
                    ? "bg-purple-500/25 text-purple-200"
                    : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                }`}
                onClick={() =>
                  setEdits((prev) => ({ ...prev, mode: mode.value }))
                }
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div className="mt-4">
            <label className="block text-sm text-zinc-400 mb-1" htmlFor="remix-prompt">
              Prompt
            </label>
            {/* Prompt presets (#1177): transparent templates — clicking fills
                the editable textarea with the full text, never a hidden
                augmentation. Only prompted modes have presets. */}
            {promptEnabled && presetsForMode(edits.mode).length > 0 && (
              <div
                className="flex items-center gap-2 flex-wrap mb-2"
                role="group"
                aria-label="Prompt presets"
              >
                {presetsForMode(edits.mode).map((preset) => {
                  const active =
                    activePresetLabel(edits.mode, edits.prompt) === preset.label;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      disabled={saving}
                      aria-pressed={active}
                      title={preset.prompt}
                      className={`px-3 py-1 rounded-full text-xs border transition-colors remix-prompt-preset ${
                        active
                          ? "border-purple-500/60 bg-purple-500/15 text-purple-200"
                          : "border-zinc-700 bg-zinc-950 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
                      }`}
                      onClick={() =>
                        setEdits((prev) => ({ ...prev, prompt: preset.prompt }))
                      }
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            )}
            <textarea
              id="remix-prompt"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md p-3 text-sm text-zinc-200 disabled:opacity-50"
              rows={3}
              placeholder="Describe the variation or extension you want..."
              value={edits.prompt}
              disabled={!promptEnabled || saving}
              onChange={(e) =>
                setEdits((prev) => ({ ...prev, prompt: e.target.value }))
              }
            />
            {edits.mode === "variation" && (
              <div className="mt-4 remix-ai-target">
                <div className="text-xs text-zinc-500 mb-2">AI target</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="inline-flex rounded-md border border-zinc-700 overflow-hidden">
                    {(
                      [
                        { value: "whole", label: "Whole track" },
                        { value: "add_layer", label: "New layer" },
                        { value: "replace_stem", label: "Replace stem" },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={aiTargetKind === option.value}
                        disabled={saving}
                        className={`px-3 py-1.5 text-xs ${
                          aiTargetKind === option.value
                            ? "bg-purple-500/20 text-purple-200"
                            : "bg-zinc-900 text-zinc-400"
                        }`}
                        onClick={() => setAiTargetKind(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {aiTargetKind === "replace_stem" && (
                    <select
                      aria-label="Stem to replace"
                      className="bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1.5 text-xs text-zinc-200"
                      value={aiTargetStemId ?? ""}
                      disabled={saving}
                      onChange={(event) =>
                        setAiTargetStemId(event.target.value || null)
                      }
                    >
                      <option value="">Choose stem…</option>
                      {project.stems.map((stem) => (
                        <option key={stem.stemId} value={stem.stemId}>
                          {stemDisplayName(stem)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <p className="text-xs text-zinc-500 mt-2">
                  {aiTargetKind === "replace_stem"
                    ? "The AI generates an isolated part to take that stem's place; your other stems stay untouched."
                    : aiTargetKind === "add_layer"
                      ? "The AI generates one new part that sits on top of your arranged stems."
                      : "The AI reinterprets the whole arrangement as one generated layer over your stems."}
                </p>
              </div>
            )}
            {!promptEnabled && (
              <p className="text-xs text-zinc-500 mt-1">
                Prompts apply to variation and extension modes. Stem mix uses
                only your stem settings.
              </p>
            )}
          </div>
        </section>

        {/* Draft status + AI generation (#1162) */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-white mb-3">Draft status</h2>
              <div className="text-sm text-zinc-400 space-y-1">
                <p>
                  Status: <span className="text-zinc-200">{project.status}</span>
                  {" · "}Policy:{" "}
                  <span className="text-zinc-200">{project.policyVersion}</span>
                </p>
                <p className="remix-generation-placeholder">
                  {generationActive && project.generationJobId
                    ? `AI generation queued — job ${project.generationJobId}.`
                    : generationStatus === "failed" && project.generationJobId
                      ? `AI generation failed — job ${project.generationJobId}.`
                      : project.generationJobId
                        ? `AI draft recorded — job ${project.generationJobId} (${project.generationProvider ?? "unknown provider"}).`
                        : edits.mode === "stem_mix"
                          ? "No draft yet. Render your arranged stems into a mix, or switch to a prompted mode for AI generation."
                          : "No AI draft yet. Write a prompt in variation or extension mode and generate one."}
                </p>
                {(() => {
                  const grounding = groundingDescription(
                    project.generationMetadata,
                  );
                  return (
                    project.generationJobId &&
                    grounding && (
                      <p className="text-zinc-500 text-xs remix-generation-grounding">
                        {grounding}
                      </p>
                    )
                  );
                })()}
                {(() => {
                  const transformNote = describeStemTransform(
                    project.generationMetadata?.stemTransform,
                  );
                  return (
                    project.generationJobId &&
                    transformNote && (
                      <p className="text-zinc-500 text-xs remix-generation-transform">
                        {transformNote}
                      </p>
                    )
                  );
                })()}
                {generationFailure && (
                  <p className="text-red-300 remix-generation-error">
                    {generationFailure}
                  </p>
                )}
              </div>
            </div>
            {(() => {
              const baseAvailability = describeGenerateAvailability({
                mode: edits.mode,
                prompt: edits.prompt,
                saving,
                dirty,
                generating,
                generationActive,
              });
              // Targeted transform gating (#1316): an incomplete replace
              // selection blocks Generate with the concrete reason.
              const transformCheck =
                edits.mode === "variation"
                  ? stemTransformForGenerate(
                      aiTargetKind,
                      aiTargetStemId,
                      project.stems,
                      edits,
                    )
                  : {};
              const availability =
                baseAvailability.enabled && transformCheck.problem
                  ? { enabled: false, reason: transformCheck.problem }
                  : baseAvailability;
              return (
                <div className="text-right">
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary remix-generate-btn"
                    aria-disabled={!availability.enabled || published || undefined}
                    title={
                      published
                        ? "This remix is published and can no longer be regenerated."
                        : availability.reason ?? undefined
                    }
                    onClick={(e) => {
                      if (!availability.enabled || published) {
                        e.preventDefault();
                        return;
                      }
                      void handleGenerate();
                    }}
                  >
                    {generating || generationActive
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
                            : "Generate AI draft"}
                  </button>
                  {availability.reason && (
                    <p className="text-xs text-zinc-500 mt-2 max-w-[16rem]">
                      {availability.reason}
                    </p>
                  )}
                  {draftOutputUri && (
                    <button
                      type="button"
                      className="ui-btn ui-btn-ghost remix-draft-playback-btn mt-3"
                      onClick={() => void handleDraftPlayback()}
                    >
                      {draftPlaybackStatus === "loading"
                        ? "Loading draft..."
                        : draftPlaybackStatus === "playing"
                          ? "Stop draft"
                          : "Play AI draft"}
                    </button>
                  )}
                  {project.generationJobId &&
                    !draftOutputUri &&
                    !generationActive &&
                    generationStatus !== "failed" && (
                    <p className="text-xs text-zinc-500 mt-3 max-w-[16rem]">
                      This generation has no playable draft output yet.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        </section>

        {/* Save + publish + unavailable actions */}
        <section className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            {published ? (
              project.publishedReleaseId && (
                <Link
                  href={`/release/${project.publishedReleaseId}`}
                  className="ui-btn ui-btn-primary remix-action-view-release"
                >
                  View release
                </Link>
              )
            ) : (
              <button
                type="button"
                className="ui-btn ui-btn-primary remix-action-publish"
                aria-disabled={!publishAvailability.enabled || undefined}
                title={publishAvailability.reason ?? undefined}
                onClick={(e) => {
                  if (!publishAvailability.enabled) {
                    e.preventDefault();
                    // Demand signal for the gated publish flow (#1143/#1196).
                    void recordProductAnalytics(
                      token,
                      "remix.studio_action_unavailable",
                      {
                        source: "remix_studio",
                        subjectType: "remix_project",
                        subjectId: project.id,
                        payload: {
                          projectId: project.id,
                          action: "publish",
                          reasonCode: publishAvailability.reasonCode,
                        },
                      },
                    );
                    return;
                  }
                  setConfirmPublishOpen(true);
                }}
              >
                {publishing ? "Publishing..." : "Publish on Resonate"}
              </button>
            )}
            {UNAVAILABLE_ACTIONS.map((action) => (
              <button
                key={action.key}
                type="button"
                aria-disabled="true"
                title={action.reason}
                className={`ui-btn ui-btn-ghost opacity-60 cursor-not-allowed remix-action-unavailable remix-action-unavailable--${action.key}`}
                onClick={(e) => {
                  e.preventDefault();
                  // Demand signal for locked workflows (#1143).
                  void recordProductAnalytics(token, "remix.studio_action_unavailable", {
                    source: "remix_studio",
                    subjectType: "remix_project",
                    subjectId: project.id,
                    payload: {
                      projectId: project.id,
                      action: action.key,
                      reasonCode: action.reasonCode,
                    },
                  });
                }}
              >
                {action.label}
                <span className="sr-only"> — {action.reason}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`text-xs ${titleBlank && !saving ? "text-red-400" : "text-zinc-500"}`}
            >
              {saveStatusLabel({ saving, dirty, titleBlank })}
            </span>
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={!dirty || saving || titleBlank || published}
              onClick={() => void handleSave()}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </section>
        {!published && publishAvailability.reason && (
          <p className="text-xs text-zinc-500 remix-publish-reason">
            {publishAvailability.reason}
          </p>
        )}
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
