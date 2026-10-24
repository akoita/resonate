import { AdminAuditAction, writeAdminAuditEvent } from "./admin_audit_event";
import { AdminAuditDetailValue, toAuditDetail } from "./admin_audit.interceptor";

/** The two roles whose broader branches inside user-facing routes are recorded (#2380). */
export function isAdminOrOperatorRole(role: unknown): boolean {
  return role === "admin" || role === "operator";
}

/**
 * Records that an admin or operator took the broader branch of a route people
 * use for their own data: reading any wallet, supporting a collection, managing
 * an artist's campaign (#2380). Admin-only routes are recorded by `@AdminAudit`
 * instead (#2362); this is for the branches inside shared routes.
 *
 * Call it only where the branch is the one that let the caller in. The rule is
 * enforced here as well: a caller who is not an admin or operator, and a caller
 * whose target is themselves (an admin reading their own wallet), write nothing.
 *
 * Detail carries identifiers, codes and counts only (read them through
 * `auditRef` / `auditCode` / `auditNumber`), never a note or any free text. Like
 * every `writeAdminAuditEvent` call without `required`, a failed write is logged
 * and swallowed: the support read is not blocked by the log being down.
 */
export async function auditAdminBranch(
  actor: { userId?: unknown; role?: unknown } | null | undefined,
  action: AdminAuditAction,
  input: { targetUserId?: string | null; detail?: Record<string, AdminAuditDetailValue> } = {},
): Promise<void> {
  if (!actor || !isAdminOrOperatorRole(actor.role)) return;
  const actorUserId = typeof actor.userId === "string" ? actor.userId : "";
  if (!actorUserId) return;
  const targetUserId = input.targetUserId ?? null;
  if (targetUserId && targetUserId.toLowerCase() === actorUserId.toLowerCase()) return;
  await writeAdminAuditEvent({
    actorUserId,
    action,
    targetUserId,
    detail: toAuditDetail(input.detail),
  });
}
