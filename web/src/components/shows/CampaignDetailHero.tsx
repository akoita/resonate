"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { CampaignProgress } from "./CampaignProgress";
import {
  campaignDisplayTitle,
  daysUntil,
  formatMoneyCompact,
  progressRatio,
  type Campaign,
} from "../../lib/shows";

interface Props {
  campaign: Campaign;
  /**
   * Conversion slot rendered inside the hero's right column (#1373): the live
   * pledge module (tiers + wallet action) sits above the fold instead of an
   * anchor button pointing below it.
   */
  children: ReactNode;
}

export function CampaignDetailHero({ campaign, children }: Props) {
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
  const deadlineFmt = new Date(campaign.deadline).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  const progressPct = Math.round(progressRatio(campaign) * 100);
  const backersNeeded = Math.max(0, campaign.thresholdBackers - campaign.backerCount);
  const displayTitle = campaignDisplayTitle(campaign);
  const heroVisual = campaign.heroImage || campaign.visuals[0]?.url;
  const hasHeroImage = Boolean(heroVisual);
  const denseCopy = displayTitle.length > 54 || (campaign.venue?.length ?? 0) > 72;
  const titleParts = denseCopy && displayTitle.includes(":")
    ? displayTitle.split(/:\s*/, 2)
    : null;

  return (
    <header
      className={`campaign-detail-hero ${denseCopy ? "campaign-detail-hero--dense-copy" : ""}`}
      aria-labelledby="campaign-detail-title"
    >
      <div
        className={`campaign-detail-hero__banner ${
          hasHeroImage ? "campaign-detail-hero__banner--visual" : ""
        }`}
        style={hasHeroImage ? { "--campaign-visual": `url(${heroVisual})` } as CSSProperties : undefined}
      >
        <div className="campaign-detail-hero__banner-copy">
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
            <span>
              <strong title={campaign.venue ?? campaign.city}>
                {campaign.venue ?? campaign.city}
              </strong>
            </span>
          </div>
        </div>
      </div>

      <div className="campaign-detail-hero__lede">
        <div className="campaign-detail-hero__copy">
          <p className="campaign-detail-hero__tagline">{campaign.tagline}</p>

          <CampaignProgress campaign={campaign} daysLeft={daysLeft} />

          <dl className="campaign-detail-hero__stats" aria-label="Campaign signal snapshot">
            <div className="campaign-detail-hero__stat">
              <dt>Funded</dt>
              <dd>
                <strong>{progressPct}%</strong>
                <small>of {formatMoneyCompact(campaign.goalCents, campaign.currency)} goal</small>
              </dd>
            </div>
            <div className="campaign-detail-hero__stat">
              <dt>Backers</dt>
              <dd>
                <strong>{campaign.backerCount.toLocaleString("en-US")}</strong>
                <small>{backersNeeded.toLocaleString("en-US")} more to threshold</small>
              </dd>
            </div>
            <div className="campaign-detail-hero__stat">
              <dt>Deadline</dt>
              <dd>
                <strong>{daysLeft}d left</strong>
                <small>closes {deadlineFmt}, then auto-refund</small>
              </dd>
            </div>
            <div className="campaign-detail-hero__stat">
              <dt>Show target</dt>
              <dd>
                <strong title={campaign.venue ?? campaign.city}>{campaign.venue ?? campaign.city}</strong>
                <small>{targetDateFmt}</small>
              </dd>
            </div>
          </dl>

          <p className="campaign-detail-hero__trust-line">
            {campaign.isSample
              ? "Fictional fan-created sample — no artist endorsement, venue hold, or live escrow is implied."
              : "Funds held in a smart contract, not a company bank account. Miss the threshold and every pledge refunds automatically — enforced by code."}
            {" "}
            <a
              href={campaign.etherscanUrl}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="View the escrow contract on the block explorer"
            >
              View escrow contract ↗
            </a>
          </p>
        </div>

        <div
          id="campaign-pledge-rail"
          className="campaign-detail-hero__pledge"
          aria-label="Pledge from this campaign"
        >
          {children}
        </div>
      </div>
    </header>
  );
}
