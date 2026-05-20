import { Injectable } from "@nestjs/common";
import { AnalyticsEvent, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

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
    const result = {
      status: "ok",
      matched: events.length,
      deleted: 0,
      redacted: 0,
      lineageRecords: 0,
      ranAt: new Date().toISOString(),
    };

    for (const event of events) {
      if (shouldPreserveForAudit(event.eventName)) {
        await this.redactEvent(event, action, reason, details);
        result.redacted += 1;
      } else {
        await this.deleteEvent(event, action, reason, details);
        result.deleted += 1;
      }
      result.lineageRecords += 1;
    }

    return result;
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
