import type { CSSProperties } from "react";
import type { Campaign } from "../../lib/shows";

/*
 * Typographic campaign poster: the city name set large over a violet → coral
 * mesh. Shared by every campaign surface (Home ticket rail, Shows explorer
 * cards) as the no-image state, so a campaign without working artwork never
 * shows a broken image or a lone initial. Decorative — the surrounding card
 * already names the campaign and city for assistive tech.
 */

/** Deterministic 0..359 hue from the campaign id, so each poster is stable. */
export function campaignPosterHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

export function CampaignPoster({
  campaign,
  className,
}: {
  campaign: Pick<Campaign, "id" | "city">;
  className?: string;
}) {
  return (
    <span
      className={["campaign-poster", className].filter(Boolean).join(" ")}
      style={{ "--poster-hue": campaignPosterHue(campaign.id) } as CSSProperties}
      aria-hidden
    >
      <span className="campaign-poster__city">{campaign.city}</span>
    </span>
  );
}
