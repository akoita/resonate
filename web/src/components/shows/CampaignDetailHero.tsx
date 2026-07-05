"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { CampaignProgress } from "./CampaignProgress";
import { CampaignPledgeAnchor } from "./CampaignPledgeAnchor";
import {
  campaignDisplayInitial,
  campaignDisplayTitle,
  campaignFeeNotice,
  campaignRouteCode,
  daysUntil,
  formatMoney,
  type Campaign,
  type CampaignTier,
} from "../../lib/shows";

interface Props {
  campaign: Campaign;
  tiers: CampaignTier[];
}

export function CampaignDetailHero({ campaign, tiers }: Props) {
  const [daysLeft, setDaysLeft] = useState(0);

  useEffect(() => {
    const tick = () => setDaysLeft(daysUntil(campaign.deadline));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [campaign.deadline]);

  const targetDateFmt = new Date(campaign.targetDate).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const displayTitle = campaignDisplayTitle(campaign);
  const monogram = campaignDisplayInitial(campaign);
  const routeCode = campaignRouteCode(campaign);
  const heroVisual = campaign.heroImage || campaign.visuals[0]?.url;
  const hasHeroImage = Boolean(heroVisual);
  const denseCopy = displayTitle.length > 54 || (campaign.venue?.length ?? 0) > 72;
  const titleParts = denseCopy && displayTitle.includes(":")
    ? displayTitle.split(/:\s*/, 2)
    : null;
  const feeNotice = campaignFeeNotice(campaign);

  return (
    <section
      className={`campaign-detail-hero ${hasHeroImage ? "campaign-detail-hero--visual" : ""} ${
        denseCopy ? "campaign-detail-hero--dense-copy" : ""
      }`}
      style={hasHeroImage ? { "--campaign-visual": `url(${heroVisual})` } as CSSProperties : undefined}
      aria-labelledby="campaign-detail-title"
    >
      <div className="campaign-detail-hero__copy">
        <span className="campaign-detail-hero__eyebrow">
          {campaign.isSample ? "Sample campaign concept" : "Featured Show"}
        </span>
        <h1
          id="campaign-detail-title"
          className={`campaign-detail-hero__title ${titleParts ? "campaign-detail-hero__title--split" : ""}`}
          aria-label={displayTitle}
        >
          {titleParts ? (
            <>
              <span className="campaign-detail-hero__title-main">{titleParts[0]}</span>
              <span className="campaign-detail-hero__title-accent">{titleParts[1]}</span>
            </>
          ) : displayTitle}
        </h1>

        <div className="campaign-detail-hero__meta">
          <span>
            <strong>{targetDateFmt}</strong>
          </span>
          {campaign.venue ? (
            <span>
              <strong title={campaign.venue}>{campaign.venue}</strong>
            </span>
          ) : (
            <span>
              <strong>{campaign.city}</strong>
            </span>
          )}
        </div>

        <CampaignProgress campaign={campaign} daysLeft={daysLeft} />

        {tiers.length > 0 ? (
          <div className="campaign-detail-hero__tier-chips" aria-label="Available pledge tiers">
            {tiers.slice(0, 3).map((tier) => (
              <span key={tier.id} className="campaign-detail-hero__tier-chip">
                <strong>{formatMoney(tier.amountCents, tier.currency)}</strong>
                {tier.title}
              </span>
            ))}
          </div>
        ) : null}

        <div className="campaign-detail-hero__actions">
          <CampaignPledgeAnchor
            className="campaign-detail-hero__cta-primary"
            aria-label="Pledge with wallet, jump to pledge tiers"
          >
            Pledge with wallet
          </CampaignPledgeAnchor>
          <a
            href={campaign.etherscanUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="campaign-detail-hero__cta-secondary"
            aria-label="View the escrow contract on Sepolia Etherscan"
          >
            View escrow contract ↗
          </a>
        </div>

        {feeNotice ? (
          <p className="campaign-detail-hero__fee-note">{feeNotice}</p>
        ) : null}
      </div>

      <div
        className={`campaign-detail-hero__visual ${hasHeroImage ? "campaign-detail-hero__visual--image" : ""}`}
        aria-hidden
      >
        <span className="campaign-detail-hero__visual-ribbon">Fan-funded route</span>
        {hasHeroImage ? (
          <div className="campaign-detail-hero__visual-caption">
            <span>{routeCode}</span>
            <span>{campaign.city}</span>
          </div>
        ) : (
          <>
            <div className="campaign-detail-hero__visual-grid">
              <span />
              <span />
              <span />
              <span />
            </div>
            <span className="campaign-detail-hero__visual-monogram">{monogram}</span>
            <span className="campaign-detail-hero__visual-city">{campaign.city}</span>
            <div className="campaign-detail-hero__visual-caption">
              <span>{routeCode}</span>
              <span>{campaign.status}</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
