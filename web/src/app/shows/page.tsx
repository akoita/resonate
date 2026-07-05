import { CampaignCard } from "../../components/shows/CampaignCard";
import { ShowsCampaignFilters } from "../../components/shows/ShowsCampaignFilters";
import { listCampaigns, type CampaignListOptions, type CampaignListStatus } from "../../lib/shows";
import Link from "next/link";

type SearchParams = Record<string, string | string[] | undefined>;

const OPERATOR_FILTER_STATUSES = new Set<CampaignListStatus>([
  "active",
  "funded",
  "cancelled",
  "refund_available",
  "released",
]);

function firstParam(params: SearchParams | undefined, key: string): string | undefined {
  const value = params?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function campaignListOptions(params: SearchParams | undefined): {
  activeFilter: "default" | "all" | CampaignListStatus;
  options: CampaignListOptions;
} {
  const status = firstParam(params, "status");
  if (status && OPERATOR_FILTER_STATUSES.has(status as CampaignListStatus)) {
    return {
      activeFilter: status as CampaignListStatus,
      options: { status: status as CampaignListStatus },
    };
  }
  if (firstParam(params, "scope") === "all") {
    return { activeFilter: "all", options: { scope: "all" } };
  }
  return { activeFilter: "default", options: {} };
}

export default async function ShowsExplorerPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams> | SearchParams;
}) {
  const resolvedSearchParams = await searchParams;
  const { activeFilter, options } = campaignListOptions(resolvedSearchParams);
  const campaigns = await listCampaigns(options);
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
          <div className="shows-page__intro-stat" aria-label="Campaigns shown">
            <span className="shows-page__intro-stat-num tabular">
              {campaigns.length}
            </span>
            <span className="shows-page__intro-stat-label">
              Campaigns shown
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
          <ShowsCampaignFilters activeFilter={activeFilter} />
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
