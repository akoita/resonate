"use client";

import { useEffect, useReducer, useRef, Suspense, useState } from "react";
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

  useEffect(() => {
    if (!trackId) return;

    let cancelled = false;
    dispatch({ type: "FETCH_START" });

    getTrack(trackId, token)
      .then((result) => {
        console.log(`[Player] Loaded track ${trackId}`, result);
        if (!cancelled) {
          dispatch({ type: "FETCH_SUCCESS", track: result });
        }
      })
      .catch((err) => {
        console.error(`[Player] Failed to load track ${trackId}:`, err);
        if (!cancelled) {
          dispatch({ type: "FETCH_ERROR" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [trackId, token]);

  const [isPlaying, setIsPlaying] = useReducer((s) => !s, false);
  const [progress, setProgress] = useReducer((_: number, p: number) => p, 0);
  const [duration, setDuration] = useReducer((_: number, d: number) => d, 0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (state.track && state.track.stems && state.track.stems.length > 0) {
      // Find the first stem to play, preferentially 'vocals' or 'other' if it's a single track
      const stem = state.track.stems[0];
      if (stem) {
        if (audioRef.current) {
          audioRef.current.pause();
        }
        audioRef.current = new Audio(stem.uri);
        audioRef.current.addEventListener("timeupdate", () => {
          if (audioRef.current) {
            const time = audioRef.current.currentTime;
            setCurrentTime(time);
            setProgress((time / audioRef.current.duration) * 100);
          }
        });
        audioRef.current.addEventListener("loadedmetadata", () => {
          if (audioRef.current) {
            setDuration(audioRef.current.duration);
          }
        });
        audioRef.current.addEventListener("ended", () => {
          setIsPlaying();
        });
      }
    }
  }, [state.track]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(console.error);
    }
    setIsPlaying();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (audioRef.current && audioRef.current.duration) {
      audioRef.current.currentTime = (value / 100) * audioRef.current.duration;
      setProgress(value);
    }
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.volume = value / 100;
    }
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const loading = state.status === "loading";
  const track = state.track;
  const displayTrack = track || {
    title: loading ? "Loading..." : "No track selected",
    primaryArtist: loading ? "Please wait..." : "Select a track from the home page",
    releaseTitle: "",
  };

  const fetchState = state.status;

  return (
    <main className="player-grid">
      <Card>
        <div className="player-hero">
          <div className="player-label">Now playing</div>
          <div className="player-art" />
          <div className="player-title">{displayTrack.releaseTitle || displayTrack.title}</div>
          <div className="player-meta-row">
            <span>{displayTrack.primaryArtist}</span>
            {track?.genre && <span>{track.genre}</span>}
            {track?.status && <span className={`status-${track.status}`}>{track.status}</span>}
          </div>
        </div>
        <div className="player-controls">
          <Button variant="ghost">Prev</Button>
          <Button onClick={togglePlay} variant="primary">
            {isPlaying ? (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
                Pause
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Play
              </>
            )}
          </Button>
          <Button variant="ghost">Next</Button>
        </div>
        <div className="player-progress">
          <input
            className="player-range"
            type="range"
            min="0"
            max="100"
            value={progress || 0}
            onChange={handleSeek}
          />
          <div className="player-time">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
        <div className="player-volume">
          <span className="queue-meta">Volume</span>
          <input
            className="player-range"
            type="range"
            min="0"
            max="100"
            defaultValue="80"
            onChange={handleVolume}
          />
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
            {fetchState === "idle" ? "No track selected. Go to the home page to select a release to play." : loading ? "Loading track details..." : "Failed to load track."}
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


