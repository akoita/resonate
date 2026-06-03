"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type {
  CommunityCohortGenerationResponse,
  CommunityCohortQualityReasonSummary,
  CommunityCohortQualityResponse,
} from "../../lib/api";

type PanelState =
  | { status: "loading"; minimumSize: number; onMinimumSizeChange: (value: number) => void }
  | { status: "forbidden"; minimumSize: number; onMinimumSizeChange: (value: number) => void }
  | {
      status: "error";
      minimumSize: number;
      message: string;
      onMinimumSizeChange: (value: number) => void;
      onRefresh: () => void;
    }
  | {
      status: "ready";
      minimumSize: number;
      quality: CommunityCohortQualityResponse;
      lastGeneration: CommunityCohortGenerationResponse | null;
      isGenerating: boolean;
      generateError: string | null;
      onMinimumSizeChange: (value: number) => void;
      onGenerate: () => void;
      onRefresh: () => void;
    };

// Ascending so the segmented control reads as a coherent scale: the real-data
// staging validation floor of 2 first, up to safer operational sizes.
const MINIMUM_SIZE_OPTIONS = [2, 3, 5, 10, 25];

export default function CommunityCohortOperationsPanel(props: PanelState) {
  return (
    <main className="analytics-container cohort-operations-container">
      <header className="analytics-header-section">
        <div className="analytics-title-row">
          <div>
            <p className="artist-analytics-eyebrow" style={{ fontSize: "12px", opacity: 0.5, margin: "0 0 4px" }}>
              Community Operations
            </p>
            <h1 style={{ margin: 0 }}>Community Cohorts</h1>
            <p className="analytics-muted" style={{ margin: "8px 0 0", maxWidth: "760px" }}>
              Generate privacy-safe listener cohorts from real opted-in staging activity and inspect aggregate health.
            </p>
          </div>
          <MinimumSizeControl
            value={props.minimumSize}
            onChange={props.onMinimumSizeChange}
            disabled={props.status === "loading"}
          />
        </div>
      </header>

      {props.status === "loading" ? <LoadingPanel /> : null}
      {props.status === "forbidden" ? <ForbiddenPanel /> : null}
      {props.status === "error" ? <ErrorPanel message={props.message} onRefresh={props.onRefresh} /> : null}
      {props.status === "ready" ? (
        <ReadyPanel
          quality={props.quality}
          minimumSize={props.minimumSize}
          lastGeneration={props.lastGeneration}
          isGenerating={props.isGenerating}
          generateError={props.generateError}
          onGenerate={props.onGenerate}
          onRefresh={props.onRefresh}
        />
      ) : null}
    </main>
  );
}

function ReadyPanel({
  quality,
  minimumSize,
  lastGeneration,
  isGenerating,
  generateError,
  onGenerate,
  onRefresh,
}: {
  quality: CommunityCohortQualityResponse;
  minimumSize: number;
  lastGeneration: CommunityCohortGenerationResponse | null;
  isGenerating: boolean;
  generateError: string | null;
  onGenerate: () => void;
  onRefresh: () => void;
}) {
  const generated = quality.cohorts.generated;
  const hasVisibleGeneratedCohort = generated.visibleNow > 0;

  return (
    <>
      <div className="glass-metadata-bar">
        <div className="metadata-item">
          <span>Report:</span>
          <strong>{formatDateTime(quality.generatedAt)}</strong>
        </div>
        <div className="metadata-item">
          <span
            className={`metadata-dot ${hasVisibleGeneratedCohort ? "pulsing" : "metadata-dot--muted"}`}
            aria-hidden="true"
          />
          <span>Visible generated:</span>
          <strong>{formatNumber(generated.visibleNow)}</strong>
        </div>
        <div className="metadata-item">
          <span>Privacy:</span>
          <strong>{quality.privacy.aggregateOnly ? "Aggregate only" : "Check response"}</strong>
        </div>
        <div className="metadata-item">
          <span>Source:</span>
          <strong>{quality.actions.source}</strong>
        </div>
      </div>

      <section className="kpi-row" aria-label="Community cohort quality summary">
        <Kpi icon={ICONS.cohorts} label="Generated cohorts" value={formatNumber(generated.total)} detail={`${formatNumber(generated.visibleNow)} visible now`} />
        <Kpi icon={ICONS.below} label="Below threshold" value={formatNumber(generated.belowThreshold)} detail={`${formatNumber(quality.cohorts.belowThreshold)} across all types`} />
        <Kpi icon={ICONS.stale} label="Stale memberships" value={formatNumber(quality.memberships.stale)} detail={`of ${formatNumber(quality.memberships.total)} memberships`} />
        <Kpi icon={ICONS.consent} label="Consent filtered" value={formatNumber(quality.memberships.disabledConsent.total)} detail="No listener identities exposed" />
      </section>

      <section className="premium-table-wrapper">
        <div className="chart-card-header">
          <div>
            <h2>Run Generation</h2>
            <p className="analytics-muted" style={{ margin: "4px 0 0" }}>
              Uses real opted-in listener signals only. A size of 2 is useful for staging validation; higher values are safer for normal operation.
            </p>
          </div>
          <button
            type="button"
            className="wallet-connect-btn"
            onClick={onGenerate}
            disabled={isGenerating}
            aria-busy={isGenerating}
            style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
          >
            {isGenerating ? (
              <>
                <span className="aid-spinner" aria-hidden="true" />
                Generating...
              </>
            ) : (
              `Generate at ${minimumSize}+`
            )}
          </button>
        </div>
        {generateError ? (
          <p role="alert" style={{ color: "var(--r-error)", fontSize: "13px", marginTop: "12px" }}>
            {generateError}
          </p>
        ) : null}
        {lastGeneration ? <GenerationSummary generation={lastGeneration} /> : null}
      </section>

      <section className="premium-table-wrapper">
        <div className="chart-card-header">
          <div>
            <h2>Real-Data Readiness</h2>
            <p className="analytics-muted" style={{ margin: "4px 0 0" }}>
              Listener cards appear only when real opted-in accounts share a privacy-safe signal.
            </p>
          </div>
          <button type="button" className="date-selector-pill" onClick={onRefresh}>
            Refresh
          </button>
        </div>
        {hasVisibleGeneratedCohort ? (
          <div className="glass-metadata-bar" style={{ marginTop: "16px" }}>
            <div className="metadata-item">
              <span className="metadata-dot pulsing" aria-hidden="true" />
              <strong>Ready for listener validation</strong>
            </div>
            <div className="metadata-item">
              <span>Open:</span>
              <Link href="/settings" className="cohort-inline-link" style={{ color: "var(--r-primary-soft)", fontWeight: 600 }}>
                Settings → Listener Cohorts
              </Link>
            </div>
          </div>
        ) : (
          <ReadinessBlock minimumSize={minimumSize} quality={quality} />
        )}
      </section>

      <div className="analytics-dashboard-grid">
        <BreakdownCard title="Generated Status" rows={recordRows(generated.byStatus)} />
        <BreakdownCard title="Generated Types" rows={recordRows(generated.byType)} />
      </div>

      <section className="premium-table-wrapper">
        <div className="chart-card-header">
          <h2>Bounded Reason Codes</h2>
          <div className="chart-card-header-badge">
            {formatNumber(quality.reasonCodes.summaries.length)} of {formatNumber(quality.reasonCodes.total)}
          </div>
        </div>
        <ReasonSummaryTable rows={quality.reasonCodes.summaries} />
      </section>
    </>
  );
}

function MinimumSizeControl({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="date-selector-pill-row" aria-label="Cohort minimum size">
      {MINIMUM_SIZE_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          className={`date-selector-pill ${value === option ? "active" : ""}`}
          disabled={disabled}
          onClick={() => onChange(option)}
        >
          {option}+
        </button>
      ))}
    </div>
  );
}

function GenerationSummary({ generation }: { generation: CommunityCohortGenerationResponse }) {
  const summary = generation.summary;
  return (
    <div className="glass-metadata-bar" style={{ marginTop: "16px", flexWrap: "wrap" }}>
      <div className="metadata-item">
        <span>Generated:</span>
        <strong>{formatDateTime(generation.generatedAt)}</strong>
      </div>
      <div className="metadata-item">
        <span>Visible:</span>
        <strong>{formatNumber(summary.visibleCohorts)}</strong>
      </div>
      <div className="metadata-item">
        <span>Activated:</span>
        <strong>{formatNumber(summary.cohortsActivated)}</strong>
      </div>
      <div className="metadata-item">
        <span>Archived:</span>
        <strong>{formatNumber(summary.cohortsArchived)}</strong>
      </div>
      <div className="metadata-item">
        <span>Created memberships:</span>
        <strong>{formatNumber(summary.membershipsCreated)}</strong>
      </div>
    </div>
  );
}

function ReadinessBlock({ minimumSize, quality }: { minimumSize: number; quality: CommunityCohortQualityResponse }) {
  const noCandidates = quality.cohorts.generated.total === 0;
  const belowThreshold = quality.cohorts.generated.belowThreshold > 0;
  const consentFiltered = quality.memberships.disabledConsent.total > 0;

  return (
    <div
      style={{
        marginTop: "16px",
        padding: "16px",
        border: "1px solid color-mix(in srgb, var(--r-warning) 28%, transparent)",
        borderRadius: "var(--r-radius-sm)",
        background: "color-mix(in srgb, var(--r-warning) 8%, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span
          aria-hidden="true"
          style={{ display: "inline-flex", color: "var(--r-warning)", flexShrink: 0 }}
        >
          <svg {...svgProps}>
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
        </span>
        <h3 style={{ margin: 0, fontSize: "16px" }}>No visible generated cohorts yet</h3>
      </div>
      <div className="analytics-quality-table" role="table" style={{ marginTop: "16px" }}>
        <ReadinessRow
          label={`${minimumSize}+ real opted-in listeners`}
          status={belowThreshold ? "Needs more shared members" : noCandidates ? "Not observed yet" : "Observed"}
        />
        <ReadinessRow
          label="Shared safe signal"
          status={noCandidates ? "Need shared genre, artist, campaign, collector, or city signal" : "Observed"}
        />
        <ReadinessRow
          label="Community matching consent"
          status={consentFiltered ? "Some matching consent is off" : "No disabled consent blockers reported"}
        />
        <ReadinessRow
          label="Generation run"
          status={quality.cohorts.generated.total > 0 ? "Completed" : "Run after real signals exist"}
        />
      </div>
    </div>
  );
}

function ReadinessRow({ label, status }: { label: string; status: string }) {
  return (
    <div className="analytics-quality-row" role="row" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
      <span>{label}</span>
      <strong>{status}</strong>
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: Array<{ key: string; count: number }> }) {
  return (
    <section className="sources-card">
      <div className="chart-card-header">
        <h2>{title}</h2>
        <div className="chart-card-header-badge">{rows.length} rows</div>
      </div>
      {rows.length > 0 ? (
        <div className="analytics-quality-table" role="table">
          {rows.map((row) => (
            <div key={row.key} className="analytics-quality-row" role="row" style={{ gridTemplateColumns: "1fr auto" }}>
              <span>{labelize(row.key)}</span>
              <strong>{formatNumber(row.count)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="analytics-muted">No rows yet.</p>
      )}
    </section>
  );
}

function ReasonSummaryTable({ rows }: { rows: CommunityCohortQualityReasonSummary[] }) {
  if (rows.length === 0) {
    return <p className="analytics-muted">No generated reason-code summaries yet.</p>;
  }

  return (
    <div className="analytics-quality-table" role="table">
      <div className="analytics-quality-row analytics-quality-row--head" role="row" style={{ gridTemplateColumns: "1.1fr 1.5fr repeat(4, 0.7fr)" }}>
        <span>Type</span>
        <span>Reason</span>
        <span>Cohorts</span>
        <span>Active</span>
        <span>Below</span>
        <span>Members</span>
      </div>
      {rows.map((row) => (
        <div
          key={`${row.cohortType}:${row.reasonCode}`}
          className="analytics-quality-row"
          role="row"
          style={{ gridTemplateColumns: "1.1fr 1.5fr repeat(4, 0.7fr)" }}
        >
          <span>{labelize(row.cohortType)}</span>
          <span>{displayReason(row.reasonCode, row.cohortType)}</span>
          <strong>{formatNumber(row.cohortCount)}</strong>
          <strong>{formatNumber(row.activeCount)}</strong>
          <strong>{formatNumber(row.belowThresholdCount)}</strong>
          <strong>{row.visibleMemberBucket}</strong>
        </div>
      ))}
    </div>
  );
}

function Kpi({ icon, label, value, detail }: { icon?: ReactNode; label: string; value: string; detail: string }) {
  return (
    <div className="premium-kpi-card agent-context">
      <div className="kpi-header">
        <span className="kpi-label">{label}</span>
        <div className="kpi-icon-glow" aria-hidden="true">
          {icon ?? label.slice(0, 1)}
        </div>
      </div>
      <div className="kpi-value-mono">{value}</div>
      <div className="kpi-subtitle-trend">
        <span>{detail}</span>
      </div>
    </div>
  );
}

const svgProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

// Monochrome line icons (inherit the kpi-icon-glow colour via currentColor),
// one per KPI — clearer and more on-brand than a bare initial letter.
const ICONS = {
  cohorts: (
    <svg {...svgProps}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  below: (
    <svg {...svgProps}>
      <path d="M12 2v14" />
      <path d="m6 12 6 6 6-6" />
      <path d="M5 22h14" />
    </svg>
  ),
  stale: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  consent: (
    <svg {...svgProps}>
      <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
} as const;

function LoadingPanel() {
  return (
    <div className="analytics-skeleton" style={{ padding: "80px", textAlign: "center", opacity: 0.5 }}>
      <span className="aid-spinner" style={{ marginBottom: "16px" }} />
      <div>Loading community cohort health...</div>
    </div>
  );
}

function ErrorPanel({ message, onRefresh }: { message: string; onRefresh: () => void }) {
  return (
    <section className="premium-table-wrapper" style={{ textAlign: "center", padding: "40px" }} role="alert">
      <p style={{ color: "var(--r-error)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase" }}>
        Cohort Report Unavailable
      </p>
      <h2 style={{ fontSize: "20px", marginTop: "8px" }}>Could not load community cohort health</h2>
      <p style={{ opacity: 0.6, fontSize: "13px", margin: "8px 0 20px" }}>{message}</p>
      <button type="button" className="wallet-connect-btn" onClick={onRefresh}>
        Retry
      </button>
    </section>
  );
}

function ForbiddenPanel() {
  return (
    <section className="premium-table-wrapper" style={{ textAlign: "center", padding: "40px" }}>
      <p style={{ color: "var(--r-primary-soft)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase" }}>
        Admin Access
      </p>
      <h2 style={{ fontSize: "20px", marginTop: "8px" }}>Community cohort operations are restricted</h2>
      <p className="analytics-muted" style={{ marginTop: "8px" }}>
        Connect with an admin account to run generation and inspect aggregate cohort quality.
      </p>
    </section>
  );
}

function recordRows(record: Record<string, number>) {
  return Object.entries(record)
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => ({ key, count }));
}

function labelize(value: string) {
  return value
    .replace(/^community\.cohort_/, "")
    .replace(/[_:.]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayReason(reasonCode: string, cohortType: string) {
  const withoutType = reasonCode.startsWith(`${cohortType}:`)
    ? reasonCode.slice(cohortType.length + 1)
    : reasonCode;
  return labelize(withoutType);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
