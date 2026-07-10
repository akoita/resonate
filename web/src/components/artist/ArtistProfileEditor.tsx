"use client";

import { useState } from "react";
import type { ArtistProfile } from "../../lib/api";
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

  if (!isOwner) return null;

  const startEditing = () => {
    setForm(artistProfileFormStateFromProfile(artist));
    setIsEditing(true);
  };

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
      <div className="artist-profile-edit-field">
        <label htmlFor="artist-edit-imageUrl">Image URL</label>
        <Input
          id="artist-edit-imageUrl"
          value={form.imageUrl}
          onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
          placeholder="https://..."
          maxLength={2048}
        />
      </div>

      <div className="artist-profile-edit-field">
        <label htmlFor="artist-edit-summary">Bio</label>
        <textarea
          id="artist-edit-summary"
          className="ui-input artist-profile-edit-textarea"
          value={form.summary}
          onChange={(e) => setForm({ ...form, summary: e.target.value })}
          maxLength={2000}
          rows={4}
        />
      </div>

      <div className="artist-profile-edit-field">
        <label htmlFor="artist-edit-website">Website</label>
        <Input
          id="artist-edit-website"
          value={form.website}
          onChange={(e) => setForm({ ...form, website: e.target.value })}
          placeholder="https://..."
          maxLength={2048}
        />
      </div>

      <div className="artist-profile-edit-socials">
        {ARTIST_SOCIAL_LINK_FIELDS.map((field) => (
          <div className="artist-profile-edit-field" key={field}>
            <label htmlFor={`artist-edit-social-${field}`}>{ARTIST_SOCIAL_LINK_LABELS[field]}</label>
            <Input
              id={`artist-edit-social-${field}`}
              value={form[field]}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
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
          onClick={() => setIsEditing(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
