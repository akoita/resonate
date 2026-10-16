import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { writeStructuredLog } from "../shared/structured_logging";

/** Actions recorded in `AdminAuditEvent` so far (#2166); #2173 extends the set. */
export type AdminAuditAction =
  | "user.detail_viewed"
  | "account.suspended"
  | "account.unsuspended"
  | "account.closed";

export interface AdminAuditInput {
  actorUserId: string;
  action: AdminAuditAction;
  targetUserId?: string | null;
  /** Never free-text operator notes or personal data; e.g. `{ reason: "fraud" }`. */
  detail?: Prisma.InputJsonValue;
}

/**
 * Durable record of operator access to and actions on a person's account.
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
