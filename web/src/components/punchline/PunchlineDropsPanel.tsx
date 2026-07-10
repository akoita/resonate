"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  checkPunchlineEligibility,
  type PunchlineEligibility,
  type Track,
} from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import {
  clampClipRange,
  formatClipDuration,
  formatClipTime,
  PunchlineClipSelector,
  type ClipRange,
} from "./PunchlineClipSelector";
import "../../styles/punchline.css";

const VOCALS_STEM_TYPE = "vocals";

type PanelStem = NonNullable<Track["stems"]>[number];

function normalizeStemType(type?: string | null): string {
  return type?.trim().toLowerCase() ?? "";
}

function findVocalsStem(track: Track): PanelStem | undefined {
  return track.stems?.find(
    (stem) => normalizeStemType(stem.type) === VOCALS_STEM_TYPE,
  );
}

/** Tracks with a usable vocal stem are the only ones a drop can be built from. */
export function tracksWithVocalsStem(tracks: Track[]): Track[] {
  return tracks.filter((track) => !!findVocalsStem(track));
}

export interface PunchlineDropsPanelProps {
  releaseId: string;
  tracks: Track[];
}

export function PunchlineDropsPanel({
  releaseId,
  tracks,
}: PunchlineDropsPanelProps) {
  const { token } = useAuth();
  const { addToast } = useToast();

  const vocalsTracks = useMemo(() => tracksWithVocalsStem(tracks), [tracks]);

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(
    vocalsTracks.length === 1 ? vocalsTracks[0].id : null,
  );
  const [eligibility, setEligibility] = useState<PunchlineEligibility | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<ClipRange | null>(null);

  const selectedTrack = useMemo(
    () => vocalsTracks.find((t) => t.id === selectedTrackId) ?? null,
    [vocalsTracks, selectedTrackId],
  );
  const vocalsStem = selectedTrack ? findVocalsStem(selectedTrack) : undefined;
  const durationSeconds = vocalsStem?.durationSeconds ?? null;

  // Keep the auto-selection stable if the track list changes to a single track.
  useEffect(() => {
    if (!selectedTrackId && vocalsTracks.length === 1) {
      setSelectedTrackId(vocalsTracks[0].id);
    }
  }, [vocalsTracks, selectedTrackId]);

  const loadEligibility = useCallback(
    async (trackId: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      setEligibility(null);
      setRange(null);
      try {
        const result = await checkPunchlineEligibility(trackId, token);
        setEligibility(result);
      } catch (err) {
        console.error(err);
        setError(
          "Could not check this track's Punchline eligibility. Please try again.",
        );
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    if (selectedTrackId) {
      loadEligibility(selectedTrackId);
    }
  }, [selectedTrackId, loadEligibility]);

  // Seed a sensible default range once we have both the bounds and a duration.
  useEffect(() => {
    if (!eligibility?.eligible || durationSeconds == null) {
      return;
    }
    const durationMs = Math.round(durationSeconds * 1000);
    const { minMs, maxMs } = eligibility.clipBoundsMs;
    setRange(
      clampClipRange(
        { startMs: 0, endMs: Math.min(maxMs, durationMs) },
        durationMs,
        minMs,
        maxMs,
      ),
    );
  }, [eligibility, durationSeconds, selectedTrackId]);

  if (vocalsTracks.length === 0) {
    return null;
  }

  const bounds = eligibility?.clipBoundsMs;

  return (
    <section
      className="punchline-panel glass-panel"
      data-release-id={releaseId}
    >
      <div className="punchline-panel-header">
        <h3>🎤 Punchline Drops</h3>
        <p>
          Turn your track&apos;s best vocal punchlines into collectible moments.
        </p>
      </div>

      {vocalsTracks.length > 1 && (
        <div className="punchline-track-select">
          <label htmlFor="punchline-track">Track</label>
          <select
            id="punchline-track"
            value={selectedTrackId ?? ""}
            onChange={(e) => setSelectedTrackId(e.target.value || null)}
          >
            <option value="" disabled>
              Choose a track…
            </option>
            {vocalsTracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {!selectedTrackId && (
        <p className="punchline-hint">
          Select a track with a vocal stem to build a Punchline Drop.
        </p>
      )}

      {selectedTrackId && loading && (
        <p className="punchline-hint">Checking eligibility…</p>
      )}

      {selectedTrackId && error && (
        <div className="punchline-error-state">
          <p className="punchline-error">{error}</p>
          <button
            type="button"
            className="punchline-retry-btn"
            onClick={() => loadEligibility(selectedTrackId)}
          >
            Try again
          </button>
        </div>
      )}

      {selectedTrackId &&
        !loading &&
        !error &&
        eligibility &&
        !eligibility.eligible && (
          <div className="punchline-not-eligible">
            <p className="punchline-not-eligible-title">
              This track can&apos;t create a Punchline Drop yet:
            </p>
            <ul className="punchline-reasons">
              {eligibility.reasons.map((reason) => (
                <li key={reason.code}>{reason.message}</li>
              ))}
            </ul>
          </div>
        )}

      {selectedTrackId &&
        !loading &&
        !error &&
        eligibility?.eligible &&
        bounds && (
          <div className="punchline-eligible">
            <p className="punchline-rights-summary">
              <span className="punchline-rights-label">
                {eligibility.rightsLabel}
              </span>{" "}
              {eligibility.rightsSummary}
            </p>

            {durationSeconds == null || durationSeconds <= 0 ? (
              <p className="punchline-hint">
                The vocal stem length isn&apos;t available yet, so a clip range
                can&apos;t be selected. Try again once processing finishes.
              </p>
            ) : vocalsStem && range ? (
              <>
                <PunchlineClipSelector
                  stemId={vocalsStem.id}
                  durationSeconds={durationSeconds}
                  minMs={bounds.minMs}
                  maxMs={bounds.maxMs}
                  value={range}
                  onChange={setRange}
                  onPreviewError={(message) =>
                    addToast({
                      type: "error",
                      title: "Preview failed",
                      message,
                    })
                  }
                />

                <div className="punchline-selection-summary">
                  Selected: {formatClipTime(range.startMs)} →{" "}
                  {formatClipTime(range.endMs)} ·{" "}
                  {formatClipDuration(range.endMs - range.startMs)}
                </div>

                <div className="punchline-next-step">
                  <button
                    type="button"
                    className="punchline-save-moment-btn"
                    aria-disabled="true"
                    disabled
                  >
                    Save as moment
                  </button>
                  <span className="punchline-next-step-hint">
                    Drop builder arrives next (#484) — your clip range selection
                    and preview are live today.
                  </span>
                </div>
              </>
            ) : null}
          </div>
        )}
    </section>
  );
}

export default PunchlineDropsPanel;
