"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CampaignProgress } from "./CampaignProgress";
import { daysUntil, type Campaign } from "../../lib/shows";

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

  const monogram = (campaign.artistName[0] ?? "?").toUpperCase();

  return (
    <button
      type="button"
      className="campaign-card"
      onClick={() => router.push(`/shows/${campaign.id}`)}
      aria-label={`Open campaign — ${campaign.artistName} in ${campaign.city}`}
    >
      <div className="campaign-card__art" data-city={campaign.city}>
        <span className="campaign-card__city-chip">{campaign.city}</span>
        <span className="campaign-card__monogram" aria-hidden>
          {monogram}
        </span>
      </div>
      <div className="campaign-card__body">
        <h3 className="campaign-card__title">
          {campaign.artistName} in {campaign.city}
        </h3>
        {campaign.venue ? (
          <p className="campaign-card__meta">{campaign.venue}</p>
        ) : null}
        <CampaignProgress campaign={campaign} daysLeft={daysLeft} compact />
      </div>
    </button>
  );
}
