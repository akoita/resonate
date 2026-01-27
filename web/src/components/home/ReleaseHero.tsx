"use client";

import { useRouter } from "next/navigation";
import { Button } from "../ui/Button";
import { Release } from "../../lib/api";
import { LocalTrack } from "../../lib/localLibrary";
import { usePlayer } from "../../lib/playerContext";

interface ReleaseHeroProps {
  release: Release;
}

export function ReleaseHero({ release }: ReleaseHeroProps) {
  const router = useRouter();
  const { playQueue } = usePlayer();

  const handlePlay = () => {
    if (!release.tracks) return;
    const playableTracks: LocalTrack[] = release.tracks.map(t => ({
      id: t.id,
      title: t.title,
      artist: release.primaryArtist || release.artist?.displayName || "Unknown Artist",
      albumArtist: null,
      album: release.title,
      year: release.releaseDate ? new Date(release.releaseDate).getFullYear() : null,
      genre: release.genre || null,
      duration: 0,
      createdAt: t.createdAt,
      remoteUrl: t.stems && t.stems.length > 0 ? t.stems[0].uri : undefined,
      remoteArtworkUrl: release.artworkUrl || undefined,
    }));
    void playQueue(playableTracks, 0);
  };

  const handleViewDetails = () => {
    if (release.id) {
      router.push(`/release/${release.id}`);
    }
  };

  return (
    <div className="home-hero-stage glass-panel">
      {/* Dynamic Background */}
      {release.artworkUrl && (
        <div
          className="hero-backdrop-image"
          style={{ backgroundImage: `url(${release.artworkUrl})` }}
        />
      )}
      <div className="hero-backdrop-overlay" />

      <div className="hero-content">
        <div className="hero-metadata">
          <span className="hero-badge">NEW RELEASE</span>
          <span className="hero-type">{release.type}</span>
        </div>

        <h1 className="hero-main-title text-gradient">{release.title}</h1>
        <p className="hero-main-artist">
          By <span className="artist-highlight">{release.primaryArtist || release.artist?.displayName || "Unknown Artist"}</span>
        </p>

        <div className="hero-actions">
          <Button onClick={handlePlay} className="btn-main-action">
            <span className="btn-icon">▶</span> Play Now
          </Button>
          <Button
            variant="ghost"
            className="btn-secondary-action"
            onClick={handleViewDetails}
          >
            View Details
          </Button>
        </div>
      </div>

      <div className="hero-artwork-container">
        {release.artworkUrl ? (
          <img src={release.artworkUrl} alt={release.title} className="hero-artwork" />
        ) : (
          <div className="hero-artwork-placeholder">🎵</div>
        )}
      </div>

      <style jsx>{`
        .home-hero-stage {
          position: relative;
          width: 100%;
          min-height: 520px;
          border-radius: 40px;
          overflow: hidden;
          display: flex;
          align-items: center;
          padding: var(--space-12) 80px;
          margin-bottom: var(--space-12);
          transition: all 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
          transform-style: preserve-3d;
          perspective: 1000px;
        }

        .home-hero-stage:hover {
          transform: translateY(-4px);
          border-color: rgba(124, 92, 255, 0.4);
          box-shadow: 0 40px 80px rgba(0, 0, 0, 0.5), 0 0 40px rgba(124, 92, 255, 0.1);
        }

        .hero-backdrop-image {
          position: absolute;
          inset: -20px;
          background-size: cover;
          background-position: center;
          filter: blur(100px) saturate(160%) brightness(0.3);
          opacity: 0.7;
          z-index: 0;
          transition: transform 1s ease;
        }

        .home-hero-stage:hover .hero-backdrop-image {
          transform: scale(1.1);
        }

        .hero-backdrop-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, var(--studio-bg) 0%, rgba(5, 5, 8, 0.4) 60%, transparent 100%);
          z-index: 1;
        }

        .hero-content {
          position: relative;
          z-index: 10;
          flex: 1;
          max-width: 650px;
        }

        .hero-metadata {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-bottom: 24px;
        }

        .hero-badge {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.15em;
          color: var(--color-accent);
          background: rgba(124, 92, 255, 0.1);
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid rgba(124, 92, 255, 0.2);
        }

        .hero-type {
          font-size: 10px;
          font-weight: 700;
          color: var(--color-muted);
          text-transform: uppercase;
        }

        .hero-main-title {
          font-size: 72px;
          line-height: 0.95;
          margin-bottom: 16px;
          letter-spacing: -0.04em;
        }

        .hero-main-artist {
          font-size: 20px;
          color: var(--color-muted);
          margin-bottom: 40px;
        }

        .artist-highlight {
          color: #fff;
          font-weight: 600;
        }

        .hero-actions {
          display: flex;
          gap: 16px;
        }

        .btn-main-action {
          background: #fff !important;
          color: #000 !important;
          font-weight: 700 !important;
          border-radius: 50px !important;
          padding: 0 40px !important;
          height: 56px !important;
          box-shadow: 0 10px 30px rgba(255, 255, 255, 0.2) !important;
        }

        .btn-main-action:hover {
          transform: scale(1.05) translateY(-2px);
          box-shadow: 0 15px 40px rgba(255, 255, 255, 0.3) !important;
        }

        .btn-icon {
          margin-right: 8px;
          font-size: 14px;
        }

        .btn-secondary-action {
          border-radius: 50px !important;
          padding: 0 32px !important;
          height: 56px !important;
          border-color: rgba(255, 255, 255, 0.2) !important;
        }

        .hero-artwork-container {
          position: relative;
          z-index: 10;
          width: 400px;
          height: 400px;
          flex-shrink: 0;
          margin-left: 64px;
          transition: transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        .home-hero-stage:hover .hero-artwork-container {
          transform: scale(1.05) rotate(2deg);
        }

        .hero-artwork {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 24px;
          box-shadow: 0 40px 100px rgba(0, 0, 0, 0.8), 0 0 60px rgba(124, 92, 255, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.15);
        }

        .hero-artwork-placeholder {
          width: 100%;
          height: 100%;
          background: var(--studio-surface-raised);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 80px;
          border-radius: 20px;
          border: 1px dashed rgba(255, 255, 255, 0.1);
        }
      `}</style>
    </div>
  );
}
