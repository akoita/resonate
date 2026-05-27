import { Injectable } from "@nestjs/common";
import {
  AnalyticsQuarantineRow,
  AnalyticsWarehouseExport,
  AnalyticsWarehouseExportService,
  EventsCleanRow,
} from "./analytics_warehouse";
import { analyticsPubSubPublisherConfigFromEnv } from "./analytics_event_publisher";

export type AnalyticsPipelineStatus = "ok" | "warning" | "critical";

export interface AnalyticsPipelineObservabilityReport {
  status: AnalyticsPipelineStatus;
  generatedAt: string;
  source: "warehouse_export";
  freshness: {
    asOf: string | null;
    lagSeconds: number | null;
    warningAfterSeconds: number;
    criticalAfterSeconds: number;
    status: AnalyticsPipelineStatus;
  };
  quarantine: {
    rows: number;
    byReason: Array<{ reason: string; eventName: string; count: number }>;
  };
  identifierGaps: {
    rows: number;
    byReason: Array<{ reason: string; eventName: string; count: number }>;
  };
  facts: {
    cleanEvents: number;
    factRows: number;
    cleanToFactRate: number;
    missingFactRows: number;
  };
  productIngestion: {
    rejectedPayloadLogEvent: "analytics_product_event_rejected";
    note: string;
  };
  pubSub: {
    enabled: boolean;
    strict: boolean;
    topicConfigured: boolean;
    projectConfigured: boolean;
  };
  recommendations: string[];
}

const FRESHNESS_WARNING_SECONDS = 6 * 60 * 60;
const FRESHNESS_CRITICAL_SECONDS = 24 * 60 * 60;

@Injectable()
export class AnalyticsPipelineObservabilityService {
  constructor(private readonly warehouseExportService: AnalyticsWarehouseExportService) {}

  async getPipelineHealth(now = new Date()): Promise<AnalyticsPipelineObservabilityReport> {
    return buildAnalyticsPipelineHealth(await this.warehouseExportService.exportLayers(), now);
  }
}

export function buildAnalyticsPipelineHealth(
  exportPayload: AnalyticsWarehouseExport,
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsPipelineObservabilityReport {
  const freshness = freshnessFromRows(exportPayload.analyticsFacts, exportPayload.eventsClean, now);
  const quarantine = quarantineSummary(exportPayload.analyticsQuarantine);
  const identifierGaps = identifierGapSummary(exportPayload.eventsClean);
  const facts = factCoverage(exportPayload);
  const pubSubConfig = analyticsPubSubPublisherConfigFromEnv(env);
  const recommendations = buildRecommendations({
    freshness,
    quarantineRows: quarantine.rows,
    identifierGapRows: identifierGaps.rows,
    missingFactRows: facts.missingFactRows,
    cleanToFactRate: facts.cleanToFactRate,
    pubSubEnabled: pubSubConfig.enabled,
    pubSubTopicConfigured: Boolean(pubSubConfig.topicName),
  });

  return {
    status: reportStatus(freshness.status, quarantine.rows, identifierGaps.rows, facts),
    generatedAt: now.toISOString(),
    source: "warehouse_export",
    freshness,
    quarantine,
    identifierGaps,
    facts,
    productIngestion: {
      rejectedPayloadLogEvent: "analytics_product_event_rejected",
      note: "Rejected POST /analytics/product/event payloads are emitted as structured warning logs with reason and eventName.",
    },
    pubSub: {
      enabled: pubSubConfig.enabled,
      strict: pubSubConfig.strict,
      topicConfigured: Boolean(pubSubConfig.topicName),
      projectConfigured: Boolean(pubSubConfig.projectId),
    },
    recommendations,
  };
}

function freshnessFromRows(
  facts: AnalyticsWarehouseExport["analyticsFacts"],
  cleanRows: AnalyticsWarehouseExport["eventsClean"],
  now: Date,
): AnalyticsPipelineObservabilityReport["freshness"] {
  const timestamps = [...facts.map((row) => row.occurredAt), ...cleanRows.map((row) => row.occurredAt)]
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  const latest = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
  const lagSeconds = latest ? Math.max(0, Math.floor((now.getTime() - latest.getTime()) / 1000)) : null;
  const status =
    lagSeconds === null
      ? "warning"
      : lagSeconds >= FRESHNESS_CRITICAL_SECONDS
        ? "critical"
        : lagSeconds >= FRESHNESS_WARNING_SECONDS
          ? "warning"
          : "ok";

  return {
    asOf: latest?.toISOString() ?? null,
    lagSeconds,
    warningAfterSeconds: FRESHNESS_WARNING_SECONDS,
    criticalAfterSeconds: FRESHNESS_CRITICAL_SECONDS,
    status,
  };
}

function quarantineSummary(rows: AnalyticsQuarantineRow[]) {
  const byReason = groupedCounts(rows, (row) => ({
    reason: row.reason || "unknown",
    eventName: row.eventName || "unknown",
  }));
  return {
    rows: rows.length,
    byReason,
  };
}

function identifierGapSummary(rows: EventsCleanRow[]) {
  const gaps: Array<{ reason: string; eventName: string }> = [];
  for (const row of rows) {
    for (const reason of missingIdentifierReasons(row)) {
      gaps.push({ reason, eventName: row.eventName });
    }
  }

  return {
    rows: gaps.length,
    byReason: groupedCounts(gaps, (gap) => gap),
  };
}

function missingIdentifierReasons(row: EventsCleanRow) {
  const reasons: string[] = [];
  if (expectsActor(row) && !row.actorId) {
    reasons.push("missing_actor_id");
  }
  if (expectsSession(row) && !row.sessionId) {
    reasons.push("missing_session_id");
  }
  if (expectsTrack(row) && !row.trackId) {
    reasons.push("missing_track_id");
  }
  if (expectsArtist(row) && !row.artistId) {
    reasons.push("missing_artist_id");
  }
  if (expectsRelease(row) && !row.releaseId) {
    reasons.push("missing_release_id");
  }
  return reasons;
}

function expectsActor(row: EventsCleanRow) {
  return ["identity", "onboarding", "session", "playback", "playlist", "search", "library", "commerce", "marketplace", "wallet", "agent"].includes(
    row.eventFamily,
  );
}

function expectsSession(row: EventsCleanRow) {
  return ["onboarding", "session", "playback", "playlist", "search", "marketplace", "agent"].includes(row.eventFamily);
}

function expectsTrack(row: EventsCleanRow) {
  return ["playback", "library", "commerce", "marketplace", "agent"].includes(row.eventFamily);
}

function expectsArtist(row: EventsCleanRow) {
  return ["playback", "artist", "catalog", "stems", "rights", "commerce", "marketplace"].includes(row.eventFamily);
}

function expectsRelease(row: EventsCleanRow) {
  return ["playback", "artist", "catalog", "stems", "rights", "commerce", "marketplace", "release_rights"].includes(
    row.eventFamily,
  );
}

function factCoverage(exportPayload: AnalyticsWarehouseExport) {
  const factEventIds = new Set(exportPayload.analyticsFacts.map((row) => row.eventId));
  const missingFactRows = exportPayload.eventsClean.filter((row) => !factEventIds.has(row.eventId)).length;
  const cleanEvents = exportPayload.eventsClean.length;
  const factRows = exportPayload.analyticsFacts.length;
  return {
    cleanEvents,
    factRows,
    cleanToFactRate: cleanEvents === 0 ? 1 : factRows / cleanEvents,
    missingFactRows,
  };
}

function groupedCounts<T>(rows: T[], keyFn: (row: T) => { reason: string; eventName: string }) {
  const counts = new Map<string, { reason: string; eventName: string; count: number }>();
  for (const row of rows) {
    const key = keyFn(row);
    const mapKey = `${key.reason}\0${key.eventName}`;
    const current = counts.get(mapKey) ?? { ...key, count: 0 };
    current.count += 1;
    counts.set(mapKey, current);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

function reportStatus(
  freshnessStatus: AnalyticsPipelineStatus,
  quarantineRows: number,
  identifierGapRows: number,
  facts: AnalyticsPipelineObservabilityReport["facts"],
): AnalyticsPipelineStatus {
  if (freshnessStatus === "critical" || facts.cleanToFactRate < 0.95) {
    return "critical";
  }
  if (freshnessStatus === "warning" || quarantineRows > 0 || identifierGapRows > 0 || facts.missingFactRows > 0) {
    return "warning";
  }
  return "ok";
}

function buildRecommendations(input: {
  freshness: AnalyticsPipelineObservabilityReport["freshness"];
  quarantineRows: number;
  identifierGapRows: number;
  missingFactRows: number;
  cleanToFactRate: number;
  pubSubEnabled: boolean;
  pubSubTopicConfigured: boolean;
}) {
  const recommendations: string[] = [];
  if (input.freshness.status !== "ok") {
    recommendations.push("Check Dataflow, warehouse loader, and BigQuery reporting schedules for stale analytics facts.");
  }
  if (input.quarantineRows > 0) {
    recommendations.push("Review analytics_quarantine by reason/eventName and replay rows after schema or producer fixes.");
  }
  if (input.identifierGapRows > 0) {
    recommendations.push("Fix producers that omit expected actorId, sessionId, trackId, artistId, or releaseId fields.");
  }
  if (input.missingFactRows > 0 || input.cleanToFactRate < 1) {
    recommendations.push("Compare events_clean and analytics_facts to find transform drops before reports depend on them.");
  }
  if (input.pubSubEnabled && !input.pubSubTopicConfigured) {
    recommendations.push("Set ANALYTICS_EVENT_PUBSUB_TOPIC before enabling analytics event publishing in this environment.");
  }
  return recommendations;
}
