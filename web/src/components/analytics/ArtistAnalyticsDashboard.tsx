"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ArtistActionCard, ArtistAnalyticsDashboard as ArtistAnalyticsDashboardData } from "../../lib/api";
import { recordProductAnalyticsFromBrowser } from "../../lib/productAnalytics";

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
    <main className="analytics-container">
      <header className="analytics-header-section">
        <div className="analytics-title-row">
          <div>
            <p className="artist-analytics-eyebrow" style={{ fontSize: "12px", opacity: 0.5, margin: "0 0 4px" }}>
              Artist Analytics
            </p>
            <h1 style={{ margin: 0 }}>{title}</h1>
          </div>
          <div className="date-selector-pill-row" aria-label="Analytics time window">
            {DAY_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                className={`date-selector-pill ${props.days === days ? "active" : ""}`}
                onClick={() => props.onDaysChange(days)}
              >
                {days}d
              </button>
            ))}
          </div>
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
  const sourceLabel = data.meta.source === "bigquery" ? "BigQueryFactTable" : "LocalEventLedger";
  const freshnessLabel = formatFreshness(data.meta.freshness.asOf, data.meta.freshness.lagSeconds);
  const payoutLabel = formatUsd(data.summary.totalPayoutUsd);
  const actions = data.actions ?? [];

  if (data.meta.isEmpty) {
    return (
      <>
        <StatusStrip
          sourceLabel={sourceLabel}
          freshnessLabel="No events yet"
          windowLabel={formatWindow(data.meta.timeWindow.from, data.meta.timeWindow.to)}
          cacheLabel={cacheLabel(data.meta.cache.hit)}
        />
        <ArtistActionCockpit artistId={data.summary.artistId} actions={actions} />
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

      <ArtistActionCockpit artistId={data.summary.artistId} actions={actions} />

      <section className="kpi-row" aria-label="Artist analytics summary">
        <Kpi label="Total plays" value={formatNumber(data.summary.totalPlays)} detail={`${data.meta.timeWindow.days} day window`} />
        <Kpi label="Total payout" value={payoutLabel} detail={primaryPayoutAsset(data.summary.payoutsByAsset)} />
        <Kpi label="Top track" value={topTrack?.title ?? "No track yet"} detail={topTrack ? `${formatNumber(topTrack.plays)} plays` : "Waiting for play events"} />
        <Kpi
          label="Protected releases"
          value={formatNumber(data.protection.releasesWithDecisions)}
          detail={`${formatNumber(data.protection.marketplaceReadyReleases)} marketplace ready`}
        />
      </section>

      <div className="analytics-dashboard-grid">
        <div className="chart-card-wrapper">
          <div className="chart-card-header">
            <h2>Plays over time</h2>
            <div className="chart-card-header-badge">
              {data.playsOverTime.length} data points
            </div>
          </div>
          <PlaysChart points={data.playsOverTime} />
        </div>

        <div className="sources-card">
          <div className="chart-card-header">
            <h2>Sources</h2>
            <div className="chart-card-header-badge">
              {formatNumber(totalSourcePlays(data.sources))} plays
            </div>
          </div>
          <div className="sources-list">
            {data.sources.length === 0 ? (
              <p style={{ opacity: 0.4, padding: "20px 0", textAlign: "center", fontSize: "13px" }}>
                No playback source dimensions yet.
              </p>
            ) : (
              data.sources.map((source) => {
                const maxPlays = Math.max(...data.sources.map((src) => src.plays), 1);
                const percentage = (source.plays / maxPlays) * 100;
                return (
                  <div key={source.source} className="sources-item">
                    <div className="sources-item-row">
                      <span className="sources-item-name">{source.source}</span>
                      <span className="sources-item-value">{formatNumber(source.plays)} plays</span>
                    </div>
                    <div className="sources-progress-bar-bg">
                      <div className="sources-progress-bar-fill" style={{ width: `${percentage}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="premium-table-wrapper">
        <h2>Track Performance</h2>
        <TrackPerformanceTable tracks={data.trackPerformance} />
      </div>

      <ContentProtectionMetrics protection={data.protection} />
    </>
  );
}

function ArtistActionCockpit({ artistId, actions }: { artistId: string; actions: ArtistActionCard[] }) {
  const actionSignature = useMemo(() => actions.map((action) => action.id).join("|"), [actions]);

  useEffect(() => {
    for (const action of actions) {
      recordProductAnalyticsFromBrowser("artist.action_card_impression", {
        subjectType: "artist",
        subjectId: artistId,
        payload: actionAnalyticsPayload(action),
      });
    }
  }, [actionSignature, actions, artistId]);

  if (actions.length === 0) {
    return (
      <section className="artist-action-cockpit" aria-label="Recommended artist actions">
        <div className="artist-action-cockpit__header">
          <div>
            <p className="artist-action-cockpit__eyebrow">Action Cockpit</p>
            <h2>Recommended next actions</h2>
          </div>
          <span className="artist-action-cockpit__privacy">Aggregate signals only</span>
        </div>
        <p className="artist-action-cockpit__empty">
          Action recommendations appear once aggregate catalog, playback, marketplace, or community signals are available.
        </p>
      </section>
    );
  }

  return (
    <section className="artist-action-cockpit" aria-label="Recommended artist actions">
      <div className="artist-action-cockpit__header">
        <div>
          <p className="artist-action-cockpit__eyebrow">Action Cockpit</p>
          <h2>Recommended next actions</h2>
        </div>
        <span className="artist-action-cockpit__privacy">Aggregate signals only</span>
      </div>
      <div className="artist-action-cockpit__grid">
        {actions.map((action) => (
          <article key={action.id} className={`artist-action-card artist-action-card--${action.priority}`}>
            <div className="artist-action-card__topline">
              <span>{action.sourceSignal.category}</span>
              <span className={`artist-action-card__priority artist-action-card__priority--${action.priority}`}>
                {action.priority} priority
              </span>
            </div>
            <h3>{action.title}</h3>
            <p>{action.description}</p>
            <div className="artist-action-card__reason">{action.reason}</div>
            <div className="artist-action-card__meta">
              <span>{Math.round(action.confidence * 100)}% confidence</span>
              {action.privacy.thresholdApplied && action.privacy.minimumThreshold ? (
                <span>{action.privacy.minimumThreshold}+ signal floor</span>
              ) : (
                <span>artist-owned signal</span>
              )}
            </div>
            <div className="artist-action-card__footer">
              {action.cta.disabled || !action.cta.href ? (
                <>
                  <button type="button" className="artist-action-card__cta" disabled>
                    {action.cta.label}
                  </button>
                  {action.cta.disabledReason ? (
                    <small className="artist-action-card__cta-note">{action.cta.disabledReason}</small>
                  ) : null}
                </>
              ) : (
                <Link
                  className="artist-action-card__cta"
                  href={action.cta.href}
                  onClick={() => {
                    recordProductAnalyticsFromBrowser("artist.action_card_clicked", {
                      subjectType: "artist",
                      subjectId: artistId,
                      payload: actionAnalyticsPayload(action),
                    });
                  }}
                >
                  {action.cta.label}
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function actionAnalyticsPayload(action: ArtistActionCard) {
  return {
    cardId: action.id,
    cardType: action.type,
    priority: action.priority,
    sourceCategory: action.sourceSignal.category,
    disabled: Boolean(action.cta.disabled || !action.cta.href),
  };
}

function LoadingDashboard() {
  return (
    <div className="analytics-skeleton" style={{ padding: "80px", textAlign: "center", opacity: 0.5 }}>
      <span className="aid-spinner" style={{ marginBottom: "16px" }} />
      <div>Loading catalog and playback statistics…</div>
    </div>
  );
}

function ErrorDashboard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="premium-table-wrapper" style={{ textAlign: "center", padding: "40px" }} role="alert">
      <p style={{ color: "var(--r-error)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase" }}>
        Analytics Unavailable
      </p>
      <h2 style={{ fontSize: "20px", marginTop: "8px" }}>Could not load artist metrics</h2>
      <p style={{ opacity: 0.6, fontSize: "13px", margin: "8px 0 20px" }}>{message}</p>
      <button type="button" className="wallet-connect-btn" onClick={onRetry}>
        Retry Synchronization
      </button>
    </section>
  );
}

function NoArtistDashboard() {
  return (
    <section className="premium-table-wrapper" style={{ textAlign: "center", padding: "40px" }}>
      <p style={{ color: "var(--r-primary-soft)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase" }}>
        No Artist Profile
      </p>
      <h2 style={{ fontSize: "20px", marginTop: "8px" }}>Create an artist profile to see analytics</h2>
      <p style={{ opacity: 0.6, fontSize: "13px", margin: "8px 0 20px" }}>
        Metrics are scoped to the artist account that owns the catalog.
      </p>
      <Link className="wallet-connect-btn" href="/artist/onboarding" style={{ display: "inline-block", textDecoration: "none" }}>
        Open Artist Onboarding
      </Link>
    </section>
  );
}

function EmptyDashboard({ days }: { days: number }) {
  return (
    <section className="premium-table-wrapper" style={{ textAlign: "center", padding: "40px" }}>
      <p style={{ color: "var(--r-on-surface-muted)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase" }}>
        No Playback Events
      </p>
      <h2 style={{ fontSize: "20px", marginTop: "8px" }}>No plays or payouts in the last {days} days</h2>
      <p style={{ opacity: 0.6, fontSize: "13px", marginTop: "8px" }}>
        Once listeners play tracks or stablecoin settlements complete, this page will fill dynamically.
      </p>
    </section>
  );
}

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  const isAgent = label.toLowerCase().includes("top track");
  const icon = label.toLowerCase().includes("plays")
    ? "▶"
    : label.toLowerCase().includes("payout")
    ? "$"
    : label.toLowerCase().includes("track")
    ? "★"
    : "🛡️";

  return (
    <div className={`premium-kpi-card ${isAgent ? "agent-context" : "human-context"}`}>
      <div className="kpi-header">
        <span className="kpi-label">{label}</span>
        <div className="kpi-icon-glow">{icon}</div>
      </div>
      <div className="kpi-value-mono" style={{ fontSize: label.toLowerCase().includes("track") ? "18px" : undefined, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
        {value}
      </div>
      <div className="kpi-subtitle-trend">
        <span>{detail}</span>
      </div>
    </div>
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
    <div className="glass-metadata-bar">
      <div className="metadata-item">
        <span>Source:</span>
        <strong>{sourceLabel}</strong>
      </div>
      <div className="metadata-item">
        <span className="metadata-dot pulsing" />
        <span>Freshness:</span>
        <strong>{freshnessLabel}</strong>
      </div>
      <div className="metadata-item">
        <span>Window:</span>
        <strong>{windowLabel}</strong>
      </div>
      <div className="metadata-item">
        <span>Cache:</span>
        <strong>{cacheLabel}</strong>
      </div>
    </div>
  );
}

function PlaysChart({ points }: { points: ArtistAnalyticsDashboardData["playsOverTime"] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const chartPoints = useMemo(() => {
    if (points.length === 0) return [];
    if (points.length === 1) {
      return [
        { date: "Start", plays: 0, payoutUsd: 0 },
        { date: points[0].date, plays: points[0].plays, payoutUsd: points[0].payoutUsd },
        { date: "End", plays: 0, payoutUsd: 0 },
      ];
    }
    return points;
  }, [points]);

  const svgPath = useMemo(() => {
    if (chartPoints.length < 2) return { linePath: "", areaPath: "" };

    const width = 600;
    const height = 140;
    const padding = 30;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const maxVal = Math.max(...chartPoints.map((p) => p.plays), 10);

    const coords = chartPoints.map((p, idx) => {
      const x = padding + (idx / (chartPoints.length - 1)) * chartWidth;
      const y = padding + chartHeight - (p.plays / maxVal) * chartHeight;
      return { x, y };
    });

    let linePath = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const curr = coords[i];
      const next = coords[i + 1];
      const cpX1 = curr.x + (next.x - curr.x) / 3;
      const cpY1 = curr.y;
      const cpX2 = curr.x + (2 * (next.x - curr.x)) / 3;
      const cpY2 = next.y;
      linePath += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${next.x} ${next.y}`;
    }

    const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${height - padding} L ${coords[0].x} ${height - padding} Z`;

    return { linePath, areaPath, coords };
  }, [chartPoints]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>, coords: Array<{ x: number; y: number }>) => {
    if (coords.length === 0) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;

    let closestIdx = 0;
    let minDiff = Infinity;
    coords.forEach((coord, idx) => {
      const diff = Math.abs(coord.x - (x * (600 / rect.width)));
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });

    setHoveredIndex(closestIdx);

    const tooltipX = (coords[closestIdx].x / 600) * rect.width;
    const tooltipY = (coords[closestIdx].y / 140) * rect.height - 10;
    setTooltipPos({ x: tooltipX, y: tooltipY });
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
    setTooltipPos(null);
  };

  if (points.length === 0) {
    return <div className="analytics-chart-empty">No time-series rows yet</div>;
  }

  const formattedDate = (d: string) => {
    if (d === "Start" || d === "End") return "";
    try {
      return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(d));
    } catch {
      return d;
    }
  };

  return (
    <div className="svg-chart-container" onMouseLeave={handleMouseLeave}>
      <svg
        className="svg-chart"
        viewBox="0 0 600 140"
        preserveAspectRatio="none"
        onMouseMove={(e) => svgPath.coords && handleMouseMove(e, svgPath.coords)}
      >
        <defs>
          <linearGradient id="chartAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--r-primary)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--r-primary)" stopOpacity="0.00" />
          </linearGradient>
          <linearGradient id="chartLineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--r-primary)" />
            <stop offset="100%" stopColor="var(--r-secondary)" />
          </linearGradient>
        </defs>

        <line className="svg-chart-gridline" x1="30" y1="30" x2="570" y2="30" />
        <line className="svg-chart-gridline" x1="30" y1="70" x2="570" y2="70" />
        <line className="svg-chart-gridline" x1="30" y1="110" x2="570" y2="110" />

        <path className="svg-chart-path-area" d={svgPath.areaPath} />
        <path className="svg-chart-path-line" d={svgPath.linePath} />

        {hoveredIndex !== null && svgPath.coords && (
          <line
            className="svg-chart-hover-line"
            x1={svgPath.coords[hoveredIndex].x}
            y1="30"
            x2={svgPath.coords[hoveredIndex].x}
            y2="110"
          />
        )}

        {svgPath.coords && svgPath.coords.map((c, idx) => {
          const label = chartPoints[idx].date;
          if (label === "Start" || label === "End") return null;
          return (
            <circle
              key={idx}
              className="svg-chart-dot"
              cx={c.x}
              cy={c.y}
              r={hoveredIndex === idx ? 6 : 4}
            />
          );
        })}
      </svg>

      {hoveredIndex !== null && tooltipPos && chartPoints[hoveredIndex].date !== "Start" && chartPoints[hoveredIndex].date !== "End" && (
        <div
          className="chart-interactive-tooltip"
          style={{
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`,
          }}
        >
          <span className="tooltip-date">
            {formattedDate(chartPoints[hoveredIndex].date)}
          </span>
          <span className="tooltip-value">
            {formatNumber(chartPoints[hoveredIndex].plays)} plays
          </span>
        </div>
      )}
    </div>
  );
}

function TrackPerformanceTable({ tracks }: { tracks: ArtistAnalyticsDashboardData["trackPerformance"] }) {
  if (tracks.length === 0) {
    return <p className="analytics-muted">No track metrics for this window.</p>;
  }

  return (
    <table className="premium-table">
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
          <tr key={track.trackId}>
            <td style={{ fontWeight: 600 }}>{track.title}</td>
            <td className="premium-table-cell-mono">{formatNumber(track.plays)}</td>
            <td className="premium-table-cell-mono">{formatUsd(track.payoutUsd)}</td>
            <td>
              <span className="status-capsule-badge inactive" style={{ fontSize: "10px", padding: "2px 8px" }}>
                {track.payoutsByAsset.map((asset) => asset.symbol).join(", ") || "None"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ContentProtectionMetrics({ protection }: { protection: ArtistAnalyticsDashboardData["protection"] }) {
  return (
    <div className="premium-table-wrapper" style={{ padding: "20px 24px" }}>
      <h2>Content protection escrow status</h2>
      <div className="rights-decisions-grid">
        <div className="rights-decision-column">
          <span className="rights-decision-column-label">Marketplace Ready</span>
          <span className="rights-decision-column-value">{formatNumber(protection.marketplaceReadyReleases)}</span>
          <span className="rights-decision-column-sub">standard escrow or trusted fast path</span>
        </div>
        <div className="rights-decision-column" style={{ borderLeft: "1px solid rgba(255,255,255,0.03)", paddingLeft: "20px" }}>
          <span className="rights-decision-column-label">Restricted</span>
          <span className="rights-decision-column-value" style={{ color: "var(--r-error)" }}>
            {formatNumber(protection.restrictedReleases)}
          </span>
          <span className="rights-decision-column-sub">limited, quarantined, or blocked</span>
        </div>
        <div className="rights-decision-column" style={{ borderLeft: "1px solid rgba(255,255,255,0.03)", paddingLeft: "20px" }}>
          <span className="rights-decision-column-label">Blocked</span>
          <span className="rights-decision-column-value" style={{ color: "var(--r-error)" }}>
            {formatNumber(protection.blockedReleases)}
          </span>
          <span className="rights-decision-column-sub">current blocked route decision</span>
        </div>
      </div>
      <RouteBreakdown routes={protection.routes} />
    </div>
  );
}

function RouteBreakdown({ routes }: { routes: ArtistAnalyticsDashboardData["protection"]["routes"] }) {
  if (routes.length === 0) {
    return <p className="analytics-muted" style={{ opacity: 0.5, fontSize: "12px", textAlign: "center", padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.03)" }}>
      No rights route decisions for this window.
    </p>;
  }

  return (
    <div className="sources-list" style={{ borderTop: "1px solid rgba(255,255,255,0.03)", paddingTop: "12px", marginTop: "12px" }}>
      {routes.map((route) => (
        <div key={route.route} className="sources-item-row" style={{ fontSize: "12px", padding: "4px 0" }}>
          <span style={{ fontWeight: 500 }}>{formatRoute(route.route)}</span>
          <span style={{ opacity: 0.8, fontFamily: "var(--font-mono)" }}>
            {formatNumber(route.releases)} releases · {formatNumber(route.decisions)} decisions
          </span>
        </div>
      ))}
    </div>
  );
}

function SeparatedContentProtection() {
  return (
    <div className="premium-table-wrapper" style={{ textAlign: "center", padding: "20px", opacity: 0.5, fontSize: "12px" }}>
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

// Helper: safe formatting for NaN cases
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
