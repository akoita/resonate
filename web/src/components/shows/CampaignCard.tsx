"use client";

import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { CampaignProgress } from "./CampaignProgress";
import {
  campaignDisplayInitial,
  campaignDisplayTitle,
  daysUntil,
  type Campaign,
} from "../../lib/shows";

interface Props {
  campaign: Campaign;
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
  const monogram = campaignDisplayInitial(campaign);
  const visualImage = campaign.cardImage || campaign.heroImage;
  const hasImage = Boolean(visualImage);

  return (
    <button
      type="button"
      className="campaign-card"
      onClick={() => router.push(`/shows/${campaign.id}`)}
      aria-label={`Open campaign — ${displayTitle}`}
    >
      <div
        className={`campaign-card__art ${hasImage ? "campaign-card__art--image" : ""}`}
        data-city={campaign.city}
        style={hasImage ? { "--campaign-card-image": `url(${visualImage})` } as CSSProperties : undefined}
      >
        <span className="campaign-card__city-chip">{campaign.city}</span>
        {!hasImage ? (
          <span className="campaign-card__monogram" aria-hidden>
            {monogram}
          </span>
        ) : null}
      </div>
      <div className="campaign-card__body">
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
