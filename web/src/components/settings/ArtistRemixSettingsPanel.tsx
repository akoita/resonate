"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getArtistMe,
  getArtistSettings,
  updateArtistSettings,
  type ArtistProfile,
  type ArtistRemixConsent,
  type ArtistSettingsResponse,
} from "../../lib/api";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { Button } from "../ui/Button";

type ToastFn = (toast: { type: "success" | "error" | "info" | "warning"; title: string; message: string }) => void;

type Props = {
  token: string | null | undefined;
  addToast: ToastFn;
};

export default function ArtistRemixSettingsPanel({ token, addToast }: Props) {
  const [artist, setArtist] = useState<ArtistProfile | null>(null);
  const [settings, setSettings] = useState<ArtistSettingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      const profile = await getArtistMe(token);
      setArtist(profile);
      if (!profile) {
        setSettings(null);
        return;
      }
      setSettings(await getArtistSettings(token, profile.id));
    } catch {
      setLoadError("Could not load your artist remix consent setting.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token changes are the reload boundary.
  }, [token]);

  const updateConsent = async (next: ArtistRemixConsent) => {
    if (!token || !artist || !settings || settings.remixConsent === next) return;
    const previous = settings;
    setSaving(true);
    setSettings({ ...settings, remixConsent: next });
    try {
      const updated = await updateArtistSettings(token, artist.id, { remixConsent: next });
      setSettings(updated);
      void recordProductAnalytics(token, "settings.updated", {
        source: "settings",
        subjectType: "artist_settings",
        subjectId: artist.id,
        payload: {
          surface: "artist_remix",
          setting: "remixConsent",
          remixConsent: next,
        },
      });
      addToast({
        type: "success",
        title: "Remix consent updated",
        message:
          next === "disabled"
            ? "New remix projects and draft generation are blocked while this is disabled."
            : "Eligible remixable stems can be used for new remix projects again.",
      });
    } catch {
      setSettings(previous);
      addToast({
        type: "error",
        title: "Setting not saved",
        message: "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const isAllowed = settings?.remixConsent !== "disabled";

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <h3 className="settings-section-title">Artist Remix Consent</h3>
          <p className="home-subtitle">
            Govern whether your remixable stems can start new Remix Studio work.
          </p>
        </div>
        <Button variant="ghost" onClick={load} disabled={loading || !token}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {!artist && !loading ? (
        <div className="artist-remix-empty">
          <strong>No artist profile connected</strong>
          <p>Create an artist profile before managing Remix Studio consent.</p>
          <Link href="/artist/upload">Open artist upload</Link>
        </div>
      ) : (
        <div className="artist-remix-consent-grid">
          <label className="artist-remix-consent-card">
            <input
              type="checkbox"
              checked={isAllowed}
              disabled={!settings || saving}
              onChange={(event) => updateConsent(event.target.checked ? "allowed" : "disabled")}
            />
            <span>
              <strong>{isAllowed ? "Remix access allowed" : "Remix access disabled"}</strong>
              <small>
                {isAllowed
                  ? "Remixable stems remain eligible for new projects and draft generation."
                  : "New remix projects and draft generation are denied by server policy."}
              </small>
            </span>
          </label>

          <div className="artist-remix-policy-note">
            <strong>Policy effect</strong>
            <p>
              Per-stem remixable mints are still required. This global setting only revokes access
              for your catalog while disabled.
            </p>
            <p>
              Existing private drafts are not deleted and remain editable, but generation re-checks
              eligibility and is blocked while remix access is disabled.
            </p>
            {settings?.updatedAt ? <small>Last updated {new Date(settings.updatedAt).toLocaleString()}</small> : null}
          </div>
        </div>
      )}

      {loadError ? <p className="artist-remix-error">{loadError}</p> : null}
    </div>
  );
}
