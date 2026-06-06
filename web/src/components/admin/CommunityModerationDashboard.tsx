"use client";

import { useState } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import type {
  CommunityModerationAction,
  CommunityModerationQueueResponse,
  CommunityModerationReport,
} from "../../lib/api";

type DashboardState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string; onRefresh: () => void }
  | {
      status: "ready";
      queue: CommunityModerationQueueResponse;
      resolvingReportId: string | null;
      onRefresh: () => void;
      onResolve: (reportId: string, action: CommunityModerationAction) => void;
    };

const ACTION_LABELS: Record<CommunityModerationAction, string> = {
  no_action: "Dismiss",
  delete_message: "Delete Message",
  remove_member: "Remove Member",
  ban_member: "Ban Member",
  pause_room: "Pause Room",
  archive_room: "Archive Room",
};

const ACTION_VARIANTS: Record<CommunityModerationAction, "danger" | "warning" | "default"> = {
  no_action: "default",
  delete_message: "danger",
  remove_member: "warning",
  ban_member: "danger",
  pause_room: "warning",
  archive_room: "danger",
};

export default function CommunityModerationDashboard(props: DashboardState) {
  const [pendingAction, setPendingAction] = useState<{
    reportId: string;
    action: CommunityModerationAction;
  } | null>(null);

  return (
    <main className="analytics-container cohort-operations-container">
      <header className="analytics-header-section">
        <div className="analytics-title-row">
          <div>
            <p className="artist-analytics-eyebrow" style={{ fontSize: "12px", opacity: 0.5, margin: "0 0 4px" }}>
              Community Operations
            </p>
            <h1 style={{ margin: 0 }}>Moderation Queue</h1>
            <p className="analytics-muted" style={{ margin: "8px 0 0", maxWidth: "760px" }}>
              Review reports, room status, and recent moderation context without wallet addresses, emails, or access-policy payloads.
            </p>
          </div>
          {props.status === "ready" ? (
            <button type="button" className="date-selector-pill" onClick={props.onRefresh}>
              Refresh
            </button>
          ) : null}
        </div>
      </header>

      {props.status === "loading" ? <LoadingPanel /> : null}
      {props.status === "forbidden" ? <ForbiddenPanel /> : null}
      {props.status === "error" ? <ErrorPanel message={props.message} onRefresh={props.onRefresh} /> : null}
      {props.status === "ready" ? (
        <ReadyPanel
          queue={props.queue}
          resolvingReportId={props.resolvingReportId}
          onRequestResolve={setPendingAction}
        />
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(pendingAction)}
        title={pendingAction ? ACTION_LABELS[pendingAction.action] : "Confirm"}
        message={pendingAction ? confirmMessage(pendingAction.action) : ""}
        confirmLabel={pendingAction ? ACTION_LABELS[pendingAction.action] : "Confirm"}
        variant={pendingAction ? ACTION_VARIANTS[pendingAction.action] : "default"}
        onCancel={() => setPendingAction(null)}
        onConfirm={async () => {
          if (!pendingAction || props.status !== "ready") return;
          props.onResolve(pendingAction.reportId, pendingAction.action);
          setPendingAction(null);
        }}
      />
    </main>
  );
}

function ReadyPanel({
  queue,
  resolvingReportId,
  onRequestResolve,
}: {
  queue: CommunityModerationQueueResponse;
  resolvingReportId: string | null;
  onRequestResolve: (action: { reportId: string; action: CommunityModerationAction }) => void;
}) {
  return (
    <>
      <div className="glass-metadata-bar">
        <div className="metadata-item">
          <span>Report:</span>
          <strong>{formatDateTime(queue.generatedAt)}</strong>
        </div>
        <div className="metadata-item">
          <span className={`metadata-dot ${queue.summary.openReports > 0 ? "pulsing" : "metadata-dot--muted"}`} aria-hidden="true" />
          <span>Open:</span>
          <strong>{formatNumber(queue.summary.openReports)}</strong>
        </div>
        <div className="metadata-item">
          <span>Privacy:</span>
          <strong>{queue.privacy.noWalletAddresses ? "Wallets redacted" : "Review response"}</strong>
        </div>
      </div>

      <section className="kpi-row" aria-label="Community moderation summary">
        <Kpi label="Returned" value={formatNumber(queue.summary.returnedReports)} detail={`${queue.filters.status} reports`} />
        <Kpi label="Paused Rooms" value={formatNumber(queue.summary.pausedRooms)} detail="Room status review" />
        <Kpi label="Archived Rooms" value={formatNumber(queue.summary.archivedRooms)} detail="Inactive community spaces" />
        <Kpi label="Context" value={queue.privacy.messageBodiesArePreviewed ? "Preview" : "Full"} detail="No emails or wallets" />
      </section>

      <section className="premium-table-wrapper">
        <div className="chart-card-header">
          <div>
            <h2>Reports</h2>
            <p className="analytics-muted" style={{ margin: "4px 0 0" }}>
              {queue.reports.length === 0 ? "No matching reports." : `${queue.reports.length} report${queue.reports.length === 1 ? "" : "s"} returned.`}
            </p>
          </div>
        </div>
        {queue.reports.length === 0 ? (
          <p className="analytics-muted">The moderation queue is clear.</p>
        ) : (
          <div className="analytics-quality-table" role="list" aria-label="Community reports">
            {queue.reports.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                actions={queue.actions}
                resolving={resolvingReportId === report.id}
                onRequestResolve={onRequestResolve}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function ReportRow({
  report,
  actions,
  resolving,
  onRequestResolve,
}: {
  report: CommunityModerationReport;
  actions: CommunityModerationAction[];
  resolving: boolean;
  onRequestResolve: (action: { reportId: string; action: CommunityModerationAction }) => void;
}) {
  return (
    <article className="moderation-report" role="listitem">
      <div className="moderation-report__grid">
        <div>
          <div className="glass-metadata-bar" style={{ margin: 0, marginBottom: "12px" }}>
            <div className="metadata-item">
              <span>{labelize(report.room.roomType)}</span>
              <strong>{labelize(report.room.status)}</strong>
            </div>
            <div className="metadata-item">
              <span>Reports:</span>
              <strong>{formatNumber(report.context.messageReportCount)}</strong>
            </div>
            <div className="metadata-item">
              <span>Created:</span>
              <strong>{formatDateTime(report.createdAt)}</strong>
            </div>
          </div>
          <h3 style={{ margin: "0 0 6px", fontSize: "16px" }}>{report.room.title}</h3>
          <p className="analytics-muted" style={{ margin: "0 0 10px" }}>
            {report.reason}
          </p>
          {report.message ? (
            <blockquote style={{ margin: 0, padding: "12px", borderLeft: "3px solid var(--r-primary-soft)", background: "rgba(255,255,255,0.04)" }}>
              <strong style={{ display: "block", marginBottom: "4px" }}>{labelize(report.message.messageType)} by {shortId(report.message.authorUserId)}</strong>
              <span>{report.message.bodyPreview ?? `Message ${report.message.status}`}</span>
            </blockquote>
          ) : (
            <p className="analytics-muted">Reported message is no longer available.</p>
          )}
          <ModerationAssistPanel report={report} />
        </div>

        <div>
          <div className="analytics-quality-table" role="table" style={{ marginBottom: "12px" }}>
            {Object.entries(report.context.roomMembershipsByStatus).map(([status, count]) => (
              <div key={status} className="analytics-quality-row" role="row" style={{ gridTemplateColumns: "1fr auto" }}>
                <span>{labelize(status)}</span>
                <strong>{formatNumber(count)}</strong>
              </div>
            ))}
          </div>
          {report.status === "open" ? (
            <div className="moderation-actions" aria-busy={resolving}>
              {actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  className={`moderation-action moderation-action--${ACTION_VARIANTS[action]}`}
                  disabled={resolving || !canApplyAction(report, action)}
                  onClick={() => onRequestResolve({ reportId: report.id, action })}
                >
                  {ACTION_LABELS[action] ?? labelize(action)}
                </button>
              ))}
              {resolving ? (
                <span className="moderation-actions__status" role="status">
                  Applying action…
                </span>
              ) : null}
            </div>
          ) : (
            <p className="analytics-muted">Resolved {report.resolvedAt ? formatDateTime(report.resolvedAt) : ""}</p>
          )}
        </div>
      </div>
    </article>
  );
}

const ASSIST_RISK_TONE: Record<string, string> = {
  high: "var(--r-error)",
  medium: "var(--r-warning)",
  low: "var(--r-success)",
};

function assistRiskTone(level: string) {
  return ASSIST_RISK_TONE[level] ?? "var(--r-text-muted)";
}

function ModerationAssistPanel({ report }: { report: CommunityModerationReport }) {
  if (!report.assist) return null;
  const assist = report.assist;

  return (
    <section
      aria-label="Advisory moderation assist"
      style={{
        marginTop: "12px",
        padding: "12px",
        border: "1px solid rgba(139, 92, 246, 0.35)",
        borderRadius: "var(--radius-md)",
        background: "rgba(139, 92, 246, 0.08)",
      }}
    >
      <div className="analytics-title-row" style={{ alignItems: "flex-start", gap: "12px" }}>
        <div>
          <p className="artist-analytics-eyebrow" style={{ margin: "0 0 4px", color: "var(--r-primary-soft)" }}>
            AI Assist
          </p>
          <p style={{ margin: 0, fontWeight: 700 }}>{assist.summary}</p>
        </div>
        <div className="glass-metadata-bar" style={{ margin: 0 }}>
          <div className="metadata-item">
            <span>Severity:</span>
            <strong style={{ color: assistRiskTone(assist.severity) }}>{labelize(assist.severity)}</strong>
          </div>
          <div className="metadata-item">
            <span>Likelihood:</span>
            <strong style={{ color: assistRiskTone(assist.likelihood) }}>{labelize(assist.likelihood)}</strong>
          </div>
        </div>
      </div>
      <ul style={{ margin: "10px 0 0", paddingLeft: "18px", color: "var(--r-text-muted)", fontSize: "13px" }}>
        {assist.reviewFocus.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="analytics-muted" style={{ margin: "10px 0 0", fontSize: "12px" }}>
        {assist.advisory.copy}
      </p>
    </section>
  );
}

function canApplyAction(report: CommunityModerationReport, action: CommunityModerationAction) {
  if (action === "remove_member" || action === "ban_member" || action === "delete_message") {
    return Boolean(report.message);
  }
  return true;
}

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="premium-kpi-card agent-context">
      <div className="kpi-header">
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value-mono">{value}</div>
      <div className="kpi-subtitle-trend">
        <span>{detail}</span>
      </div>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="analytics-skeleton" style={{ padding: "80px", textAlign: "center", opacity: 0.5 }}>
      <span className="aid-spinner" style={{ marginBottom: "16px" }} />
      <div>Loading community moderation reports...</div>
    </div>
  );
}

function ErrorPanel({ message, onRefresh }: { message: string; onRefresh: () => void }) {
  return (
    <section className="premium-table-wrapper" style={{ textAlign: "center", padding: "40px" }} role="alert">
      <p style={{ color: "var(--r-error)", fontSize: "12px", fontWeight: 600, textTransform: "uppercase" }}>
        Moderation Queue Unavailable
      </p>
      <h2 style={{ fontSize: "20px", marginTop: "8px" }}>Could not load community moderation reports</h2>
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
      <h2 style={{ fontSize: "20px", marginTop: "8px" }}>Community moderation is restricted</h2>
      <p className="analytics-muted" style={{ marginTop: "8px" }}>
        Connect with an admin account to review reports and room governance state.
      </p>
    </section>
  );
}

function confirmMessage(action: CommunityModerationAction) {
  if (action === "no_action") return "Dismiss this report without changing the room, member, or message.";
  if (action === "delete_message") return "Delete the reported message and mark this report resolved.";
  if (action === "remove_member") return "Remove the reported message author from this room.";
  if (action === "ban_member") return "Ban the reported message author from this room.";
  if (action === "pause_room") return "Pause this room and mark the report resolved.";
  return "Archive this room and mark the report resolved.";
}

function labelize(value: string) {
  return value
    .replace(/[_:.]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortId(value: string) {
  return value.length <= 12 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
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
