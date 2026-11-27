"use client";
import { ListeningControls } from "../player/ListeningControls";
import { minutesLeft } from "../player/SessionDock";

import { useRouter, usePathname } from "next/navigation";
import { usePlayer } from "../../lib/playerContext";
import { MarqueeText } from "../ui/MarqueeText";
import { AiDisclosureBadge } from "../content/AiDisclosureBadge";
import { playerArtistHref } from "../../lib/artistRoutes";
import { useToast } from "../ui/Toast";
import { useUIStore } from "../../lib/uiStore";
import { MixerConsole } from "../player/MixerConsole";
import { VolumeIcon } from "../player/VolumeIcon";
import { useSyncExternalStore } from "react";
import {
  getServerConsoleLayout,
  getStoredConsoleLayout,
  subscribeConsoleLayout,
  toggleConsoleMinimized,
} from "../../lib/playerConsoleLayout";

const WIDE_QUERY = "(min-width: 768px)";

function subscribeWide(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function isWide(): boolean {
  return typeof window === "undefined" || !window.matchMedia || window.matchMedia(WIDE_QUERY).matches;
}

export default function PlayerBar() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentTrack, isPlaying, artworkUrl, togglePlay, nextTrack, prevTrack,
    progress, duration, queue, currentIndex, seek,
    segmentLoop, shuffle, repeatMode, toggleShuffle, toggleRepeatMode,
    volume, muted, setVolume, toggleMute,
    mixerMode, toggleMixerMode
  } = usePlayer();
  const { addToast } = useToast();
  const { setTracksToAddToPlaylist } = useUIStore();
  const setSessionSheetOpen = useUIStore((state) => state.setSessionSheetOpen);

  const isPlayerPage = pathname === '/player';
  // An open Session Dock carries Loop and Repeat itself (wide screens).
  const consoleLayout = useSyncExternalStore(subscribeConsoleLayout, getStoredConsoleLayout, getServerConsoleLayout);
  const wideScreen = useSyncExternalStore(subscribeWide, isWide, () => true);
  const dockShowsListening = wideScreen && !consoleLayout.minimized;
  const isReleasePage = pathname?.startsWith('/release/');
  const queueMinutes = minutesLeft(queue, currentIndex);

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
        {segmentLoop && duration > 0 && <div className="segment-timeline" aria-label="Active passage loop"><span style={{ marginLeft: `${segmentLoop.start / duration * 100}%`, width: `${(segmentLoop.end - segmentLoop.start) / duration * 100}%` }} /></div>}
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
              {/* A paused player holds its titles still: no idle animation (#2436). */}
              <MarqueeText text={currentTrack.title} className="player-title" paused={!isPlaying} />
              <div className="player-artist-row">
                {/* Listeners see that a track is AI-generated or AI-assisted on every page. */}
                <AiDisclosureBadge disclosure={currentTrack.aiDisclosure} aiOnly compact className="player-ai-badge" />
                <MarqueeText
                  text={currentTrack.artist || "Unknown Artist"}
                  paused={!isPlaying}
                  className="player-artist clickable"
                  onClick={(e) => {
                    e.stopPropagation();
                    const target = playerArtistHref(currentTrack);
                    if (target) router.push(target);
                  }}
                />
              </div>
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
            className={`player-btn-side player-btn-shuffle ${shuffle ? 'active' : ''}`}
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
            className="player-btn-side player-btn-prev"
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
            className={`player-btn-side player-btn-repeat ${repeatMode !== 'none' ? 'active' : ''}`}
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
            className="player-btn-side player-btn-add"
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

      <div className="player-end">
      {/* The session lives in the bar: the queue chip opens or folds the queue
        * panel (no capsule floats over the page), and Loop and Repeat opens
        * above the bar. The full player and an open dock carry Loop and
        * Repeat themselves, so it shows here only when neither is open. */}
      <div className="player-session" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
        {!isPlayerPage && !dockShowsListening ? (
          <div className="player-listening-menu"><ListeningControls key={currentTrack?.id} variant="bar" /></div>
        ) : null}
        <button
          type="button"
          className="queue-indicator"
          onClick={() => {
            // Phones slide up the Session sheet; wider screens open or fold
            // the queue panel (the console, on /player).
            if (window.matchMedia?.("(max-width: 767px)").matches) setSessionSheetOpen(true);
            else toggleConsoleMinimized();
          }}
          aria-pressed={wideScreen ? !consoleLayout.minimized : undefined}
          aria-label={`Queue, track ${currentIndex + 1} of ${queue.length}${queueMinutes > 0 ? `, ${queueMinutes} minutes left` : ""}. ${wideScreen ? (consoleLayout.minimized ? "Show" : "Hide") : "Show"} the queue.`}
          title={wideScreen && !consoleLayout.minimized ? "Hide the queue" : "Show the queue"}
        >
          <svg className="queue-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h13" /><path d="M3 12h13" /><path d="M3 18h9" /><path d="m17 15 4 3-4 3z" />
          </svg>
          <span className="queue-count">
            <span className="queue-count__prefix">N° </span>{currentIndex + 1} / {queue.length}
            {queueMinutes > 0 ? <span className="queue-count__time"> · {queueMinutes} min</span> : null}
          </span>
        </button>
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
