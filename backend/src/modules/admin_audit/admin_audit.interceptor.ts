import { CallHandler, ExecutionContext, NestInterceptor, UseInterceptors } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Observable } from "rxjs";
import { mergeMap } from "rxjs/operators";
import { writeStructuredLog } from "../shared/structured_logging";
import { AdminAuditAction, writeAdminAuditEvent } from "./admin_audit_event";

/** What a describer reads: the verified caller and the request, plus what the handler returned. */
export interface AdminAuditContext {
  user: { userId: string; role?: string };
  params: Record<string, string | undefined>;
  query: Record<string, unknown>;
  body: unknown;
  result: unknown;
}

/** Detail values are scalars only: a describer cannot attach an object or a blob. */
export type AdminAuditDetailValue = string | number | boolean | null | undefined;

export interface AdminAuditDescription {
  /** The account the action concerns, when it is about one person. */
  targetUserId?: string | null;
  /** Identifiers, codes and counts. Never an operator note, a message or any free text. */
  detail?: Record<string, AdminAuditDetailValue>;
}

/**
 * Names what to record for one request. Return `null` to record nothing (an
 * action that turned out to need no record). Runs after the handler succeeded.
 */
export type AdminAuditDescriber = (context: AdminAuditContext) => AdminAuditDescription | null | void;

const MAX_DETAIL_STRING = 200;
const IDENTIFIER = /^[A-Za-z0-9_.:@\-]{1,200}$/;

/** An identifier (uuid, cuid, address, hash) or `undefined`. A value of any other shape is dropped. */
export function auditRef(value: unknown): string | undefined {
  return typeof value === "string" && IDENTIFIER.test(value) ? value : undefined;
}

/** One of a known set of codes, or `undefined`. Free text can never get through. */
export function auditCode<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** A finite number, or `undefined`. */
export function auditNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && /^-?\d{1,18}(\.\d+)?$/.test(value)) return Number(value);
  return undefined;
}

export function auditBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** The length of an array, or `undefined`. For "N recipients" style detail. */
export function auditCount(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

/** `body` as a plain record, or `{}`. Describers read named keys only. */
export function auditBody(context: AdminAuditContext): Record<string, unknown> {
  return context.body !== null && typeof context.body === "object" && !Array.isArray(context.body)
    ? (context.body as Record<string, unknown>)
    : {};
}

/** `result` as a plain record, or `{}`. */
export function auditResult(context: AdminAuditContext): Record<string, unknown> {
  return context.result !== null && typeof context.result === "object" && !Array.isArray(context.result)
    ? (context.result as Record<string, unknown>)
    : {};
}

/** Scalars only, no `undefined`, strings capped: the last line of defence against free text. */
export function toAuditDetail(detail: Record<string, AdminAuditDetailValue> | undefined): Prisma.InputJsonObject | undefined {
  if (!detail) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined) continue;
    out[key] = typeof value === "string" ? value.slice(0, MAX_DETAIL_STRING) : value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Writes one `AdminAuditEvent` after an admin route succeeded (#2362).
 *
 * Guards have already run, so a request the role guard or step-up guard refused
 * is never recorded as an action; a handler that throws (a 4xx, a failed call) is
 * not recorded either, because nothing was done. The write is awaited before the
 * response is sent, so a caller that got an answer can find the row. A failed
 * write is logged and swallowed like every `writeAdminAuditEvent` call: the action
 * has already happened.
 */
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly action: AdminAuditAction,
    private readonly describe?: AdminAuditDescriber,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const request = context.switchToHttp().getRequest();
    return next.handle().pipe(
      mergeMap(async (result) => {
        await this.record(request, result);
        return result;
      }),
    );
  }

  private async record(request: any, result: unknown): Promise<void> {
    const actorUserId: unknown = request?.user?.userId;
    if (typeof actorUserId !== "string" || !actorUserId) return;

    let description: AdminAuditDescription | null | void = {};
    try {
      description = this.describe?.({
        user: { userId: actorUserId, role: request.user.role },
        params: request.params ?? {},
        query: request.query ?? {},
        body: request.body,
        result,
      }) ?? {};
    } catch (error) {
      // A describer bug must not lose the record of the action: write it without detail.
      writeStructuredLog({
        level: "error",
        event: "admin_audit.describe_failed",
        message: "Could not describe an admin action for the audit log",
        action: this.action,
        error,
      });
      description = {};
    }
    if (description === null) return;

    await writeAdminAuditEvent({
      actorUserId,
      action: this.action,
      targetUserId: description.targetUserId ?? null,
      detail: toAuditDetail(description.detail),
    });
  }
}

/**
 * Records an admin route in the one audit log (#2362). Put it on the handler:
 *
 *     @AdminAudit("dmca.report_resolved", (c) => ({ detail: { reportId: auditRef(c.params.id) } }))
 *
 * The describer reads identifiers, codes and counts from the request and the
 * result. Every field it names goes through `auditRef` / `auditCode` /
 * `auditNumber`, so a caller-supplied string of any other shape is dropped.
 */
export const AdminAudit = (action: AdminAuditAction, describe?: AdminAuditDescriber) =>
  UseInterceptors(new AdminAuditInterceptor(action, describe));
