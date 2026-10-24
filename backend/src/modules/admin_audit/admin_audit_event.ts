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
