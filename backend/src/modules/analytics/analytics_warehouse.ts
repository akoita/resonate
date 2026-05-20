import { Injectable } from "@nestjs/common";
import {
  AnalyticsEventEnvelope,
  AnalyticsEventValidationError,
  parseAnalyticsEventEnvelope,
} from "./analytics_event";
import { AnalyticsIngestService } from "./analytics_ingest.service";

const SUPPORTED_EVENT_FAMILIES = new Set([
  "identity",
  "catalog",
  "ingestion",
  "playback",
  "library",
  "commerce",
  "license",
  "payment",
  "rights",
  "agent",
  "generation",
  "experiment",
  "system",
]);

export interface AnalyticsWarehouseConfig {
  projectId: string;
  datasetPrefix: string;
  tables: {
    eventsRaw: string;
    eventsClean: string;
    analyticsFacts: string;
    analyticsViews: string;
    analyticsQuarantine: string;
  };
}

export interface EventsRawRow {
  eventId: string;
  eventName: string;
  eventVersion: number;
  occurredAt: string;
  receivedAt: string;
  producer: string;
  environment: string;
  privacyTier: string;
  payload: Record<string, unknown>;
  sourceRefs?: Record<string, string>;
  envelope: AnalyticsEventEnvelope;
}

export interface EventsCleanRow {
  eventId: string;
  eventName: string;
  eventFamily: string;
  eventAction: string;
  eventVersion: number;
  occurredAt: string;
  occurredDate: string;
  producer: string;
  environment: string;
  privacyTier: string;
  subjectType?: string;
  subjectId?: string;
  actorId?: string;
  sessionId?: string;
  artistId?: string;
  trackId?: string;
  releaseId?: string;
  canonicalAmountUsd?: number;
  source?: string;
  payload: Record<string, unknown>;
}

export interface AnalyticsFactRow {
  factId: string;
  factType: string;
  eventId: string;
  occurredAt: string;
  occurredDate: string;
  artistId?: string;
  trackId?: string;
  releaseId?: string;
  subjectType?: string;
  subjectId?: string;
  canonicalAmountUsd?: number;
  count: number;
  dimensions: Record<string, unknown>;
}

export interface AnalyticsViewRow {
  viewName: string;
  grain: "day_event_artist_track";
  date: string;
  eventName: string;
  artistId: string;
  trackId: string;
  eventCount: number;
  playCount: number;
  payoutUsd: number;
}

export interface AnalyticsQuarantineRow {
  eventId?: string;
  eventName?: string;
  reason: string;
  receivedAt: string;
  raw: unknown;
}

export interface AnalyticsWarehouseExport {
  generatedAt: string;
  config: AnalyticsWarehouseConfig;
  eventsRaw: EventsRawRow[];
  eventsClean: EventsCleanRow[];
  analyticsFacts: AnalyticsFactRow[];
  analyticsViews: AnalyticsViewRow[];
  analyticsQuarantine: AnalyticsQuarantineRow[];
}

@Injectable()
export class AnalyticsWarehouseExportService {
  constructor(private readonly ingestService: AnalyticsIngestService) {}

  async exportLayers() {
    return buildAnalyticsWarehouseExport(await this.ingestService.listEvents());
  }
}

export function analyticsWarehouseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AnalyticsWarehouseConfig {
  const datasetPrefix = env.ANALYTICS_WAREHOUSE_DATASET_PREFIX || "analytics_local";
  return {
    projectId: env.ANALYTICS_WAREHOUSE_PROJECT_ID || env.GCP_PROJECT_ID || "local",
    datasetPrefix,
    tables: {
      eventsRaw: `${datasetPrefix}.events_raw`,
      eventsClean: `${datasetPrefix}.events_clean`,
      analyticsFacts: `${datasetPrefix}.analytics_facts`,
      analyticsViews: `${datasetPrefix}.analytics_views`,
      analyticsQuarantine: `${datasetPrefix}.analytics_quarantine`,
    },
  };
}

export function buildAnalyticsWarehouseExport(
  records: unknown[],
  options?: {
    generatedAt?: Date;
    config?: AnalyticsWarehouseConfig;
  },
): AnalyticsWarehouseExport {
  const generatedAt = (options?.generatedAt ?? new Date()).toISOString();
  const config = options?.config ?? analyticsWarehouseConfigFromEnv();
  const eventsRaw: EventsRawRow[] = [];
  const eventsClean: EventsCleanRow[] = [];
  const analyticsFacts: AnalyticsFactRow[] = [];
  const viewMap = new Map<string, AnalyticsViewRow>();
  const analyticsQuarantine: AnalyticsQuarantineRow[] = [];

  for (const record of records) {
    const event = parseForExport(record, generatedAt, analyticsQuarantine);
    if (!event) {
      continue;
    }

    eventsRaw.push(toRawRow(event));

    const eventFamily = event.eventName.split(".")[0];
    if (!SUPPORTED_EVENT_FAMILIES.has(eventFamily)) {
      analyticsQuarantine.push({
        eventId: event.eventId,
        eventName: event.eventName,
        reason: `unsupported event family: ${eventFamily}`,
        receivedAt: generatedAt,
        raw: event,
      });
      continue;
    }

    const clean = toCleanRow(event);
    eventsClean.push(clean);
    analyticsFacts.push(toFactRow(clean));
    mergeViewRow(viewMap, clean);
  }

  return {
    generatedAt,
    config,
    eventsRaw,
    eventsClean,
    analyticsFacts,
    analyticsViews: [...viewMap.values()],
    analyticsQuarantine,
  };
}

function parseForExport(
  record: unknown,
  receivedAt: string,
  quarantine: AnalyticsQuarantineRow[],
): AnalyticsEventEnvelope | null {
  try {
    return parseAnalyticsEventEnvelope(record);
  } catch (error) {
    const reason =
      error instanceof AnalyticsEventValidationError
        ? error.issues.join("; ")
        : error instanceof Error
          ? error.message
          : "unknown analytics export parse failure";

    quarantine.push({
      eventId: objectField(record, "eventId"),
      eventName: objectField(record, "eventName"),
      reason,
      receivedAt,
      raw: record,
    });
    return null;
  }
}

function toRawRow(event: AnalyticsEventEnvelope): EventsRawRow {
  return {
    eventId: event.eventId,
    eventName: event.eventName,
    eventVersion: event.eventVersion,
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
    producer: event.producer,
    environment: event.environment,
    privacyTier: event.privacyTier,
    payload: event.payload,
    sourceRefs: event.sourceRefs,
    envelope: event,
  };
}

function toCleanRow(event: AnalyticsEventEnvelope): EventsCleanRow {
  const [eventFamily, ...actionParts] = event.eventName.split(".");
  return {
    eventId: event.eventId,
    eventName: event.eventName,
    eventFamily,
    eventAction: actionParts.join("."),
    eventVersion: event.eventVersion,
    occurredAt: event.occurredAt,
    occurredDate: event.occurredAt.slice(0, 10),
    producer: event.producer,
    environment: event.environment,
    privacyTier: event.privacyTier,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    actorId: event.actorId,
    sessionId: event.sessionId ?? stringPayload(event.payload, "sessionId"),
    artistId: stringPayload(event.payload, "artistId"),
    trackId: stringPayload(event.payload, "trackId"),
    releaseId: stringPayload(event.payload, "releaseId"),
    canonicalAmountUsd: numberPayload(event.payload, "canonicalAmountUsd") ?? numberPayload(event.payload, "amountUsd"),
    source: stringPayload(event.payload, "source"),
    payload: event.payload,
  };
}

function toFactRow(clean: EventsCleanRow): AnalyticsFactRow {
  return {
    factId: `fact_${clean.eventId}`,
    factType: `${clean.eventFamily}_event`,
    eventId: clean.eventId,
    occurredAt: clean.occurredAt,
    occurredDate: clean.occurredDate,
    artistId: clean.artistId,
    trackId: clean.trackId,
    releaseId: clean.releaseId,
    subjectType: clean.subjectType,
    subjectId: clean.subjectId,
    canonicalAmountUsd: clean.canonicalAmountUsd,
    count: 1,
    dimensions: {
      eventName: clean.eventName,
      producer: clean.producer,
      privacyTier: clean.privacyTier,
      source: clean.source,
      sessionId: clean.sessionId,
      title: stringPayload(clean.payload, "title"),
      paymentToken: stringPayload(clean.payload, "paymentToken"),
      paymentAssetId: stringPayload(clean.payload, "paymentAssetId"),
      paymentAssetSymbol: stringPayload(clean.payload, "paymentAssetSymbol"),
      paymentAssetDecimals: numberPayload(clean.payload, "paymentAssetDecimals"),
      settlementAmount: stringPayload(clean.payload, "settlementAmount"),
      settlementAmountUnits: stringPayload(clean.payload, "settlementAmountUnits"),
      amount: stringPayload(clean.payload, "amount"),
      amountUnits: stringPayload(clean.payload, "amountUnits"),
      currency: stringPayload(clean.payload, "currency"),
      amountUsd: numberPayload(clean.payload, "amountUsd"),
    },
  };
}

function mergeViewRow(viewMap: Map<string, AnalyticsViewRow>, clean: EventsCleanRow) {
  const artistId = clean.artistId ?? "unknown";
  const trackId = clean.trackId ?? "unknown";
  const key = `${clean.occurredDate}|${clean.eventName}|${artistId}|${trackId}`;
  const row =
    viewMap.get(key) ??
    {
      viewName: "daily_event_artist_track",
      grain: "day_event_artist_track" as const,
      date: clean.occurredDate,
      eventName: clean.eventName,
      artistId,
      trackId,
      eventCount: 0,
      playCount: 0,
      payoutUsd: 0,
    };

  row.eventCount += 1;
  if (clean.eventName === "license.granted" || clean.eventName === "playback.completed") {
    row.playCount += 1;
  }
  if (clean.eventName === "payment.settled" || clean.eventName === "commerce.settled") {
    row.payoutUsd += clean.canonicalAmountUsd ?? 0;
  }
  viewMap.set(key, row);
}

function stringPayload(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function numberPayload(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function objectField(record: unknown, key: string) {
  if (!record || typeof record !== "object") {
    return undefined;
  }
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
