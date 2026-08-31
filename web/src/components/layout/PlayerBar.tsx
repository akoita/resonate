"use client";

import { useRouter, usePathname } from "next/navigation";
import { usePlayer } from "../../lib/playerContext";
import { MarqueeText } from "../ui/MarqueeText";
import { libraryArtistHref } from "../../lib/artistRoutes";
import { useToast } from "../ui/Toast";
import { useUIStore } from "../../lib/uiStore";
import { MixerConsole } from "../player/MixerConsole";
import { VolumeIcon } from "../player/VolumeIcon";

export default function PlayerBar() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentTrack, isPlaying, artworkUrl, togglePlay, nextTrack, prevTrack,
    progress, queue, currentIndex, seek,
    shuffle, repeatMode, toggleShuffle, toggleRepeatMode,
    volume, muted, setVolume, toggleMute,
    mixerMode, toggleMixerMode
  } = usePlayer();
  const { addToast } = useToast();
  const { setTracksToAddToPlaylist } = useUIStore();

  const isPlayerPage = pathname === '/player';
  const isReleasePage = pathname?.startsWith('/release/');

  const handleToggleRepeat = () => {
    toggleRepeatMode();
    // Use a small delay to get the NEXT state after the toggle (or just cycle it here visually)
    const modes = {
      none: { label: "Off", icon: "➡️" },
      all: { label: "Repeat All", icon: "🔁" },
      one: { label: "Repeat One", icon: "🔂" }
    };

    // The state update is async, so we'll determine the next state manually for the toast
    let nextMode: keyof typeof modes = "none";
    if (repeatMode === "none") nextMode = "all";
    else if (repeatMode === "all") nextMode = "one";

    addToast({
      title: "Repeat Mode",
      message: `${modes[nextMode].label}`,
      type: "info"
    });
  };

  if (!currentTrack && queue.length === 0) return null;

  return (
    <div
      className="app-player"
      role="region"
      aria-label="Now playing"
      onDoubleClick={() => router.push("/player")}
      style={{ cursor: "pointer" }}
      title="Double-click to open player"
    >
      {/* Progress Line */}
      <div
        className="player-progress-container"
        style={{ cursor: 'pointer' }}
      >
        <div className="player-progress-bar" style={{ width: `${progress}%` }} />
        <input
          type="range"
          className="player-progress-input"
          min="0"
          max="100"
          step="0.1"
          value={progress}
          onChange={(event) => seek(Number(event.currentTarget.value))}
          onClick={(event) => event.stopPropagation()}
          aria-label="Playback position"
          aria-valuetext={`${Math.round(progress)} percent`}
        />

        {/* Floating Queue Indicator */}
        <div className="queue-indicator">
          <span className="queue-icon">📋</span>
          <span className="queue-count">N° {currentIndex + 1} / {queue.length}</span>
        </div>
      </div>

      <div className="player-track-info">
        {currentTrack ? (
          <>
            {artworkUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={artworkUrl} alt={currentTrack.title} className="player-artwork" />
              </>
            ) : (
              <div className="player-artwork-placeholder">🎵</div>
            )}
            <div className="player-details">
              <MarqueeText text={currentTrack.title} className="player-title" />
              <MarqueeText
                text={currentTrack.artist || "Unknown Artist"}
                className="player-artist clickable"
                onClick={(e) => {
                  e.stopPropagation();
                  const target = currentTrack.artist;
                  if (target) router.push(libraryArtistHref(target));
                }}
              />
            </div>
          </>
        ) : (
          <div className="player-details">
            <div className="player-title">No track selected</div>
            <div className="player-artist">Choose a song to start listening</div>
          </div>
        )}
      </div>

      <div className="player-controls" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <div className="player-buttons">
          <button
            className={`player-btn-side ${shuffle ? 'active' : ''}`}
            onClick={toggleShuffle}
            aria-label={shuffle ? "Turn shuffle off" : "Turn shuffle on"}
            aria-pressed={shuffle}
            title="Shuffle"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 3h5v5" /><path d="M4 20L21 3" /><path d="M21 16v5h-5" /><path d="M15 15l5 5" /><path d="M4 4l5 5" />
            </svg>
          </button>
          <button
            className="player-btn-side"
            onClick={prevTrack}
            disabled={currentIndex <= 0 && repeatMode !== "all"}
            aria-label="Previous track"
            title="Previous"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="19 20 9 12 19 4 19 20" /><line x1="5" y1="19" x2="5" y2="5" />
            </svg>
          </button>
          <button
            className="player-btn-play"
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause" : "Play"}
            aria-pressed={isPlaying}
          >
            {isPlaying ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '2px' }}>
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>
          <button
            className="player-btn-side"
            onClick={() => nextTrack()}
            disabled={!shuffle && currentIndex >= queue.length - 1 && repeatMode !== "all"}
            aria-label="Next track"
            title="Next"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </button>
          <button
            className={`player-btn-side ${repeatMode !== 'none' ? 'active' : ''}`}
            onClick={handleToggleRepeat}
            aria-label={`Repeat mode: ${repeatMode}. Change repeat mode`}
            aria-pressed={repeatMode !== "none"}
            title={`Repeat: ${repeatMode}`}
          >
            {repeatMode === 'one' ? (
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" />
                </svg>
                <span style={{
                  position: 'absolute',
                  fontSize: '9px',
                  fontWeight: '900',
                  background: 'var(--color-accent)',
                  color: 'white',
                  borderRadius: '50%',
                  width: '12px',
                  height: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid var(--color-bg)',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)'
                }}>1</span>
              </div>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" />
              </svg>
            )}
          </button>
          <button
            className="player-btn-side"
            onClick={() => currentTrack && setTracksToAddToPlaylist([currentTrack])}
            aria-label="Add current track to playlist"
            title="Add to Playlist"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13"></path>
              <circle cx="6" cy="18" r="3"></circle>
              <circle cx="18" cy="16" r="3"></circle>
            </svg>
          </button>
        </div>
      </div>

      <div className={`player-volume ${muted ? "is-muted" : ""}`}>
        <button
          type="button"
          className="volume-icon"
          onClick={(event) => {
            event.stopPropagation();
            toggleMute();
          }}
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          title={muted ? "Unmute" : "Mute"}
        >
          <VolumeIcon volume={volume} muted={muted} size={17} />
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="volume-slider"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          aria-label="Volume"
          aria-valuetext={`${Math.round(volume * 100)} percent`}
        />
      </div>

      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {currentTrack
          ? `${isPlaying ? "Playing" : "Paused"}: ${currentTrack.title} by ${currentTrack.artist || "Unknown Artist"}`
          : "No track selected"}
      </div>

      {mixerMode && !isPlayerPage && !isReleasePage && (
        <div className="player-bar-mixer-popover">
          <MixerConsole onClose={toggleMixerMode} />
        </div>
      )}
    </div>
  );
}
