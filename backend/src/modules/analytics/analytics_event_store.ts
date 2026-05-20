import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { AnalyticsEventEnvelope } from "./analytics_event";

export const ANALYTICS_EVENT_STORE = Symbol("ANALYTICS_EVENT_STORE");

export interface AnalyticsEventStore {
  ingest(event: AnalyticsEventEnvelope): Promise<AnalyticsEventEnvelope>;
  listEvents(filters?: AnalyticsEventListFilters): Promise<AnalyticsEventEnvelope[]>;
  countEvents(): Promise<number>;
}

export interface AnalyticsEventListFilters {
  occurredFrom?: Date;
  occurredTo?: Date;
  eventFamily?: string;
}

export class InMemoryAnalyticsEventStore implements AnalyticsEventStore {
  private events: AnalyticsEventEnvelope[] = [];

  async ingest(event: AnalyticsEventEnvelope) {
    const existing = this.events.find((candidate) => candidate.eventId === event.eventId);
    if (existing) {
      return existing;
    }

    this.events.push(event);
    return event;
  }

  async listEvents(filters?: AnalyticsEventListFilters) {
    return this.events.filter((event) => matchesFilters(event, filters)).slice();
  }

  async countEvents() {
    return this.events.length;
  }
}

export class PrismaAnalyticsEventStore implements AnalyticsEventStore {
  async ingest(event: AnalyticsEventEnvelope) {
    const row = await prisma.analyticsEvent.upsert({
      where: { eventId: event.eventId },
      update: {},
      create: {
        eventId: event.eventId,
        eventName: event.eventName,
        eventVersion: event.eventVersion,
        occurredAt: new Date(event.occurredAt),
        receivedAt: new Date(event.receivedAt),
        producer: event.producer,
        environment: event.environment,
        privacyTier: event.privacyTier,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        actorId: event.actorId,
        sessionId: event.sessionId,
        traceId: event.traceId,
        schemaUri: event.schemaUri,
        consentBasis: event.consentBasis,
        payload: event.payload as Prisma.InputJsonValue,
        sourceRefs: (event.sourceRefs as Prisma.InputJsonValue | undefined) ?? undefined,
        envelope: event as unknown as Prisma.InputJsonValue,
      },
    });

    return rowToEnvelope(row);
  }

  async listEvents(filters?: AnalyticsEventListFilters) {
    const rows = await prisma.analyticsEvent.findMany({
      where: {
        occurredAt: {
          gte: filters?.occurredFrom,
          lt: filters?.occurredTo,
        },
        eventName: filters?.eventFamily ? { startsWith: `${filters.eventFamily}.` } : undefined,
      },
      orderBy: { occurredAt: "asc" },
    });

    return rows.map(rowToEnvelope);
  }

  async countEvents() {
    return prisma.analyticsEvent.count();
  }
}

function matchesFilters(event: AnalyticsEventEnvelope, filters?: AnalyticsEventListFilters) {
  if (!filters) {
    return true;
  }

  const occurredAt = new Date(event.occurredAt).getTime();
  if (filters.occurredFrom && occurredAt < filters.occurredFrom.getTime()) {
    return false;
  }
  if (filters.occurredTo && occurredAt >= filters.occurredTo.getTime()) {
    return false;
  }
  if (filters.eventFamily && !event.eventName.startsWith(`${filters.eventFamily}.`)) {
    return false;
  }
  return true;
}

function rowToEnvelope(row: {
  eventId: string;
  eventName: string;
  eventVersion: number;
  occurredAt: Date;
  receivedAt: Date;
  producer: string;
  environment: string;
  privacyTier: string;
  subjectType: string | null;
  subjectId: string | null;
  actorId: string | null;
  sessionId: string | null;
  traceId: string | null;
  schemaUri: string | null;
  consentBasis: string | null;
  payload: Prisma.JsonValue;
  sourceRefs: Prisma.JsonValue | null;
}): AnalyticsEventEnvelope {
  return {
    eventId: row.eventId,
    eventName: row.eventName,
    eventVersion: row.eventVersion,
    occurredAt: row.occurredAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    producer: row.producer,
    environment: row.environment as AnalyticsEventEnvelope["environment"],
    privacyTier: row.privacyTier as AnalyticsEventEnvelope["privacyTier"],
    subjectType: row.subjectType ?? undefined,
    subjectId: row.subjectId ?? undefined,
    actorId: row.actorId ?? undefined,
    sessionId: row.sessionId ?? undefined,
    traceId: row.traceId ?? undefined,
    schemaUri: row.schemaUri ?? undefined,
    consentBasis: row.consentBasis ?? undefined,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    sourceRefs: (row.sourceRefs ?? undefined) as Record<string, string> | undefined,
  };
}
