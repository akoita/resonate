import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { AnalyticsEvent, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  ANALYTICS_WAREHOUSE_GOVERNANCE,
  AnalyticsWarehouseGovernanceTarget,
  WarehouseErasureResult,
  analyticsWarehouseGovernanceFromEnv,
} from "./analytics_warehouse_governance";

type RetentionTier = "personal" | "sensitive" | "pseudonymous";

export interface AnalyticsRetentionPolicy {
  personalDays: number;
  sensitiveDays: number;
  pseudonymousDays: number;
}

export interface AnalyticsDeletionRequest {
  actorId?: string;
  subjectType?: string;
  subjectId?: string;
  reason: string;
}

export interface AnalyticsConsentWithdrawalRequest extends AnalyticsDeletionRequest {
  consentBasis: string;
}

const FINANCIAL_AUDIT_EVENT_FAMILIES = new Set(["commerce", "payment", "rights", "license"]);
const REDACTED_VALUE = "[redacted]";

@Injectable()
export class AnalyticsGovernanceService {
  private readonly logger = new Logger(AnalyticsGovernanceService.name);

  constructor(
    @Optional()
    @Inject(ANALYTICS_WAREHOUSE_GOVERNANCE)
    private readonly warehouseGovernance: AnalyticsWarehouseGovernanceTarget = analyticsWarehouseGovernanceFromEnv(),
  ) {}

  getRetentionPolicy(env: NodeJS.ProcessEnv = process.env): AnalyticsRetentionPolicy {
    return {
      personalDays: parsePositiveInt(env.ANALYTICS_RETENTION_PERSONAL_DAYS, 395),
      sensitiveDays: parsePositiveInt(env.ANALYTICS_RETENTION_SENSITIVE_DAYS, 90),
      pseudonymousDays: parsePositiveInt(env.ANALYTICS_RETENTION_PSEUDONYMOUS_DAYS, 730),
    };
  }

  async runRetentionCleanup(options?: { now?: Date; policy?: AnalyticsRetentionPolicy }) {
    const now = options?.now ?? new Date();
    const policy = options?.policy ?? this.getRetentionPolicy();
    const result = {
      status: "ok",
      deleted: 0,
      redacted: 0,
      lineageRecords: 0,
      policy,
      ranAt: now.toISOString(),
    };

    for (const tier of ["sensitive", "personal", "pseudonymous"] as RetentionTier[]) {
      const cutoff = new Date(now.getTime() - retentionDays(policy, tier) * 24 * 60 * 60 * 1000);
      const expired = await prisma.analyticsEvent.findMany({
        where: {
          privacyTier: tier,
          occurredAt: { lt: cutoff },
        },
      });

      for (const event of expired) {
        if (shouldPreserveForAudit(event.eventName)) {
          await this.redactEvent(event, "retention_redacted", `retention expired for ${tier} event`, {
            cutoff: cutoff.toISOString(),
            policy,
          });
          result.redacted += 1;
        } else {
          await this.deleteEvent(event, "retention_deleted", `retention expired for ${tier} event`, {
            cutoff: cutoff.toISOString(),
            policy,
          });
          result.deleted += 1;
        }
        result.lineageRecords += 1;
      }
    }

    return result;
  }

  async propagateDeletion(input: AnalyticsDeletionRequest) {
    if (!input.actorId && !(input.subjectType && input.subjectId)) {
      throw new Error("propagateDeletion requires actorId or subjectType+subjectId");
    }

    const events = await prisma.analyticsEvent.findMany({
      where: {
        OR: [
          ...(input.actorId ? [{ actorId: input.actorId }] : []),
          ...(input.subjectType && input.subjectId
            ? [{ subjectType: input.subjectType, subjectId: input.subjectId }]
            : []),
        ],
      },
    });

    return this.applyDeletionPolicy(events, "deletion_propagated", input.reason, {
      actorId: input.actorId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
    });
  }

  async withdrawConsent(input: AnalyticsConsentWithdrawalRequest) {
    const events = await prisma.analyticsEvent.findMany({
      where: {
        consentBasis: input.consentBasis,
        OR: [
          ...(input.actorId ? [{ actorId: input.actorId }] : []),
          ...(input.subjectType && input.subjectId
            ? [{ subjectType: input.subjectType, subjectId: input.subjectId }]
            : []),
        ],
      },
    });

    return this.applyDeletionPolicy(events, "consent_withdrawn", input.reason, {
      actorId: input.actorId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      consentBasis: input.consentBasis,
    });
  }

  private async applyDeletionPolicy(
    events: Awaited<ReturnType<typeof prisma.analyticsEvent.findMany>>,
    action: string,
    reason: string,
    details: Record<string, unknown>,
  ) {
    const { deleteEventIds, redactEventIds } = partitionEventsForErasure(events);
    const redacting = new Set(redactEventIds);
    const affectedDates = [...new Set(events.map((event) => event.occurredAt.toISOString().slice(0, 10)))];
    const result = {
      status: "ok",
      matched: events.length,
      deleted: 0,
      redacted: 0,
      lineageRecords: 0,
      ranAt: new Date().toISOString(),
    };

    for (const event of events) {
      if (redacting.has(event.eventId)) {
        await this.redactEvent(event, action, reason, details);
        result.redacted += 1;
      } else {
        await this.deleteEvent(event, action, reason, details);
        result.deleted += 1;
      }
      result.lineageRecords += 1;
    }

    // Postgres first, warehouse second: a warehouse load running in between
    // cannot reintroduce the erased rows, because the source rows are already
    // deleted or already redacted.
    const warehouse = await this.eraseFromWarehouse({
      deleteEventIds,
      redactEventIds,
      affectedDates,
      action,
      reason,
      details,
    });

    return { ...result, warehouse };
  }

  private async eraseFromWarehouse(input: {
    deleteEventIds: string[];
    redactEventIds: string[];
    affectedDates: string[];
    action: string;
    reason: string;
    details: Record<string, unknown>;
  }): Promise<WarehouseErasureResult> {
    let outcome: WarehouseErasureResult;
    try {
      outcome = await this.warehouseGovernance.applyErasure({
        deleteEventIds: input.deleteEventIds,
        redactEventIds: input.redactEventIds,
        // Re-read after the Postgres redaction so the warehouse rows are rebuilt
        // from the redacted record rather than from a second set of rules.
        redactedEnvelopes: await this.readRedactedEnvelopes(input.redactEventIds),
        affectedDates: input.affectedDates,
        reason: input.reason,
      });
    } catch (error) {
      // The Postgres erasure already succeeded; a warehouse failure must not discard it.
      const message = error instanceof Error ? error.message : String(error);
      outcome = {
        status: "failed",
        provider: describeWarehouseProvider(this.warehouseGovernance),
        deletedRows: 0,
        redactedRows: 0,
        statements: 0,
        error: message,
      };
      this.logger.error(`Analytics warehouse erasure failed for ${input.action}: ${message}`);
    }

    await prisma.analyticsGovernanceLog.create({
      data: {
        action: "warehouse_erasure",
        subjectType: optionalDetail(input.details, "subjectType"),
        subjectId: optionalDetail(input.details, "subjectId"),
        actorId: optionalDetail(input.details, "actorId"),
        reason: input.reason,
        details: {
          ...input.details,
          sourceAction: input.action,
          events: { deleted: input.deleteEventIds.length, redacted: input.redactEventIds.length },
          affectedDates: input.affectedDates,
          warehouse: outcome,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return outcome;
  }

  private async readRedactedEnvelopes(eventIds: string[]) {
    const envelopes: unknown[] = [];
    for (let index = 0; index < eventIds.length; index += 500) {
      const rows = await prisma.analyticsEvent.findMany({
        where: { eventId: { in: eventIds.slice(index, index + 500) } },
        select: { envelope: true },
      });
      envelopes.push(...rows.map((row) => row.envelope));
    }
    return envelopes;
  }

  private async deleteEvent(
    event: AnalyticsEvent,
    action: string,
    reason: string,
    details: Record<string, unknown>,
  ) {
    await prisma.$transaction([
      prisma.analyticsGovernanceLog.create({
        data: governanceLogData(event, action, reason, details),
      }),
      prisma.analyticsEvent.delete({ where: { eventId: event.eventId } }),
    ]);
  }

  private async redactEvent(
    event: AnalyticsEvent,
    action: string,
    reason: string,
    details: Record<string, unknown>,
  ) {
    const redactedPayload = redactPayload(event.payload);
    const sourceRefs = event.sourceRefs && typeof event.sourceRefs === "object" ? event.sourceRefs : undefined;
    const redactedEnvelope = {
      eventId: event.eventId,
      eventName: event.eventName,
      eventVersion: event.eventVersion,
      occurredAt: event.occurredAt.toISOString(),
      receivedAt: event.receivedAt.toISOString(),
      producer: event.producer,
      environment: event.environment,
      privacyTier: event.privacyTier,
      subjectType: event.subjectType ?? undefined,
      subjectId: event.subjectId ? REDACTED_VALUE : undefined,
      actorId: event.actorId ? REDACTED_VALUE : undefined,
      sessionId: event.sessionId ? REDACTED_VALUE : undefined,
      traceId: event.traceId ? REDACTED_VALUE : undefined,
      schemaUri: event.schemaUri ?? undefined,
      consentBasis: event.consentBasis ?? undefined,
      payload: redactedPayload,
      sourceRefs,
    };

    await prisma.$transaction([
      prisma.analyticsGovernanceLog.create({
        data: governanceLogData(event, action, reason, details),
      }),
      prisma.analyticsEvent.update({
        where: { eventId: event.eventId },
        data: {
          subjectId: event.subjectId ? REDACTED_VALUE : event.subjectId,
          actorId: event.actorId ? REDACTED_VALUE : event.actorId,
          sessionId: event.sessionId ? REDACTED_VALUE : event.sessionId,
          traceId: event.traceId ? REDACTED_VALUE : event.traceId,
          payload: redactedPayload as Prisma.InputJsonValue,
          envelope: redactedEnvelope as Prisma.InputJsonValue,
        },
      }),
    ]);
  }
}

export interface AnalyticsErasurePartition {
  deleteEventIds: string[];
  redactEventIds: string[];
}

/**
 * Splits erased events the same way the Postgres write path does: audit-preserved
 * families are redacted, everything else is deleted. Exported so the warehouse
 * mirror and this rule can be tested without a database.
 */
export function partitionEventsForErasure(
  events: Array<{ eventId: string; eventName: string }>,
): AnalyticsErasurePartition {
  const deleteEventIds: string[] = [];
  const redactEventIds: string[] = [];
  for (const event of events) {
    if (shouldPreserveForAudit(event.eventName)) {
      redactEventIds.push(event.eventId);
    } else {
      deleteEventIds.push(event.eventId);
    }
  }
  return { deleteEventIds, redactEventIds };
}

function describeWarehouseProvider(target: AnalyticsWarehouseGovernanceTarget) {
  try {
    return target.describe().provider;
  } catch {
    return "unknown";
  }
}

function optionalDetail(details: Record<string, unknown>, key: string) {
  const value = details[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function retentionDays(policy: AnalyticsRetentionPolicy, tier: RetentionTier) {
  switch (tier) {
    case "personal":
      return policy.personalDays;
    case "sensitive":
      return policy.sensitiveDays;
    case "pseudonymous":
      return policy.pseudonymousDays;
  }
}

function shouldPreserveForAudit(eventName: string) {
  return FINANCIAL_AUDIT_EVENT_FAMILIES.has(eventName.split(".")[0]);
}

function governanceLogData(
  event: AnalyticsEvent,
  action: string,
  reason: string,
  details: Record<string, unknown>,
) {
  return {
    action,
    eventId: event.eventId,
    eventName: event.eventName,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    actorId: event.actorId,
    privacyTier: event.privacyTier,
    reason,
    details: details as Prisma.InputJsonValue,
  };
}

function redactPayload(value: Prisma.JsonValue): unknown {
  if (Array.isArray(value)) {
    return value.map(redactPayload);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, Prisma.JsonValue>).map(([key, item]) => {
      if (isSensitiveAnalyticsField(key)) {
        return [key, REDACTED_VALUE];
      }
      return [key, redactPayload(item)];
    }),
  ) as Prisma.InputJsonObject;
}

function isSensitiveAnalyticsField(key: string) {
  return /(user|actor|email|wallet|session|trace|ip|device|cohort)/i.test(key);
}

function parsePositiveInt(raw: string | undefined, fallback: number) {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
