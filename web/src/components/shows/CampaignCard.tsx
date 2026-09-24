"use client";

import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CampaignPoster } from "./CampaignPoster";
import { CampaignProgress } from "./CampaignProgress";
import { CampaignTrustBadge } from "./CampaignTrustBadge";
import {
  campaignDisplayTitle,
  campaignStatusBadge,
  campaignVisualEndpoint,
  daysUntil,
  type Campaign,
} from "../../lib/shows";

interface Props {
  campaign: Campaign;
}

/**
 * Every image source worth trying for a card, in order: the declared image,
 * then the backend's card and hero visual endpoints. Empties and duplicates
 * are skipped so one failure never retries the same URL.
 */
export function campaignCardVisualSources(
  campaign: Pick<Campaign, "backendId" | "cardImage" | "heroImage" | "visuals">,
): string[] {
  const chain = [
    campaign.cardImage || campaign.heroImage || campaign.visuals[0]?.url || "",
    campaignVisualEndpoint(campaign, "card"),
    campaignVisualEndpoint(campaign, "hero"),
  ];
  return chain.filter((src, index) => Boolean(src) && chain.indexOf(src) === index);
}

/**
 * Index of the source to show after `failedSrc` errored. Past the end of
 * `sources` means the chain is exhausted and the card shows its poster. A
 * stale failure (a source already skipped) never moves the index backwards.
 */
export function campaignVisualIndexAfterFailure(
  sources: readonly string[],
  currentIndex: number,
  failedSrc: string,
): number {
  const failedIndex = sources.indexOf(failedSrc);
  if (failedIndex < 0) return currentIndex;
  return Math.max(currentIndex, failedIndex + 1);
}

export function CampaignCard({ campaign }: Props) {
  const router = useRouter();
  // Start at 0 so SSR and first client render match (hydration-safe), then
  // recompute on mount against the real clock. Minute precision is enough.
  const [daysLeft, setDaysLeft] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration guard
    setDaysLeft(daysUntil(campaign.deadline));
  }, [campaign.deadline]);
  const displayTitle = campaignDisplayTitle(campaign);
  const statusBadge = campaignStatusBadge(campaign);
  const visualSources = campaignCardVisualSources(campaign);
  const visualSourcesKey = visualSources.join("\n");
  // Keyed to the source list so a changed campaign restarts at its first
  // source without an effect-driven reset.
  const [visualFailure, setVisualFailure] = useState({ key: visualSourcesKey, index: 0 });
  const visualIndex = visualFailure.key === visualSourcesKey ? visualFailure.index : 0;
  const visualImage = visualSources[visualIndex];
  const hasImage = Boolean(visualImage);
  const handleVisualError = useCallback(
    (failedSrc: string) => {
      setVisualFailure((prev) => ({
        key: visualSourcesKey,
        index: campaignVisualIndexAfterFailure(
          visualSourcesKey ? visualSourcesKey.split("\n") : [],
          prev.key === visualSourcesKey ? prev.index : 0,
          failedSrc,
        ),
      }));
    },
    [visualSourcesKey],
  );
  // The <img> is server-rendered, so a load error that fires before
  // hydration never reaches React's onError. After mount (and whenever the
  // source changes) treat an already-finished, zero-width image as failed.
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = imageRef.current;
    if (!image || !visualImage) return;
    if (image.complete && image.naturalWidth === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing a DOM load failure React never saw
      handleVisualError(visualImage);
    }
  }, [visualImage, handleVisualError]);

  return (
    <button
      type="button"
      className="campaign-card"
      onClick={() => router.push(`/shows/${campaign.id}`)}
      aria-label={`Open campaign — ${displayTitle}`}
    >
      <div
        className={`campaign-card__art ${hasImage ? "campaign-card__art--image" : "campaign-card__art--poster"}`}
        data-city={campaign.city}
        style={hasImage ? { "--campaign-card-image": `url(${visualImage})` } as CSSProperties : undefined}
      >
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- campaign visuals are dynamic backend media, not optimized static assets.
          <img
            ref={imageRef}
            key={visualImage}
            className="campaign-card__image"
            src={visualImage}
            alt=""
            loading="lazy"
            onError={() => handleVisualError(visualImage)}
          />
        ) : (
          <CampaignPoster campaign={campaign} />
        )}
        <span className="campaign-card__city-chip">{campaign.city}</span>
      </div>
      <div className="campaign-card__body">
        <div className="campaign-card__badge-row">
          <CampaignTrustBadge campaign={campaign} className="campaign-card__trust" />
          {statusBadge ? (
            <span className={`campaign-card__status-badge campaign-card__status-badge--${statusBadge.tone}`}>
              {statusBadge.label}
            </span>
          ) : null}
        </div>
        <h3 className="campaign-card__title">
          {displayTitle}
        </h3>
        {campaign.venue ? (
          <p className="campaign-card__meta">{campaign.venue}</p>
        ) : null}
        <CampaignProgress campaign={campaign} daysLeft={daysLeft} compact />
      </div>
    </button>
  );
}
