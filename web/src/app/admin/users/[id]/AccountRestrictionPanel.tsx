"use client";

import type { AccountStatusReason, AdminAccountStatus } from "../../../../lib/api";
import { ACCOUNT_REASON_LABELS } from "../../../../lib/accountStatus";
import { formatRestrictionDate } from "../../../../lib/accountRestriction";

export const ACCOUNT_NOTE_MAX = 1000;

export const REASON_OPTIONS: ReadonlyArray<{ value: AccountStatusReason; label: string }> = [
  { value: "terms_violation", label: "Terms violation" },
  { value: "fraud", label: "Fraud" },
  { value: "abuse", label: "Abuse" },
  { value: "rights_infringement", label: "Rights infringement" },
  { value: "other", label: "Other" },
];

export type RestrictionAction = "suspend" | "unsuspend" | "close";

export type RestrictionDraft = {
  reason: AccountStatusReason;
  /** `YYYY-MM-DD` from a date input, or "" for an indefinite suspension. */
  until: string;
  note: string;
  scheduleErasure: boolean;
};

export const EMPTY_RESTRICTION_DRAFT: RestrictionDraft = {
  reason: "terms_violation",
  until: "",
  note: "",
  scheduleErasure: false,
};

export type RestrictionDraftErrors = Partial<Record<"until" | "note", string>>;

/** Mirrors the server's limits; the server re-checks them. */
export function validateRestrictionDraft(
  action: RestrictionAction,
  draft: RestrictionDraft,
  now: Date = new Date(),
): RestrictionDraftErrors {
  const errors: RestrictionDraftErrors = {};
  if (draft.note.length > ACCOUNT_NOTE_MAX) errors.note = `Keep the note to ${ACCOUNT_NOTE_MAX} characters.`;
  if (action === "suspend" && draft.until) {
    const end = new Date(`${draft.until}T23:59:59Z`);
    if (Number.isNaN(end.getTime())) errors.until = "Use a valid date.";
    else if (end.getTime() <= now.getTime()) errors.until = "Pick an end date in the future, or leave it empty.";
  }
  return errors;
}

/** The request body for suspend / close. */
export function toRestrictionInput(action: RestrictionAction, draft: RestrictionDraft) {
  const note = draft.note.trim();
  if (action === "unsuspend") return { ...(note ? { note } : {}) };
  if (action === "suspend") {
    return {
      reason: draft.reason,
      ...(draft.until ? { until: new Date(`${draft.until}T23:59:59Z`).toISOString() } : {}),
      ...(note ? { note } : {}),
    };
  }
  return {
    reason: draft.reason,
    ...(note ? { note } : {}),
    ...(draft.scheduleErasure ? { scheduleErasure: true } : {}),
  };
}

export function getRestrictionConfirmCopy(action: RestrictionAction, account: AdminAccountStatus, draft: RestrictionDraft) {
  const who = account.walletAddress ?? account.userId;
  const reason = ACCOUNT_REASON_LABELS[draft.reason];
  if (action === "suspend") {
    const end = draft.until ? `until ${draft.until}` : "with no end date";
    return {
      title: "Suspend this account?",
      message:
        `${who} will be unable to upload, list, buy, pledge or post (${reason}), ${end}. They keep sign-in, refunds, ` +
        "notices and data export, and are told why in a notice. The note stays in the audit record only.",
      confirmLabel: "Suspend account",
      variant: "warning" as const,
    };
  }
  if (action === "unsuspend") {
    return {
      title: "Lift this suspension?",
      message: `${who} regains full access at once and is told in a notice.`,
      confirmLabel: "Lift suspension",
      variant: "default" as const,
    };
  }
  return {
    title: "Close this account?",
    message:
      `${who} will be permanently blocked from making changes (${reason}) and told in a notice. Closing cannot be undone from this page.` +
      (draft.scheduleErasure
        ? " Their personal data is scheduled for erasure after the normal 30-day grace period, and they cannot cancel it."
        : " Their data is kept; no erasure is scheduled."),
    confirmLabel: "Close account",
    variant: "danger" as const,
  };
}

function describeCurrent(account: AdminAccountStatus) {
  const reason = account.reason ? ACCOUNT_REASON_LABELS[account.reason] : null;
  if (account.effectiveStatus === "active") {
    return account.status === "suspended" ? "Active (the suspension has expired)" : "Active";
  }
  const end = formatRestrictionDate(account.until);
  const parts = [account.effectiveStatus === "closed" ? "Closed" : end ? `Suspended until ${end}` : "Suspended"];
  if (reason) parts.push(reason);
  return parts.join(" - ");
}

/** The state of one account and the controls to change it. */
export default function AccountRestrictionPanel({
  account,
  draft,
  errors,
  busy,
  onChange,
  onRequest,
}: {
  account: AdminAccountStatus;
  draft: RestrictionDraft;
  errors: RestrictionDraftErrors;
  busy: boolean;
  onChange: (patch: Partial<RestrictionDraft>) => void;
  onRequest: (action: RestrictionAction) => void;
}) {
  const state = account.effectiveStatus;
  const canSuspend = state !== "closed";
  const canUnsuspend = account.status === "suspended";
  const canClose = state !== "closed";
  const changedAt = formatRestrictionDate(account.changedAt);
  const erasure = formatRestrictionDate(account.erasureScheduledFor);
  return (
    <section className="ui-card" style={{ padding: "20px", display: "grid", gap: "14px" }} aria-labelledby="account-restriction-title">
      <div>
        <h2 id="account-restriction-title" style={{ margin: 0, fontSize: "1.1rem" }}>
          {account.walletAddress ?? account.userId}
        </h2>
        <p style={{ margin: "4px 0 0", fontSize: "0.85rem", opacity: 0.8 }}>
          <strong>{describeCurrent(account)}</strong>
          {changedAt ? ` · changed ${changedAt}` : ""}
          {erasure ? ` · erasure scheduled for ${erasure}` : ""}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: "0.75rem", opacity: 0.55 }}>User id: {account.userId}</p>
      </div>
      {state === "closed" ? (
        <p style={{ margin: 0, opacity: 0.7 }}>This account is closed. There is nothing more to change here.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <label style={fieldStyle}>
              <span>Reason category</span>
              <select value={draft.reason} onChange={(e) => onChange({ reason: e.target.value as AccountStatusReason })}>
                {REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label style={fieldStyle}>
              <span>Suspension ends (optional)</span>
              <input type="date" value={draft.until} onChange={(e) => onChange({ until: e.target.value })} />
              {errors.until ? <span role="alert" style={errorStyle}>{errors.until}</span> : null}
            </label>
          </div>
          <label style={fieldStyle}>
            <span>Internal note ({draft.note.length}/{ACCOUNT_NOTE_MAX}) - audit record only, never shown to the person</span>
            <textarea rows={3} value={draft.note} onChange={(e) => onChange({ note: e.target.value })} />
            {errors.note ? <span role="alert" style={errorStyle}>{errors.note}</span> : null}
          </label>
          <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "0.85rem" }}>
            <input
              type="checkbox"
              checked={draft.scheduleErasure}
              onChange={(e) => onChange({ scheduleErasure: e.target.checked })}
            />
            <span>When closing, also schedule erasure of their personal data (30-day grace period)</span>
          </label>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !canSuspend} onClick={() => onRequest("suspend")}>
              {canUnsuspend ? "Update suspension" : "Suspend"}
            </button>
            {canUnsuspend ? (
              <button type="button" className="ui-btn ui-btn-ghost" disabled={busy} onClick={() => onRequest("unsuspend")}>
                Lift suspension
              </button>
            ) : null}
            <button type="button" className="ui-btn ui-btn-ghost" disabled={busy || !canClose} onClick={() => onRequest("close")} style={{ color: "#f87171" }}>
              Close account
            </button>
          </div>
        </>
      )}
    </section>
  );
}

const fieldStyle: React.CSSProperties = { display: "grid", gap: "4px", fontSize: "0.85rem", minWidth: "200px" };
const errorStyle: React.CSSProperties = { color: "#f87171", fontSize: "0.75rem" };
