"use client";

import Link from "next/link";
import type { ArtistAnalyticsDashboard as ArtistAnalyticsDashboardData } from "../../lib/api";

type DashboardState =
  | { status: "loading"; days: number }
  | { status: "error"; days: number; message: string; onRetry: () => void }
  | { status: "no-artist"; days: number }
  | { status: "ready"; days: number; data: ArtistAnalyticsDashboardData };

type Props = DashboardState & {
  artistName?: string;
  onDaysChange: (days: number) => void;
};

const DAY_OPTIONS = [7, 30, 90];

export default function ArtistAnalyticsDashboard(props: Props) {
  const title = props.artistName ? `${props.artistName} Analytics` : "Artist Analytics";

  return (
    <main className="artist-analytics-page">
      <header className="artist-analytics-header">
        <div>
          <p className="artist-analytics-eyebrow">Artist Analytics</p>
          <h1>{title}</h1>
        </div>
        <div className="analytics-window-switch" aria-label="Analytics time window">
          {DAY_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              className={props.days === days ? "active" : ""}
              onClick={() => props.onDaysChange(days)}
            >
              {days}d
            </button>
          ))}
        </div>
      </header>

      {props.status === "loading" ? <LoadingDashboard /> : null}
      {props.status === "error" ? <ErrorDashboard message={props.message} onRetry={props.onRetry} /> : null}
      {props.status === "no-artist" ? <NoArtistDashboard /> : null}
      {props.status === "ready" ? <ReadyDashboard data={props.data} /> : null}
    </main>
  );
}

function ReadyDashboard({ data }: { data: ArtistAnalyticsDashboardData }) {
  const topTrack = data.topTracks[0] ?? data.trackPerformance[0] ?? null;
  const sourceLabel = data.meta.source === "bigquery" ? "BigQuery" : "Local ledger";
  const freshnessLabel = formatFreshness(data.meta.freshness.asOf, data.meta.freshness.lagSeconds);
  const payoutLabel = formatUsd(data.summary.totalPayoutUsd);

  if (data.meta.isEmpty) {
    return (
      <>
        <StatusStrip
          sourceLabel={sourceLabel}
          freshnessLabel="No events yet"
          windowLabel={formatWindow(data.meta.timeWindow.from, data.meta.timeWindow.to)}
          cacheLabel={cacheLabel(data.meta.cache.hit)}
        />
        <EmptyDashboard days={data.meta.timeWindow.days} />
        <SeparatedContentProtection />
      </>
    );
  }

  return (
    <>
      <StatusStrip
        sourceLabel={sourceLabel}
        freshnessLabel={freshnessLabel}
        windowLabel={formatWindow(data.meta.timeWindow.from, data.meta.timeWindow.to)}
        cacheLabel={cacheLabel(data.meta.cache.hit)}
      />

      <section className="analytics-kpi-grid" aria-label="Artist analytics summary">
        <Kpi label="Total plays" value={formatNumber(data.summary.totalPlays)} detail={`${data.meta.timeWindow.days} day window`} />
        <Kpi label="Total payout" value={payoutLabel} detail={primaryPayoutAsset(data.summary.payoutsByAsset)} />
        <Kpi label="Top track" value={topTrack?.title ?? "No track yet"} detail={topTrack ? `${formatNumber(topTrack.plays)} plays` : "Waiting for play events"} />
        <Kpi
          label="Protected releases"
          value={formatNumber(data.protection.releasesWithDecisions)}
          detail={`${formatNumber(data.protection.marketplaceReadyReleases)} marketplace ready`}
        />
      </section>

      <section className="analytics-layout">
        <div className="analytics-panel analytics-panel-large">
          <div className="analytics-panel-heading">
            <h2>Plays over time</h2>
            <span>{data.playsOverTime.length} data points</span>
          </div>
          <PlaysChart points={data.playsOverTime} />
        </div>

        <div className="analytics-panel">
          <div className="analytics-panel-heading">
            <h2>Sources</h2>
            <span>{formatNumber(totalSourcePlays(data.sources))} plays</span>
          </div>
          <div className="analytics-source-list">
            {data.sources.length === 0 ? (
              <p className="analytics-muted">No source dimensions yet.</p>
            ) : (
              data.sources.map((source) => (
                <div key={source.source} className="analytics-source-row">
                  <span>{source.source}</span>
                  <strong>{formatNumber(source.plays)}</strong>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="analytics-panel">
        <div className="analytics-panel-heading">
          <h2>Track performance</h2>
          <span>{data.trackPerformance.length} tracks</span>
        </div>
        <TrackPerformanceTable tracks={data.trackPerformance} />
      </section>

      <ContentProtectionMetrics protection={data.protection} />
    </>
  );
}

function LoadingDashboard() {
  return (
    <section className="analytics-panel analytics-state-panel" aria-live="polite">
      <div className="analytics-skeleton analytics-skeleton-title" />
      <div className="analytics-skeleton-grid">
        <div className="analytics-skeleton" />
        <div className="analytics-skeleton" />
        <div className="analytics-skeleton" />
      </div>
    </section>
  );
}

function ErrorDashboard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="analytics-panel analytics-state-panel" role="alert">
      <p className="analytics-state-kicker">Analytics unavailable</p>
      <h2>Could not load artist metrics</h2>
      <p>{message}</p>
      <button type="button" className="analytics-primary-action" onClick={onRetry}>
        Retry
      </button>
    </section>
  );
}

function NoArtistDashboard() {
  return (
    <section className="analytics-panel analytics-state-panel">
      <p className="analytics-state-kicker">No artist profile</p>
      <h2>Create an artist profile to see analytics</h2>
      <p>Metrics are scoped to the artist account that owns the catalog.</p>
      <Link className="analytics-primary-action" href="/artist/onboarding">
        Open artist onboarding
      </Link>
    </section>
  );
}

function EmptyDashboard({ days }: { days: number }) {
  return (
    <section className="analytics-panel analytics-state-panel">
      <p className="analytics-state-kicker">No analytics events</p>
      <h2>No plays or payouts in the last {days} days</h2>
      <p>Once listeners play tracks or settlements complete, this page will fill from the analytics API.</p>
    </section>
  );
}

function Kpi({ label, value, detail, muted = false }: { label: string; value: string; detail: string; muted?: boolean }) {
  return (
    <article className={`analytics-kpi-card${muted ? " muted" : ""}`}>
      <div className="analytics-kpi-label">{label}</div>
      <div className="analytics-kpi-value">{value}</div>
      <div className="analytics-kpi-detail">{detail}</div>
    </article>
  );
}

function StatusStrip({
  sourceLabel,
  freshnessLabel,
  windowLabel,
  cacheLabel,
}: {
  sourceLabel: string;
  freshnessLabel: string;
  windowLabel: string;
  cacheLabel: string;
}) {
  return (
    <section className="analytics-status-strip" aria-label="Analytics data status">
      <span>Source: {sourceLabel}</span>
      <span>Freshness: {freshnessLabel}</span>
      <span>Window: {windowLabel}</span>
      <span>{cacheLabel}</span>
    </section>
  );
}

function PlaysChart({ points }: { points: ArtistAnalyticsDashboardData["playsOverTime"] }) {
  if (points.length === 0) {
    return <div className="analytics-chart-empty">No time-series rows yet</div>;
  }

  const maxValue = Math.max(...points.map((point) => point.plays), 1);
  return (
    <div className="analytics-real-chart" aria-label="Plays over time chart">
      {points.map((point) => {
        const height = Math.max(8, Math.round((point.plays / maxValue) * 100));
        return (
          <div key={point.date} className="analytics-bar-column">
            <div className="analytics-bar-value">{formatNumber(point.plays)}</div>
            <div className="analytics-bar-track">
              <div className="analytics-bar-fill" style={{ height: `${height}%` }} />
            </div>
            <div className="analytics-bar-label">{shortDate(point.date)}</div>
          </div>
        );
      })}
    </div>
  );
}

function TrackPerformanceTable({ tracks }: { tracks: ArtistAnalyticsDashboardData["trackPerformance"] }) {
  if (tracks.length === 0) {
    return <p className="analytics-muted">No track metrics for this window.</p>;
  }

  return (
    <div className="analytics-table-wrap">
      <table className="analytics-table">
        <thead>
          <tr>
            <th>Track</th>
            <th>Plays</th>
            <th>Payout</th>
            <th>Assets</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((track) => (
            <tr key={track.trackId} className="analytics-row-tight">
              <td>{track.title}</td>
              <td>{formatNumber(track.plays)}</td>
              <td>{formatUsd(track.payoutUsd)}</td>
              <td>{track.payoutsByAsset.map((asset) => asset.symbol).join(", ") || "None"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContentProtectionMetrics({ protection }: { protection: ArtistAnalyticsDashboardData["protection"] }) {
  return (
    <section className="analytics-panel">
      <div className="analytics-panel-heading">
        <h2>Content protection</h2>
        <span>{formatNumber(protection.totalDecisions)} route decisions</span>
      </div>
      <div className="analytics-protection-grid" aria-label="Content protection metrics">
        <ProtectionMetric
          label="Marketplace ready"
          value={formatNumber(protection.marketplaceReadyReleases)}
          detail="standard escrow or trusted fast path"
        />
        <ProtectionMetric
          label="Restricted"
          value={formatNumber(protection.restrictedReleases)}
          detail="limited, quarantined, or blocked"
        />
        <ProtectionMetric
          label="Blocked"
          value={formatNumber(protection.blockedReleases)}
          detail="current blocked route"
        />
      </div>
      <RouteBreakdown routes={protection.routes} />
    </section>
  );
}

function ProtectionMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="analytics-protection-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function RouteBreakdown({ routes }: { routes: ArtistAnalyticsDashboardData["protection"]["routes"] }) {
  if (routes.length === 0) {
    return <p className="analytics-muted">No rights route decisions for this window.</p>;
  }

  return (
    <div className="analytics-source-list analytics-protection-routes">
      {routes.map((route) => (
        <div key={route.route} className="analytics-source-row">
          <span>{formatRoute(route.route)}</span>
          <strong>
            {formatNumber(route.releases)} releases - {formatNumber(route.decisions)} decisions
          </strong>
        </div>
      ))}
    </div>
  );
}

function SeparatedContentProtection() {
  return (
    <div className="analytics-content-protection-note">
      Content Protection metrics will appear once rights route events exist for this artist.
    </div>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function primaryPayoutAsset(payouts: ArtistAnalyticsDashboardData["summary"]["payoutsByAsset"]) {
  const primary = payouts[0];
  return primary ? `${primary.settlementAmount} ${primary.symbol}` : "No settlement rows";
}

function totalSourcePlays(sources: ArtistAnalyticsDashboardData["sources"]) {
  return sources.reduce((total, source) => total + source.plays, 0);
}

function cacheLabel(hit: boolean) {
  return hit ? "Cache: reused" : "Cache: refreshed";
}

function formatRoute(route: string) {
  return route
    .toLowerCase()
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function formatFreshness(asOf: string | null, lagSeconds: number | null) {
  if (!asOf) {
    return "No rows";
  }
  if (lagSeconds === null) {
    return `As of ${formatDateTime(asOf)}`;
  }
  if (lagSeconds < 90) {
    return "Live";
  }
  if (lagSeconds < 3600) {
    return `${Math.round(lagSeconds / 60)} min delayed`;
  }
  if (lagSeconds < 86400) {
    return `${Math.round(lagSeconds / 3600)} hr delayed`;
  }
  return `As of ${formatDateTime(asOf)}`;
}

function formatWindow(from: string, to: string) {
  return `${shortDate(from)} to ${shortDate(to)}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
