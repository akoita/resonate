import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CampaignDraftEditGate } from "../../../../components/shows/CampaignDraftEditGate";
import { CampaignDraftForm } from "../../../../components/shows/CampaignDraftForm";
import {
  campaignDisplayTitle,
  campaignHref,
  canonicalCampaignRedirect,
  getCampaign,
} from "../../../../lib/shows";
import { decodePathSegment } from "../../../../lib/seo";

interface Props {
  params: Promise<{ campaignId: string }>;
}

export default async function EditShowCampaignPage({ params }: Props) {
  const { campaignId } = await params;
  const requestedId = decodePathSegment(campaignId);
  const campaign = await getCampaign(requestedId);
  if (!campaign) {
    notFound();
  }
  // #2130: a draft reached by its internal id lands on its slug edit URL.
  const canonicalRedirect = canonicalCampaignRedirect(requestedId, campaign, "/edit");
  if (canonicalRedirect) {
    redirect(canonicalRedirect);
  }
  const displayTitle = campaignDisplayTitle(campaign);

  return (
    <main className="shows-surface shows-page">
      <div className="shows-create">
        <nav className="show-detail__breadcrumb" aria-label="Breadcrumb">
          <Link href="/shows">Shows</Link>
          <span aria-hidden>/</span>
          <Link href={campaignHref(campaign)}>{displayTitle}</Link>
          <span aria-hidden>/</span>
          <span>Edit</span>
        </nav>

        <header className="shows-create__header">
          <span className="shows-home-section__kicker">Campaign desk</span>
          <h1>Edit draft campaign</h1>
          <p>
            Draft terms and pledge tiers can change before activation. Once the
            escrow is active, edits should move through explicit lifecycle actions.
          </p>
        </header>

        {campaign.rawStatus === "draft" ? (
          <CampaignDraftEditGate campaign={campaign}>
            <CampaignDraftForm campaign={campaign} />
          </CampaignDraftEditGate>
        ) : (
          <section className="shows-create__panel">
            <h2>Campaign is active</h2>
            <p>Only draft campaigns can be edited from this screen.</p>
            <Link href={campaignHref(campaign)}>Back to campaign</Link>
          </section>
        )}
      </div>
    </main>
  );
}
