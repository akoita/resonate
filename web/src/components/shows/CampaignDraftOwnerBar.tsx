"use client";

import Link from "next/link";
import { campaignEditHref, type Campaign } from "../../lib/shows";
import { useCampaignManageAccess } from "./useCampaignManageAccess";

/**
 * #2130: the owner-visible entry point to a draft campaign's editor. Renders
 * only once the backend confirms the viewer may manage the campaign, so fans
 * and other accounts never see a dead button. Non-draft campaigns never ask.
 */
export function CampaignDraftOwnerBar({ campaign }: {
  campaign: Pick<Campaign, "id" | "backendId" | "rawStatus">;
}) {
  const isDraft = campaign.rawStatus === "draft";
  const access = useCampaignManageAccess(campaign, { enabled: isDraft });
  if (!isDraft || access !== "allowed") return null;

  return (
    <section className="show-detail__draft-bar" aria-label="Draft campaign">
      <div className="show-detail__draft-bar-copy">
        <span className="show-detail__draft-bar-kicker">Draft</span>
        <p>
          Only you and Resonate operators can see this. Fans can&apos;t pledge
          until the campaign is activated.
        </p>
      </div>
      <Link href={campaignEditHref(campaign)} className="show-detail__draft-bar-action">
        Edit draft
      </Link>
    </section>
  );
}
