"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { CampaignProgress } from "./CampaignProgress";
import {
  campaignDisplayInitial,
  campaignDisplayTitle,
  campaignRouteCode,
  daysUntil,
  type Campaign,
} from "../../lib/shows";

interface Props {
  campaign: Campaign;
}

export function CampaignHero({ campaign }: Props) {
  const [daysLeft, setDaysLeft] = useState(0);

  useEffect(() => {
    const tick = () => setDaysLeft(daysUntil(campaign.deadline));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [campaign.deadline]);

  const targetDateFmt = new Date(campaign.targetDate).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });

  const displayTitle = campaignDisplayTitle(campaign);
  const monogram = campaignDisplayInitial(campaign);
  const routeCode = campaignRouteCode(campaign);

  return (
    <article className="campaign-hero">
      <div className="campaign-hero__body">
        <span className="campaign-hero__eyebrow">Featured Show</span>
        <h1 className="campaign-hero__title">
          {displayTitle}
        </h1>
        <div className="campaign-hero__meta">
          <span>
            <strong>{targetDateFmt}</strong>
          </span>
          {campaign.venue ? (
            <span>
              <strong>{campaign.venue}</strong>
            </span>
          ) : null}
        </div>
        <p className="campaign-hero__tagline">{campaign.tagline}</p>

        <CampaignProgress campaign={campaign} daysLeft={daysLeft} />

        <div className="campaign-hero__actions">
          <Link
            href={`/shows/${campaign.id}`}
            className="campaign-hero__cta-primary"
            aria-label="Send your signal — open the campaign"
          >
            Send Your Signal →
          </Link>
          <a
            href={campaign.etherscanUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="campaign-hero__cta-secondary"
            aria-label="View the escrow contract on Sepolia Etherscan"
          >
            View escrow contract ↗
          </a>
        </div>

        <p className="campaign-hero__trust">
          Funds held in a smart contract, not a company bank account. If the
          threshold isn&apos;t met, every pledge is refunded automatically — enforced
          by code.
        </p>
      </div>

      <div
        className={`campaign-hero__art ${campaign.heroImage ? "campaign-hero__art--image" : ""}`}
        style={campaign.heroImage ? { "--campaign-visual": `url(${campaign.heroImage})` } as CSSProperties : undefined}
        aria-hidden
      >
        <span className="campaign-hero__art-ribbon">Fan-funded route</span>
        <div className="campaign-hero__art-grid">
          <span />
          <span />
          <span />
          <span />
        </div>
        <span className="campaign-hero__art-monogram">{monogram}</span>
        <span className="campaign-hero__art-city">{campaign.city}</span>
        <div className="campaign-hero__art-footer">
          <span>{routeCode}</span>
          <span>{campaign.status}</span>
        </div>
      </div>
    </article>
  );
}
