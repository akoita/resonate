import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { writeStructuredLog } from "../shared/structured_logging";

/**
 * Every action recorded in `AdminAuditEvent`. This is the one list: a new admin
 * action adds its name here, and the admin audit page and its filter pick it up
 * from {@link ADMIN_AUDIT_ACTIONS}.
 */
export const ADMIN_AUDIT_ACTIONS = [
  /** #2166: an operator opened a person's record. */
  "user.detail_viewed",
  /** #2147: account suspension, lift and closure. */
  "account.suspended",
  "account.unsuspended",
  "account.closed",
  /** #2259: an admin opened the raw agent events of a session. */
  "agent_session.events_viewed",
  /** #2173: a platform notice an operator sent (broadcast, or targeted at named people). */
  "notice.broadcast_sent",
  "notice.targeted_sent",
  /** #2173: a fresh passkey/wallet confirmation was accepted or refused. */
  "admin.step_up_verified",
  "admin.step_up_refused",
  /**
   * #2362: every other admin and operator surface. Written by `@AdminAudit(...)`
   * (see `admin_audit.interceptor.ts`) after the route succeeded. Mutations, plus
   * the reads that open a person's content (a review queue, a claimant's
   * contact details); aggregate operational status reads are not recorded.
   */
  "credits.granted",
  "credit_requests.viewed",
  "credit_request.granted",
  "credit_request.dismissed",
  /** #2406: an admin granted or revoked the `pro` plan (ids and codes; never the note). */
  "entitlement_grant.created",
  "entitlement_grant.revoked",
  "dmca.reports_viewed",
  "dmca.report_resolved",
  "trust.artist_verified",
  "curation.reports_viewed",
  "catalog_credit.identity_reviewed",
  "artist_claims.viewed",
  "artist_claim.reviewed",
  "management_recovery.queue_viewed",
  "management_recovery.reviewed",
  "show_authority.approved",
  "show_authority.rejected",
  "show_authority.revoked",
  "show_authority.expired",
  "show_campaign.chain_resynced",
  "show_campaign.onchain_discovered",
  "show_campaign.booking_confirmed",
  "show_campaign.fulfillment_confirmed",
  "show_reconciliation.acknowledged",
  "show_reconciliation.acknowledgement_removed",
  "show_dispute.opened",
  "show_dispute.resolved",
  "x402_refunds.viewed",
  "x402_refund.marked_refunded",
  "rights_reassessments.viewed",
  "rights_reassessment.created",
  "rights_reassessment.audit_sampled",
  "rights_reassessment.reviewed",
  "trusted_source_link_requests.viewed",
  "trusted_source_link.reviewed",
  "trusted_source_link.revoked",
  "release_rights_requests.viewed",
  "release_rights_request.viewed",
  "release_rights_request.reviewed",
  "indexer.reset",
  "indexer.tx_reindexed",
  "maintenance.stem_features_backfill_run",
  "maintenance.track_embeddings_backfill_run",
  "maintenance.retention_cleanup_run",
  "maintenance.erasures_run",
  "maintenance.analytics_warehouse_loaded",
  "maintenance.analytics_warehouse_backfilled",
  "maintenance.community_cohorts_generated",
  "maintenance.releases_wiped",
  "community_moderation.queue_viewed",
  "community_moderation.report_resolved",
  "wallet.provider_set",
  "wallet.refreshed",
  "wallet.paymaster_configured",
  "wallet.paymaster_reset",
  "wallet.session_key_issued",
  "wallet.guardians_set",
  "wallet.recovery_requested",
  "wallet.recovery_approved",
  "agents.run_invoked",
  "agents.orchestrated",
  "agents.evaluated",
  "agents.golden_eval_run",
  "agents.runtime_run",
  /**
   * #2380: an admin or operator took the broader branch of a route that people use
   * for their own data (reading any wallet, support access to a collection,
   * managing an artist's campaign). Written by `auditAdminBranch`
   * (`admin_branch_audit.ts`) only when the branch is taken for someone else's
   * data; the owner's own access writes nothing.
   */
  "wallet.support_viewed",
  "wallet.support_changed",
  "collection.support_viewed",
  "notifications.support_viewed",
  "seller_listings.support_viewed",
  "listing_intent.support_recorded",
  "rights_evidence.privileged_submitted",
  "release_rights_request.support_viewed",
  "rights_reassessment_history.support_viewed",
  "artist_analytics.support_viewed",
  "show_campaign.operator_accessed",
  "show_pledge.operator_acted",
  "community_campaign_update.operator_posted",
  "community_benefit_rule.operator_managed",
] as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

/** `denied` is a request that was refused (a step-up that did not verify). */
export const ADMIN_AUDIT_OUTCOMES = ["success", "denied"] as const;
export type AdminAuditOutcome = (typeof ADMIN_AUDIT_OUTCOMES)[number];

export interface AdminAuditInput {
  actorUserId: string;
  action: AdminAuditAction;
  targetUserId?: string | null;
  /** Defaults to `success`. */
  outcome?: AdminAuditOutcome;
  /** Never free-text operator notes or personal data; e.g. `{ reason: "fraud" }`. */
  detail?: Prisma.InputJsonValue;
}

/**
 * Durable record of operator access to and actions on a person's account.
 *
 * Append-only by construction: this is the only writer and it only inserts.
 *
 * `required: true` lets the failure reach the caller (used by the detail view,
 * which must not show a record it could not log). Otherwise a failed write is
 * logged at `error` and swallowed, because the action it records has already
 * happened and the platform's regular audit log still has it.
 */
export async function writeAdminAuditEvent(
  input: AdminAuditInput,
  options: { required?: boolean } = {},
): Promise<void> {
  try {
    await prisma.adminAuditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: input.action,
        targetUserId: input.targetUserId ?? null,
        outcome: input.outcome ?? "success",
        ...(input.detail !== undefined ? { detail: input.detail } : {}),
      },
    });
  } catch (error) {
    if (options.required) throw error;
    writeStructuredLog({
      level: "error",
      event: "accounts.admin_audit.write_failed",
      message: "Could not write an admin audit event",
      action: input.action,
      error,
    });
  }
}
