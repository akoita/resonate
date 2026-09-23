"use client";

import { useState } from "react";
import type { ArtistEnrichmentField, ArtistProfile } from "../../lib/api";
import { updateArtistProfile } from "../../lib/api";
import {
  ARTIST_SOCIAL_LINK_FIELDS,
  ARTIST_SOCIAL_LINK_LABELS,
  artistProfileFormStateFromProfile,
  buildArtistProfileUpdatePayload,
  type ArtistProfileFormState,
} from "../../lib/artistProfileForm";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { ArtistEnrichmentPanel } from "./ArtistEnrichmentPanel";

type EditableField = keyof ArtistProfileFormState;

/**
 * Label row for an edit-form field. The "Suggested" marker sits outside the
 * <label> so the field's accessible name stays exactly its label ("Bio"), and
 * is linked to the control through aria-describedby instead.
 */
function FieldLabel({ htmlFor, label, suggested }: { htmlFor: string; label: string; suggested: boolean }) {
  return (
    <div className="artist-profile-edit-label-row">
      <label htmlFor={htmlFor}>{label}</label>
      {suggested && (
        <span id={`${htmlFor}-suggested`} className="artist-profile-edit-suggested-pill">
          Suggested
        </span>
      )}
    </div>
  );
}

type ArtistProfileEditorProps = {
  artist: ArtistProfile;
  isOwner: boolean;
  onSaved: (updated: ArtistProfile) => void;
};

/**
 * Owner-only "Edit profile" affordance for `/artist/[id]` (#1419). Renders
 * nothing at all when the signed-in user doesn't own this artist profile.
 */
export function ArtistProfileEditor({ artist, isOwner, onSaved }: ArtistProfileEditorProps) {
  const { token } = useAuth();
  const { addToast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ArtistProfileFormState>(() =>
    artistProfileFormStateFromProfile(artist),
  );
  // Fields most recently filled from profile suggestions; cleared as the
  // manager edits them, and on open/cancel/save.
  const [suggested, setSuggested] = useState<ReadonlySet<EditableField>>(() => new Set());

  if (!isOwner) return null;

  const startEditing = () => {
    setForm(artistProfileFormStateFromProfile(artist));
    setSuggested(new Set());
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setSuggested(new Set());
    setIsEditing(false);
  };

  const updateField = (field: EditableField, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (suggested.has(field)) {
      setSuggested((prev) => {
        const next = new Set(prev);
        next.delete(field);
        return next;
      });
    }
  };

  const applySuggestions = (next: ArtistProfileFormState, appliedFields: ArtistEnrichmentField[]) => {
    setForm(next);
    setSuggested((prev) => new Set([...prev, ...appliedFields]));
  };

  const fieldClass = (field: EditableField) =>
    suggested.has(field) ? "artist-profile-edit-field is-suggested" : "artist-profile-edit-field";

  const describedBy = (field: EditableField, id: string) =>
    suggested.has(field) ? `${id}-suggested` : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    const payload = buildArtistProfileUpdatePayload(form);
    if (!payload.ok) {
      addToast({ type: "error", title: "Check your links", message: payload.error });
      return;
    }

    setSaving(true);
    try {
      const updated = await updateArtistProfile(token, artist.id, payload.body);
      onSaved(updated);
      setSuggested(new Set());
      setIsEditing(false);
      addToast({
        type: "success",
        title: "Profile updated",
        message: "Your artist profile has been saved.",
      });
    } catch (err) {
      addToast({
        type: "error",
        title: "Failed to save profile",
        message: err instanceof Error ? err.message : "Something went wrong. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!isEditing) {
    return (
      <div className="artist-profile-editor">
        <Button
          type="button"
          variant="ghost"
          className="artist-edit-profile-btn"
          onClick={startEditing}
        >
          Edit profile
        </Button>
      </div>
    );
  }

  return (
    <form
      className="artist-profile-edit-form"
      aria-label="Edit artist profile"
      onSubmit={handleSubmit}
    >
      {token && (
        <ArtistEnrichmentPanel
          artistId={artist.id}
          token={token}
          form={form}
          onApply={applySuggestions}
        />
      )}

      <div className={fieldClass("imageUrl")}>
        <FieldLabel htmlFor="artist-edit-imageUrl" label="Image URL" suggested={suggested.has("imageUrl")} />
        <Input
          id="artist-edit-imageUrl"
          aria-describedby={describedBy("imageUrl", "artist-edit-imageUrl")}
          value={form.imageUrl}
          onChange={(e) => updateField("imageUrl", e.target.value)}
          placeholder="https://..."
          maxLength={2048}
        />
      </div>

      <div className={fieldClass("summary")}>
        <FieldLabel htmlFor="artist-edit-summary" label="Bio" suggested={suggested.has("summary")} />
        <textarea
          id="artist-edit-summary"
          aria-describedby={describedBy("summary", "artist-edit-summary")}
          className="ui-input artist-profile-edit-textarea"
          value={form.summary}
          onChange={(e) => updateField("summary", e.target.value)}
          maxLength={2000}
          rows={4}
        />
      </div>

      <div className={fieldClass("website")}>
        <FieldLabel htmlFor="artist-edit-website" label="Website" suggested={suggested.has("website")} />
        <Input
          id="artist-edit-website"
          aria-describedby={describedBy("website", "artist-edit-website")}
          value={form.website}
          onChange={(e) => updateField("website", e.target.value)}
          placeholder="https://..."
          maxLength={2048}
        />
      </div>

      <div className="artist-profile-edit-socials">
        {ARTIST_SOCIAL_LINK_FIELDS.map((field) => (
          <div className={fieldClass(field)} key={field}>
            <FieldLabel
              htmlFor={`artist-edit-social-${field}`}
              label={ARTIST_SOCIAL_LINK_LABELS[field]}
              suggested={suggested.has(field)}
            />
            <Input
              id={`artist-edit-social-${field}`}
              aria-describedby={describedBy(field, `artist-edit-social-${field}`)}
              value={form[field]}
              onChange={(e) => updateField(field, e.target.value)}
              placeholder="https://..."
              maxLength={2048}
            />
          </div>
        ))}
      </div>

      <div className="artist-profile-edit-actions">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={cancelEditing}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
