"use client";

import { useRouter } from "next/navigation";
import { usePlayer } from "../../lib/playerContext";
import { LocalTrack } from "../../lib/localLibrary";

/** Stem shape as stored on each FeaturedStem for full-track playback */
export interface TrackStemInfo {
  id: string;
  uri: string;
  type: string;
  durationSeconds?: number | null;
  isEncrypted?: boolean;
  encryptionMetadata?: string | null;
  storageProvider?: string | null;
}

/** Stem data flattened from releases → tracks → stems */
export interface FeaturedStem {
  id: string;
  type: string;
  uri: string;
  ipnftId?: string | null;
  durationSeconds?: number | null;
  isEncrypted?: boolean;
  /** Parent track info */
  trackTitle: string;
  trackId: string;
  trackCreatedAt: string;
  /** All stems belonging to the parent track — needed for mixer playback */
  trackStems: TrackStemInfo[];
  /** Parent release info */
  releaseId: string;
  releaseTitle: string;
  releaseArtist: string;
  releaseArtworkUrl?: string | null;
}

// Color + icon map per stem type
const STEM_STYLES: Record<string, { color: string; icon: string; label: string }> = {
  original: { color: "#94a3b8", icon: "🎶", label: "Full Mix" },
  vocals: { color: "#e879f9", icon: "🎤", label: "Vocals" },
  drums: { color: "#f97316", icon: "🥁", label: "Drums" },
  bass: { color: "#22d3ee", icon: "🎸", label: "Bass" },
  guitar: { color: "#facc15", icon: "🎸", label: "Guitar" },
  piano: { color: "#a78bfa", icon: "🎹", label: "Piano" },
  other: { color: "#60a5fa", icon: "🎵", label: "Other" },
};

function getStemStyle(type: string) {
  const key = type.toLowerCase();
  return STEM_STYLES[key] || STEM_STYLES.other;
}

interface StemCardProps {
  stem: FeaturedStem;
}

export function StemCard({ stem }: StemCardProps) {
  const router = useRouter();
  const { playQueue, mixerMode, toggleMixerMode, setMixerVolumes } = usePlayer();
  const style = getStemStyle(stem.type);
  const isRemixable = !!stem.ipnftId;

  /** Play the track in mixer mode with this stem soloed */
  const handlePlay = async (e?: React.MouseEvent) => {
    e?.stopPropagation();

    // 1) Build a LocalTrack from the FeaturedStem data
    const originalStem = stem.trackStems.find(
      (s) => s.type.toUpperCase() === "ORIGINAL",
    );
    const track: LocalTrack = {
      id: stem.trackId,
      title: stem.trackTitle,
      artist: stem.releaseArtist,
      albumArtist: null,
      album: stem.releaseTitle,
      year: null,
      genre: null,
      duration: stem.durationSeconds ?? 0,
      createdAt: stem.trackCreatedAt,
      remoteUrl: originalStem?.uri,
      remoteArtworkUrl: stem.releaseArtworkUrl || undefined,
      stems: stem.trackStems,
    };

    // 2) Play — this stops any current playback and starts the new track
    await playQueue([track], 0);

    // 3) Enable mixer mode if not already on
    if (!mixerMode) {
      toggleMixerMode();
    }

    // 4) Solo the selected stem type
    const selectedType = stem.type.toLowerCase();
    const volumes: Record<string, number> = {};
    for (const s of stem.trackStems) {
      const t = s.type.toLowerCase();
      if (t === "original") continue; // never show original in mixer
      volumes[t] = t === selectedType ? 100 : 0;
    }
    setMixerVolumes(volumes);

    // 5) Navigate to the release page so the user sees the full mixer UI
    router.push(
      `/release/${stem.releaseId}?mixer=true&stem=${selectedType}`,
    );
  };

  return (
    <div
      className="stem-card glass-panel"
      onClick={handlePlay}
    >
      {/* Decorative waveform bar */}
      <div
        className="stem-card-wave"
        style={{
          background: `linear-gradient(135deg, ${style.color}33 0%, ${style.color}11 100%)`,
          borderBottom: `1px solid ${style.color}22`,
        }}
      >
        <span className="stem-card-icon">{style.icon}</span>
        <div className="stem-card-badges">
          {isRemixable && (
            <span className="stem-remixable-badge">Remixable</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="stem-card-body">
        <span className="stem-type-label" style={{ color: style.color }}>
          {style.label}
        </span>
        <p className="stem-track-title">{stem.trackTitle}</p>
        <p className="stem-release-info">
          from <span className="stem-release-name">{stem.releaseTitle}</span>
        </p>
        <p className="stem-artist">{stem.releaseArtist}</p>

        {/* Remix count + Quick Mix CTA */}
        <div className="stem-card-actions">
          <span className="stem-remix-count">0 remixes</span>
          <button
            className="stem-quick-mix-btn"
            onClick={handlePlay}
            title="Play in Mixer"
            style={{ borderColor: `${style.color}44`, color: style.color }}
          >
            ▶ Play Stem
          </button>
        </div>
      </div>

      <style jsx>{`
        .stem-card {
          min-width: 220px;
          max-width: 280px;
          border-radius: 16px;
          overflow: hidden;
          cursor: pointer;
          transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
          flex-shrink: 0;
        }

        .stem-card:hover {
          transform: translateY(-6px) scale(1.02);
          border-color: ${style.color}44;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4),
                      0 0 30px ${style.color}15;
        }

        .stem-card-wave {
          height: 80px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          position: relative;
          overflow: hidden;
        }

        .stem-card-wave::after {
          content: "";
          position: absolute;
          bottom: 8px;
          left: 12px;
          right: 12px;
          height: 24px;
          background:
            repeating-linear-gradient(
              90deg,
              ${style.color}22 0px,
              ${style.color}44 2px,
              transparent 2px,
              transparent 6px
            );
          mask: linear-gradient(
            to right,
            transparent,
            black 10%,
            black 90%,
            transparent
          );
          -webkit-mask: linear-gradient(
            to right,
            transparent,
            black 10%,
            black 90%,
            transparent
          );
          opacity: 0.7;
        }

        .stem-card-icon {
          font-size: 28px;
          z-index: 1;
          filter: drop-shadow(0 2px 8px ${style.color}44);
        }

        .stem-card-badges {
          display: flex;
          gap: 6px;
          z-index: 1;
        }

        .stem-remixable-badge {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #10b981;
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.25);
          padding: 3px 8px;
          border-radius: 6px;
        }

        .stem-card-body {
          padding: 14px 16px 16px;
        }

        .stem-type-label {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          display: block;
          margin-bottom: 6px;
        }

        .stem-track-title {
          font-size: 15px;
          font-weight: 700;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 4px;
        }

        .stem-release-info {
          font-size: 12px;
          color: var(--color-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 2px;
        }

        .stem-release-name {
          color: rgba(255, 255, 255, 0.7);
        }

        .stem-artist {
          font-size: 11px;
          color: var(--color-muted);
          opacity: 0.7;
          margin-bottom: 10px;
        }

        .stem-card-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .stem-remix-count {
          font-size: 11px;
          color: var(--color-muted);
          opacity: 0.6;
        }

        .stem-quick-mix-btn {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.05em;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid;
          padding: 4px 10px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
        }

        .stem-quick-mix-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          transform: scale(1.05);
        }
      `}</style>
    </div>
  );
}
