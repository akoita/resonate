"use client";

import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { CampaignProgress } from "./CampaignProgress";
import { CampaignTrustBadge } from "./CampaignTrustBadge";
import {
  campaignDisplayInitial,
  campaignDisplayTitle,
  campaignStatusBadge,
  campaignVisualEndpoint,
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
  const [fallbackVisualSlot, setFallbackVisualSlot] = useState<"card" | "hero" | "none">("card");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration guard
    setDaysLeft(daysUntil(campaign.deadline));
  }, [campaign.deadline]);
  const displayTitle = campaignDisplayTitle(campaign);
  const statusBadge = campaignStatusBadge(campaign);
  const monogram = campaignDisplayInitial(campaign);
  const declaredVisualImage = campaign.cardImage || campaign.heroImage || campaign.visuals[0]?.url;
  const fallbackVisualImage = !declaredVisualImage && fallbackVisualSlot !== "none"
    ? campaignVisualEndpoint(campaign, fallbackVisualSlot)
    : "";
  const visualImage = declaredVisualImage || fallbackVisualImage;
  const hasImage = Boolean(visualImage);
  const handleVisualError = () => {
    if (declaredVisualImage) return;
    setFallbackVisualSlot((slot) => (slot === "card" ? "hero" : "none"));
  };

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
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- campaign visuals are dynamic backend media, not optimized static assets.
          <img
            className="campaign-card__image"
            src={visualImage}
            alt=""
            loading="lazy"
            onError={handleVisualError}
          />
        ) : null}
        <span className="campaign-card__city-chip">{campaign.city}</span>
        {!hasImage ? (
          <span className="campaign-card__monogram" aria-hidden>
            {monogram}
          </span>
        ) : null}
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
