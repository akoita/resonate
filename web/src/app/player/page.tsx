"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "../../components/ui/Button";
import SocialShare from "../../components/social/SocialShare";
import { usePlayer } from "../../lib/playerContext";
import { formatDuration } from "../../lib/metadataExtractor";
import { getTrack, getRelease } from "../../lib/api";
import { LocalTrack } from "../../lib/localLibrary";
import { AddToPlaylistModal } from "../../components/library/AddToPlaylistModal";
import { ContextMenu, ContextMenuItem } from "../../components/ui/ContextMenu";
import { useToast } from "../../components/ui/Toast";
import { MixerConsole } from "../../components/player/MixerConsole";

function PlayerContent() {
  const searchParams = useSearchParams();
  const trackId = searchParams.get("trackId");

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
    artworkUrl,
    playNext,
    addToQueue,
    mixerMode,
    toggleMixerMode
  } = usePlayer();

  const { addToast } = useToast();
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, track: LocalTrack } | null>(null);

  // Local state for seeking
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleSeekStart = (e: React.PointerEvent<HTMLInputElement>) => {
    setIsDragging(true);
    setDragValue(progress);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDragValue(parseFloat(e.target.value));
  };

  const handleSeekEnd = (e: React.PointerEvent<HTMLInputElement>) => {
    seek(dragValue);
    e.currentTarget.releasePointerCapture(e.pointerId);

    // Small delay to prevent jitter where the UI jumps back to old progress
    // before the audio engine reports the new time
    setTimeout(() => {
      setIsDragging(false);
    }, 200);
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value) / 100);
  };

  const handleContextMenu = (e: React.MouseEvent, track: LocalTrack) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, track });
  };

  const getTrackContextMenuItems = (track: LocalTrack): ContextMenuItem[] => [
    { label: "Play Next", icon: "⏭️", onClick: () => { playNext(track); addToast({ type: "success", title: "Queued", message: `"${track.title}" will play next` }); } },
    { label: "Add to Queue", icon: "➕", onClick: () => { addToQueue(track); addToast({ type: "success", title: "Queued", message: `Added "${track.title}" to queue` }); } },
    { separator: true, label: "", onClick: () => { } },
    { label: "Add to Playlist", icon: "🎵", onClick: () => setShowAddToPlaylist(true) },
  ];

  const lastProcessedTrackId = useRef<string | null>(null);

  useEffect(() => {
    if (trackId && trackId !== lastProcessedTrackId.current) {
      lastProcessedTrackId.current = trackId;

      // 1. If currently playing this track, update ref and do nothing
      if (currentTrack?.id === trackId) return;

      // 2. If track is already in the queue, just jump to it
      const queueIndex = queue.findIndex(t => t.id === trackId);
      if (queueIndex !== -1) {
        void playQueue(queue, queueIndex);
        return;
      }

      // 3. Otherwise, load the full release context
      const loadAndPlayTrack = async () => {
        try {
          const selectedTrack = await getTrack(trackId);
          if (selectedTrack && selectedTrack.releaseId) {
            // Fetch the full release to get the entire tracklist
            const release = await getRelease(selectedTrack.releaseId);
            if (release && release.tracks) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const getTrackDuration = (track: any): number => {
                if (!track.stems) return 0;
                // Prefer stems with durationSeconds
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const withDuration = track.stems.find((s: any) => s.durationSeconds);
                if (withDuration) return withDuration.durationSeconds;
                return track.stems[0]?.durationSeconds || 0;
              };

              const playableTracks: LocalTrack[] = release.tracks.flatMap((track) => {
                const masteredStems = (track.stems || []).filter(s => s.type === "ORIGINAL" || s.type === "other");

                if (masteredStems.length > 0) {
                  return masteredStems.map(s => ({
                    id: s.id,
                    title: track.title,
                    artist: release.primaryArtist || release.artist?.displayName || "Unknown Artist",
                    albumArtist: null,
                    album: release.title,
                    year: release.releaseDate ? new Date(release.releaseDate).getFullYear() : null,
                    genre: release.genre || null,
                    duration: getTrackDuration(track),
                    createdAt: track.createdAt,
                    remoteUrl: s.uri,
                    remoteArtworkUrl: release.artworkUrl || undefined,
                    stems: track.stems,
                  }));
                } else if (track.stems && track.stems.length > 0) {
                  // Fallback to first stem if no ORIGINAL/other found
                  const s = track.stems[0];
                  return [{
                    id: s.id,
                    title: track.title,
                    artist: release.primaryArtist || release.artist?.displayName || "Unknown Artist",
                    albumArtist: null,
                    album: release.title,
                    year: release.releaseDate ? new Date(release.releaseDate).getFullYear() : null,
                    genre: release.genre || null,
                    duration: getTrackDuration(track),
                    createdAt: track.createdAt,
                    remoteUrl: s.uri,
                    remoteArtworkUrl: release.artworkUrl || undefined,
                    stems: track.stems,
                  }];
                }
                return [];
              });

              // Find the index of the track we actually clicked on
              const startIndex = playableTracks.findIndex(t => t.title === selectedTrack.title);
              void playQueue(playableTracks, Math.max(0, startIndex));
            }
          }
        } catch (error) {
          console.error("Failed to load release from URL:", error);
        }
      };

      void loadAndPlayTrack();
    }
  }, [trackId, playQueue, queue, currentTrack?.id]);

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
        <div className="player-art-container">
          {artworkUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={artworkUrl} alt={displayTrack.title} className="player-art-master" />
          ) : (
            <div className="player-art-master player-art-placeholder" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: "160px", opacity: 0.05 }}>🎵</span>
            </div>
          )}
          
          {/* Mixer Toggle - floating on artwork */}
          {currentTrack && (
            <button 
              className={`artwork-mixer-toggle ${mixerMode ? 'active' : ''}`}
              onClick={toggleMixerMode}
              title={mixerMode ? "Close Mixer" : "Open Stem Mixer"}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <circle cx="4" cy="12" r="2" fill="currentColor" />
                <circle cx="12" cy="10" r="2" fill="currentColor" />
                <circle cx="20" cy="14" r="2" fill="currentColor" />
              </svg>
              <span>Stem Mixer</span>
            </button>
          )}
        </div>

        <h1 className="hero-title">{displayTrack.title}</h1>
        <p className="hero-artist">
          {displayTrack.artist} {displayTrack.album ? ` • ${displayTrack.album}` : ""}
        </p>

        {currentTrack && (
          <div style={{ marginTop: "20px" }}>
            <Button variant="ghost" onClick={() => setShowAddToPlaylist(true)}>
              <span style={{ marginRight: "8px" }}>➕</span> Add to Playlist
            </Button>
          </div>
        )}
      </section>

      {/* Mixer Panel - shows when active */}
      {mixerMode && currentTrack && (
        <div className="player-mixer-panel">
          <MixerConsole onClose={toggleMixerMode} />
        </div>
      )}

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
          <button className="ui-btn" onClick={prevTrack} disabled={currentIndex <= 0} aria-label="Prev">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="19 20 9 12 19 4 19 20" fill="currentColor" />
              <line x1="5" y1="19" x2="5" y2="5" />
            </svg>
          </button>

          <button className="ui-btn btn-main" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
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

          <button className="ui-btn" onClick={nextTrack} disabled={currentIndex >= queue.length - 1} aria-label="Next">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </button>
        </div>

        <div className="player-progress" style={{ marginBottom: "var(--space-2)" }}>
          <div className="studio-label" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: "2px" }}>
            <span>Signal Progress</span>
            <span>{formatTime(isDragging ? (dragValue / 100) * duration : currentTime)} / {formatTime(duration)}</span>
          </div>
          <input
            className="player-range"
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={isDragging ? dragValue : (progress || 0)}
            onPointerDown={handleSeekStart}
            onChange={handleSeekChange}
            onPointerUp={handleSeekEnd}
          />
        </div>

        <div className="player-volume" style={{ background: "transparent", padding: 0, marginBottom: "var(--space-1)" }}>
          <div className="studio-label" style={{ marginBottom: "2px" }}>Output Gain</div>
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

        <div className="queue-section" style={{ display: "flex", flexDirection: "column", minHeight: 0, maxHeight: "40vh" }}>
          <div className="studio-label" style={{ marginBottom: "var(--space-2)" }}>Queue Manifest</div>
          <div className="queue-list" style={{ overflowY: "auto", paddingRight: "8px" }}>
            {queue.length > 0 ? (
              queue.map((track, idx) => (
                <div
                  key={`${track.id}-${idx}`}
                  className={`queue-item ${currentIndex === idx ? "queue-item-active" : ""}`}
                  onClick={() => playQueue(queue, idx)}
                  onContextMenu={(e) => handleContextMenu(e, track)}
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

        <div className="player-share-section" style={{ marginTop: "auto", paddingTop: "var(--space-2)", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="studio-label" style={{ marginBottom: "var(--space-2)" }}>Broadcast Signal</div>
          <SocialShare title={displayTrack.title} artist={displayTrack.artist || "Unknown"} />
        </div>
      </aside>

      {showAddToPlaylist && currentTrack && (
        <AddToPlaylistModal
          tracks={[currentTrack]}
          onClose={() => setShowAddToPlaylist(false)}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getTrackContextMenuItems(contextMenu.track)}
          onClose={() => setContextMenu(null)}
        />
      )}
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
