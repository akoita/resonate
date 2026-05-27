"use client";

import type { AgentQualityDashboard as AgentQualityDashboardData, AgentQualityBreakdown } from "../../lib/api";

type DashboardState =
  | { status: "loading"; days: number }
  | { status: "error"; days: number; message: string; onRetry: () => void }
  | { status: "forbidden"; days: number }
  | { status: "ready"; days: number; data: AgentQualityDashboardData };

type Props = DashboardState & {
  onDaysChange: (days: number) => void;
};

const DAY_OPTIONS = [7, 30, 90];

export default function AgentQualityDashboard(props: Props) {
  return (
    <main className="analytics-container">
      <header className="analytics-header-section">
        <div className="analytics-title-row">
          <div>
            <p className="artist-analytics-eyebrow" style={{ fontSize: "12px", opacity: 0.5, margin: "0 0 4px" }}>
              AI DJ Quality
            </p>
            <h1 style={{ margin: 0 }}>Recommendation Quality</h1>
          </div>
          <div className="date-selector-pill-row" aria-label="AI DJ quality time window">
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
      {props.status === "forbidden" ? <ForbiddenDashboard /> : null}
      {props.status === "ready" ? <ReadyDashboard data={props.data} /> : null}
    </main>
  );
}

function ReadyDashboard({ data }: { data: AgentQualityDashboardData }) {
  const sourceLabel = data.meta.source === "bigquery" ? "BigQueryFactTable" : "LocalEventLedger";
  const freshnessLabel = formatFreshness(data.meta.freshness.asOf, data.meta.freshness.lagSeconds);

  if (data.meta.isEmpty) {
    return (
      <>
        <StatusStrip
          sourceLabel={sourceLabel}
          freshnessLabel="No AI DJ events yet"
          windowLabel={formatWindow(data.meta.timeWindow.from, data.meta.timeWindow.to)}
          cacheLabel={cacheLabel(data.meta.cache.hit)}
        />
        <section className="premium-table-wrapper" style={{ textAlign: "center", padding: "40px" }}>
          <p className="analytics-muted">No AI DJ quality events in this window.</p>
        </section>
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

      <section className="kpi-row" aria-label="AI DJ recommendation quality summary">
        <Kpi label="Acceptance" value={formatPercent(data.summary.acceptanceRate)} detail={`${formatNumber(data.summary.acceptedPicks)} accepted picks`} />
        <Kpi label="First-pick skip" value={formatPercent(data.summary.firstPickSkipRate)} detail={`${formatNumber(data.summary.firstPickOutcomes)} first-pick outcomes`} />
        <Kpi label="Sessions" value={formatNumber(data.summary.sessionsStarted)} detail={`${formatDuration(data.summary.averageSessionDurationMs)} average duration`} />
        <Kpi label="Purchases" value={formatNumber(data.summary.purchases)} detail={formatUsd(data.summary.purchaseUsd)} />
      </section>

      <div className="analytics-dashboard-grid">
        <BreakdownCard title="Session Intent Outcomes" rows={data.intentBreakdown} />
        <BreakdownCard title="Strategy And Taste Source" rows={[...data.strategyBreakdown, ...data.tasteSourceBreakdown].slice(0, 8)} />
      </div>

      <div className="premium-table-wrapper">
        <div className="chart-card-header">
          <h2>Version Freshness</h2>
          <div className="chart-card-header-badge">{data.versionBreakdown.length} versions</div>
        </div>
        <BreakdownTable rows={data.versionBreakdown} />
      </div>

      <div className="premium-table-wrapper">
        <div className="chart-card-header">
          <h2>Quality Timeline</h2>
          <div className="chart-card-header-badge">{data.qualityOverTime.length} days</div>
        </div>
        <div className="analytics-mini-bars">
          {data.qualityOverTime.map((point) => (
            <div key={point.date} className="analytics-mini-bar-row">
              <span>{formatDate(point.date)}</span>
              <div className="sources-progress-bar-bg">
                <div
                  className="sources-progress-bar-fill"
                  style={{ width: `${barWidth(point.acceptedPicks, data.qualityOverTime.map((row) => row.acceptedPicks))}%` }}
                />
              </div>
              <strong>{formatNumber(point.acceptedPicks)} accepted</strong>
            </div>
          ))}
        </div>
      </div>

      <section className="premium-table-wrapper">
        <h2>Privacy Boundary</h2>
        <p className="analytics-muted" style={{ marginBottom: "12px" }}>
          {data.privacy.aggregation}. Excludes {data.privacy.excludes.join(", ")}.
        </p>
      </section>
    </>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: AgentQualityBreakdown[] }) {
  return (
    <div className="sources-card">
      <div className="chart-card-header">
        <h2>{title}</h2>
        <div className="chart-card-header-badge">{rows.length} segments</div>
      </div>
      <BreakdownTable rows={rows} />
    </div>
  );
}

function BreakdownTable({ rows }: { rows: AgentQualityBreakdown[] }) {
  if (rows.length === 0) {
    return <p className="analytics-muted">No segment rows yet.</p>;
  }

  return (
    <div className="analytics-quality-table" role="table">
      <div className="analytics-quality-row analytics-quality-row--head" role="row">
        <span>Segment</span>
        <span>Accept</span>
        <span>Complete</span>
        <span>Save</span>
        <span>Buy</span>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="analytics-quality-row" role="row">
          <span>{row.label}</span>
          <strong>{formatPercent(row.acceptanceRate)}</strong>
          <strong>{formatPercent(row.completionRate)}</strong>
          <strong>{formatPercent(row.saveRate)}</strong>
          <strong>{formatPercent(row.purchaseRate)}</strong>
        </div>
      ))}
    </div>
  );
}

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="premium-kpi-card agent-context">
      <div className="kpi-header">
        <span className="kpi-label">{label}</span>
        <div className="kpi-icon-glow">{label.slice(0, 1)}</div>
      </div>
      <div className="kpi-value-mono">{value}</div>
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

function LoadingDashboard() {
  return (
    <div className="analytics-skeleton" style={{ padding: "80px", textAlign: "center", opacity: 0.5 }}>
      <span className="aid-spinner" style={{ marginBottom: "16px" }} />
      <div>Loading AI DJ quality metrics...</div>
    </div>
  );
}

function ErrorDashboard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="premium-table-wrapper" style={{ textAlign: "center", padding: "40px" }} role="alert">
      <p style={{ color: "var(--r-error)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase" }}>
        Quality Report Unavailable
      </p>
      <h2 style={{ fontSize: "20px", marginTop: "8px" }}>Could not load AI DJ metrics</h2>
      <p style={{ opacity: 0.6, fontSize: "13px", margin: "8px 0 20px" }}>{message}</p>
      <button type="button" className="wallet-connect-btn" onClick={onRetry}>
        Retry Synchronization
      </button>
    </section>
  );
}

function ForbiddenDashboard() {
  return (
    <section className="premium-table-wrapper" style={{ textAlign: "center", padding: "40px" }}>
      <p style={{ color: "var(--r-primary-soft)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase" }}>
        Operator Access
      </p>
      <h2 style={{ fontSize: "20px", marginTop: "8px" }}>AI DJ quality metrics are restricted</h2>
      <p className="analytics-muted" style={{ marginTop: "8px" }}>
        Connect with an operator or admin account to view aggregate recommendation quality.
      </p>
    </section>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDuration(value: number | null) {
  if (!value) {
    return "No duration";
  }
  const minutes = Math.round(value / 60000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatFreshness(asOf: string | null, lagSeconds: number | null) {
  if (!asOf || lagSeconds === null) return "No events yet";
  if (lagSeconds < 60) return "Current";
  if (lagSeconds < 3600) return `${Math.round(lagSeconds / 60)} min delayed`;
  if (lagSeconds < 86400) return `${Math.round(lagSeconds / 3600)} hr delayed`;
  return `${Math.round(lagSeconds / 86400)} day delayed`;
}

function formatWindow(from: string, to: string) {
  return `${formatDate(from)} - ${formatDate(to)}`;
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
  } catch {
    return value;
  }
}

function cacheLabel(hit: boolean) {
  return hit ? "Hit" : "Fresh";
}

function barWidth(value: number, allValues: number[]) {
  const max = Math.max(...allValues, 1);
  return Math.max(4, (value / max) * 100);
}
