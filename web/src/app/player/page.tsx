"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SocialShare from "../../components/social/SocialShare";
import { usePlayer } from "../../lib/playerContext";
import { formatDuration } from "../../lib/metadataExtractor";
import { deleteLibraryTrackAPI, getTrack, getRelease, getPlayerTrackActions, type PlayerTrackAction, type PlayerTrackActionsResponse } from "../../lib/api";
import { LocalTrack, saveTrackMetadataAuthenticated } from "../../lib/localLibrary";
import { AddToPlaylistModal } from "../../components/library/AddToPlaylistModal";
import { ContextMenu, ContextMenuItem } from "../../components/ui/ContextMenu";
import { useToast } from "../../components/ui/Toast";
import { MixerConsole } from "../../components/player/MixerConsole";
import { PlayerActionPanel } from "../../components/player/PlayerActionPanel";
import { recordProductAnalyticsFromBrowser } from "../../lib/productAnalytics";
import { AiDisclosureBadge } from "../../components/content/AiDisclosureBadge";
import { useAuth } from "../../components/auth/AuthProvider";
import { useImmersiveMode } from "../../lib/useImmersiveMode";
import { VolumeIcon } from "../../components/player/VolumeIcon";
import { useQueueActions } from "../../lib/useQueueActions";
import { useIdleReveal } from "../../lib/useIdleReveal";

function PlayerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token } = useAuth();
  const playerStageRef = useRef<HTMLDivElement>(null);
  const immersive = useImmersiveMode(playerStageRef);
  // In immersive mode the console steps aside once the listener settles.
  const immersiveIdle = useIdleReveal(immersive.active);
  const queueActions = useQueueActions();
  const trackId = searchParams.get("trackId");

  const {
    currentTrack,
    isPlaying,
    togglePlay,
    nextTrack,
    prevTrack,
    shuffle,
    repeatMode,
    progress,
    currentTime,
    duration,
    seek,
    volume,
    muted,
    setVolume,
    toggleMute,
    currentIndex,
    queue,
    playQueue,
    artworkUrl,
    removeFromQueue,
    mixerMode,
    toggleMixerMode
  } = usePlayer();

  const { addToast } = useToast();
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, track: LocalTrack } | null>(null);
  const [trackActions, setTrackActions] = useState<PlayerTrackActionsResponse | null>(null);
  const [savingTrack, setSavingTrack] = useState(false);
  const actionImpressionKeyRef = useRef<string | null>(null);

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
    const nextProgress = parseFloat(e.target.value);
    setDragValue(nextProgress);
    // Keyboard changes do not emit pointer-up, so commit them immediately.
    if (!isDragging) {
      seek(nextProgress);
    }
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

  const recommendationReasonParam = searchParams.toString();
  const recommendationReasons = useMemo(() => {
    const params = new URLSearchParams(recommendationReasonParam);
    const explicitReasons = params.getAll("reason");
    const csvReasons = params.get("reasons")?.split(",") ?? [];
    return [...explicitReasons, ...csvReasons].map((reason) => reason.trim()).filter(Boolean);
  }, [recommendationReasonParam]);

  const actionTrackId = currentTrack?.catalogTrackId || null;

  useEffect(() => {
    let active = true;
    setTrackActions(null);

    if (!actionTrackId) {
      return;
    }

    getPlayerTrackActions(actionTrackId, { reasons: recommendationReasons }, token)
      .then((response) => {
        if (active) setTrackActions(response);
      })
      .catch((error) => {
        console.warn("Failed to load player actions:", error);
        if (active) setTrackActions(null);
      });

    return () => {
      active = false;
    };
  }, [actionTrackId, recommendationReasons, token]);

  const visibleTrackActions =
    actionTrackId && trackActions?.track.id === actionTrackId ? trackActions : null;
  const actionPanelLoading = Boolean(actionTrackId) && !visibleTrackActions;

  useEffect(() => {
    if (!actionTrackId || !visibleTrackActions) return;
    const impressionKey = `${actionTrackId}:${visibleTrackActions.actions.map((action) => `${action.key}:${action.status}`).join("|")}`;
    if (actionImpressionKeyRef.current === impressionKey) return;

    actionImpressionKeyRef.current = impressionKey;
    recordProductAnalyticsFromBrowser("player.action_impression", {
      subjectType: "track",
      subjectId: actionTrackId,
      payload: {
        actionKeys: visibleTrackActions.actions.map((action) => action.key),
        actionStatuses: visibleTrackActions.actions.map((action) => action.status),
        source: "player",
      },
    });
  }, [actionTrackId, visibleTrackActions]);

  const handlePlayerAction = async (action: PlayerTrackAction) => {
    if (!currentTrack || !actionTrackId) return;

    if (action.status !== "available") {
      addToast({
        type: "warning",
        title: action.label,
        message: action.reason || "This action is not available for the current track.",
      });
      return;
    }

    recordProductAnalyticsFromBrowser("player.action_selected", {
      subjectType: "track",
      subjectId: actionTrackId,
      payload: {
        actionKey: action.key,
        actionStatus: action.status,
        source: "player",
      },
    });

    if (action.key === "save") {
      if (!token) {
        addToast({ type: "info", title: "Sign in to save", message: "Connect your account to update your library." });
        return;
      }
      setSavingTrack(true);
      try {
        if (visibleTrackActions?.library?.saved && visibleTrackActions.library.libraryTrackId) {
          await deleteLibraryTrackAPI(visibleTrackActions.library.libraryTrackId, token);
          setTrackActions((current) => current?.track.id === actionTrackId
            ? { ...current, library: { saved: false, libraryTrackId: null } }
            : current);
          addToast({ type: "success", title: "Removed", message: `"${currentTrack.title}" was removed from your library.` });
        } else {
          const savedTrack = await saveTrackMetadataAuthenticated(
            { ...currentTrack, source: currentTrack.source ?? "remote" },
            token,
          );
          setTrackActions((current) => current?.track.id === actionTrackId
            ? { ...current, library: { saved: true, libraryTrackId: savedTrack.id } }
            : current);
          addToast({ type: "success", title: "Saved", message: `"${currentTrack.title}" was added to your library.` });
        }
      } catch (error) {
        console.warn("Failed to update saved track state:", error);
        addToast({ type: "error", title: "Library not updated", message: "Please try again." });
      } finally {
        setSavingTrack(false);
      }
      return;
    }

    if (action.key === "add_to_playlist") {
      setShowAddToPlaylist(true);
      return;
    }

    if (action.href) {
      router.push(action.href);
      return;
    }

    addToast({
      type: "warning",
      title: action.label,
      message: "This action is not linked yet.",
    });
  };

  const handleContextMenu = (e: React.MouseEvent, track: LocalTrack) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, track });
  };

  const getTrackContextMenuItems = (track: LocalTrack): ContextMenuItem[] => [
    ...queueActions.contextMenuItems(track),
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
                    catalogTrackId: track.id,
                    artistId: release.artist?.id || release.artistId,
                    aiDisclosure: track.aiDisclosure,
                    source: "remote",
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
                    catalogTrackId: track.id,
                    artistId: release.artist?.id || release.artistId,
                    aiDisclosure: track.aiDisclosure,
                    source: "remote",
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
    <div
      ref={playerStageRef}
      className={`player-master-stage ${immersive.active ? "is-immersive" : ""} ${immersive.fallback ? "is-immersive-fallback" : ""} ${immersiveIdle ? "is-settled" : ""}`}
    >
      {/* Mesh Backdrop Layer */}
      {artworkUrl && (
        <div
          className="player-mesh-bg"
          style={{ backgroundImage: `url(${artworkUrl})` }}
        />
      )}
      <div className="player-mesh-overlay" />

      {/* Immersive keeps a hairline of progress on the bottom edge, so the
        * console can recede without taking the playhead with it. */}
      {immersive.active && (
        <div className="immersive-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.max(0, Math.min(100, progress || 0)) / 100})` }} />
        </div>
      )}

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
          
          {/* Mixer Toggle - only show when track has Demucs-separated stems */}
          {currentTrack && currentTrack.stems?.some(s => !['ORIGINAL', 'master', 'other'].includes(s.type)) && (
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
        <AiDisclosureBadge disclosure={currentTrack?.aiDisclosure} />
        <p className="hero-artist">
          {displayTrack.artist} {displayTrack.album ? ` • ${displayTrack.album}` : ""}
        </p>
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
          <div className="player-status-signal">
            <div className="status-led" />
            <span className="status-text">Live Sync Active</span>
          </div>
          <button
            type="button"
            className="console-icon-btn console-icon-btn--immersive"
            onClick={() => void immersive.toggle()}
            aria-label={immersive.active ? "Exit immersive player" : "Open immersive player"}
            aria-pressed={immersive.active}
            title={immersive.active ? "Exit immersive player" : "Open immersive player"}
          >
            {immersive.active ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
              </svg>
            )}
          </button>
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

          <button className="ui-btn" onClick={() => nextTrack()} disabled={!shuffle && currentIndex >= queue.length - 1 && repeatMode !== "all"} aria-label="Next">
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
            aria-label="Playback position"
            aria-valuetext={`${formatTime(isDragging ? (dragValue / 100) * duration : currentTime)} of ${formatTime(duration)}`}
          />
        </div>

        <div className={`console-gain ${muted ? "is-muted" : ""}`}>
          <div className="studio-label console-gain__label">Output Gain</div>
          <div className="console-gain__row">
            <button
              type="button"
              className="console-icon-btn console-icon-btn--mute"
              onClick={toggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
              aria-pressed={muted}
              title={muted ? "Unmute" : "Mute"}
            >
              <VolumeIcon volume={volume} muted={muted} size={16} />
            </button>
            <input
              className="player-range"
              type="range"
              min="0"
              max="100"
              value={volume * 100}
              onChange={handleVolume}
              aria-label="Output volume"
              aria-valuetext={`${Math.round(volume * 100)} percent`}
            />
          </div>
        </div>

        {currentTrack && (
          <PlayerActionPanel
            actionState={visibleTrackActions}
            loading={actionPanelLoading}
            saved={Boolean(visibleTrackActions?.library?.saved)}
            saving={savingTrack}
            onAction={handlePlayerAction}
          />
        )}

        <div className="queue-section" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: "1 1 auto" }}>
          <div className="studio-label" style={{ marginBottom: "var(--space-2)" }}>Queue Manifest</div>
          <div
            className="queue-list"
            style={{ overflowY: "auto", paddingRight: "8px" }}
            tabIndex={0}
            aria-label="Playback queue"
          >
            {queue.length > 0 ? (
              queue.map((track, idx) => (
                <div
                  key={`${track.id}-${idx}`}
                  className={`queue-item ${currentIndex === idx ? "queue-item-active" : ""}`}
                  onClick={() => playQueue(queue, idx)}
                  onContextMenu={(e) => handleContextMenu(e, track)}
                >
                  <div className="queue-item-left">
                    <div className="queue-item-name">{track.title}</div>
                    <div className="queue-item-artist">{track.artist || "Unknown Artist"}</div>
                  </div>
                  <div className="queue-item-right">
                    <span className="queue-item-duration">{formatDuration(track.duration)}</span>
                    <button
                      type="button"
                      className="queue-remove-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeFromQueue(idx);
                      }}
                      aria-label={`Remove ${track.title} from queue`}
                      title="Remove from queue"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="player-queue-empty">
                <span className="player-queue-empty__icon" aria-hidden="true">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                </span>
                <strong>Your session is empty</strong>
                <span className="player-queue-empty__hint">
                  Play a track to build your queue. Save, playlist, stem, and license
                  actions appear here once something&apos;s playing.
                </span>
              </div>
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
