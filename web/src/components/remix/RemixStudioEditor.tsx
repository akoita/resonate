"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import {
  generateRemixDraft,
  updateRemixProject,
  type RemixProject,
  type RemixProjectPatch,
  type RemixProjectSource,
} from "../../lib/api";
import { recordProductAnalytics } from "../../lib/productAnalytics";

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
};

export type ProjectEdits = {
  title: string;
  prompt: string;
  mode: string;
  stems: Record<string, StemEdit>;
};

export function initialEdits(project: RemixProject): ProjectEdits {
  const stems: Record<string, StemEdit> = {};
  for (const stem of project.stems) {
    stems[stem.stemId] = { gainDb: stem.gainDb, muted: stem.muted };
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
  const stemPatches: NonNullable<RemixProjectPatch["stems"]> = [];
  for (const stem of project.stems) {
    const edit = edits.stems[stem.stemId];
    if (!edit) continue;
    const stemPatch: { stemId: string; gainDb?: number | null; muted?: boolean } = {
      stemId: stem.stemId,
    };
    if (edit.gainDb !== stem.gainDb) {
      stemPatch.gainDb = edit.gainDb;
    }
    if (edit.muted !== stem.muted) {
      stemPatch.muted = edit.muted;
    }
    if (stemPatch.gainDb !== undefined || stemPatch.muted !== undefined) {
      stemPatches.push(stemPatch);
    }
  }
  if (stemPatches.length > 0) {
    patch.stems = stemPatches;
  }
  return patch;
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
}): { enabled: boolean; reason: string | null } {
  if (input.mode === "stem_mix") {
    return {
      enabled: false,
      reason:
        "AI generation applies to variation and extension modes. Stem mix uses only your stem settings.",
    };
  }
  if (input.prompt.trim() === "") {
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

/** Toast copy per normalized provider error code (#1162). */
export function generationErrorMessage(code: string, message: string): string {
  switch (code) {
    case "provider_disabled":
      return "AI generation is not enabled on this environment yet.";
    case "provider_rejected":
      return "The provider rejected this prompt. Adjust it and try again.";
    case "invalid_input":
    case "provider_unavailable":
      return message;
    default:
      return "Generation failed. Please try again later.";
  }
}

const UNAVAILABLE_ACTIONS = [
  {
    key: "publish",
    label: "Publish on Resonate",
    // reasonCode is the analytics-safe identifier; reason stays human text.
    reasonCode: "publish_not_available",
    reason:
      "Publishing remixes inside Resonate is not available yet. Drafts stay private to you.",
  },
  {
    key: "export",
    label: "Export audio",
    reasonCode: "export_rights_required",
    reason:
      "Export requires a license that explicitly grants export rights. Your remix license covers private drafts only.",
  },
] as const;

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
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

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
  const rights = describeSourceRights(project.source);
  // Switching back to stem_mix keeps any stored prompt; generation (#896)
  // must ignore prompts when mode is stem_mix.
  const promptEnabled = edits.mode !== "stem_mix";
  const titleBlank = edits.title.trim() === "";

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
    if (!token || generating) return;
    setGenerating(true);
    try {
      // force=true on regenerate: the backend's duplicate-job guard
      // otherwise rejects projects with a recorded generation job.
      const updated = await generateRemixDraft(token, project.id, {
        force: !!project.generationJobId,
      });
      setProject(updated);
      setEdits(initialEdits(updated));
      addToast({
        type: "success",
        title: "Draft generated",
        message: "Your AI remix draft is recorded on this project.",
      });
      void recordProductAnalytics(token, "remix.studio_saved", {
        source: "remix_studio",
        subjectType: "remix_project",
        subjectId: updated.id,
        payload: { projectId: updated.id, mode: updated.mode },
      });
    } catch (error) {
      // apiRequest throws Error("API <status>: <json>") — recover the
      // normalized provider error contract when present.
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

  const handleSave = async () => {
    if (!token || !dirty || saving) return;
    setSaving(true);
    try {
      const updated = await updateRemixProject(token, project.id, patch);
      setProject(updated);
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
              disabled={saving}
              onChange={(e) =>
                setEdits((prev) => ({ ...prev, title: e.target.value }))
              }
            />
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30">
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
        {/* Stem controls */}
        <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold text-white">Stems</h2>
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
            Mute and gain are saved with your draft. Solo is a preview-only
            control and is not saved.
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
                    <div className="text-xs text-zinc-500">
                      {stem.type}
                      {soloedOut ? " · muted by solo (preview)" : ""}
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
        </section>

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
                  {project.generationJobId
                    ? `AI draft recorded — job ${project.generationJobId} (${project.generationProvider ?? "unknown provider"}). Playback arrives with audio preview.`
                    : "No AI draft yet. Write a prompt in variation or extension mode and generate one."}
                </p>
              </div>
            </div>
            {(() => {
              const availability = describeGenerateAvailability({
                mode: edits.mode,
                prompt: edits.prompt,
                saving,
                dirty,
                generating,
              });
              return (
                <div className="text-right">
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary remix-generate-btn"
                    aria-disabled={!availability.enabled || undefined}
                    title={availability.reason ?? undefined}
                    onClick={(e) => {
                      if (!availability.enabled) {
                        e.preventDefault();
                        return;
                      }
                      void handleGenerate();
                    }}
                  >
                    {generating
                      ? "Generating..."
                      : project.generationJobId
                        ? "Regenerate draft"
                        : "Generate AI draft"}
                  </button>
                  {availability.reason && (
                    <p className="text-xs text-zinc-500 mt-2 max-w-[16rem]">
                      {availability.reason}
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        </section>

        {/* Save + unavailable actions */}
        <section className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
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
              disabled={!dirty || saving || titleBlank}
              onClick={() => void handleSave()}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
