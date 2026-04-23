"use client";

import { CampaignCard } from "../../components/shows/CampaignCard";
import { listCampaignsSync } from "../../lib/shows";

export default function ShowsExplorerPage() {
  const campaigns = listCampaignsSync();

  return (
    <main className="shows-surface shows-page">
      <header className="shows-page__intro">
        <span className="shows-home-section__kicker">Resonate Shows</span>
        <h1 className="shows-page__title">Fans bring the show.</h1>
        <p className="shows-page__lede">
          Pick an artist and a city, lock funds in a smart-contract escrow,
          and if enough fans commit, the artist&apos;s team gets a demand signal
          backed by money — not likes. If they don&apos;t confirm, every pledge
          is refunded automatically.
        </p>
      </header>

      <div className="shows-page__toolbar">
        <button
          type="button"
          className="shows-page__sort"
          disabled
          title="Sorting ships alongside the pledge flow with the cohort demo"
        >
          Sort: Most funded
        </button>
        <span className="shows-page__sort-note">
          Sorting ships with the pledge flow.
        </span>
      </div>

      <div className="campaign-grid">
        {campaigns.map((c) => (
          <CampaignCard key={c.id} campaign={c} />
        ))}
      </div>
    </main>
  );
}
