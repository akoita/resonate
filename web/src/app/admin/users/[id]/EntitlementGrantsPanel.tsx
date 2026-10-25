"use client";

import type { EntitlementGrant, EntitlementGrantSource } from "../../../../lib/api";

/** Mirrors the server's limit; the server re-checks it. */
export const GRANT_NOTE_MAX = 500;

export const GRANT_SOURCE_OPTIONS: ReadonlyArray<{ value: EntitlementGrantSource; label: string }> = [
  { value: "operator_grant", label: "Operator grant (founder, partner, support)" },
  { value: "promo", label: "Promotion" },
];

export type GrantDraft = {
  /** `YYYY-MM-DD` from a date input: Pro lasts until the end of that day (UTC). */
  until: string;
  source: EntitlementGrantSource;
  note: string;
};

export const EMPTY_GRANT_DRAFT: GrantDraft = { until: "", source: "operator_grant", note: "" };

export type GrantDraftErrors = Partial<Record<"until" | "note", string>>;

export type GrantsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; grants: EntitlementGrant[] };

export type GrantAction = { kind: "grant" } | { kind: "revoke"; grant: EntitlementGrant };

/** Grants run to the end of a UTC day, so they are shown as UTC days too. */
export function formatGrantDay(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function endOfDay(day: string): Date {
  return new Date(`${day}T23:59:59Z`);
}

export function validateGrantDraft(draft: GrantDraft, now: Date = new Date()): GrantDraftErrors {
  const errors: GrantDraftErrors = {};
  if (!draft.until) errors.until = "Pick the last day of Pro.";
  else {
    const end = endOfDay(draft.until);
    if (Number.isNaN(end.getTime())) errors.until = "Use a valid date.";
    else if (end.getTime() <= now.getTime()) errors.until = "Pick a day in the future.";
  }
  const note = draft.note.trim();
  if (!note) errors.note = "Say why, for the record (for example: founding artist).";
  else if (note.length > GRANT_NOTE_MAX) errors.note = `Keep the note to ${GRANT_NOTE_MAX} characters.`;
  return errors;
}

/** The request body for `POST /admin/entitlements/grants`. */
export function toGrantInput(userId: string, draft: GrantDraft) {
  return {
    userId,
    source: draft.source,
    validUntil: endOfDay(draft.until).toISOString(),
    reason: draft.note.trim(),
  };
}

const STATUS_LABELS: Record<EntitlementGrant["status"], string> = {
  active: "Active",
  scheduled: "Starts later",
  expired: "Expired",
  revoked: "Revoked",
};

export function canRevoke(grant: EntitlementGrant): boolean {
  return grant.status === "active" || grant.status === "scheduled";
}

export function describeGrant(grant: EntitlementGrant): string {
  const source = grant.source === "promo" ? "Promotion" : "Operator grant";
  const end = grant.validUntil ? `until ${formatGrantDay(grant.validUntil)}` : "no end date";
  const revoked = grant.revokedAt ? ` · revoked ${formatGrantDay(grant.revokedAt)}` : "";
  return `${STATUS_LABELS[grant.status]} · ${source} · from ${formatGrantDay(grant.validFrom)}, ${end}${revoked}`;
}

export function getGrantConfirmCopy(action: GrantAction, who: string, draft: GrantDraft) {
  if (action.kind === "grant") {
    return {
      title: "Grant Pro?",
      message:
        `${who} gets the Pro plan until the end of ${draft.until} (UTC). Pro tools are free for everyone today, ` +
        "so this changes what their plan says, not what they can do. The note stays on the grant (the person sees it if they download their data), never in the audit log.",
      confirmLabel: "Grant Pro",
      variant: "default" as const,
    };
  }
  return {
    title: "Revoke this Pro grant?",
    message: `${who}'s plan goes back to Free at once. The grant stays in the list, marked revoked. Nothing they made is removed.`,
    confirmLabel: "Revoke grant",
    variant: "warning" as const,
  };
}

/** A person's Pro grants and the form to grant or revoke one (admins only). */
export default function EntitlementGrantsPanel({
  state,
  draft,
  errors,
  busy,
  onChange,
  onRequest,
  onRetry,
}: {
  state: GrantsState;
  draft: GrantDraft;
  errors: GrantDraftErrors;
  busy: boolean;
  onChange: (patch: Partial<GrantDraft>) => void;
  onRequest: (action: GrantAction) => void;
  onRetry: () => void;
}) {
  return (
    <div className="ui-card" style={{ padding: "20px", display: "grid", gap: "14px" }}>
      {state.status === "loading" ? (
        <p className="admin-users-note" role="status">Loading Pro grants...</p>
      ) : state.status === "error" ? (
        <p className="admin-users-note" role="alert">
          {state.message}{" "}
          <button type="button" className="ui-btn ui-btn-ghost" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : state.grants.length === 0 ? (
        <p className="admin-users-note">No Pro grants. Their plan is Free.</p>
      ) : (
        <ul className="admin-users-list">
          {state.grants.map((grant) => (
            <li key={grant.id}>
              <span>{describeGrant(grant)}</span>
              {grant.reason ? <span className="admin-users-list__meta">Note: {grant.reason}</span> : null}
              {canRevoke(grant) ? (
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost"
                  disabled={busy}
                  onClick={() => onRequest({ kind: "revoke", grant })}
                >
                  Revoke
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        <label style={fieldStyle}>
          <span>Pro until (last day)</span>
          <input type="date" value={draft.until} onChange={(e) => onChange({ until: e.target.value })} />
          {errors.until ? <span role="alert" style={errorStyle}>{errors.until}</span> : null}
        </label>
        <label style={fieldStyle}>
          <span>Kind</span>
          <select value={draft.source} onChange={(e) => onChange({ source: e.target.value as EntitlementGrantSource })}>
            {GRANT_SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label style={fieldStyle}>
        <span>Why ({draft.note.trim().length}/{GRANT_NOTE_MAX}) - kept on the grant and in the person&apos;s data download, never in the audit log</span>
        <input type="text" value={draft.note} onChange={(e) => onChange({ note: e.target.value })} />
        {errors.note ? <span role="alert" style={errorStyle}>{errors.note}</span> : null}
      </label>
      <div>
        <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={() => onRequest({ kind: "grant" })}>
          Grant Pro
        </button>
      </div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = { display: "grid", gap: "4px", fontSize: "0.85rem", minWidth: "200px" };
const errorStyle: React.CSSProperties = { color: "#f87171", fontSize: "0.75rem" };
