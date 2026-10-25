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
  { value: "credits.granted", label: "Granted credits" },
  { value: "credit_requests.viewed", label: "Opened the credit requests" },
  { value: "credit_request.granted", label: "Granted a credit request" },
  { value: "credit_request.dismissed", label: "Dismissed a credit request" },
  { value: "entitlement_grant.created", label: "Granted Pro" },
  { value: "entitlement_grant.revoked", label: "Revoked a Pro grant" },
  { value: "dmca.reports_viewed", label: "Opened the takedown reports" },
  { value: "dmca.report_resolved", label: "Resolved a takedown report" },
  { value: "trust.artist_verified", label: "Verified an artist" },
  { value: "curation.reports_viewed", label: "Opened the curator reports" },
  { value: "catalog_credit.identity_reviewed", label: "Reviewed a credit's identity" },
  { value: "artist_claims.viewed", label: "Opened the artist claims" },
  { value: "artist_claim.reviewed", label: "Decided an artist claim" },
  { value: "management_recovery.queue_viewed", label: "Opened the management recovery requests" },
  { value: "management_recovery.reviewed", label: "Decided a management recovery" },
  { value: "show_authority.approved", label: "Approved a show's authority" },
  { value: "show_authority.rejected", label: "Rejected a show's authority" },
  { value: "show_authority.revoked", label: "Revoked a show's authority" },
  { value: "show_authority.expired", label: "Expired a show's authority" },
  { value: "show_campaign.chain_resynced", label: "Re-synced a show from the chain" },
  { value: "show_campaign.onchain_discovered", label: "Looked up a show on the chain" },
  { value: "show_campaign.booking_confirmed", label: "Confirmed a show booking" },
  { value: "show_campaign.fulfillment_confirmed", label: "Confirmed a show was delivered" },
  { value: "show_reconciliation.acknowledged", label: "Acknowledged a reconciliation mismatch" },
  { value: "show_reconciliation.acknowledgement_removed", label: "Removed a mismatch acknowledgement" },
  { value: "show_dispute.opened", label: "Opened a show dispute" },
  { value: "show_dispute.resolved", label: "Resolved a show dispute" },
  { value: "x402_refunds.viewed", label: "Opened the refunds due" },
  { value: "x402_refund.marked_refunded", label: "Marked a payment refunded" },
  { value: "rights_reassessments.viewed", label: "Opened the rights reassessments" },
  { value: "rights_reassessment.created", label: "Started a rights reassessment" },
  { value: "rights_reassessment.audit_sampled", label: "Sampled releases for a rights audit" },
  { value: "rights_reassessment.reviewed", label: "Decided a rights reassessment" },
  { value: "trusted_source_link_requests.viewed", label: "Opened the trusted-source requests" },
  { value: "trusted_source_link.reviewed", label: "Decided a trusted-source request" },
  { value: "trusted_source_link.revoked", label: "Revoked a trusted-source link" },
  { value: "release_rights_requests.viewed", label: "Opened the release rights requests" },
  { value: "release_rights_request.viewed", label: "Opened a release rights request" },
  { value: "release_rights_request.reviewed", label: "Decided a release rights request" },
  { value: "indexer.reset", label: "Reset the chain indexer" },
  { value: "indexer.tx_reindexed", label: "Re-indexed a transaction" },
  { value: "maintenance.stem_features_backfill_run", label: "Ran the stem features backfill" },
  { value: "maintenance.track_embeddings_backfill_run", label: "Ran the track embeddings backfill" },
  { value: "maintenance.retention_cleanup_run", label: "Ran the retention cleanup" },
  { value: "maintenance.erasures_run", label: "Ran the due account erasures" },
  { value: "maintenance.analytics_warehouse_loaded", label: "Loaded the analytics warehouse" },
  { value: "maintenance.analytics_warehouse_backfilled", label: "Backfilled the analytics warehouse" },
  { value: "maintenance.community_cohorts_generated", label: "Generated community cohorts" },
  { value: "maintenance.releases_wiped", label: "Wiped the releases" },
  { value: "community_moderation.queue_viewed", label: "Opened the community moderation queue" },
  { value: "community_moderation.report_resolved", label: "Resolved a community moderation report" },
  { value: "wallet.provider_set", label: "Changed a wallet provider" },
  { value: "wallet.refreshed", label: "Refreshed a wallet" },
  { value: "wallet.paymaster_configured", label: "Configured the paymaster" },
  { value: "wallet.paymaster_reset", label: "Reset a paymaster" },
  { value: "wallet.session_key_issued", label: "Issued a session key" },
  { value: "wallet.guardians_set", label: "Set wallet guardians" },
  { value: "wallet.recovery_requested", label: "Requested a wallet recovery" },
  { value: "wallet.recovery_approved", label: "Approved a wallet recovery" },
  { value: "agents.run_invoked", label: "Ran an agent" },
  { value: "agents.orchestrated", label: "Ran the agent orchestrator" },
  { value: "agents.evaluated", label: "Ran an agent evaluation" },
  { value: "agents.golden_eval_run", label: "Ran the golden agent evaluation" },
  { value: "agents.runtime_run", label: "Ran an agent on the runtime" },
  // #2380: the broader branch an admin or operator took inside a route people use for their own data.
  { value: "wallet.support_viewed", label: "Read someone's wallet" },
  { value: "wallet.support_changed", label: "Changed someone's wallet" },
  { value: "collection.support_viewed", label: "Opened someone's collection" },
  { value: "notifications.support_viewed", label: "Read someone's notifications" },
  { value: "seller_listings.support_viewed", label: "Opened a seller's listing inventory" },
  { value: "listing_intent.support_recorded", label: "Recorded a listing for a seller" },
  { value: "rights_evidence.privileged_submitted", label: "Submitted rights evidence as the platform" },
  { value: "release_rights_request.support_viewed", label: "Opened an artist's release rights review" },
  { value: "rights_reassessment_history.support_viewed", label: "Opened a release's route history" },
  { value: "artist_analytics.support_viewed", label: "Opened an artist's analytics" },
  { value: "show_campaign.operator_accessed", label: "Managed an artist's show campaign" },
  { value: "show_pledge.operator_acted", label: "Acted on a backer's pledge" },
  { value: "community_campaign_update.operator_posted", label: "Posted a show campaign update" },
  { value: "community_benefit_rule.operator_managed", label: "Managed an artist's community benefits" },
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
  // #2362: codes and amounts the other admin actions record.
  for (const key of ["decision", "action", "outcome", "status", "provider", "via", "change", "evidenceRole"]) {
    const value = text(key);
    if (value) parts.push(value.replace(/_/g, " "));
  }
  const cents = count("amountCents");
  if (cents !== null) parts.push(`$${(cents / 100).toFixed(2)}`);
  const sessionId = text("sessionId");
  if (sessionId) parts.push(`session ${sessionId}`);
  const noticeId = text("noticeId");
  if (noticeId) parts.push(`notice ${noticeId.slice(0, 8)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
