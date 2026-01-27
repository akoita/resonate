"use client";

import { Suspense } from "react";
import SocialShare from "../../components/social/SocialShare";
import { usePlayer } from "../../lib/playerContext";
import { formatDuration } from "../../lib/metadataExtractor";

function PlayerContent() {
  const {
    currentTrack,
    isPlaying,
    togglePlay,
    nextTrack,
    prevTrack,
    progress,
    currentTime,
    duration,
    seek,
    volume,
    setVolume,
    currentIndex,
    queue,
    playQueue,
    artworkUrl
  } = usePlayer();

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    seek(parseFloat(e.target.value));
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value) / 100);
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const displayTrack = currentTrack || {
    title: "No track selected",
    artist: "Select a track from the library",
    album: "",
    genre: ""
  };

  return (
    <div className="player-master-stage">
      {/* Mesh Backdrop Layer */}
      {artworkUrl && (
        <div
          className="player-mesh-bg"
          style={{ backgroundImage: `url(${artworkUrl})` }}
        />
      )}
      <div className="player-mesh-overlay" />

      {/* THE HERO STAGE */}
      <section className="player-hero-stage">
        {artworkUrl ? (
          <img src={artworkUrl} alt={displayTrack.title} className="player-art-master" />
        ) : (
          <div className="player-art-master player-art-placeholder" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: "160px", opacity: 0.05 }}>🎵</span>
          </div>
        )}

        <h1 className="hero-title">{displayTrack.title}</h1>
        <p className="hero-artist">
          {displayTrack.artist} {displayTrack.album ? ` • ${displayTrack.album}` : ""}
        </p>
      </section>

      {/* THE FLOATING CONSOLE */}
      <aside className="player-floating-console">
        <div className="player-status-area">
          <div className="studio-label">System Monitoring</div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div className="status-led" />
            <span className="status-text">Live Sync Active</span>
          </div>
        </div>

        <div className="player-controls-backstage">
          <button className="ui-btn" onClick={prevTrack} disabled={currentIndex <= 0}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="19 20 9 12 19 4 19 20" fill="currentColor" />
              <line x1="5" y1="19" x2="5" y2="5" />
            </svg>
          </button>

          <button className="ui-btn btn-main" onClick={togglePlay}>
            {isPlaying ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: "4px" }}>
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>

          <button className="ui-btn" onClick={nextTrack} disabled={currentIndex >= queue.length - 1}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </button>
        </div>

        <div className="player-progress" style={{ marginBottom: "var(--space-10)" }}>
          <div className="studio-label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: "8px" }}>
            <span>Signal Progress</span>
            <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
          </div>
          <input
            className="player-range"
            type="range"
            min="0"
            max="100"
            value={progress || 0}
            onChange={handleSeek}
          />
        </div>

        <div className="player-volume" style={{ background: "transparent", padding: 0, marginBottom: "var(--space-10)" }}>
          <div className="studio-label" style={{ marginBottom: "12px" }}>Output Gain</div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", width: "100%" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.4 }}>
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            </svg>
            <input
              className="player-range"
              type="range"
              min="0"
              max="100"
              value={volume * 100}
              onChange={handleVolume}
            />
          </div>
        </div>

        <div className="queue-section" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="studio-label" style={{ marginBottom: "var(--space-4)" }}>Queue Manifest</div>
          <div className="queue-list" style={{ flex: 1, overflowY: "auto", paddingRight: "8px" }}>
            {queue.length > 0 ? (
              queue.map((track, idx) => (
                <div
                  key={`${track.id}-${idx}`}
                  className={`queue-item ${currentIndex === idx ? "queue-item-active" : ""}`}
                  onClick={() => playQueue(queue, idx)}
                  style={{
                    background: currentIndex === idx ? "rgba(124, 92, 255, 0.15)" : "rgba(255,255,255,0.02)",
                    borderRadius: "12px",
                    border: currentIndex === idx ? "1px solid rgba(124, 92, 255, 0.2)" : "1px solid transparent"
                  }}
                >
                  <div className="queue-item-left">
                    <div className="queue-item-name" style={{ color: currentIndex === idx ? "var(--color-accent)" : "#fff" }}>
                      {track.title}
                    </div>
                    <div className="queue-item-artist">{track.artist || "Unknown Artist"}</div>
                  </div>
                  <div className="queue-item-right">
                    {formatDuration(track.duration)}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ fontSize: "12px", opacity: 0.4 }}>Console ready. Queue manifest empty.</div>
            )}
          </div>
        </div>

        <div className="player-share-section" style={{ marginTop: "var(--space-8)", paddingTop: "var(--space-6)", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="studio-label" style={{ marginBottom: "var(--space-4)" }}>Broadcast Signal</div>
          <SocialShare title={displayTrack.title} artist={displayTrack.artist || "Unknown"} />
        </div>
      </aside>
    </div>
  );
}

export default function PlayerPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayerContent />
    </Suspense>
  );
}


