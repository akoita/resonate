import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignDraftForm } from "../../../../components/shows/CampaignDraftForm";
import { campaignDisplayTitle, getCampaign } from "../../../../lib/shows";

interface Props {
  params: Promise<{ campaignId: string }>;
}

export default async function EditShowCampaignPage({ params }: Props) {
  const { campaignId } = await params;
  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    notFound();
  }
  const displayTitle = campaignDisplayTitle(campaign);

  return (
    <main className="shows-surface shows-page">
      <div className="shows-create">
        <nav className="show-detail__breadcrumb" aria-label="Breadcrumb">
          <Link href="/shows">Shows</Link>
          <span aria-hidden>/</span>
          <Link href={`/shows/${campaign.id}`}>{displayTitle}</Link>
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
          <CampaignDraftForm campaign={campaign} />
        ) : (
          <section className="shows-create__panel">
            <h2>Campaign is active</h2>
            <p>Only draft campaigns can be edited from this screen.</p>
            <Link href={`/shows/${campaign.id}`}>Back to campaign</Link>
          </section>
        )}
      </div>
    </main>
  );
}
