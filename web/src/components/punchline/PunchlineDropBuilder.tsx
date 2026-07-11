"use client";

import React, { useState } from "react";
import {
  addPunchlineMoment,
  publishPunchlineDrop,
  removePunchlineMoment,
  updatePunchlineDraft,
  updatePunchlineMoment,
  type PunchlineDrop,
  type PunchlineMoment,
  type PunchlineMomentInput,
} from "../../lib/api";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import {
  formatClipDuration,
  formatClipTime,
} from "./PunchlineClipSelector";
import { PunchlineMomentEditor } from "./PunchlineMomentEditor";
import { PunchlinePublishReviewDialog } from "./PunchlinePublishReviewDialog";
import { PunchlineSetBonusEditor } from "./PunchlineSetBonusEditor";
import {
  formatEditionLabel,
  formatPriceCents,
} from "./punchlineDropHelpers";

/** Strip the "API 400: " prefix so server messages read naturally inline. */
function cleanApiError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^API \d+:\s*/, "");
}

type EditorState =
  | { mode: "add" }
  | { mode: "edit"; moment: PunchlineMoment }
  | null;

export interface PunchlineDropBuilderProps {
  token: string;
  drop: PunchlineDrop;
  stemId: string;
  durationSeconds: number;
  minMs: number;
  maxMs: number;
  onDropChange: (drop: PunchlineDrop) => void;
  onExit: () => void;
  addToast: (toast: {
    type: "success" | "error" | "info";
    title: string;
    message?: string;
  }) => void;
}

export function PunchlineDropBuilder({
  token,
  drop,
  stemId,
  durationSeconds,
  minMs,
  maxMs,
  onDropChange,
  onExit,
  addToast,
}: PunchlineDropBuilderProps) {
  const isPublished = drop.status === "published";

  const [title, setTitle] = useState(drop.title ?? "");
  const [description, setDescription] = useState(drop.description ?? "");
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaSaved, setMetaSaved] = useState(false);

  const [editor, setEditor] = useState<EditorState>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  const [pendingRemove, setPendingRemove] = useState<PunchlineMoment | null>(
    null,
  );

  const [reviewOpen, setReviewOpen] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const metaDirty =
    (title.trim() || null) !== (drop.title ?? null) ||
    (description.trim() || null) !== (drop.description ?? null);

  const saveMeta = async () => {
    setMetaSaving(true);
    setMetaSaved(false);
    try {
      const updated = await updatePunchlineDraft(
        drop.id,
        { title: title.trim() || null, description: description.trim() || null },
        token,
      );
      onDropChange(updated);
      setMetaSaved(true);
    } catch (error) {
      addToast({
        type: "error",
        title: "Couldn’t save",
        message: cleanApiError(error),
      });
    } finally {
      setMetaSaving(false);
    }
  };

  const saveMoment = async (input: PunchlineMomentInput) => {
    setEditorSaving(true);
    setEditorError(null);
    try {
      const updated =
        editor?.mode === "edit"
          ? await updatePunchlineMoment(drop.id, editor.moment.id, input, token)
          : await addPunchlineMoment(drop.id, input, token);
      onDropChange(updated);
      setEditor(null);
      addToast({
        type: "success",
        title: editor?.mode === "edit" ? "Moment updated" : "Moment added",
      });
    } catch (error) {
      setEditorError(cleanApiError(error));
    } finally {
      setEditorSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (!pendingRemove) return;
    try {
      const updated = await removePunchlineMoment(
        drop.id,
        pendingRemove.id,
        token,
      );
      onDropChange(updated);
      addToast({ type: "success", title: "Moment removed" });
    } catch (error) {
      addToast({
        type: "error",
        title: "Couldn’t remove moment",
        message: cleanApiError(error),
      });
    } finally {
      setPendingRemove(null);
    }
  };

  const confirmPublish = async () => {
    setPublishError(null);
    try {
      const published = await publishPunchlineDrop(drop.id, token);
      onDropChange(published);
      setReviewOpen(false);
      addToast({
        type: "success",
        title: "Drop published",
        message: `${published.moments.length} moment${
          published.moments.length === 1 ? "" : "s"
        } are now live.`,
      });
    } catch (error) {
      // Keep the drop a draft and let the artist retry after fixing the cause.
      setPublishError(cleanApiError(error));
      setReviewOpen(false);
      throw error;
    }
  };

  // ---- Published (read-only) summary ---------------------------------------

  if (isPublished) {
    return (
      <div className="punchline-builder">
        <div className="punchline-builder-published-head">
          <div>
            <span className="punchline-status-chip is-published">Published</span>
            <h4>{drop.title || "Punchline Drop"}</h4>
            {drop.publishedAt && (
              <p className="punchline-hint">
                Published{" "}
                {new Date(drop.publishedAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </p>
            )}
          </div>
          <button
            type="button"
            className="punchline-btn-secondary"
            onClick={onExit}
          >
            Done
          </button>
        </div>

        <p className="punchline-rights-summary">
          <span className="punchline-rights-label">{drop.rightsLabel}</span>{" "}
          {drop.rightsSummary}
        </p>

        <ul className="punchline-moment-list">
          {drop.moments.map((moment) => (
            <li key={moment.id} className="punchline-moment-row">
              <div className="punchline-moment-row-main">
                <span className="punchline-moment-row-title">
                  {moment.title}
                </span>
                <span className="punchline-moment-row-lyric">
                  “{moment.lyricText}”
                </span>
              </div>
              <div className="punchline-moment-row-meta">
                <span>
                  {formatClipTime(moment.startMs)} →{" "}
                  {formatClipTime(moment.endMs)} ·{" "}
                  {formatClipDuration(moment.endMs - moment.startMs)}
                </span>
                <span>{formatEditionLabel(moment.editionSize)}</span>
                <span>{formatPriceCents(moment.priceCents)}</span>
                <span className="punchline-moment-row-collected">
                  {moment.collectedCount} collected
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // ---- Draft builder --------------------------------------------------------

  return (
    <div className="punchline-builder">
      <div className="punchline-builder-head">
        <div>
          <span className="punchline-status-chip is-draft">Draft</span>
          <h4>Build your drop</h4>
        </div>
        <button
          type="button"
          className="punchline-btn-secondary"
          onClick={onExit}
          disabled={metaSaving || editorSaving}
        >
          Back
        </button>
      </div>

      <p className="punchline-rights-summary">
        <span className="punchline-rights-label">{drop.rightsLabel}</span>{" "}
        {drop.rightsSummary}
      </p>

      {/* Drop metadata */}
      <div className="punchline-field">
        <label htmlFor="punchline-drop-title">Drop title</label>
        <input
          id="punchline-drop-title"
          type="text"
          value={title}
          maxLength={120}
          placeholder="Name this drop (optional)"
          onChange={(e) => {
            setTitle(e.target.value);
            setMetaSaved(false);
          }}
        />
      </div>
      <div className="punchline-field">
        <label htmlFor="punchline-drop-description">Description</label>
        <textarea
          id="punchline-drop-description"
          value={description}
          rows={2}
          maxLength={2000}
          placeholder="What is this drop about? (optional)"
          onChange={(e) => {
            setDescription(e.target.value);
            setMetaSaved(false);
          }}
        />
      </div>
      <div className="punchline-meta-actions">
        <button
          type="button"
          className="punchline-btn-secondary"
          onClick={saveMeta}
          disabled={metaSaving || !metaDirty}
          aria-disabled={metaSaving || !metaDirty}
        >
          {metaSaving ? "Saving…" : "Save details"}
        </button>
        {metaSaved && !metaDirty && (
          <span className="punchline-meta-saved" role="status">
            Saved
          </span>
        )}
      </div>

      {/* Moment list */}
      <div className="punchline-moments-header">
        <h5>Moments ({drop.moments.length})</h5>
        {!editor && drop.moments.length < 20 && (
          <button
            type="button"
            className="punchline-btn-primary"
            onClick={() => {
              setEditorError(null);
              setEditor({ mode: "add" });
            }}
          >
            Add moment
          </button>
        )}
      </div>

      {drop.moments.length === 0 && !editor && (
        <p className="punchline-hint">
          No moments yet. Add your first collectible moment to get started.
        </p>
      )}

      {drop.moments.length > 0 && (
        <ul className="punchline-moment-list">
          {drop.moments.map((moment) => (
            <li key={moment.id} className="punchline-moment-row">
              <div className="punchline-moment-row-main">
                <span className="punchline-moment-row-title">
                  {moment.title}
                </span>
                <span className="punchline-moment-row-lyric">
                  “{moment.lyricText}”
                </span>
              </div>
              <div className="punchline-moment-row-meta">
                <span>
                  {formatClipTime(moment.startMs)} →{" "}
                  {formatClipTime(moment.endMs)} ·{" "}
                  {formatClipDuration(moment.endMs - moment.startMs)}
                </span>
                <span>{formatEditionLabel(moment.editionSize)}</span>
                <span>{formatPriceCents(moment.priceCents)}</span>
              </div>
              {!editor && (
                <div className="punchline-moment-row-actions">
                  <button
                    type="button"
                    className="punchline-link-btn"
                    onClick={() => {
                      setEditorError(null);
                      setEditor({ mode: "edit", moment });
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="punchline-link-btn is-danger"
                    onClick={() => setPendingRemove(moment)}
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Moment editor */}
      {editor && (
        <PunchlineMomentEditor
          mode={editor.mode}
          stemId={stemId}
          durationSeconds={durationSeconds}
          minMs={minMs}
          maxMs={maxMs}
          rightsLabel={drop.rightsLabel}
          initial={
            editor.mode === "edit"
              ? {
                  title: editor.moment.title,
                  lyricText: editor.moment.lyricText,
                  artworkUrl: editor.moment.artworkUrl,
                  editionSize: editor.moment.editionSize,
                  priceCents: editor.moment.priceCents,
                  startMs: editor.moment.startMs,
                  endMs: editor.moment.endMs,
                }
              : undefined
          }
          saving={editorSaving}
          serverError={editorError}
          onSave={saveMoment}
          onCancel={() => {
            setEditor(null);
            setEditorError(null);
          }}
          onPreviewError={(message) =>
            addToast({ type: "error", title: "Preview failed", message })
          }
        />
      )}

      {/* Set bonus (#488) — draft-only, hidden while the moment editor is open */}
      {!editor && (
        <PunchlineSetBonusEditor
          token={token}
          drop={drop}
          stemId={stemId}
          durationSeconds={durationSeconds}
          minMs={minMs}
          maxMs={maxMs}
          onDropChange={onDropChange}
          addToast={addToast}
        />
      )}

      {/* Publish */}
      {!editor && (
        <div className="punchline-publish-row">
          <button
            type="button"
            className="punchline-btn-publish"
            onClick={() => {
              setPublishError(null);
              setReviewOpen(true);
            }}
            disabled={drop.moments.length === 0}
            aria-disabled={drop.moments.length === 0}
          >
            Publish drop
          </button>
          {drop.moments.length === 0 && (
            <span className="punchline-field-hint">
              Add at least one moment to publish.
            </span>
          )}
          {publishError && (
            <p className="punchline-error" role="alert">
              {publishError}
            </p>
          )}
        </div>
      )}

      <PunchlinePublishReviewDialog
        isOpen={reviewOpen}
        drop={drop}
        onConfirm={confirmPublish}
        onCancel={() => setReviewOpen(false)}
      />

      <ConfirmDialog
        isOpen={pendingRemove !== null}
        title="Remove this moment?"
        message={
          pendingRemove
            ? `“${pendingRemove.title}” will be removed from this drop. You can add it again later.`
            : ""
        }
        variant="danger"
        confirmLabel="Remove"
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}

export default PunchlineDropBuilder;
