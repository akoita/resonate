import React from "react";
import { formatClipDuration } from "./PunchlineClipSelector";
import { formatEditionLabel, formatPriceCents } from "./punchlineDropHelpers";

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
}: PunchlineCollectibleCardProps) {
  const displayTitle = title.trim() || "Untitled moment";
  const displayLyric = lyricText.trim();

  return (
    <div className="punchline-card" data-testid="punchline-collectible-card">
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
            🎤
          </div>
        )}
        <span className="punchline-card-duration">
          {formatClipDuration(Math.max(0, durationMs))}
        </span>
      </div>

      <div className="punchline-card-body">
        <h5 className="punchline-card-title">{displayTitle}</h5>
        {displayLyric ? (
          <p className="punchline-card-lyric">“{displayLyric}”</p>
        ) : (
          <p className="punchline-card-lyric is-placeholder">
            Add the lyric to bring this moment to life.
          </p>
        )}

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
