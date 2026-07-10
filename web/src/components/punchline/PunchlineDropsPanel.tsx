"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  checkPunchlineEligibility,
  createPunchlineDraft,
  listMyPunchlineTrackDrops,
  type PunchlineDrop,
  type PunchlineEligibility,
  type Track,
} from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import { PunchlineDropBuilder } from "./PunchlineDropBuilder";
import {
  newestDraft,
  publishedDrops,
  selectPunchlineView,
} from "./punchlineDropHelpers";
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

  const [myDrops, setMyDrops] = useState<PunchlineDrop[]>([]);
  const [activeDraft, setActiveDraft] = useState<PunchlineDrop | null>(null);
  const [creating, setCreating] = useState(false);

  const selectedTrack = useMemo(
    () => vocalsTracks.find((t) => t.id === selectedTrackId) ?? null,
    [vocalsTracks, selectedTrackId],
  );
  const vocalsStem = selectedTrack ? findVocalsStem(selectedTrack) : undefined;
  const durationSeconds = vocalsStem?.durationSeconds ?? null;

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
      setActiveDraft(null);
      setMyDrops([]);
      try {
        const result = await checkPunchlineEligibility(trackId, token);
        setEligibility(result);
        if (result.eligible) {
          try {
            const drops = await listMyPunchlineTrackDrops(trackId, token);
            setMyDrops(drops.items);
          } catch (dropsErr) {
            console.error(dropsErr);
            // Non-fatal: overview still lets the artist start a new drop.
          }
        }
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

  const onDropChange = useCallback((drop: PunchlineDrop) => {
    setActiveDraft(drop);
    setMyDrops((prev) => {
      const without = prev.filter((d) => d.id !== drop.id);
      return [drop, ...without];
    });
  }, []);

  const createDrop = useCallback(async () => {
    if (!token || !selectedTrackId) return;
    setCreating(true);
    try {
      const draft = await createPunchlineDraft(
        { trackId: selectedTrackId },
        token,
      );
      setActiveDraft(draft);
      setMyDrops((prev) => [draft, ...prev]);
    } catch (err) {
      addToast({
        type: "error",
        title: "Couldn’t start a drop",
        message:
          err instanceof Error
            ? err.message.replace(/^API \d+:\s*/, "")
            : "Please try again.",
      });
    } finally {
      setCreating(false);
    }
  }, [token, selectedTrackId, addToast]);

  if (vocalsTracks.length === 0) {
    return null;
  }

  const bounds = eligibility?.clipBoundsMs;
  const view = selectPunchlineView({
    selectedTrackId,
    activeDraft,
    loading,
    error: error !== null,
    eligible: eligibility ? eligibility.eligible : null,
  });

  const resumeDraft = newestDraft(myDrops);
  const published = publishedDrops(myDrops);
  const stemLengthReady = durationSeconds != null && durationSeconds > 0;

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

      {vocalsTracks.length > 1 && !activeDraft && (
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

      {view === "select-track" && (
        <p className="punchline-hint">
          Select a track with a vocal stem to build a Punchline Drop.
        </p>
      )}

      {view === "loading" && (
        <p className="punchline-hint">Checking eligibility…</p>
      )}

      {view === "error" && (
        <div className="punchline-error-state">
          <p className="punchline-error">{error}</p>
          <button
            type="button"
            className="punchline-retry-btn"
            onClick={() => selectedTrackId && loadEligibility(selectedTrackId)}
          >
            Try again
          </button>
        </div>
      )}

      {view === "ineligible" && eligibility && (
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

      {view === "overview" && eligibility && (
        <div className="punchline-overview">
          <p className="punchline-rights-summary">
            <span className="punchline-rights-label">
              {eligibility.rightsLabel}
            </span>{" "}
            {eligibility.rightsSummary}
          </p>

          {published.length > 0 && (
            <div className="punchline-overview-published">
              <h5>Published drops</h5>
              <ul className="punchline-moment-list">
                {published.map((drop) => (
                  <li key={drop.id} className="punchline-moment-row">
                    <div className="punchline-moment-row-main">
                      <span className="punchline-moment-row-title">
                        {drop.title || "Punchline Drop"}
                      </span>
                      <span className="punchline-moment-row-lyric">
                        {drop.moments.length} moment
                        {drop.moments.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="punchline-moment-row-actions">
                      <button
                        type="button"
                        className="punchline-link-btn"
                        onClick={() => setActiveDraft(drop)}
                      >
                        View
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!stemLengthReady ? (
            <p className="punchline-hint">
              The vocal stem length isn&apos;t available yet, so a drop can&apos;t
              be built. Try again once processing finishes.
            </p>
          ) : (
            <div className="punchline-overview-cta">
              {resumeDraft ? (
                <>
                  <button
                    type="button"
                    className="punchline-btn-primary"
                    onClick={() => setActiveDraft(resumeDraft)}
                  >
                    Resume draft
                  </button>
                  <button
                    type="button"
                    className="punchline-btn-secondary"
                    onClick={createDrop}
                    disabled={creating}
                    aria-disabled={creating}
                  >
                    {creating ? "Starting…" : "Start another drop"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="punchline-btn-primary"
                  onClick={createDrop}
                  disabled={creating}
                  aria-disabled={creating}
                >
                  {creating ? "Starting…" : "Create Punchline Drop"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {view === "builder" &&
        activeDraft &&
        token &&
        bounds &&
        vocalsStem &&
        stemLengthReady && (
          <PunchlineDropBuilder
            token={token}
            drop={activeDraft}
            stemId={vocalsStem.id}
            durationSeconds={durationSeconds as number}
            minMs={bounds.minMs}
            maxMs={bounds.maxMs}
            onDropChange={onDropChange}
            onExit={() => setActiveDraft(null)}
            addToast={addToast}
          />
        )}

      {view === "builder" &&
        activeDraft &&
        (!bounds || !vocalsStem || !stemLengthReady) && (
          <div className="punchline-builder">
            <p className="punchline-hint">
              This drop can&apos;t be edited right now because the track&apos;s
              vocal stem details aren&apos;t available. Reopen the release once
              processing finishes.
            </p>
            <button
              type="button"
              className="punchline-btn-secondary"
              onClick={() => setActiveDraft(null)}
            >
              Back
            </button>
          </div>
        )}
    </section>
  );
}

export default PunchlineDropsPanel;
