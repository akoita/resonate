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
  searchParams?: Promise<SearchParams>;
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
            Pick an artist and a city, and pledge toward the show. Your pledge
            is held safely until the show is booked. When enough fans join in,
            the artist&apos;s team sees real demand, not just likes. If the show
            doesn&apos;t happen, every backer can claim their pledge back.
          </p>
        </div>

        {/* A stat with nothing to count yet is left out, not shown as 0. */}
        {campaigns.length > 0 ? (
          <div className="shows-page__intro-art">
            <div className="shows-page__intro-stat">
              <span className="shows-page__intro-stat-num tabular">
                {campaigns.length.toLocaleString("en-US")}
              </span>
              <span className="shows-page__intro-stat-label">
                {campaigns.length === 1 ? "Campaign" : "Campaigns"}
              </span>
            </div>
            {totalBackers > 0 ? (
              <div
                className="shows-page__intro-stat"
                style={{ animationDelay: "1s" }}
              >
                <span className="shows-page__intro-stat-num tabular">
                  {totalBackers.toLocaleString("en-US")}
                </span>
                <span className="shows-page__intro-stat-label">
                  {totalBackers === 1 ? "Fan backing" : "Fans backing"}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
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
        {campaigns.length > 0 ? (
          <div className="campaign-grid">
            {campaigns.map((c) => (
              <CampaignCard key={c.id} campaign={c} />
            ))}
          </div>
        ) : (
          <div className="shows-page__empty" role="status">
            <strong>
              {activeFilter === "default"
                ? "No campaigns are open for pledges right now."
                : "No campaigns match this filter."}
            </strong>
            <p>
              Propose a show for an artist in your city. Pledges are held
              safely, and backers can claim them back if the show doesn&apos;t
              happen.
            </p>
            <Link href="/shows/create" className="shows-page__create-link">
              Create campaign
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
