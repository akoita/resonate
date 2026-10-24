"use client";

import React, { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import {
  OFFICIAL_STEM_TYPES,
  getOfficialStemFileValidationError,
  uploadOfficialStems,
  type OfficialStemType,
} from "../../lib/api";
import { StemSourceBadge } from "../stem/StemSourceBadge";
import "../../styles/stem-pricing.css";

interface OfficialStemsPanelProps {
  releaseId: string;
  releaseStatus?: string | null;
  tracks: Array<{
    trackId: string;
    trackTitle: string;
    /** Stem types that already have a current official stem. */
    officialTypes: string[];
  }>;
}

/**
 * Owner-only: upload the artist's own lossless parts for a published track
 * (#1976, ADR-TE-7). Official stems are checked against the published mix and
 * sold as "Official", next to the "Separated (AI)" stems Resonate makes itself.
 */
export function OfficialStemsPanel({ releaseId, releaseStatus, tracks }: OfficialStemsPanelProps) {
  const { token } = useAuth();
  const { addToast } = useToast();
  const [openTrackId, setOpenTrackId] = useState<string | null>(null);
  const [files, setFiles] = useState<Partial<Record<OfficialStemType, File>>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Record<string, string[]>>({});

  if (releaseStatus && releaseStatus !== "ready" && releaseStatus !== "published") return null;
  if (tracks.length === 0) return null;

  const choose = (type: OfficialStemType, file: File | undefined) => {
    setError(null);
    if (file) {
      const problem = getOfficialStemFileValidationError(file);
      if (problem) {
        setError(problem);
        return;
      }
    }
    setFiles((current) => {
      const next = { ...current };
      if (file) next[type] = file;
      else delete next[type];
      return next;
    });
  };

  const submit = async (trackId: string) => {
    if (!token) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadOfficialStems(token, releaseId, trackId, files);
      setUploaded((current) => ({ ...current, [trackId]: result.stems.map((stem) => stem.type) }));
      setFiles({});
      setOpenTrackId(null);
      addToast({
        type: "success",
        title: "Official stems added",
        message: result.replaced > 0
          ? "They replace your earlier official stems for this track."
          : "Buyers now see them as Official, in lossless quality.",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The stems could not be uploaded.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="official-stems-panel" data-testid="official-stems-panel" aria-labelledby="official-stems-title">
      <h3 id="official-stems-title">Official stems</h3>
      <p className="official-stems-panel__intro">
        Upload your own lossless parts (WAV or FLAC), exported from the same start point as the published mix. Buyers
        see them as <StemSourceBadge source="official" /> and receive the lossless file. You price them separately from
        the <StemSourceBadge source="separated" /> stems below, and Resonate sets no minimum price.
      </p>
      {tracks.map((track) => {
        const have = uploaded[track.trackId] ?? track.officialTypes;
        const isOpen = openTrackId === track.trackId;
        return (
          <div key={track.trackId} className="official-stems-panel__track">
            <div className="official-stems-panel__track-head">
              <strong>{track.trackTitle}</strong>
              <span>{have.length > 0 ? `Official: ${[...new Set(have)].join(", ")}` : "No official stems yet"}</span>
              <button
                type="button"
                onClick={() => {
                  setFiles({});
                  setError(null);
                  setOpenTrackId(isOpen ? null : track.trackId);
                }}
              >
                {isOpen ? "Cancel" : have.length > 0 ? "Replace official stems" : "Upload official stems"}
              </button>
            </div>
            {isOpen && (
              <div className="official-stems-panel__form">
                {OFFICIAL_STEM_TYPES.map((type) => (
                  <label key={type}>
                    <span>{type[0].toUpperCase() + type.slice(1)}</span>
                    <input
                      type="file"
                      accept=".wav,.flac,audio/wav,audio/flac"
                      onChange={(event) => choose(type, event.target.files?.[0])}
                    />
                  </label>
                ))}
                <p className="official-stems-panel__hint">
                  Upload the full set: added together, the stems must sound like the published mix. A new upload
                  replaces your earlier official stems for this track.
                </p>
                {error && <p role="alert" className="official-stems-panel__error">{error}</p>}
                <button
                  type="button"
                  disabled={uploading || Object.keys(files).length === 0}
                  onClick={() => void submit(track.trackId)}
                >
                  {uploading ? "Checking and uploading…" : "Upload"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
