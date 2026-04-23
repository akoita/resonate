"use client";

import { formatMoney, formatMoneyCompact, progressRatio, type Campaign } from "../../lib/shows";

interface Props {
  campaign: Campaign;
  daysLeft: number;
  compact?: boolean;
}

export function CampaignProgress({ campaign, daysLeft, compact = false }: Props) {
  const ratio = progressRatio(campaign);
  const pct = Math.round(ratio * 100);

  const raisedFull = formatMoney(campaign.raisedCents, campaign.currency);
  const goalCompact = formatMoneyCompact(campaign.goalCents, campaign.currency);
  const raisedCompact = formatMoneyCompact(campaign.raisedCents, campaign.currency);

  return (
    <div className={`campaign-progress ${compact ? "campaign-progress--compact" : ""}`}>
      <div className="campaign-progress__amounts tabular">
        <span className="campaign-progress__raised">
          {compact ? raisedCompact : raisedFull}
          <span className="campaign-progress__goal"> of {goalCompact}</span>
        </span>
        <span className="campaign-progress__pct">{pct}%</span>
      </div>

      <div
        className="campaign-progress__bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% of goal reached`}
      >
        <div
          className="campaign-progress__fill"
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>

      <div className="campaign-progress__stats tabular">
        <span>
          <strong>{campaign.backerCount.toLocaleString("en-US")}</strong> backers
        </span>
        <span className="campaign-stat-sep" aria-hidden>
          ·
        </span>
        <span>
          <strong>{daysLeft}</strong> {daysLeft === 1 ? "day" : "days"} left
        </span>
        <span className="campaign-stat-sep" aria-hidden>
          ·
        </span>
        <span>
          threshold <strong>{campaign.thresholdBackers.toLocaleString("en-US")}</strong>
        </span>
      </div>
    </div>
  );
}
