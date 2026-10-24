import type { AdminAuditAction, AdminAuditEvent, AdminAuditOutcome } from "./api";
import { reasonLabel } from "./adminUsers";

/** #2173: labels and helpers for the admin audit log page. */

export const ADMIN_AUDIT_PAGE_SIZE = 50;

export const ADMIN_AUDIT_ACTION_OPTIONS: ReadonlyArray<{ value: AdminAuditAction; label: string }> = [
  { value: "user.detail_viewed", label: "Opened a person's record" },
  { value: "account.suspended", label: "Suspended an account" },
  { value: "account.unsuspended", label: "Lifted a suspension" },
  { value: "account.closed", label: "Closed an account" },
  { value: "agent_session.events_viewed", label: "Opened a session's agent events" },
  { value: "notice.broadcast_sent", label: "Sent a broadcast notice" },
  { value: "notice.targeted_sent", label: "Sent a notice to named people" },
  { value: "admin.step_up_verified", label: "Confirmed with a passkey" },
  { value: "admin.step_up_refused", label: "Passkey confirmation refused" },
];

export const ADMIN_AUDIT_OUTCOME_OPTIONS: ReadonlyArray<{ value: AdminAuditOutcome; label: string }> = [
  { value: "success", label: "Done" },
  { value: "denied", label: "Refused" },
];

const ACTION_VALUES = ADMIN_AUDIT_ACTION_OPTIONS.map((option) => option.value) as string[];

export function isAdminAuditAction(value: string): value is AdminAuditAction {
  return ACTION_VALUES.includes(value);
}

/** A plain label for an action; unknown actions are shown as recorded. */
export function adminAuditActionLabel(action: string): string {
  return ADMIN_AUDIT_ACTION_OPTIONS.find((option) => option.value === action)?.label ?? action;
}

export function adminAuditOutcomeLabel(outcome: string): string {
  return ADMIN_AUDIT_OUTCOME_OPTIONS.find((option) => option.value === outcome)?.label ?? outcome;
}

const REFUSAL_REASONS: Record<string, string> = {
  signature_mismatch: "the signature did not match",
  challenge_invalid: "the request was invalid or had expired",
  challenge_spent: "the request had already been used",
  wrong_account: "the address was not this account's",
  address_mismatch: "the address was not the one requested",
};

/**
 * A short, safe summary of an event's detail: identifiers, categories and
 * counts only. The server never stores free text there, and this only reads
 * the few keys it knows.
 */
export function adminAuditDetailSummary(event: Pick<AdminAuditEvent, "action" | "detail">): string | null {
  const detail = event.detail && typeof event.detail === "object" ? (event.detail as Record<string, unknown>) : {};
  const parts: string[] = [];
  const text = (key: string) => (typeof detail[key] === "string" ? (detail[key] as string) : null);
  const count = (key: string) => (typeof detail[key] === "number" ? (detail[key] as number) : null);

  const reason = text("reason");
  if (reason) {
    parts.push(event.action === "admin.step_up_refused" ? (REFUSAL_REASONS[reason] ?? reason) : (reasonLabel(reason) ?? reason));
  }
  const category = text("category");
  if (category) parts.push(category);
  const audience = text("audience");
  if (audience) parts.push(`to ${audience}`);
  const recipients = count("recipientCount");
  if (recipients !== null) parts.push(`${recipients} ${recipients === 1 ? "person" : "people"}`);
  const events = count("eventCount");
  if (events !== null) parts.push(`${events} ${events === 1 ? "event" : "events"}`);
  const sessionId = text("sessionId");
  if (sessionId) parts.push(`session ${sessionId}`);
  const noticeId = text("noticeId");
  if (noticeId) parts.push(`notice ${noticeId.slice(0, 8)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
