"use client";

import {
  ReviewQueueHeader,
  ReviewQueueLoading,
  ReviewQueuePage,
  ReviewQueueStatePanel,
} from "../../../components/admin/review-queue/ReviewQueue";
import { Button } from "../../../components/ui/Button";
import type { AdminAuditAction, AdminAuditEventsPage, AdminAuditOutcome } from "../../../lib/api";
import {
  ADMIN_AUDIT_ACTION_OPTIONS,
  ADMIN_AUDIT_OUTCOME_OPTIONS,
  adminAuditActionLabel,
  adminAuditDetailSummary,
  adminAuditOutcomeLabel,
} from "../../../lib/adminAudit";
import { formatDateTime, pageCount, pageRange, shortAddress } from "../../../lib/adminUsers";

export type AuditLogState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; page: AdminAuditEventsPage; refreshing?: boolean };

export type AuditLogFilters = {
  action?: AdminAuditAction;
  outcome?: AdminAuditOutcome;
  page: number;
};

export type AuditLogViewProps = {
  /** Admins only; the server enforces the same rule. */
  allowed: boolean;
  state: AuditLogState;
  filters: AuditLogFilters;
  onFiltersChange: (filters: AuditLogFilters) => void;
  onRetry: () => void;
};

function who(id: string | null): string {
  if (!id) return "-";
  return id.startsWith("system:") ? id : shortAddress(id);
}

function AuditTable({ page }: { page: AdminAuditEventsPage }) {
  return (
    <table className="admin-users-table">
      <caption className="visually-hidden">Admin audit log, newest first</caption>
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">Who</th>
          <th scope="col">What</th>
          <th scope="col">About</th>
          <th scope="col">Outcome</th>
          <th scope="col">Details</th>
        </tr>
      </thead>
      <tbody>
        {page.items.map((event) => (
          <tr key={event.id}>
            <td data-label="When">{formatDateTime(event.createdAt)}</td>
            <td data-label="Who" title={event.actorUserId}>{who(event.actorUserId)}</td>
            <td data-label="What">{adminAuditActionLabel(event.action)}</td>
            <td data-label="About" title={event.targetUserId ?? undefined}>{who(event.targetUserId)}</td>
            <td data-label="Outcome">
              <span className={`admin-users-chip admin-users-chip--${event.outcome === "success" ? "active" : "suspended"}`}>
                {adminAuditOutcomeLabel(event.outcome)}
              </span>
            </td>
            <td data-label="Details">{adminAuditDetailSummary(event) ?? <span className="admin-users-muted">None</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * #2173: the one admin audit log, newest first. Presentation only; the page
 * owns the data and the auth gate. It is read-only on purpose: nothing here
 * edits or removes an entry.
 */
export default function AuditLogView({ allowed, state, filters, onFiltersChange, onRetry }: AuditLogViewProps) {
  if (!allowed) {
    return (
      <ReviewQueuePage className="admin-users-page">
        <ReviewQueueStatePanel
          variant="forbidden"
          heading="Admins only"
          body="Your account does not have access to the admin audit log."
        />
      </ReviewQueuePage>
    );
  }

  const change = (patch: Partial<AuditLogFilters>) => onFiltersChange({ ...filters, ...patch, page: 1 });

  return (
    <ReviewQueuePage className="admin-users-page">
      <ReviewQueueHeader
        eyebrow="Operators"
        title="Admin audit log"
        description="Who opened a person's record, changed an account, sent a platform notice or confirmed with a passkey, newest first. Internal notes and message text are never part of it."
      />
      <section className="admin-users-filters" aria-label="Filter the audit log">
        <div className="admin-users-selects">
          <label className="admin-users-field">
            <span>What happened</span>
            <select
              aria-label="What happened"
              value={filters.action ?? ""}
              onChange={(event) => change({ action: (event.target.value || undefined) as AdminAuditAction | undefined })}
            >
              <option value="">Anything</option>
              {ADMIN_AUDIT_ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="admin-users-field">
            <span>Outcome</span>
            <select
              aria-label="Outcome"
              value={filters.outcome ?? ""}
              onChange={(event) => change({ outcome: (event.target.value || undefined) as AdminAuditOutcome | undefined })}
            >
              <option value="">Any outcome</option>
              {ADMIN_AUDIT_OUTCOME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="admin-users-note">
          The log is append-only and kept as audit history. People who were erased appear only by a replaced
          identifier.
        </p>
      </section>

      {state.status === "loading" ? <ReviewQueueLoading statusText="Loading the audit log..." /> : null}
      {state.status === "error" ? (
        <ReviewQueueStatePanel
          variant="error"
          heading="Could not load the audit log"
          body={state.message}
          actionLabel="Try again"
          onAction={onRetry}
        />
      ) : null}
      {state.status === "ready" && state.page.items.length === 0 ? (
        <ReviewQueueStatePanel
          variant="empty"
          heading="Nothing logged yet"
          body="No entries match these filters."
          actionLabel="Refresh"
          onAction={onRetry}
        />
      ) : null}
      {state.status === "ready" && state.page.items.length > 0 ? (
        <section aria-busy={state.refreshing ? true : undefined}>
          <AuditTable page={state.page} />
          <nav className="admin-users-pager" aria-label="Pagination">
            <span>
              Showing {pageRange(state.page.page, state.page.pageSize, state.page.items.length, state.page.total)} · Page{" "}
              {state.page.page} of {pageCount(state.page.total, state.page.pageSize)}
            </span>
            <span className="admin-users-pager__buttons">
              <Button variant="ghost" disabled={state.page.page <= 1} onClick={() => onFiltersChange({ ...filters, page: state.page.page - 1 })}>
                Previous
              </Button>
              <Button
                variant="ghost"
                disabled={state.page.page >= pageCount(state.page.total, state.page.pageSize)}
                onClick={() => onFiltersChange({ ...filters, page: state.page.page + 1 })}
              >
                Next
              </Button>
            </span>
          </nav>
        </section>
      ) : null}
    </ReviewQueuePage>
  );
}
