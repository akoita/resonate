"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";
import {
  WRITER_ROLE_LABELS,
  copyCompositionToRelease,
  draftFromComposition,
  formatIswc,
  formatWriterCredits,
  getReleaseComposition,
  hasCompositionErrors,
  saveTrackComposition,
  toCompositionInput,
  validateCompositionDraft,
  type Composition,
  type CompositionDraft,
  type CompositionDraftErrors,
  type ReleaseComposition,
} from "../../lib/composition";
import { CompositionEditor } from "./CompositionEditor";
import "../../styles/composition.css";

type FullTrack = Extract<ReleaseComposition, { access: "full" }>["tracks"][number];

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Something went wrong. Please try again.";
}

/**
 * #2669: the "Composition" section of a release page. The artist (and a
 * manager with track-metadata access) edits each track's writers, publisher,
 * work code and cover/samples declaration and can copy one track's details to
 * the rest; operators read them in full; everyone else sees writer names and
 * roles. Renders nothing for a visitor when no writers are listed.
 */
export function ReleaseCompositionSection({ releaseId }: { releaseId: string }) {
  const { token, sessionChecked } = useAuth();
  const { addToast } = useToast();
  const [data, setData] = useState<ReleaseComposition | null>(null);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CompositionDraft | null>(null);
  const [errors, setErrors] = useState<CompositionDraftErrors>({});
  const [saving, setSaving] = useState(false);
  const [copySourceId, setCopySourceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getReleaseComposition(releaseId, token));
    } catch {
      setData(null);
    }
  }, [releaseId, token]);

  useEffect(() => {
    if (!sessionChecked) return;
    void load();
  }, [load, sessionChecked]);

  if (!data) return null;

  if (data.access === "public") {
    const credited = data.tracks.filter((track) => track.writers.length > 0);
    if (credited.length === 0) return null;
    return (
      <section className="composition-section glass-panel" aria-labelledby="composition-title">
        <h2 id="composition-title">Songwriting</h2>
        <ul className="composition-section__credits">
          {credited.map((track) => (
            <li key={track.trackId}>
              <span className="composition-section__track">{track.title}</span>
              <span>Written by {formatWriterCredits(track.writers)}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const startEdit = (track: FullTrack) => {
    setEditingTrackId(track.trackId);
    setDraft(draftFromComposition(track.composition));
    setErrors({});
  };

  const cancelEdit = () => {
    setEditingTrackId(null);
    setDraft(null);
    setErrors({});
  };

  const save = async () => {
    if (!token || !draft || !editingTrackId || saving) return;
    const found = validateCompositionDraft(draft);
    setErrors(found);
    if (hasCompositionErrors(found)) return;
    setSaving(true);
    try {
      await saveTrackComposition(releaseId, editingTrackId, token, toCompositionInput(draft));
      addToast({ type: "success", title: "Composition saved", message: "The details are stored with this track." });
      cancelEdit();
      await load();
    } catch (error) {
      addToast({ type: "error", title: "Not saved", message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!token || !copySourceId) return;
    const source = copySourceId;
    setCopySourceId(null);
    try {
      const result = await copyCompositionToRelease(releaseId, source, token);
      addToast({
        type: "success",
        title: "Copied",
        message: `Copied to ${result.copiedTo} other ${result.copiedTo === 1 ? "track" : "tracks"}. Add each track's own work code.`,
      });
      await load();
    } catch (error) {
      addToast({ type: "error", title: "Not copied", message: errorMessage(error) });
    }
  };

  const multiTrack = data.tracks.length > 1;

  return (
    <section className="composition-section glass-panel" aria-labelledby="composition-title">
      <h2 id="composition-title">Composition</h2>
      <p className="composition-section__intro">
        {data.canEdit
          ? "Who wrote each song, who publishes it and its work code. Listeners see writer names and roles only. This is what a usage report to a collecting society needs."
          : "The composition details the artist entered. Listeners see writer names and roles only."}
      </p>
      <ol className="composition-section__tracks">
        {data.tracks.map((track) => (
          <li key={track.trackId} className="composition-section__item">
            <div className="composition-section__head">
              <span className="composition-section__track">
                {track.position}. {track.title}
              </span>
              {data.canEdit && editingTrackId !== track.trackId && (
                <span className="composition-section__actions">
                  <button type="button" className="ui-btn ui-btn-ghost" onClick={() => startEdit(track)}>
                    {track.composition ? "Edit" : "Add details"}
                  </button>
                  {multiTrack && track.composition && (
                    <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setCopySourceId(track.trackId)}>
                      Copy to all tracks
                    </button>
                  )}
                </span>
              )}
            </div>
            {editingTrackId === track.trackId && draft ? (
              <div className="composition-section__editor">
                <CompositionEditor
                  idPrefix={`composition-${track.trackId}`}
                  value={draft}
                  errors={errors}
                  onChange={setDraft}
                  disabled={saving}
                />
                <div className="composition-section__buttons">
                  <button type="button" className="ui-btn ui-btn-primary" onClick={() => void save()} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button type="button" className="ui-btn ui-btn-ghost" onClick={cancelEdit} disabled={saving}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <CompositionSummary composition={track.composition} />
            )}
          </li>
        ))}
      </ol>
      <ConfirmDialog
        isOpen={copySourceId !== null}
        title="Copy to all tracks?"
        message="The writers, publisher and cover or samples declaration of this track replace those of every other track on the release. Work codes are not copied, because each song has its own."
        confirmLabel="Copy"
        variant="warning"
        onConfirm={() => void copy()}
        onCancel={() => setCopySourceId(null)}
      />
    </section>
  );
}

export function CompositionSummary({ composition }: { composition: Composition | null }) {
  if (!composition) return <p className="composition-section__empty">No composition details yet.</p>;
  return (
    <dl className="composition-section__summary">
      {composition.writers.length > 0 && (
        <>
          <dt>Writers</dt>
          <dd>
            <ul>
              {composition.writers.map((writer, index) => (
                <li key={index}>
                  {writer.name} ({WRITER_ROLE_LABELS[writer.role].toLowerCase()}
                  {writer.share !== undefined ? `, ${writer.share}%` : ""}
                  {writer.society ? `, ${writer.society === "none" ? "no society" : writer.society}` : ""}
                  {writer.ipi ? `, IPI ${writer.ipi}` : ""})
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}
      {(composition.selfPublished || composition.publisher) && (
        <>
          <dt>Publisher</dt>
          <dd>{composition.selfPublished ? "Self-published" : composition.publisher}</dd>
        </>
      )}
      {composition.iswc && (
        <>
          <dt>Work code</dt>
          <dd>{formatIswc(composition.iswc)}</dd>
        </>
      )}
      {composition.coverOrSamples && (
        <>
          <dt>Cover or samples</dt>
          <dd>{composition.coverNote || "Yes"}</dd>
        </>
      )}
    </dl>
  );
}
