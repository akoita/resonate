import React from "react";
import "../../styles/punchline.css";
import { formatClipDuration, formatEditionLabel, formatPriceCents, maskSensitiveLyric } from "./punchlineDropHelpers";

/**
 * Deterministic hue (0-359) from a seed string, so every moment gets its own
 * stable accent color — no two cards in a drop look identical, and the same
 * moment always renders the same. Exported for tests.
 */
export function hueFromSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return ((hash % 360) + 360) % 360;
}

/**
 * On the no-artwork card the lyric IS the poster, so type scales inversely with
 * length — a short slogan fills the canvas, a long verse steps down to stay
 * readable. Sized by trimmed length. Exported for tests.
 */
export function lyricPosterClass(lyric: string): string {
  const length = lyric.trim().length;
  if (length <= 70) return "punchline-card-art-lyric--xl";
  if (length <= 130) return "punchline-card-art-lyric--lg";
  return "punchline-card-art-lyric--md";
}

/**
 * Live preview of a collectible moment card (#484).
 *
 * Pure presentational — the same card renders from the editor's live fields
 * (preview-before-publish) and from a persisted moment (published summary). No
 * hooks, so it renders under `renderToStaticMarkup` in tests.
 */
export interface PunchlineCollectibleCardProps {
  title: string;
  lyricText: string;
  artworkUrl?: string | null;
  durationMs: number;
  editionSize: number;
  /** Integer cents; 0 renders "Free to claim". */
  priceCents: number;
  rightsLabel: string;
  /** Shown on published cards. */
  collectedCount?: number;
  /** Animates the waveform ribbon while this moment's clip is playing. */
  playing?: boolean;
}

export function PunchlineCollectibleCard({
  title,
  lyricText,
  artworkUrl,
  durationMs,
  editionSize,
  priceCents,
  rightsLabel,
  collectedCount,
  playing,
}: PunchlineCollectibleCardProps) {
  const displayTitle = title.trim() || "Untitled moment";
  // Display-only masking of socially-weighted words: the stored lyric is never
  // mutated — the card just doesn't broadcast them on discovery surfaces.
  const displayLyric = maskSensitiveLyric(lyricText.trim());
  const hue = hueFromSeed(displayTitle + lyricText);

  return (
    <div
      className="punchline-card"
      data-testid="punchline-collectible-card"
      style={{ ["--card-hue" as never]: hue }}
    >
      <div className="punchline-card-art">
        {artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- artist-supplied remote/ipfs thumbnail; upload is out of scope
          <img
            className="punchline-card-art-img"
            src={artworkUrl}
            alt={`Artwork for ${displayTitle}`}
          />
        ) : (
          <div className="punchline-card-art-placeholder" aria-hidden="true">
            <span className="punchline-card-quote">“</span>
            <span
              className={`punchline-card-art-lyric ${lyricPosterClass(displayLyric)}`}
            >
              {displayLyric.length > 180
                ? `${displayLyric.slice(0, 180)}…`
                : displayLyric || "…"}
            </span>
          </div>
        )}
        <span className="punchline-card-serial" aria-hidden="true">
          № 1–{editionSize}
        </span>
        <span className="punchline-card-duration">
          {formatClipDuration(Math.max(0, durationMs))}
        </span>
        <span className="punchline-card-holo" aria-hidden="true" />
        <span
          className={`punchline-card-wave ${playing ? "is-playing" : ""}`}
          aria-hidden="true"
        >
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} />
          ))}
        </span>
      </div>

      <div className="punchline-card-body">
        <h5 className="punchline-card-title">{displayTitle}</h5>
        {artworkUrl ? (
          displayLyric ? (
            <p className="punchline-card-lyric">“{displayLyric}”</p>
          ) : null
        ) : !displayLyric ? (
          <p className="punchline-card-lyric is-placeholder">
            Add the lyric to bring this moment to life.
          </p>
        ) : null}

        <div className="punchline-card-meta">
          <span className="punchline-card-edition">
            {formatEditionLabel(editionSize)}
          </span>
          <span className="punchline-card-price">
            {formatPriceCents(priceCents)}
          </span>
        </div>

        {typeof collectedCount === "number" && (
          <div className="punchline-card-collected">
            {collectedCount} collected
          </div>
        )}

        <span className="punchline-card-rights" title={rightsLabel}>
          {rightsLabel}
        </span>
      </div>
    </div>
  );
}

export default PunchlineCollectibleCard;
