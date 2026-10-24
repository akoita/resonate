"use client";

import { useId, useState, type CSSProperties } from "react";
import type { TrackDescriptor, TrackDescriptorVocabulary } from "../../lib/api";
import { TrackDescriptorTags, trackDescriptorSoundLabels } from "./TrackDescriptorTags";

/** Mirrors the backend limit (`MAX_SUB_GENRES`). */
export const MAX_DESCRIPTOR_SUB_GENRES = 8;

export type DescriptorDraft = { families: string[]; subGenres: string[] };

export function draftFromDescriptor(descriptor?: TrackDescriptor | null): DescriptorDraft {
  return {
    families: [...(descriptor?.families ?? [])].sort(),
    subGenres: [...(descriptor?.subGenres ?? [])].sort(),
  };
}

/** Adds the family when absent, removes it when present. Sorted. */
export function toggleFamily(families: string[], id: string): string[] {
  return (families.includes(id) ? families.filter((f) => f !== id) : [...families, id]).sort();
}

export function removeSubGenre(subGenres: string[], label: string): string[] {
  return subGenres.filter((s) => s !== label);
}

export type AddSubGenreResult = { subGenres: string[]; error: string | null };

/**
 * Adds a typed sub-genre. Only labels of the vocabulary are accepted (the
 * server enforces the same rule), at most `MAX_DESCRIPTOR_SUB_GENRES`.
 */
export function addSubGenre(
  subGenres: string[],
  typed: string,
  vocabulary: readonly string[],
): AddSubGenreResult {
  const label = typed.trim().replace(/\s+/g, " ").toLowerCase();
  if (!label) return { subGenres, error: "Type a style, then choose it from the suggestions." };
  if (subGenres.includes(label)) return { subGenres, error: "That style is already on the track." };
  if (!vocabulary.includes(label)) {
    return { subGenres, error: "Choose a style from the suggestions. Other styles cannot be added." };
  }
  if (subGenres.length >= MAX_DESCRIPTOR_SUB_GENRES) {
    return { subGenres, error: `A track can have at most ${MAX_DESCRIPTOR_SUB_GENRES} styles.` };
  }
  return { subGenres: [...subGenres, label].sort(), error: null };
}

export function descriptorDraftChanged(initial: DescriptorDraft, draft: DescriptorDraft): boolean {
  return (
    initial.families.join("|") !== [...draft.families].sort().join("|") ||
    initial.subGenres.join("|") !== [...draft.subGenres].sort().join("|")
  );
}

const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "1px 8px",
  borderRadius: 12,
  fontSize: 11,
  color: "#d4d4d8",
  background: "rgba(255, 255, 255, 0.06)",
  border: "1px solid rgba(255, 255, 255, 0.12)",
};

const noteStyle: CSSProperties = { margin: "3px 0 0", fontSize: 11, color: "#a1a1aa" };

export type TrackDescriptorEditFormProps = {
  trackTitle: string;
  descriptor?: TrackDescriptor | null;
  vocabulary: TrackDescriptorVocabulary;
  saving?: boolean;
  /** A failure from the last save, shown in the form. */
  error?: string | null;
  onSave: (draft: DescriptorDraft) => void;
  onCancel: () => void;
};

/**
 * The correction form (#2292): family checkboxes and sub-genre chips taken
 * from the vocabulary. Tempo, energy and vocals are shown but cannot be
 * changed. Save is enabled only when something changed.
 */
export function TrackDescriptorEditForm({
  trackTitle,
  descriptor,
  vocabulary,
  saving = false,
  error = null,
  onSave,
  onCancel,
}: TrackDescriptorEditFormProps) {
  const listId = useId();
  const initial = draftFromDescriptor(descriptor);
  const [draft, setDraft] = useState<DescriptorDraft>(initial);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState<string | null>(null);
  const sound = trackDescriptorSoundLabels(descriptor);
  const changed = descriptorDraftChanged(initial, draft);
  const atLimit = draft.subGenres.length >= MAX_DESCRIPTOR_SUB_GENRES;

  const add = () => {
    const result = addSubGenre(draft.subGenres, typed, vocabulary.subGenres);
    setTypedError(result.error);
    if (!result.error) {
      setDraft({ ...draft, subGenres: result.subGenres });
      setTyped("");
    }
  };

  return (
    <div
      className="track-descriptor-editor"
      role="group"
      aria-label={`Edit tags for ${trackTitle}`}
      data-testid="track-descriptor-editor"
      style={{ marginTop: 6, display: "grid", gap: 8 }}
      onClick={(event) => event.stopPropagation()}
    >
      <fieldset style={{ border: 0, margin: 0, padding: 0 }} disabled={saving}>
        <legend style={{ fontSize: 12, color: "#e4e4e7", padding: 0 }}>Genre families</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 4 }}>
          {vocabulary.families.map((family) => (
            <label key={family.id} style={{ fontSize: 12, display: "inline-flex", gap: 4, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={draft.families.includes(family.id)}
                onChange={() => setDraft({ ...draft, families: toggleFamily(draft.families, family.id) })}
              />
              {family.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset style={{ border: 0, margin: 0, padding: 0 }} disabled={saving}>
        <legend style={{ fontSize: 12, color: "#e4e4e7", padding: 0 }}>Styles</legend>
        <ul
          aria-label="Selected styles"
          style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "4px 0", padding: 0, listStyle: "none" }}
        >
          {draft.subGenres.length === 0 && <li style={{ fontSize: 11, color: "#a1a1aa" }}>No styles</li>}
          {draft.subGenres.map((label) => (
            <li key={label} style={chipStyle}>
              {label}
              <button
                type="button"
                aria-label={`Remove style ${label}`}
                onClick={() => setDraft({ ...draft, subGenres: removeSubGenre(draft.subGenres, label) })}
                style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", padding: 0 }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            aria-label="Add a style"
            list={listId}
            value={typed}
            maxLength={40}
            disabled={atLimit}
            placeholder={atLimit ? `Up to ${MAX_DESCRIPTOR_SUB_GENRES} styles` : "Start typing a style"}
            onChange={(event) => { setTyped(event.target.value); setTypedError(null); }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <datalist id={listId}>
            {vocabulary.subGenres.filter((label) => !draft.subGenres.includes(label)).map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
          <button type="button" onClick={add} disabled={atLimit || typed.trim() === ""}>Add style</button>
        </div>
        {typedError && <p role="alert" style={{ ...noteStyle, color: "#f87171" }}>{typedError}</p>}
      </fieldset>

      {sound.length > 0 && (
        <div>
          <ul
            aria-label="Measured sound"
            style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: 0, padding: 0, listStyle: "none" }}
          >
            {sound.map((label) => <li key={label} style={chipStyle}>{label}</li>)}
          </ul>
          <p style={noteStyle}>Tempo, energy and vocals are measured from the audio and cannot be edited.</p>
        </div>
      )}

      {error && <p role="alert" style={{ ...noteStyle, color: "#f87171" }}>{error}</p>}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" disabled={saving || !changed} onClick={() => onSave(draft)}>
          {saving ? "Saving..." : "Save tags"}
        </button>
        <button type="button" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
      <p style={noteStyle}>Your changes replace Resonate&apos;s suggestions and are kept when your track is tagged again.</p>
    </div>
  );
}

export type TrackDescriptorEditorProps = {
  trackTitle: string;
  descriptor?: TrackDescriptor | null;
  /** Owner or a manager with track-metadata rights. Everyone else sees the tags read-only. */
  canEdit: boolean;
  /** `null` until loaded: no edit control is shown without it. */
  vocabulary: TrackDescriptorVocabulary | null;
  /** Saves the draft; rejects with an Error whose message is shown to the artist. */
  onSave: (draft: DescriptorDraft) => Promise<void>;
};

/**
 * A track's tags in the release editor (#2240, #2292): read-only chips, plus an
 * "Edit tags" control for the people allowed to correct them.
 */
export function TrackDescriptorEditor({ trackTitle, descriptor, canEdit, vocabulary, onSave }: TrackDescriptorEditorProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit || !vocabulary) return <TrackDescriptorTags descriptor={descriptor} />;

  if (editing) {
    return (
      <TrackDescriptorEditForm
        trackTitle={trackTitle}
        descriptor={descriptor}
        vocabulary={vocabulary}
        saving={saving}
        error={error}
        onCancel={() => { setEditing(false); setError(null); }}
        onSave={async (draft) => {
          setSaving(true);
          setError(null);
          try {
            await onSave(draft);
            setEditing(false);
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Could not save the tags. Please try again.");
          } finally {
            setSaving(false);
          }
        }}
      />
    );
  }

  return (
    <>
      <TrackDescriptorTags descriptor={descriptor} />
      <button
        type="button"
        aria-label={`${descriptor ? "Edit" : "Add"} tags for ${trackTitle}`}
        style={{ marginTop: 4, fontSize: 11 }}
        onClick={(event) => { event.stopPropagation(); setEditing(true); }}
      >
        {descriptor ? "Edit tags" : "Add tags"}
      </button>
    </>
  );
}
