import { CampaignCard } from "../../components/shows/CampaignCard";
import { listCampaigns } from "../../lib/shows";
import Link from "next/link";

export default async function ShowsExplorerPage() {
  const campaigns = await listCampaigns();
  const totalBackers = campaigns.reduce((s, c) => s + c.backerCount, 0);

  return (
    <main className="shows-surface shows-page">
      {/* ── Cinematic intro banner ── */}
      <header className="shows-page__intro">
        <div className="shows-page__intro-body">
          <span className="shows-home-section__kicker">Resonate Shows</span>
          <h1 className="shows-page__title">Fans bring the&nbsp;show.</h1>
          <p className="shows-page__lede">
            Pick an artist and a city, lock funds in a smart-contract escrow,
            and if enough fans commit, the artist&apos;s team gets a demand
            signal backed by money&nbsp;— not likes. If they don&apos;t
            confirm, every pledge is refunded automatically.
          </p>
        </div>

        <div className="shows-page__intro-art">
          <div className="shows-page__intro-stat" aria-label="Active campaigns">
            <span className="shows-page__intro-stat-num tabular">
              {campaigns.length}
            </span>
            <span className="shows-page__intro-stat-label">
              Active campaigns
            </span>
          </div>
          <div
            className="shows-page__intro-stat"
            aria-label="Total backers"
            style={{ animationDelay: "1s" }}
          >
            <span className="shows-page__intro-stat-num tabular">
              {totalBackers}
            </span>
            <span className="shows-page__intro-stat-label">Fans signalled</span>
          </div>
        </div>
      </header>

      {/* ── Campaign grid ── */}
      <section aria-label="All campaigns">
        <div className="shows-page__toolbar" style={{ marginBottom: 20 }}>
          <h2 className="shows-page__toolbar-heading">All campaigns</h2>
          <Link href="/shows/create" className="shows-page__create-link">
            Create campaign
          </Link>
        </div>
        <div className="campaign-grid">
          {campaigns.map((c) => (
            <CampaignCard key={c.id} campaign={c} />
          ))}
        </div>
      </section>
    </main>
  );
}
