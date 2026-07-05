import { CampaignPledgeAnchor } from "./CampaignPledgeAnchor";
import { formatMoneyCompact, progressRatio, type Campaign } from "../../lib/shows";

interface Props {
  campaign: Campaign;
}

export function CampaignMobilePledgeBar({ campaign }: Props) {
  const pct = Math.round(progressRatio(campaign) * 100);

  return (
    <div className="show-detail__mobile-pledge-bar" aria-label="Mobile pledge shortcut">
      <div className="show-detail__mobile-pledge-progress">
        <strong>{pct}% funded</strong>
        <span className="tabular">
          {formatMoneyCompact(campaign.raisedCents, campaign.currency)} of{" "}
          {formatMoneyCompact(campaign.goalCents, campaign.currency)}
        </span>
      </div>
      <CampaignPledgeAnchor
        className="show-detail__mobile-pledge-action"
        aria-label="Pledge with wallet, jump to pledge tiers"
      >
        Pledge
      </CampaignPledgeAnchor>
    </div>
  );
}
