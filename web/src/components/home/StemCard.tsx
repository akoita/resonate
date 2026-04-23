"use client";

import type { CSSProperties } from "react";
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
  const durationLabel = stem.durationSeconds
    ? `${Math.floor(stem.durationSeconds / 60)}:${Math.floor(stem.durationSeconds % 60).toString().padStart(2, "0")}`
    : "Mixer-ready";

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

    // 2) Play the track — playQueue already stops current and starts new
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
      volumes[t] = t === selectedType ? 1 : 0;
    }
    setMixerVolumes(volumes);

    // 5) Navigate to the release page so the user sees the full mixer UI
    router.push(
      `/release/${stem.releaseId}?mixer=true&stem=${selectedType}`,
    );
  };

  return (
    <div
      className="stem-card"
      onClick={handlePlay}
      style={{ "--stem-accent": style.color } as CSSProperties}
    >
      <div className="stem-card-art">
        {stem.releaseArtworkUrl ? (
          <div
            className="stem-card-art-image"
            style={{ backgroundImage: `url(${JSON.stringify(stem.releaseArtworkUrl)})` }}
            aria-hidden="true"
          />
        ) : (
          <div className="stem-card-art-fallback" />
        )}
        <div className="stem-card-art-gradient" />
        <div className="stem-card-topline">
          <span className="stem-type-chip">
            <span className="stem-card-icon">{style.icon}</span>
            {style.label}
          </span>
          {isRemixable && (
            <span className="stem-remixable-badge">Remixable</span>
          )}
        </div>
        <div className="stem-card-play-orb" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="8 5 19 12 8 19 8 5" />
          </svg>
        </div>
        <div className="stem-card-wave" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} style={{ height: `${18 + ((i * 37) % 52)}%` }} />
          ))}
        </div>
      </div>

      <div className="stem-card-body">
        <p className="stem-track-title">{stem.trackTitle}</p>
        <p className="stem-release-info">
          <span className="stem-release-name">{stem.releaseTitle}</span> by {stem.releaseArtist}
        </p>

        <div className="stem-card-meta-row">
          <span>{durationLabel}</span>
          <span>Solo stem</span>
        </div>

        <div className="stem-card-actions">
          <button
            className="stem-quick-mix-btn"
            onClick={handlePlay}
            title="Solo this stem in the mixer"
          >
            Solo in Mixer
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
          position: relative;
          isolation: isolate;
          background:
            radial-gradient(circle at 20% 0%, color-mix(in srgb, var(--stem-accent) 28%, transparent), transparent 38%),
            rgba(18, 18, 27, 0.92);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow:
            0 20px 55px rgba(0, 0, 0, 0.32),
            inset 0 1px 0 rgba(255, 255, 255, 0.04);
          transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
          flex-shrink: 0;
        }

        .stem-card:hover {
          transform: translateY(-8px);
          border-color: color-mix(in srgb, var(--stem-accent) 50%, rgba(255, 255, 255, 0.08));
          box-shadow:
            0 28px 70px rgba(0, 0, 0, 0.48),
            0 0 42px color-mix(in srgb, var(--stem-accent) 20%, transparent);
        }

        .stem-card-art {
          position: relative;
          height: 172px;
          overflow: hidden;
        }

        .stem-card-art-image,
        .stem-card-art-fallback {
          width: 100%;
          height: 100%;
          display: block;
          background-position: center;
          background-size: cover;
          transform: scale(1.02);
          transition: transform 0.45s ease, filter 0.45s ease;
        }

        .stem-card:hover .stem-card-art-image,
        .stem-card:hover .stem-card-art-fallback {
          transform: scale(1.08);
          filter: saturate(1.1) contrast(1.05);
        }

        .stem-card-art-fallback {
          background:
            linear-gradient(135deg, color-mix(in srgb, var(--stem-accent) 72%, #12121b), #08080d),
            repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.08) 0 1px, transparent 1px 8px);
        }

        .stem-card-art-gradient {
          position: absolute;
          inset: 0;
          background:
            linear-gradient(180deg, rgba(0, 0, 0, 0.1), rgba(9, 9, 14, 0.86)),
            radial-gradient(circle at 50% 58%, color-mix(in srgb, var(--stem-accent) 34%, transparent), transparent 34%);
        }

        .stem-card-topline {
          position: absolute;
          z-index: 2;
          top: 12px;
          left: 12px;
          right: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .stem-type-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          max-width: 100%;
          padding: 6px 10px;
          border-radius: 999px;
          color: #fff;
          background: color-mix(in srgb, var(--stem-accent) 72%, rgba(0, 0, 0, 0.55));
          border: 1px solid color-mix(in srgb, var(--stem-accent) 58%, rgba(255, 255, 255, 0.16));
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .stem-card-icon {
          font-size: 14px;
          filter: drop-shadow(0 2px 8px color-mix(in srgb, var(--stem-accent) 45%, transparent));
        }

        .stem-card-play-orb {
          position: absolute;
          z-index: 2;
          left: 50%;
          top: 50%;
          width: 58px;
          height: 58px;
          transform: translate(-50%, -50%);
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          color: #fff;
          background:
            radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.24), transparent 28%),
            color-mix(in srgb, var(--stem-accent) 82%, #6d5dfc);
          box-shadow:
            0 18px 42px color-mix(in srgb, var(--stem-accent) 42%, transparent),
            0 0 0 10px rgba(255, 255, 255, 0.08);
          opacity: 0.94;
          transition: transform 0.25s ease, box-shadow 0.25s ease;
        }

        .stem-card:hover .stem-card-play-orb {
          transform: translate(-50%, -50%) scale(1.06);
          box-shadow:
            0 22px 52px color-mix(in srgb, var(--stem-accent) 56%, transparent),
            0 0 0 12px rgba(255, 255, 255, 0.1);
        }

        .stem-remixable-badge {
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #10b981;
          background: rgba(5, 18, 14, 0.72);
          border: 1px solid rgba(16, 185, 129, 0.25);
          padding: 3px 8px;
          border-radius: 999px;
          backdrop-filter: blur(10px);
        }

        .stem-card-wave {
          position: absolute;
          z-index: 2;
          left: 16px;
          right: 16px;
          bottom: 14px;
          height: 34px;
          display: flex;
          align-items: flex-end;
          gap: 4px;
          opacity: 0.88;
          mask-image: linear-gradient(90deg, transparent, black 12%, black 88%, transparent);
          -webkit-mask-image: linear-gradient(90deg, transparent, black 12%, black 88%, transparent);
        }

        .stem-card-wave span {
          flex: 1;
          min-width: 3px;
          border-radius: 999px 999px 0 0;
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--stem-accent) 96%, #fff),
            color-mix(in srgb, var(--stem-accent) 42%, transparent)
          );
          box-shadow: 0 0 16px color-mix(in srgb, var(--stem-accent) 32%, transparent);
        }

        .stem-card-body {
          padding: 16px;
        }

        .stem-track-title {
          font-size: 16px;
          font-weight: 850;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 6px;
          letter-spacing: -0.02em;
        }

        .stem-release-info {
          font-size: 12px;
          color: var(--color-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 12px;
        }

        .stem-release-name {
          color: rgba(255, 255, 255, 0.78);
        }

        .stem-card-meta-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 9px 0 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.07);
          font-size: 11px;
          color: var(--color-muted);
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          opacity: 0.8;
        }

        .stem-card-actions {
          display: flex;
          align-items: center;
          justify-content: stretch;
        }

        .stem-quick-mix-btn {
          width: 100%;
          min-height: 40px;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #fff;
          background:
            linear-gradient(135deg, color-mix(in srgb, var(--stem-accent) 55%, rgba(255, 255, 255, 0.06)), rgba(255, 255, 255, 0.05));
          border: 1px solid color-mix(in srgb, var(--stem-accent) 42%, rgba(255, 255, 255, 0.12));
          padding: 0 12px;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
        }

        .stem-quick-mix-btn:hover {
          background: color-mix(in srgb, var(--stem-accent) 22%, rgba(255, 255, 255, 0.08));
          transform: translateY(-1px);
        }
      `}</style>
    </div>
  );
}
