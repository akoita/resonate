"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FeaturedDrop,
  PunchlineMoment,
  DropsBrowsePrice,
} from "../../lib/api";
import { recordProductAnalyticsFromBrowser } from "../../lib/productAnalytics";
import { PunchlineCollectibleCard } from "../punchline/PunchlineCollectibleCard";
import { resolveClipUrl } from "../punchline/punchlineCollectHelpers";
import { DROP_KIND_LABEL } from "../punchline/punchlineDropHelpers";

type DiscoveryDrop = FeaturedDrop & {
  availability?: { soldOut: boolean };
};

const DROP_PREVIEW_STARTED_EVENT = "resonate:drops-preview-started";

function unloadAudio(audioRef: { current: HTMLAudioElement | null }) {
  const audio = audioRef.current;
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  audioRef.current = null;
}

function matchesPrice(moment: PunchlineMoment, price: DropsBrowsePrice) {
  if (price === "free") return moment.priceCents <= 0;
  if (price === "paid") return moment.priceCents > 0;
  return true;
}

/** Selects the first available face, constrained to a price class when possible. */
export function discoveryMoment(
  drop: DiscoveryDrop,
  price: DropsBrowsePrice = "all",
): PunchlineMoment | null {
  const matching = drop.moments.filter((moment) => matchesPrice(moment, price));
  const candidates = matching.length > 0 ? matching : drop.moments;
  return (
    candidates.find((moment) => moment.collectedCount < moment.editionSize) ??
    candidates[0] ??
    null
  );
}

export function DropDiscoveryCard({
  drop,
  price = "all",
  testId = "drop-discovery-card",
  enablePreview = false,
}: {
  drop: DiscoveryDrop;
  price?: DropsBrowsePrice;
  testId?: string;
  enablePreview?: boolean;
}) {
  const moment = discoveryMoment(drop, price);
  const [playingMomentId, setPlayingMomentId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewOwnerRef = useRef({});

  const stopPreview = useCallback(() => {
    unloadAudio(audioRef);
    setPlayingMomentId(null);
  }, [setPlayingMomentId]);

  useEffect(() => {
    if (!enablePreview) return;

    const stopOtherPreview = (event: Event) => {
      const owner = (event as CustomEvent<{ owner?: object }>).detail?.owner;
      if (owner !== previewOwnerRef.current) stopPreview();
    };
    window.addEventListener(DROP_PREVIEW_STARTED_EVENT, stopOtherPreview);
    return () => {
      window.removeEventListener(DROP_PREVIEW_STARTED_EVENT, stopOtherPreview);
      unloadAudio(audioRef);
    };
  }, [enablePreview, stopPreview]);

  if (!moment) return null;
  const momentSoldOut = moment.collectedCount >= moment.editionSize;
  const clipUrl = resolveClipUrl(moment.clipAssetUri);
  const isPlaying = playingMomentId === moment.id;

  const togglePreview = () => {
    if (isPlaying) {
      stopPreview();
      return;
    }
    if (!clipUrl) return;

    window.dispatchEvent(
      new CustomEvent(DROP_PREVIEW_STARTED_EVENT, {
        detail: { owner: previewOwnerRef.current },
      }),
    );
    stopPreview();
    const audio = new Audio(clipUrl);
    audioRef.current = audio;
    audio.addEventListener("ended", stopPreview);
    audio.addEventListener("error", stopPreview);
    audio
      .play()
      .then(() => {
        if (audioRef.current !== audio) return;
        setPlayingMomentId(moment.id);
        recordProductAnalyticsFromBrowser("punchline.preview_played", {
          payload: {
            dropId: drop.id,
            momentId: moment.id,
            trackId: drop.trackId,
            source: "drops_browse",
          },
        });
      })
      .catch(() => {
        if (audioRef.current === audio) stopPreview();
      });
  };

  return (
    <article
      className="ng-glass ng-drops-card"
      style={{
        borderRadius: 20,
        padding: 14,
        position: "relative",
      }}
      data-testid={testId}
    >
      {drop.availability?.soldOut && (
        <span className="drops-card-sold-out">Sold out</span>
      )}
      <Link
        href={`/release/${drop.context.releaseId}?focus=moments`}
        className="ng-drops-card__link"
        aria-label={`${momentSoldOut ? "View sold-out" : "Collect"} ${moment.title} from ${drop.context.trackTitle}`}
      >
        <PunchlineCollectibleCard
          title={moment.title}
          lyricText={moment.lyricText}
          artworkUrl={moment.artworkUrl}
          durationMs={moment.endMs - moment.startMs}
          editionSize={moment.editionSize}
          priceCents={moment.priceCents}
          rightsLabel={moment.rightsLabel}
          collectedCount={moment.collectedCount}
          imageLoading="lazy"
          imageDecoding="async"
        />
        <p
          className="ng-play-card__artist ng-drops-card__context"
          style={{
            marginTop: 10,
            display: "flex",
            flexWrap: "wrap",
            gap: "4px 8px",
            alignItems: "baseline",
          }}
        >
          <span className="punchline-kind-chip">{DROP_KIND_LABEL}</span>
          <strong className="ng-drops-card__artist" style={{ fontWeight: 700 }}>
            {drop.context.artistName ?? "Unknown artist"}
          </strong>
          <span className="ng-drops-card__track" style={{ opacity: 0.7 }}>
            · {drop.context.trackTitle}
          </span>
        </p>
      </Link>
      {enablePreview ? (
        <div className="drops-card-preview">
          <button
            type="button"
            className="drops-card-preview__button"
            onClick={togglePreview}
            disabled={!clipUrl}
            aria-pressed={clipUrl ? isPlaying : undefined}
            aria-label={
              clipUrl
                ? `${isPlaying ? "Stop" : "Play"} preview of ${moment.title}`
                : `Preview unavailable for ${moment.title}`
            }
          >
            <span aria-hidden="true">{isPlaying ? "■" : "▶"}</span>
            {clipUrl
              ? `${isPlaying ? "Stop" : "Play"} preview`
              : "Preview unavailable"}
          </button>
        </div>
      ) : null}
    </article>
  );
}
