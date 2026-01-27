"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getRelease, Release } from "../../../lib/api";
import { LocalTrack } from "../../../lib/localLibrary";
import { Button } from "../../../components/ui/Button";
import { usePlayer } from "../../../lib/playerContext";

export default function ReleaseDetails() {
  const { id } = useParams();
  const { playQueue } = usePlayer();
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);

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
      duration: 0,
      createdAt: t.createdAt,
      remoteUrl: t.stems && t.stems.length > 0 ? t.stems[0].uri : undefined,
      remoteArtworkUrl: release.artworkUrl || undefined,
    }));
    void playQueue(playableTracks, trackIndex);
  };

  const handlePlayAll = () => handlePlayTrack(0);

  if (loading) return <div className="loading-state">Initializing Studio...</div>;
  if (!release) return <div className="error-state">Release not found.</div>;

  return (
    <div className="release-details-container fade-in-up">
      <div className="mesh-gradient-bg" />

      <header className="release-header">
        <div className="header-artwork-container">
          {release.artworkUrl ? (
            <img src={release.artworkUrl} alt={release.title} className="header-artwork" />
          ) : (
            <div className="header-artwork-placeholder">🎵</div>
          )}
        </div>

        <div className="header-info">
          <div className="header-metadata">
            <span className="release-type-badge">{release.type}</span>
            <span className="release-year">{release.releaseDate ? new Date(release.releaseDate).getFullYear() : '2026'}</span>
          </div>
          <h1 className="release-title-lg text-gradient">{release.title}</h1>
          <div className="release-artist-row">
            <div className="artist-avatar" />
            <span className="artist-name">{release.primaryArtist || release.artist?.displayName || "Unknown Artist"}</span>
            <span className="dot" />
            <span className="track-count">{release.tracks?.length || 0} tracks</span>
          </div>

          <div className="header-actions">
            <Button onClick={handlePlayAll} className="btn-play-all">
              Play All
            </Button>
            <Button variant="ghost" className="btn-save">
              Save to Library
            </Button>
          </div>
        </div>
      </header>

      <section className="tracklist-section glass-panel">
        <table className="track-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Title</th>
              <th>Artist</th>
              <th>Genre</th>
              <th className="th-duration">Time</th>
            </tr>
          </thead>
          <tbody>
            {release.tracks?.map((track, idx) => (
              <tr
                key={track.id}
                className="track-row"
                onClick={() => handlePlayTrack(idx)}
              >
                <td className="track-num">{idx + 1}</td>
                <td className="track-title-cell">
                  <div className="track-title-info">
                    <span className="track-title-name">{track.title}</span>
                    {track.explicit && <span className="explicit-tag">E</span>}
                  </div>
                </td>
                <td className="track-artist">{track.artist || release.primaryArtist || release.artist?.displayName || "Unknown Artist"}</td>
                <td className="track-genre">{release.genre || "---"}</td>
                <td className="track-duration">--:--</td>
              </tr>
            ))}
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
