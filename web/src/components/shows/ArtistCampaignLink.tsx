"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  campaignDisplayTitle,
  findArtistCampaigns,
  listCampaigns,
  progressRatio,
  type Campaign,
} from "../../lib/shows";

/** At most this many campaign banners render for one artist. */
const MAX_ARTIST_CAMPAIGNS = 2;

type CampaignKicker = { label: string; live: boolean };

export function artistCampaignKicker(campaign: Pick<Campaign, "rawStatus">): CampaignKicker {
  switch (campaign.rawStatus) {
    case "active":
      return { label: "Live show campaign", live: true };
    case "funded":
      return { label: "Funded show campaign", live: false };
    case "booking_confirmed":
    case "deposit_released":
    case "fulfilled":
      return { label: "Show booked", live: false };
    default:
      return { label: "Show campaign", live: false };
  }
}

function campaignWhere(campaign: Pick<Campaign, "city" | "venue">): string {
  return [campaign.venue?.trim(), campaign.city?.trim()].filter(Boolean).join(" · ");
}

/**
 * Presentational banner(s) linking an artist surface to that artist's show
 * campaigns. Renders nothing for an empty list.
 */
export function ArtistCampaignBanners({
  campaigns,
  className,
}: {
  campaigns: Campaign[];
  className?: string;
}) {
  if (campaigns.length === 0) return null;
  return (
    <div
      className={`artist-campaign-links${className ? ` ${className}` : ""}`}
      role="group"
      aria-label="Show campaigns"
    >
      {campaigns.map((campaign) => {
        const title = campaignDisplayTitle(campaign);
        const pct = Math.round(progressRatio(campaign) * 100);
        const kicker = artistCampaignKicker(campaign);
        const where = campaignWhere(campaign);
        const image = campaign.cardImage || campaign.heroImage || campaign.visuals[0]?.url || "";
        const accessibleName = [
          `${kicker.label}: ${title}`,
          where,
          `${pct}% funded`,
        ].filter(Boolean).join(", ");
        return (
          <Link
            key={campaign.id}
            href={`/shows/${encodeURIComponent(campaign.id)}`}
            className="artist-campaign-link"
            aria-label={`${accessibleName}. Open the campaign`}
          >
            <span
              className={`artist-campaign-link__thumb${image ? " artist-campaign-link__thumb--image" : ""}`}
              style={image ? { "--artist-campaign-image": `url(${JSON.stringify(image)})` } as CSSProperties : undefined}
              aria-hidden="true"
            >
              {image ? null : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 11l18-5v12L3 14v-3z" />
                  <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
                </svg>
              )}
            </span>
            <span className="artist-campaign-link__body">
              <span className="artist-campaign-link__kicker">
                {kicker.live ? <span className="artist-campaign-link__pulse" aria-hidden="true" /> : null}
                {kicker.label}
              </span>
              <span className="artist-campaign-link__title">{title}</span>
              {where ? <span className="artist-campaign-link__where">{where}</span> : null}
            </span>
            <span className="artist-campaign-link__progress" aria-hidden="true">
              <span className="artist-campaign-link__pct">{pct}% funded</span>
              <span className="artist-campaign-link__track">
                <span
                  className="artist-campaign-link__fill"
                  style={{ width: `${pct}%` }}
                />
              </span>
            </span>
            <span className="artist-campaign-link__arrow" aria-hidden="true">→</span>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Links an artist or release page to the artist's live show campaigns.
 * Fetches the public campaign list once per artist identity; failures and
 * artists without campaigns render nothing.
 */
export function ArtistCampaignLink({
  artistId,
  artistName,
  className,
}: {
  artistId?: string | null;
  artistName?: string | null;
  className?: string;
}) {
  const identityKey = `${artistId?.trim() ?? ""}\u0000${artistName?.trim() ?? ""}`;
  const hasIdentity = Boolean(artistId?.trim() || artistName?.trim());
  // Results are keyed by the identity they were fetched for, so a stale
  // response never shows another artist's campaigns during navigation.
  const [result, setResult] = useState<{ key: string; campaigns: Campaign[] } | null>(null);

  useEffect(() => {
    if (!hasIdentity) return;
    let cancelled = false;
    listCampaigns()
      .then((all) => {
        if (cancelled) return;
        setResult({
          key: identityKey,
          campaigns: findArtistCampaigns(all, { artistId, artistName }).slice(0, MAX_ARTIST_CAMPAIGNS),
        });
      })
      .catch(() => {
        if (!cancelled) setResult({ key: identityKey, campaigns: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [artistId, artistName, hasIdentity, identityKey]);

  const campaigns = hasIdentity && result?.key === identityKey ? result.campaigns : [];
  return <ArtistCampaignBanners campaigns={campaigns} className={className} />;
}
