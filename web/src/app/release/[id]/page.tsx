"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getRelease, Release, updateReleaseArtwork, getReleaseArtworkUrl } from "../../../lib/api";
import { LocalTrack, saveTracksMetadata } from "../../../lib/localLibrary";
import { Button } from "../../../components/ui/Button";
import { usePlayer } from "../../../lib/playerContext";
import { AddToPlaylistModal } from "../../../components/library/AddToPlaylistModal";
import { MixerConsole } from "../../../components/player/MixerConsole";
import { useUIStore } from "../../../lib/uiStore";
import { useToast } from "../../../components/ui/Toast";
// import { addTracksByCriteria } from "../../../lib/playlistStore";
import { formatDuration } from "../../../lib/metadataExtractor";
import { useAuth } from "../../../components/auth/AuthProvider";
import { MintStemButton } from "../../../components/marketplace/MintStemButton";
import { TrackActionMenu } from "../../../components/ui/TrackActionMenu";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useWebSockets, TrackStatusUpdate, ReleaseStatusUpdate, ReleaseProgressUpdate } from "../../../hooks/useWebSockets";
import { StemPricingPanel } from "../../../components/release/StemPricingPanel";
import { LicensingInfoSection } from "../../../components/release/LicensingInfoSection";
import "../../../styles/license-badges.css";

// Helper to get duration from track's first stem
const getTrackDuration = (track: { stems?: Array<{ durationSeconds?: number | null }> }): number => {
  return track.stems?.[0]?.durationSeconds ?? 0;
};

export default function ReleaseDetails() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    playQueue,
    mixerMode,
    toggleMixerMode,
    mixerVolumes,
    setMixerVolumes,
    currentTrack
  } = usePlayer();
  const { addToast } = useToast();
  const { token, userId } = useAuth();
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [isUpdatingArtwork, setIsUpdatingArtwork] = useState(false);
  const [tracksToAddToPlaylist, setTracksToAddToPlaylist] = useState<LocalTrack[] | null>(null);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [trackStems, setTrackStems] = useState<Record<string, string>>({}); // trackId -> stemType (e.g. 'vocals')
  const [expandedNftTracks, setExpandedNftTracks] = useState<Set<string>>(new Set());
  const artworkInputRef = useRef<HTMLInputElement>(null);
  const [recentlyCompletedTracks, setRecentlyCompletedTracks] = useState<Set<string>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; variant: "danger" | "warning" | "default"; confirmLabel: string; onConfirm: () => Promise<void> } | null>(null);
  const [trackProgress, setTrackProgress] = useState<Record<string, number>>({});

  // Handle real-time track progress updates via WebSocket
  const handleProgressUpdate = useCallback((data: ReleaseProgressUpdate) => {
    if (data.releaseId !== id) return;
    setTrackProgress(prev => ({ ...prev, [data.trackId]: data.progress }));
  }, [id]);

  // Handle real-time track status updates via WebSocket
  const handleTrackStatusUpdate = useCallback((data: TrackStatusUpdate) => {
    if (data.releaseId !== id) return;

    setRelease(prev => {
      if (!prev || !prev.tracks) return prev;
      return {
        ...prev,
        tracks: prev.tracks.map(track =>
          track.id === data.trackId
            ? { ...track, processingStatus: data.status }
            : track
        ),
      };
    });

    // Clear progress when status changes away from separating
    if (data.status !== 'separating') {
      setTrackProgress(prev => {
        const next = { ...prev };
        delete next[data.trackId];
        return next;
      });
    }

    // Track completion with visual feedback
    if (data.status === 'complete') {
      setRecentlyCompletedTracks(prev => new Set([...prev, data.trackId]));
      // Remove from recently completed after 3 seconds
      setTimeout(() => {
        setRecentlyCompletedTracks(prev => {
          const next = new Set(prev);
          next.delete(data.trackId);
          return next;
        });
      }, 3000);
    }
  }, [id]);

  // Handle release status updates (for when processing completes)
  const handleReleaseStatusUpdate = useCallback((data: ReleaseStatusUpdate) => {
    if (data.releaseId !== id) return;

    if (data.status === 'ready') {
      // Refresh release data to get updated stems and tracks
      getRelease(id as string).then(freshRelease => {
        if (freshRelease) {
          setRelease(freshRelease);
          addToast({
            title: "Processing Complete",
            message: `"${freshRelease.title}" is now ready to play!`,
            type: "success",
          });
        }
      }).catch(console.error);
    } else if (data.status === 'failed') {
      setRelease(prev => prev ? { ...prev, status: 'failed' } : null);
      addToast({
        title: "Processing Failed",
        message: "There was an error processing your release.",
        type: "error",
      });
    }
  }, [id, addToast]);

  // Subscribe to WebSocket events for real-time updates
  useWebSockets(handleReleaseStatusUpdate, handleProgressUpdate, handleTrackStatusUpdate);

  useEffect(() => {
    if (typeof id === "string") {
      getRelease(id)
        .then((r) => {
          if (r) {
            // If a ?rev= param is present (e.g. from post-publish toast), bust artwork cache
            const rev = searchParams.get('rev');
            if (rev && r.artworkUrl) {
              r.artworkUrl = `${r.artworkUrl}?rev=${rev}`;
            }
          }
          setRelease(r);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [id, searchParams]);

  // Auto-enable mixer mode when navigating from Quick Mix CTA (?mixer=true&stem=vocals)
  useEffect(() => {
    if (searchParams.get('mixer') === 'true' && !mixerMode && release?.tracks?.length) {
      toggleMixerMode();
      // Solo the specific stem if provided
      const stemParam = searchParams.get('stem');
      if (stemParam) {
        const stemTypes = ["vocals", "drums", "bass", "piano", "guitar", "other"];
        const newVolumes: Record<string, number> = {};
        for (const st of stemTypes) {
          newVolumes[st] = st.toLowerCase() === stemParam.toLowerCase() ? 1 : 0;
        }
        setMixerVolumes(newVolumes);
      }
      // Play the first track to activate the mixer immediately
      handlePlayTrack(0);
    }
    // Only run once when release loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release?.id]);

  const handlePlayTrack = (trackIndex: number, specificStem?: string) => {
    if (!release?.tracks) return;
    const playableTracks: LocalTrack[] = (release.tracks || []).map((t) => {
      // Use ORIGINAL stem for uploaded tracks, or 'master' for AI-generated tracks
      const originalStem = t.stems?.find(s => s.type === 'ORIGINAL')
        || t.stems?.find(s => s.type === 'master')
        || t.stems?.[0]; // fallback to first stem

      // Construct stream URL: prefer stem URI, fall back to catalog stream endpoint
      const streamUrl = originalStem?.uri
        || (release.id && t.id ? `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/catalog/releases/${release.id}/tracks/${t.id}/stream` : undefined);

      return {
        id: t.id,
        title: t.title,
        artist: t.artist || release.primaryArtist || release.artist?.displayName || "Unknown Artist",
        albumArtist: null,
        album: release.title,
        year: release.releaseDate ? new Date(release.releaseDate).getFullYear() : null,
        genre: release.genre || null,
        duration: getTrackDuration(t),
        createdAt: t.createdAt,
        remoteUrl: streamUrl,
        remoteArtworkUrl: release.artworkUrl || undefined,
        stems: t.stems,
      };
    });
    void playQueue(playableTracks, trackIndex);
  };

  const handleStemChange = (trackId: string, trackIndex: number, type: string) => {
    setTrackStems(prev => ({ ...prev, [trackId]: type }));

    const isOriginal = type.toUpperCase() === "ORIGINAL";
    const isTrackAlreadyPlaying = currentTrack?.id === trackId;

    if (isOriginal) {
      // Playing full track - disable mixer mode for clean playback
      if (mixerMode) {
        toggleMixerMode();
      }
      // If track is already playing, don't re-queue (just let mixer mode change take effect)
      if (!isTrackAlreadyPlaying) {
        handlePlayTrack(trackIndex, type);
      }
    } else {
      // Playing an individual stem - enable mixer and solo it
      if (!mixerMode) {
        toggleMixerMode();
      }

      // Solo the selected stem: set it to 100%, mute all others
      const stemTypes = ["vocals", "drums", "bass", "piano", "guitar", "other"];
      const newVolumes: Record<string, number> = {};
      for (const stemType of stemTypes) {
        newVolumes[stemType] = stemType.toLowerCase() === type.toLowerCase() ? 1 : 0;
      }
      setMixerVolumes(newVolumes);

      // Only start playback if track isn't already playing
      // IMPORTANT: Call synchronously to preserve user gesture context for browser audio
      // The toggleMixerMode above sets the ref immediately, so playTrack will see the correct state
      if (!isTrackAlreadyPlaying) {
        handlePlayTrack(trackIndex, type);
      }
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapToLocalTrack = (t: any): LocalTrack => {
    // Use ORIGINAL stem for playback URL (same as handlePlayTrack)
    // stems[0] is typically an encrypted separated stem, NOT the playable original
    const originalStem = t.stems?.find(
      (s: { type?: string }) => s.type?.toUpperCase() === "ORIGINAL",
    );
    return {
      id: t.id,
      title: t.title,
      artist: t.artist || release?.primaryArtist || release?.artist?.displayName || "Unknown Artist",
      albumArtist: null,
      album: release?.title || "Unknown Album",
      year: release?.releaseDate ? new Date(release.releaseDate).getFullYear() : null,
      genre: release?.genre || null,
      duration: getTrackDuration(t),
      createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
      remoteUrl: originalStem?.uri,
      remoteArtworkUrl: release?.artworkUrl || undefined,
      stems: t.stems,
    };
  };

  const handlePlayAll = () => handlePlayTrack(0);

  const handleAddReleaseToPlaylist = async () => {
    if (!release?.tracks) return;
    const allTracks = release.tracks.map((t) => mapToLocalTrack(t));
    setTracksToAddToPlaylist(allTracks);
  };

  const handleSaveToLibrary = async () => {
    if (!release?.tracks) return;
    try {
      const allTracks = release.tracks.map((t) => mapToLocalTrack(t));
      await saveTracksMetadata(allTracks, "remote");
      addToast({
        title: "Success",
        message: `Saved ${allTracks.length} tracks to library`,
        type: "success",
      });
    } catch (error) {
      console.error("Failed to save to library:", error);
      addToast({
        title: "Error",
        message: "Failed to save to library",
        type: "error",
      });
    }
  };

  const handleArtworkChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !release || !token) return;

    // Optional: local preview for instant feedback
    const previewUrl = URL.createObjectURL(file);
    const originalUrl = release.artworkUrl;

    // Optimistic update
    setRelease(prev => prev ? { ...prev, artworkUrl: previewUrl } : null);
    setIsUpdatingArtwork(true);

    try {
      const formData = new FormData();
      formData.append("artwork", file);

      const result = await updateReleaseArtwork(token, release.id, formData);

      if (result.success) {
        // Force refresh the image by using the helper which ensures API_BASE is included
        // and adding a fresh timestamp to bypass browser cache
        const newUrl = `${getReleaseArtworkUrl(release.id)}?rev=${Date.now()}`;
        setRelease(prev => prev ? { ...prev, artworkUrl: newUrl } : null);
        addToast({
          title: "Artwork updated",
          message: "The release cover has been successfully updated.",
          type: "success"
        });
      }
    } catch (err) {
      console.error("Artwork update failed", err);
      // Revert on error
      setRelease(prev => prev ? { ...prev, artworkUrl: originalUrl } : null);
      addToast({
        title: "Update failed",
        message: "Failed to upload new artwork. Please try again.",
        type: "error"
      });
    } finally {
      setIsUpdatingArtwork(false);
    }
  };

  const isOwner = release?.artist?.userId?.toLowerCase() === userId?.toLowerCase();

  if (loading) return <div className="loading-state">Initializing Studio...</div>;
  if (!release) return <div className="error-state">Release not found.</div>;

  return (
    <div className="release-details-container fade-in-up">
      <div className="mesh-gradient-bg" />

      <header className="release-header">
        <div
          className={`header-artwork-container draggable-album ${isOwner ? 'editable' : ''}`}
          draggable="true"
          onDragStart={(e) => {
            e.stopPropagation();
            if (!release.tracks) return;

            const allTracks = release.tracks.map((t) => mapToLocalTrack(t));
            const payload = JSON.stringify({
              type: "release-album",
              tracks: allTracks,
              title: release.title,
              count: allTracks.length,
            });

            e.dataTransfer.setData("application/json", payload);
            e.dataTransfer.setData("text/plain", payload);
            e.dataTransfer.effectAllowed = "copy";

            // Set a custom drag image
            const target = e.currentTarget as HTMLElement;
            e.dataTransfer.setDragImage(target, 75, 75);
          }}
          onClick={() => isOwner && artworkInputRef.current?.click()}
          title={isOwner ? "Click to change artwork, drag to add to playlist" : "Drag to add entire album to playlist"}
        >
          {release.artworkUrl ? (
            <img
              src={release.artworkUrl}
              alt={release.title}
              /* eslint-disable-next-line @next/next/no-img-element */
              className={`header-artwork ${isUpdatingArtwork ? 'opacity-50' : ''}`}
              draggable="false"
            />
          ) : (
            <div className="header-artwork-placeholder">🎵</div>
          )}
          {isOwner && (
            <div className="edit-artwork-overlay">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span>{isUpdatingArtwork ? 'Uploading...' : 'Change Cover'}</span>
            </div>
          )}
          {isOwner && !isUpdatingArtwork && (
            <div className="edit-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </div>
          )}
          <div className="drag-badge">Drag Album</div>
        </div>

        <input
          type="file"
          ref={artworkInputRef}
          style={{ display: "none" }}
          accept="image/*"
          onChange={handleArtworkChange}
        />

        <div className="header-info">
          <div className="header-metadata">
            <span className="release-type-badge">{release.type}</span>
            <span className="release-year">{release.releaseDate ? new Date(release.releaseDate).getFullYear() : '2026'}</span>
          </div>
          <h1 className="release-title-lg text-gradient">{release.title}</h1>
          <div className="release-artist-row">
            <div className="artist-avatar" />
            <span
              className="artist-name clickable"
              onClick={(e) => {
                e.stopPropagation();
                const id = release.artist?.id || release.artistId;
                const name = release.primaryArtist || release.artist?.displayName;
                const target = id || name;
                if (target) router.push(`/artist/${encodeURIComponent(target)}`);
              }}
            >
              {release.primaryArtist || release.artist?.displayName || "Unknown Artist"}
            </span>
            <span className="dot" />
            <span className="track-count">{release.tracks?.length || 0} tracks</span>
          </div>

          <div className="header-actions">
            <Button onClick={handlePlayAll} className="btn-play-all">
              Play All
            </Button>
            <Button variant="ghost" className="btn-save" onClick={handleAddReleaseToPlaylist}>
              Add to Playlist
            </Button>
            <Button variant="ghost" className="btn-save" onClick={handleSaveToLibrary}>
              Save to Library
            </Button>
            {/* Produce Stems: show when owner has tracks with only the original stem and not currently processing */}
            {isOwner && release.status !== 'processing' && release.tracks?.some(t => !t.stems || t.stems.length <= 1) && (
              <Button
                variant="ghost"
                className="btn-save"
                style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                onClick={async () => {
                  if (!token) return;
                  try {
                    const { retryRelease } = await import("../../../lib/api");
                    await retryRelease(token, release.id);
                    addToast({ type: "success", title: "Stems processing started!", message: "Your tracks are being separated into stems by Demucs." });
                    // Optimistic: mark tracks as processing
                    setRelease(prev => prev ? {
                      ...prev,
                      status: 'processing',
                      tracks: prev.tracks?.map(t =>
                        (!t.stems || t.stems.length <= 1)
                          ? { ...t, processingStatus: 'separating' as const }
                          : t
                      )
                    } : null);
                  } catch (e) {
                    console.error(e);
                    addToast({ type: "error", title: "Failed", message: "Could not start stem production." });
                  }
                }}
              >
                🎛️ Produce Stems
              </Button>
            )}
            {isOwner && (release.status === 'failed' || release.status === 'processing' || release.tracks?.some(t => t.processingStatus === 'failed')) && (
              <Button
                className="btn-retry"
                onClick={async () => {
                  if (!token) return;
                  try {
                    const { retryRelease } = await import("../../../lib/api");
                    await retryRelease(token, release.id);
                    addToast({ type: "success", title: "Retrying...", message: "Processing restarted." });
                    // Optimistic update
                    setRelease(prev => prev ? { ...prev, status: 'processing', tracks: prev.tracks?.map(t => ({ ...t, processingStatus: 'separating' as const })) } : null);
                  } catch (e) {
                    console.error(e);
                    addToast({ type: "error", title: "Retry failed", message: "Could not restart processing." });
                  }
                }}
                style={{
                  backgroundColor: release.status === 'failed' || release.tracks?.some(t => t.processingStatus === 'failed')
                    ? 'var(--color-error)'
                    : 'var(--color-warning, #eab308)',
                  color: 'white',
                  borderColor: 'transparent'
                }}
              >
                {release.status === 'failed' || release.tracks?.some(t => t.processingStatus === 'failed') ? 'Retry Processing' : 'Restart Processing'}
              </Button>
            )}
            {/* Global Mixer Toggle - only show when track has Demucs-separated stems */}
            {currentTrack && currentTrack.stems && currentTrack.stems.some(s => !['ORIGINAL', 'master', 'other'].includes(s.type)) && (
              <Button
                variant="ghost"
                className={`btn-mixer ${mixerMode ? 'active' : ''}`}
                onClick={toggleMixerMode}
              >
                🎚️ Mixer
              </Button>
            )}
            {/* Three-dots menu at the rightmost position */}
            {isOwner && (
              <TrackActionMenu
                actions={[
                  {
                    label: "Edit Cover",
                    icon: <span>🖼️</span>,
                    onClick: () => artworkInputRef.current?.click(),
                  },
                  ...(release.status === 'processing' ? [{
                    label: "Cancel Processing",
                    icon: <span>⏹</span>,
                    variant: "destructive" as const,
                    onClick: () => {
                      if (!token) return;
                      setConfirmDialog({
                        title: "Cancel Processing",
                        message: "Stop processing this release? Tracks will be marked as failed.",
                        variant: "warning",
                        confirmLabel: "Stop Processing",
                        onConfirm: async () => {
                          try {
                            const { cancelProcessing } = await import("../../../lib/api");
                            await cancelProcessing(token, release.id);
                            addToast({ type: "success", title: "Cancelled", message: "Processing has been stopped." });
                            setRelease(prev => prev ? { ...prev, status: 'failed', tracks: prev.tracks?.map(t => ({ ...t, processingStatus: 'failed' as const })) } : null);
                          } catch (e) {
                            console.error(e);
                            addToast({ type: "error", title: "Cancel failed", message: "Could not cancel processing." });
                          } finally {
                            setConfirmDialog(null);
                          }
                        },
                      });
                    },
                  }] : []),
                  {
                    label: "Delete Release",
                    icon: <span>🗑</span>,
                    variant: "destructive" as const,
                    onClick: () => {
                      if (!token) return;
                      setConfirmDialog({
                        title: "Delete Release",
                        message: `Delete "${release.title}"? This action is permanent and cannot be undone.`,
                        variant: "danger",
                        confirmLabel: "Delete Forever",
                        onConfirm: async () => {
                          try {
                            const { deleteRelease } = await import("../../../lib/api");
                            await deleteRelease(token, release.id);
                            addToast({ type: "success", title: "Deleted", message: `"${release.title}" has been removed.` });
                            router.push("/");
                          } catch (e) {
                            console.error(e);
                            addToast({ type: "error", title: "Delete failed", message: "Could not delete the release." });
                          } finally {
                            setConfirmDialog(null);
                          }
                        },
                      });
                    },
                  },
                ]}
              />
            )}
          </div>
        </div>
      </header>

      {mixerMode && currentTrack && (
        <div className="mixer-page-section" style={{ marginBottom: 'var(--space-4)' }}>
          <MixerConsole onClose={() => toggleMixerMode()} />
        </div>
      )}

      <section className="tracklist-section glass-panel">
        <div className="tracklist-scroll-container">
          <table className="track-table">
            <thead>
              <tr>
                <th className="th-select">
                  <input
                    type="checkbox"
                    checked={selectedTrackIds.size === (release.tracks?.length || 0) && selectedTrackIds.size > 0}
                    onChange={(e) => {
                      if (e.target.checked && release.tracks) {
                        setSelectedTrackIds(new Set(release.tracks.map(t => t.id)));
                      } else {
                        setSelectedTrackIds(new Set());
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    title="Select all tracks"
                  />
                </th>
                <th>#</th>
                <th>Title</th>
                <th>Status</th>
                <th>Artist</th>
                <th>Genre</th>
                <th className="th-duration">Time</th>
                <th className="th-actions"></th>
              </tr>
            </thead>
            <tbody>
              {release.tracks?.map((track, idx) => {
                const isSelected = selectedTrackIds.has(track.id);
                return (
                  <tr
                    key={track.id}
                    className={`track-row ${isSelected ? "selected" : ""}`}
                    onClick={() => handlePlayTrack(idx)}
                    draggable
                    onDragStart={(e) => {
                      // If this track is selected, drag all selected tracks
                      // Otherwise, just drag this single track
                      if (isSelected && selectedTrackIds.size > 1) {
                        const selectedTracks = release.tracks!
                          .filter(t => selectedTrackIds.has(t.id))
                          .map((t) => mapToLocalTrack(t));
                        const payload = JSON.stringify({
                          type: "release-selection",
                          tracks: selectedTracks,
                          count: selectedTracks.length,
                        });
                        e.dataTransfer.setData("application/json", payload);
                        e.dataTransfer.setData("text/plain", payload);
                      } else {
                        const localTrack = mapToLocalTrack(track);
                        const payload = JSON.stringify({
                          type: "release-track",
                          track: localTrack,
                          title: localTrack.title,
                        });
                        e.dataTransfer.setData("application/json", payload);
                        e.dataTransfer.setData("text/plain", payload);
                      }
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                  >
                    <td className="track-select-cell">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelectedTrackIds(prev => {
                            const next = new Set(prev);
                            if (next.has(track.id)) {
                              next.delete(track.id);
                            } else {
                              next.add(track.id);
                            }
                            return next;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td className="track-num">{idx + 1}</td>
                    <td className="track-title-cell">
                      <div className="track-title-info">
                        <span className="track-title-name">{track.title}</span>
                        {track.explicit && <span className="explicit-tag">E</span>}
                      </div>

                      {track.stems && track.stems.length > 1 && (
                        <div className="stem-selector" onClick={(e) => e.stopPropagation()}>
                          <div className="stem-btns-group">
                            {["ORIGINAL", "vocals", "drums", "bass", "piano", "guitar", "other"].map((type) => {
                              const hasStem = track.stems?.some(s => s.type.toLowerCase() === type.toLowerCase());
                              if (!hasStem) return null;

                              const isSelected = (trackStems[track.id] || "ORIGINAL").toLowerCase() === type.toLowerCase();
                              return (
                                <button
                                  key={type}
                                  className={`stem-btn ${isSelected ? 'active' : ''}`}
                                  onClick={() => handleStemChange(track.id, idx, type)}
                                  title={`Play ${type}`}
                                >
                                  {type === "ORIGINAL" ? "Full" : type.charAt(0).toUpperCase() + type.slice(1, 4)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="track-status-cell">
                      {/* Processing status badge */}
                      {(track.processingStatus && track.processingStatus !== "complete") || recentlyCompletedTracks.has(track.id) ? (
                        <span
                          className={`processing-badge processing-${recentlyCompletedTracks.has(track.id) ? 'complete' : track.processingStatus}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            verticalAlign: "middle",
                            gap: 4,
                            padding: "2px 8px",
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 500,
                            background:
                              recentlyCompletedTracks.has(track.id) ? "#22c55e20" :
                                track.processingStatus === "pending" ? "#3b82f620" :
                                  track.processingStatus === "separating" ? "#eab30820" :
                                    track.processingStatus === "encrypting" ? "#f9731620" :
                                      track.processingStatus === "storing" ? "#14b8a620" :
                                        track.processingStatus === "failed" ? "#ef444420" : "transparent",
                            color:
                              recentlyCompletedTracks.has(track.id) ? "#4ade80" :
                                track.processingStatus === "pending" ? "#60a5fa" :
                                  track.processingStatus === "separating" ? "#fbbf24" :
                                    track.processingStatus === "encrypting" ? "#fb923c" :
                                      track.processingStatus === "storing" ? "#2dd4bf" :
                                        track.processingStatus === "failed" ? "#f87171" : "#a1a1aa",
                            transition: "all 0.3s ease",
                          }}
                        >
                          {recentlyCompletedTracks.has(track.id) && "✅ Complete"}
                          {!recentlyCompletedTracks.has(track.id) && track.processingStatus === "pending" && "🔵 Pending"}
                          {!recentlyCompletedTracks.has(track.id) && track.processingStatus === "separating" && (
                            trackProgress[track.id] != null
                              ? `🟡 Separating ${trackProgress[track.id]}%`
                              : "🟡 Separating..."
                          )}
                          {!recentlyCompletedTracks.has(track.id) && track.processingStatus === "encrypting" && "🟠 Encrypting..."}
                          {!recentlyCompletedTracks.has(track.id) && track.processingStatus === "storing" && "🟢 Storing..."}
                          {!recentlyCompletedTracks.has(track.id) && track.processingStatus === "failed" && "🔴 Failed"}
                        </span>
                      ) : null}
                    </td>
                    <td
                      className="track-artist clickable"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Track might have its own artist override, but usually it's string only in this object structure unless we expand it.
                        // For now, if track.artist matches release primary, we use release IDs.
                        // Otherwise fall back to name string.
                        const name = track.artist || release.primaryArtist || release.artist?.displayName;

                        // Check if it's the main artist to use the ID
                        const isMain = name === (release.primaryArtist || release.artist?.displayName);
                        const id = isMain ? (release.artist?.id || release.artistId) : null;

                        const target = id || name;
                        if (target) router.push(`/artist/${encodeURIComponent(target)}`);
                      }}
                    >
                      {track.artist || release.primaryArtist || release.artist?.displayName || "Unknown Artist"}
                    </td>
                    <td className="track-genre">{release.genre || "---"}</td>
                    <td className="track-duration">{formatDuration(getTrackDuration(track))}</td>
                    <td className="track-actions-cell">
                      <TrackActionMenu
                        actions={[
                          { label: "Add to Playlist", icon: "🎵", onClick: () => setTracksToAddToPlaylist([mapToLocalTrack(track)]) },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* NFT Marketplace Section - Only for owners */}
      {
        isOwner && release.tracks && release.tracks.some(t => t.stems && t.stems.length > 0) && (
          <section className="nft-section glass-panel">
            <div className="nft-header">
              <div>
                <h3 className="nft-title">NFT Marketplace</h3>
                <p className="nft-subtitle">Mint and list your stems as NFTs</p>
              </div>
              <a href="/marketplace" className="nft-link">
                View Marketplace →
              </a>
            </div>

            <div className="nft-tracks-scroll-container">
              <div className="nft-tracks-accordion">
                {release.tracks.map(track => {
                  const mintableStems = (track.stems || []).filter(s => s.type !== "ORIGINAL");
                  if (mintableStems.length === 0) return null;

                  const isExpanded = expandedNftTracks.has(track.id);
                  const toggleExpand = () => {
                    setExpandedNftTracks(prev => {
                      const next = new Set(prev);
                      if (next.has(track.id)) {
                        next.delete(track.id);
                      } else {
                        next.add(track.id);
                      }
                      return next;
                    });
                  };

                  return (
                    <div key={track.id} className={`nft-track-group ${isExpanded ? 'expanded' : ''}`}>
                      <button className="nft-track-header" onClick={toggleExpand}>
                        <div className="nft-track-left">
                          <span className="nft-chevron">{isExpanded ? '▼' : '▶'}</span>
                          <span className="nft-track-title">{track.title}</span>
                        </div>
                        <span className="nft-stem-count">{mintableStems.length} stems</span>
                      </button>

                      {isExpanded && (
                        <div className="nft-stems-grid">
                          {mintableStems.map(stem => (
                            <div key={stem.id} className="nft-stem-chip">
                              <span className="nft-stem-emoji">
                                {stem.type === "vocals" ? "🎤" :
                                  stem.type === "drums" ? "🥁" :
                                    stem.type === "bass" ? "🎸" :
                                      stem.type === "piano" ? "🎹" :
                                        stem.type === "guitar" ? "🎸" : "🎵"}
                              </span>
                              <span className="nft-stem-name">
                                {stem.type.charAt(0).toUpperCase() + stem.type.slice(1)}
                              </span>
                              <MintStemButton
                                stemId={stem.id}
                                stemTitle={`${stem.type} - ${track.title}`}
                                stemType={stem.type}
                                trackTitle={track.title}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="nft-royalties-banner">
              <div className="nft-royalties-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <div>
                <div className="nft-royalties-title">Enforced Royalties</div>
                <div className="nft-royalties-desc">5% royalty on all secondary sales, paid automatically</div>
              </div>
            </div>
          </section>
        )
      }

      {/* Stem Pricing Panel - Only for owners with stems */}
      {isOwner && release.tracks && (() => {
        const pricingTracks = release.tracks
          .map((t) => ({
            trackId: t.id,
            trackTitle: t.title,
            stems: (t.stems || [])
              .filter((s) => s.type !== "ORIGINAL")
              .map((s) => ({ id: s.id, type: s.type })),
          }))
          .filter((t) => t.stems.length > 0);
        if (pricingTracks.length === 0) return null;
        return <StemPricingPanel releaseId={release.id} tracks={pricingTracks} />;
      })()}

      {/* Public Licensing Info — visible to ALL users */}
      <LicensingInfoSection />

      <footer className="release-footer">
        <div className="credits-section">
          <h3>Credits</h3>
          <div className="credits-grid">
            <div className="credit-item">
              <span className="credit-label">Label</span>
              <span className="credit-value">{release.label || "Independent"}</span>
            </div>
            <div className="credit-item">
              <span className="credit-label">Released</span>
              <span className="credit-value">{release.releaseDate ? new Date(release.releaseDate).toLocaleDateString() : "Unknown"}</span>
            </div>
            {release.featuredArtists && (
              <div className="credit-item">
                <span className="credit-label">Featuring</span>
                <span className="credit-value">{release.featuredArtists}</span>
              </div>
            )}
          </div>
        </div>
      </footer>

      <AddToPlaylistModal
        tracks={tracksToAddToPlaylist}
        onClose={() => setTracksToAddToPlaylist(null)}
      />

      <style jsx>{`
        .release-details-container {
          max-width: 1400px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 60px;
          padding: 40px 60px 120px;
        }

        .release-header {
          display: flex;
          gap: 60px;
          align-items: flex-end;
          padding-top: 40px;
        }

        .header-artwork-container {
          width: 320px;
          height: 320px;
          flex-shrink: 0;
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 40px 80px rgba(0, 0, 0, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .header-artwork {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: opacity 0.3s ease;
        }

        .header-artwork-container.editable {
          cursor: pointer;
          position: relative;
        }

        .edit-artwork-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          opacity: 0;
          transition: opacity 0.3s ease;
          color: #fff;
          font-weight: 700;
          font-size: 14px;
        }

        .header-artwork-container.editable:hover .edit-artwork-overlay {
          opacity: 1;
        }

        .edit-badge {
          position: absolute;
          top: 12px;
          right: 12px;
          width: 28px;
          height: 28px;
          background: var(--color-accent);
          color: #fff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          z-index: 10;
          border: 2px solid rgba(255, 255, 255, 0.2);
        }

        .opacity-50 {
          opacity: 0.5;
        }

        .header-artwork-placeholder {
          width: 100%;
          height: 100%;
          background: var(--studio-surface-raised);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 80px;
        }

        .header-info {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .header-metadata {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-bottom: 20px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .release-type-badge {
          background: var(--color-accent);
          color: #fff;
          padding: 4px 10px;
          border-radius: 4px;
        }

        .release-year {
          color: var(--color-muted);
        }

        .release-title-lg {
          font-size: 84px;
          font-weight: 900;
          line-height: 0.9;
          margin-bottom: 32px;
          letter-spacing: -0.04em;
        }

        .release-artist-row {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 48px;
          font-size: 16px;
        }

        .artist-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--color-accent), #fff);
        }

        .artist-name {
          font-weight: 800;
          color: #fff;
          cursor: pointer;
          transition: color 0.2s;
        }
        .artist-name:hover {
          color: var(--color-accent);
          text-decoration: underline;
        }

        .dot {
          width: 4px;
          height: 4px;
          background: var(--color-muted);
          border-radius: 50%;
        }

        .track-count {
          color: var(--color-muted);
          font-weight: 600;
        }

        .header-actions {
          display: flex;
          gap: 16px;
        }

        .btn-play-all {
          background: #fff !important;
          color: #000 !important;
          font-weight: 700 !important;
          border-radius: 50px !important;
          padding: 0 40px !important;
          height: 56px !important;
        }

        .btn-save {
          border-radius: 50px !important;
          padding: 0 32px !important;
          height: 56px !important;
          border-color: rgba(255, 255, 255, 0.2) !important;
        }

        .btn-mixer {
          border-radius: 50px !important;
          padding: 0 24px !important;
          height: 56px !important;
          border-color: var(--color-accent) !important;
          color: var(--color-accent) !important;
          font-weight: 700 !important;
          transition: all 0.2s ease !important;
        }

        .btn-mixer:hover,
        .btn-mixer.active {
          background: var(--color-accent) !important;
          color: #fff !important;
        }

        .tracklist-section {
          padding: 24px;
          border-radius: 24px;
        }

        .tracklist-scroll-container {
          max-height: 600px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
        }

        .tracklist-scroll-container::-webkit-scrollbar {
          width: 6px;
        }

        .tracklist-scroll-container::-webkit-scrollbar-track {
          background: transparent;
        }

        .tracklist-scroll-container::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15);
          border-radius: 3px;
        }

        .tracklist-scroll-container::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        .track-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }

        .track-table th {
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          color: var(--color-muted);
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .th-duration {
          text-align: right;
        }

        .track-row {
          transition: background 0.2s;
          cursor: pointer;
        }

        .track-row:hover {
          background: rgba(255, 255, 255, 0.05);
        }

        .track-row td {
          padding: 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.02);
          font-size: 14px;
        }

        .track-num {
          width: 40px;
          color: var(--color-muted);
          text-align: center;
        }

        .track-title-cell {
          min-width: 250px;
        }

        .track-status-cell {
          width: 140px;
          min-width: 140px;
        }

        .track-title-info {
          display: flex;
          align-items: center;
          flex-wrap: nowrap;
          gap: 8px;
        }

        .track-title-name {
          font-weight: 700;
          color: #fff;
        }

        .explicit-tag {
          font-size: 9px;
          background: rgba(255, 255, 255, 0.2);
          color: rgba(255, 255, 255, 0.8);
          padding: 1px 4px;
          border-radius: 2px;
          font-weight: 700;
        }

        .stem-selector {
          display: flex;
          gap: 6px;
          margin-top: 8px;
        }

        .stem-btn {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: var(--color-muted);
          font-size: 10px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 4px;
          transition: all 0.2s;
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .stem-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }

        .stem-btn.active {
          background: var(--color-accent);
          border-color: var(--color-accent);
          color: #fff;
          box-shadow: 0 0 10px rgba(var(--color-accent-rgb), 0.4);
        }

        .track-artist, .track-genre {
          color: var(--color-muted);
        }

        .track-duration {
          text-align: right;
          color: var(--color-muted);
          font-family: monospace;
        }

        .track-actions-cell {
          text-align: right;
          width: 120px;
        }

        .track-row:hover .track-action-menu-trigger {
          opacity: 1;
        }

        .th-actions {
          width: 120px;
        }

        .release-footer {
          margin-top: 40px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          padding-top: 60px;
        }

        .credits-section h3 {
          font-size: 20px;
          font-weight: 800;
          margin-bottom: 32px;
        }

        .credits-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 40px;
        }

        .credit-item {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .credit-label {
          font-size: 12px;
          font-weight: 700;
          color: var(--color-muted);
          text-transform: uppercase;
        }

        .credit-value {
          font-size: 15px;
          color: #fff;
          font-weight: 600;
        }

        .loading-state, .error-state {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 60vh;
          font-size: 24px;
          font-weight: 700;
          color: var(--color-muted);
        }

        /* NFT Marketplace Accordion Styles */
        .nft-section {
          padding: 24px;
          border-radius: 24px;
        }

        .nft-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
        }

        .nft-title {
          font-size: 20px;
          font-weight: 800;
          color: #fff;
          margin: 0;
        }

        .nft-subtitle {
          font-size: 14px;
          color: #71717a;
          margin: 4px 0 0;
        }

        .nft-link {
          font-size: 13px;
          color: #10b981;
          text-decoration: none;
          font-weight: 600;
          transition: color 0.2s;
        }

        .nft-link:hover {
          color: #34d399;
        }

        .nft-tracks-accordion {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .nft-tracks-scroll-container {
          max-height: 500px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
        }

        .nft-tracks-scroll-container::-webkit-scrollbar {
          width: 6px;
        }

        .nft-tracks-scroll-container::-webkit-scrollbar-track {
          background: transparent;
        }

        .nft-tracks-scroll-container::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15);
          border-radius: 3px;
        }

        .nft-tracks-scroll-container::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        .nft-track-group {
          background: #18181b;
          border-radius: 12px;
          border: 1px solid #27272a;
          overflow: hidden;
          transition: border-color 0.2s;
        }

        .nft-track-group.expanded {
          border-color: #3f3f46;
        }

        .nft-track-header {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          background: transparent;
          border: none;
          cursor: pointer;
          color: #fff;
          transition: background 0.2s;
        }

        .nft-track-header:hover {
          background: rgba(255, 255, 255, 0.03);
        }

        .nft-track-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .nft-chevron {
          font-size: 10px;
          color: #71717a;
          transition: transform 0.2s;
        }

        .nft-track-title {
          font-size: 15px;
          font-weight: 600;
        }

        .nft-stem-count {
          font-size: 12px;
          color: #71717a;
          background: #27272a;
          padding: 4px 10px;
          border-radius: 12px;
        }

        .nft-stems-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          padding: 0 20px 20px;
          animation: fadeSlideIn 0.2s ease;
        }

        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateY(-8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .nft-stem-chip {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #27272a;
          padding: 8px 12px;
          border-radius: 10px;
          border: 1px solid #3f3f46;
          transition: border-color 0.2s, background 0.2s;
        }

        .nft-stem-chip:hover {
          background: #3f3f46;
          border-color: #52525b;
        }

        .nft-stem-emoji {
          font-size: 16px;
        }

        .nft-stem-name {
          font-size: 13px;
          font-weight: 600;
          color: #fff;
          min-width: 60px;
        }

        .nft-royalties-banner {
          margin-top: 24px;
          padding: 16px;
          background: #27272a;
          border-radius: 12px;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .nft-royalties-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: #10b981;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .nft-royalties-title {
          font-size: 13px;
          font-weight: 600;
          color: #fff;
        }

        .nft-royalties-desc {
          font-size: 12px;
          color: #71717a;
        }
      `}</style>

      {/* Confirm dialog for destructive actions */}
      <ConfirmDialog
        isOpen={!!confirmDialog}
        title={confirmDialog?.title ?? ""}
        message={confirmDialog?.message ?? ""}
        variant={confirmDialog?.variant ?? "default"}
        confirmLabel={confirmDialog?.confirmLabel ?? "Confirm"}
        onConfirm={confirmDialog?.onConfirm ?? (() => {})}
        onCancel={() => setConfirmDialog(null)}
      />
    </div >
  );
}
