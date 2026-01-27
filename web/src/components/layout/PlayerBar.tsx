"use client";

import { usePlayer } from "../../lib/playerContext";

export default function PlayerBar() {
  const {
    currentTrack, isPlaying, artworkUrl, togglePlay, nextTrack, prevTrack,
    progress, queue, currentIndex, seek,
    shuffle, repeatMode, toggleShuffle, toggleRepeatMode
  } = usePlayer();

  if (!currentTrack && queue.length === 0) return null;

  return (
    <div className="app-player">
      {/* Progress Line */}
      <div
        className="player-progress-container"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const percent = (x / rect.width) * 100;
          console.log("PlayerBar: seek clicked, percent:", percent);
          seek(percent);
        }}
        style={{ cursor: 'pointer' }}
      >
        <div className="player-progress-bar" style={{ width: `${progress}%` }} />
      </div>

      <div className="player-track-info">
        {currentTrack ? (
          <>
            {artworkUrl ? (
              <img src={artworkUrl} alt={currentTrack.title} className="player-artwork" />
            ) : (
              <div className="player-artwork-placeholder">🎵</div>
            )}
            <div className="player-details">
              <div className="player-title">{currentTrack.title}</div>
              <div className="player-artist">{currentTrack.artist || "Unknown Artist"}</div>
            </div>
          </>
        ) : (
          <div className="player-details">
            <div className="player-title">No track selected</div>
            <div className="player-artist">Choose a song to start listening</div>
          </div>
        )}
      </div>

      <div className="player-controls">
        <div className="player-buttons">
          <button
            className={`player-btn-side ${shuffle ? 'active' : ''}`}
            onClick={toggleShuffle}
            title="Shuffle"
          >
            🔀
          </button>
          <button
            className="player-btn-side"
            onClick={prevTrack}
            disabled={currentIndex <= 0 && repeatMode !== "all"}
            title="Previous"
          >
            ⏮
          </button>
          <button className="player-btn-play" onClick={togglePlay}>
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button
            className="player-btn-side"
            onClick={nextTrack}
            disabled={currentIndex >= queue.length - 1 && repeatMode !== "all"}
            title="Next"
          >
            ⏭
          </button>
          <button
            className={`player-btn-side ${repeatMode !== 'none' ? 'active' : ''}`}
            onClick={toggleRepeatMode}
            title={`Repeat: ${repeatMode}`}
          >
            {repeatMode === 'one' ? '🔂' : '🔁'}
          </button>
        </div>
      </div>

      <div className="player-volume">
        <div className="queue-indicator">
          <span className="queue-icon">📋</span>
          <span className="queue-count">{currentIndex + 1} / {queue.length}</span>
        </div>
      </div>
    </div>
  );
}
