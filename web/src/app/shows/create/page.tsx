import Link from "next/link";
import { CampaignDraftForm } from "../../../components/shows/CampaignDraftForm";

export default function CreateShowCampaignPage() {
  return (
    <main className="shows-surface shows-page">
      <div className="shows-create">
        <nav className="show-detail__breadcrumb" aria-label="Breadcrumb">
          <Link href="/shows">Shows</Link>
          <span aria-hidden>/</span>
          <span>Create</span>
        </nav>

        <header className="shows-create__header">
          <span className="shows-home-section__kicker">Campaign desk</span>
          <h1>Create a draft show campaign</h1>
          <p>
            Drafts stay off the active escrow path until artist authority is
            approved and an operator links the deployed escrow campaign.
          </p>
        </header>

        <CampaignDraftForm />
      </div>
    </main>
  );
}
