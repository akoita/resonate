"use client";

import { useEffect, useReducer, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import SocialShare from "../../components/social/SocialShare";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { getTrack, Track } from "../../lib/api";
import { useAuth } from "../../components/auth/AuthProvider";

type State = {
  track: Track | null;
  status: "idle" | "loading" | "done";
};

type Action =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; track: Track }
  | { type: "FETCH_ERROR" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "FETCH_START":
      return { ...state, status: "loading" };
    case "FETCH_SUCCESS":
      return { track: action.track, status: "done" };
    case "FETCH_ERROR":
      return { track: null, status: "done" };
    default:
      return state;
  }
}

function PlayerContent() {
  const searchParams = useSearchParams();
  const trackId = searchParams.get("trackId");
  const { token } = useAuth();
  const [state, dispatch] = useReducer(reducer, { track: null, status: "idle" });
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!trackId || !token) return;
    if (fetchedRef.current === trackId) return;

    fetchedRef.current = trackId;
    let cancelled = false;

    dispatch({ type: "FETCH_START" });

    getTrack(token, trackId)
      .then((result) => {
        if (!cancelled) dispatch({ type: "FETCH_SUCCESS", track: result });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "FETCH_ERROR" });
      });

    return () => { cancelled = true; };
  }, [trackId, token]);

  const loading = state.status === "loading";
  const track = state.track;
  const displayTrack = track || {
    title: "No track selected",
    primaryArtist: "Select a track from the home page",
    releaseTitle: "",
  };

  const fetchState = state.status;

  return (
    <main className="player-grid">
      <Card>
        <div className="player-hero">
          <div className="player-label">Now playing</div>
          <div className="player-art" />
          {loading ? (
            <div className="player-title">Loading...</div>
          ) : (
            <>
              <div className="player-title">{displayTrack.releaseTitle || displayTrack.title}</div>
              <div className="player-meta-row">
                <span>{displayTrack.primaryArtist}</span>
                {track?.genre && <span>{track.genre}</span>}
                {track?.status && <span className={`status-${track.status}`}>{track.status}</span>}
              </div>
            </>
          )}
        </div>
        <div className="player-controls">
          <Button variant="ghost">Prev</Button>
          <Button>Play</Button>
          <Button variant="ghost">Next</Button>
        </div>
        <div className="player-progress">
          <input className="player-range" type="range" min="0" max="100" />
          <div className="player-time">
            <span>0:00</span>
            <span>0:00</span>
          </div>
        </div>
        <div className="player-volume">
          <span className="queue-meta">Volume</span>
          <input className="player-range" type="range" min="0" max="100" />
        </div>
        {track && (
          <SocialShare title={track.releaseTitle || track.title} artist={track.primaryArtist || "Unknown"} />
        )}
      </Card>

      <Card title="Track Info">
        {track ? (
          <div className="track-info">
            <div className="track-info-row">
              <span className="track-info-label">Title</span>
              <span>{track.title}</span>
            </div>
            <div className="track-info-row">
              <span className="track-info-label">Release</span>
              <span>{track.releaseTitle || "—"}</span>
            </div>
            <div className="track-info-row">
              <span className="track-info-label">Artist</span>
              <span>{track.primaryArtist || "—"}</span>
            </div>
            <div className="track-info-row">
              <span className="track-info-label">Genre</span>
              <span>{track.genre || "—"}</span>
            </div>
            <div className="track-info-row">
              <span className="track-info-label">Label</span>
              <span>{track.label || "—"}</span>
            </div>
            <div className="track-info-row">
              <span className="track-info-label">Status</span>
              <span className={`status-badge status-${track.status}`}>{track.status}</span>
            </div>
          </div>
        ) : (
          <div className="home-subtitle">
            {fetchState === "idle" ? "No track selected. Go to the home page to select a release to play." : "Loading..."}
          </div>
        )}
      </Card>
    </main>
  );
}

export default function PlayerPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayerContent />
    </Suspense>
  );
}


