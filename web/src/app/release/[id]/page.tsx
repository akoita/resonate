"use client";

import { useRef, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getRelease, Release, updateReleaseArtwork, getReleaseArtworkUrl } from "../../../lib/api";
import { LocalTrack, saveTrackMetadata } from "../../../lib/localLibrary";
import { Button } from "../../../components/ui/Button";
import { usePlayer } from "../../../lib/playerContext";
import { AddToPlaylistModal } from "../../../components/library/AddToPlaylistModal";
import { useToast } from "../../../components/ui/Toast";
import { addTracksByCriteria } from "../../../lib/playlistStore";
import { formatDuration } from "../../../lib/metadataExtractor";
import { useAuth } from "../../../components/auth/AuthProvider";

// Helper to get duration from track's first stem
const getTrackDuration = (track: { stems?: Array<{ durationSeconds?: number | null }> }): number => {
  return track.stems?.[0]?.durationSeconds ?? 0;
};

export default function ReleaseDetails() {
  const { id } = useParams();
  const router = useRouter();
  const { playQueue } = usePlayer();
  const { addToast } = useToast();
  const { token, userId } = useAuth();
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [isUpdatingArtwork, setIsUpdatingArtwork] = useState(false);
  const [tracksToAddToPlaylist, setTracksToAddToPlaylist] = useState<LocalTrack[] | null>(null);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const artworkInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof id === "string") {
      getRelease(id)
        .then(setRelease)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [id]);

  const handlePlayTrack = (trackIndex: number) => {
    if (!release?.tracks) return;
    const playableTracks: LocalTrack[] = (release.tracks || []).map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist || release.primaryArtist || release.artist?.displayName || "Unknown Artist",
      albumArtist: null,
      album: release.title,
      year: release.releaseDate ? new Date(release.releaseDate).getFullYear() : null,
      genre: release.genre || null,
      duration: getTrackDuration(t),
      createdAt: t.createdAt,
      remoteUrl: t.stems && t.stems.length > 0 ? t.stems[0].uri : undefined,
      remoteArtworkUrl: release.artworkUrl || undefined,
    }));
    void playQueue(playableTracks, trackIndex);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapToLocalTrack = (t: any, idx: number): LocalTrack => ({
    id: t.id,
    title: t.title,
    artist: t.artist || release?.primaryArtist || release?.artist?.displayName || "Unknown Artist",
    albumArtist: null,
    album: release?.title || "Unknown Album",
    year: release?.releaseDate ? new Date(release.releaseDate).getFullYear() : null,
    genre: release?.genre || null,
    duration: getTrackDuration(t),
    createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : new Date().toISOString(),
    remoteUrl: t.stems && t.stems.length > 0 ? t.stems[0].uri : undefined,
    remoteArtworkUrl: release?.artworkUrl || undefined,
  });

  const handlePlayAll = () => handlePlayTrack(0);

  const handleAddReleaseToPlaylist = async () => {
    if (!release?.tracks) return;
    const allTracks = release.tracks.map((t, idx) => mapToLocalTrack(t, idx));
    setTracksToAddToPlaylist(allTracks);
  };

  const handleSaveToLibrary = async () => {
    if (!release?.tracks) return;
    try {
      const allTracks = release.tracks.map((t, idx) => mapToLocalTrack(t, idx));
      for (const track of allTracks) {
        await saveTrackMetadata(track);
      }
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

  const isOwner = release?.artist?.userId === userId;

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

            const allTracks = release.tracks.map((t, idx) => mapToLocalTrack(t, idx));
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
            {isOwner && (
              <Button variant="ghost" className="btn-save" onClick={() => artworkInputRef.current?.click()}>
                Edit Cover
              </Button>
            )}
          </div>
        </div>
      </header>

      <section className="tracklist-section glass-panel">
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
                        .map((t, i) => mapToLocalTrack(t, i));
                      const payload = JSON.stringify({
                        type: "release-selection",
                        tracks: selectedTracks,
                        count: selectedTracks.length,
                      });
                      e.dataTransfer.setData("application/json", payload);
                      e.dataTransfer.setData("text/plain", payload);
                    } else {
                      const localTrack = mapToLocalTrack(track, idx);
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
                    <Button
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTracksToAddToPlaylist([mapToLocalTrack(track, idx)]);
                      }}
                    >
                      + Playlist
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

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

        .tracklist-section {
          padding: 24px;
          border-radius: 24px;
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
          min-width: 300px;
        }

        .track-title-info {
          display: flex;
          align-items: center;
          gap: 12px;
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
      `}</style>
    </div>
  );
}
