"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PunchlineCollectibleCard } from "./PunchlineCollectibleCard";
import { recordProductAnalyticsFromBrowser } from "../../lib/productAnalytics";
import type { PublicMomentShare } from "../../lib/momentShare";
import "../../styles/punchline.css";

/**
 * Interactive slice of the moment permalink (#1477 slice 2): renders the same
 * collectible card fans collect from (masked lyric happens inside the card),
 * plays the public clip, and — for a signed-in viewer — attributes the visit
 * back into the #489 funnel with a `drop_viewed(source:"share")`.
 *
 * The surrounding page is a server component; only this interactive piece is a
 * client component.
 */
export function MomentPermalinkCard({
  share,
  clipUrl,
}: {
  share: PublicMomentShare;
  clipUrl: string | null;
}) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // One share-attributed view per permalink load (no-ops when signed out).
    recordProductAnalyticsFromBrowser("punchline.drop_viewed", {
      payload: {
        dropId: share.drop.id,
        trackId: share.track.id,
        momentCount: 1,
        source: "share",
      },
    });
  }, [share.drop.id, share.track.id]);

  const stopClip = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    }
    setPlaying(false);
  }, []);

  useEffect(() => () => stopClip(), [stopClip]);

  const playClip = useCallback(() => {
    if (!clipUrl) return;
    stopClip();
    const audio = new Audio(clipUrl);
    audioRef.current = audio;
    audio.addEventListener("ended", stopClip);
    audio.addEventListener("error", stopClip);
    audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => stopClip());
  }, [clipUrl, stopClip]);

  return (
    <div className="punchline-collect-item">
      <PunchlineCollectibleCard
        title={share.moment.title}
        lyricText={share.moment.lyricText}
        artworkUrl={share.moment.artworkUrl}
        durationMs={share.moment.endMs - share.moment.startMs}
        editionSize={share.moment.editionSize}
        priceCents={share.moment.priceCents}
        rightsLabel={share.moment.rightsLabel}
        collectedCount={share.moment.collectedCount}
        playing={playing}
      />
      {clipUrl ? (
        <button
          type="button"
          className="punchline-btn-secondary punchline-collect-play"
          onClick={playing ? stopClip : playClip}
          aria-label={
            playing
              ? `Stop preview of ${share.moment.title}`
              : `Preview ${share.moment.title}`
          }
        >
          {playing ? "■ Stop preview" : "▶ Preview"}
        </button>
      ) : null}
    </div>
  );
}

export default MomentPermalinkCard;
