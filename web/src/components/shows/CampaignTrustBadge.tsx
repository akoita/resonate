import { campaignTrustState, type Campaign } from "../../lib/shows";

interface Props {
  campaign: Pick<Campaign, "campaignLevel" | "rawStatus" | "artistAuthorityStatus">;
  className?: string;
}

/**
 * Small tone-coded trust pill (#949) reused across the detail panel, campaign
 * cards, and the hero. Pure presentation derived from campaignTrustState.
 */
export function CampaignTrustBadge({ campaign, className }: Props) {
  const trust = campaignTrustState(campaign);
  return (
    <span
      className={`campaign-trust-badge campaign-trust-badge--${trust.tone}${className ? ` ${className}` : ""}`}
      data-trust={trust.key}
      title={trust.description}
    >
      {trust.label}
    </span>
  );
}
