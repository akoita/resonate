import { GoogleAuth } from "google-auth-library";
import { AnalyticsFactRow, AnalyticsViewRow, analyticsWarehouseConfigFromEnv } from "./analytics_warehouse";

export const ANALYTICS_REPORT_SOURCE = Symbol("ANALYTICS_REPORT_SOURCE");

export type AnalyticsReportSourceKind = "warehouse_export" | "bigquery";

export interface ArtistAnalyticsFactRequest {
  artistId: string;
  from: Date;
  to: Date;
}

export interface ArtistAnalyticsFactResult {
  facts: AnalyticsFactRow[];
  views: AnalyticsViewRow[];
  metadata: AnalyticsReportMetadata;
}

export interface AnalyticsReportMetadata {
  source: AnalyticsReportSourceKind;
  generatedAt: string;
  timeWindow: {
    from: string;
    to: string;
    days: number;
  };
  freshness: {
    asOf: string | null;
    lagSeconds: number | null;
  };
  isEmpty: boolean;
  cache: {
    hit: boolean;
    ttlSeconds: number;
  };
  query?: {
    projectId: string;
    datasetId: string;
    factsTable: string;
    viewsTable: string;
    maximumBytesBilled: string;
    totalBytesProcessed?: string;
    cacheHit?: boolean;
  };
}

export interface ArtistAnalyticsReportSource {
  listArtistFacts(request: ArtistAnalyticsFactRequest): Promise<ArtistAnalyticsFactResult | null>;
}

export interface AnalyticsBigQueryReportConfig {
  source: AnalyticsReportSourceKind;
  projectId: string;
  datasetId: string;
  factsTable: string;
  viewsTable: string;
  apiBaseUrl: string;
  cacheTtlSeconds: number;
  maximumBytesBilled: string;
  queryTimeoutMs: number;
  rowLimit: number;
}

export interface AnalyticsBigQueryQueryRequest {
  projectId: string;
  apiBaseUrl: string;
  query: string;
  parameters: Record<string, BigQueryParameterValue>;
  maximumBytesBilled: string;
  timeoutMs: number;
}

export interface AnalyticsBigQueryQueryResponse {
  rows: Record<string, unknown>[];
  totalBytesProcessed?: string;
  cacheHit?: boolean;
}

type BigQueryParameterValue = string | number;

interface CacheEntry {
  expiresAt: number;
  result: ArtistAnalyticsFactResult;
}

export class DisabledArtistAnalyticsReportSource implements ArtistAnalyticsReportSource {
  async listArtistFacts(): Promise<null> {
    return null;
  }
}

export class BigQueryArtistAnalyticsReportSource implements ArtistAnalyticsReportSource {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly config = analyticsBigQueryReportConfigFromEnv(),
    private readonly client: AnalyticsBigQueryQueryClient = new GoogleAuthBigQueryQueryClient(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listArtistFacts(request: ArtistAnalyticsFactRequest): Promise<ArtistAnalyticsFactResult> {
    const cacheKey = `${request.artistId}:${request.from.toISOString()}:${request.to.toISOString()}`;
    const cached = this.cache.get(cacheKey);
    const now = this.now();
    if (cached && cached.expiresAt > now.getTime()) {
      return {
        ...cached.result,
        metadata: {
          ...cached.result.metadata,
          cache: { ...cached.result.metadata.cache, hit: true },
        },
      };
    }

    const [factsResponse, viewsResponse] = await Promise.all([
      this.client.query({
        projectId: this.config.projectId,
        apiBaseUrl: this.config.apiBaseUrl,
        query: artistFactsQuery(this.config),
        parameters: {
          artistId: request.artistId,
          from: request.from.toISOString(),
          to: request.to.toISOString(),
          limit: this.config.rowLimit,
        },
        maximumBytesBilled: this.config.maximumBytesBilled,
        timeoutMs: this.config.queryTimeoutMs,
      }),
      this.client.query({
        projectId: this.config.projectId,
        apiBaseUrl: this.config.apiBaseUrl,
        query: artistViewsQuery(this.config),
        parameters: {
          artistId: request.artistId,
          fromDate: request.from.toISOString().slice(0, 10),
          toExclusiveDate: dailyViewExclusiveEndDate(request.to),
          limit: this.config.rowLimit,
        },
        maximumBytesBilled: this.config.maximumBytesBilled,
        timeoutMs: this.config.queryTimeoutMs,
      }),
    ]);

    const facts = factsResponse.rows.map(toAnalyticsFactRow);
    const views = viewsResponse.rows.map(toAnalyticsViewRow);
    const freshness = freshnessFromFacts(facts, now);
    const result: ArtistAnalyticsFactResult = {
      facts,
      views,
      metadata: {
        source: "bigquery",
        generatedAt: now.toISOString(),
        timeWindow: timeWindowMetadata(request.from, request.to),
        freshness,
        isEmpty: facts.length === 0 && views.length === 0,
        cache: {
          hit: false,
          ttlSeconds: this.config.cacheTtlSeconds,
        },
        query: {
          projectId: this.config.projectId,
          datasetId: this.config.datasetId,
          factsTable: this.config.factsTable,
          viewsTable: this.config.viewsTable,
          maximumBytesBilled: this.config.maximumBytesBilled,
          totalBytesProcessed: sumDecimalStrings(
            factsResponse.totalBytesProcessed,
            viewsResponse.totalBytesProcessed,
          ),
          cacheHit: Boolean(factsResponse.cacheHit && viewsResponse.cacheHit),
        },
      },
    };

    if (this.config.cacheTtlSeconds > 0) {
      this.cache.set(cacheKey, {
        expiresAt: now.getTime() + this.config.cacheTtlSeconds * 1000,
        result,
      });
    }

    return result;
  }
}

export interface AnalyticsBigQueryQueryClient {
  query(request: AnalyticsBigQueryQueryRequest): Promise<AnalyticsBigQueryQueryResponse>;
}

export class GoogleAuthBigQueryQueryClient implements AnalyticsBigQueryQueryClient {
  private readonly auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/bigquery.readonly"],
  });

  async query(request: AnalyticsBigQueryQueryRequest): Promise<AnalyticsBigQueryQueryResponse> {
    const client = await this.auth.getClient();
    const response = await client.request<BigQueryJobsQueryResponse>({
      url: `${request.apiBaseUrl.replace(/\/$/, "")}/bigquery/v2/projects/${encodeURIComponent(
        request.projectId,
      )}/queries`,
      method: "POST",
      timeout: request.timeoutMs,
      data: {
        kind: "bigquery#queryRequest",
        useLegacySql: false,
        useQueryCache: true,
        maximumBytesBilled: request.maximumBytesBilled,
        parameterMode: "NAMED",
        query: request.query,
        queryParameters: Object.entries(request.parameters).map(([name, value]) => queryParameter(name, value)),
      },
    });

    const fields = response.data.schema?.fields ?? [];
    return {
      rows: (response.data.rows ?? []).map((row) => decodeBigQueryRow(fields, row)),
      totalBytesProcessed: response.data.totalBytesProcessed,
      cacheHit: response.data.cacheHit,
    };
  }
}

interface BigQueryField {
  name: string;
  type?: string;
}

interface BigQueryRow {
  f?: Array<{ v?: unknown }>;
}

interface BigQueryJobsQueryResponse {
  schema?: {
    fields?: BigQueryField[];
  };
  rows?: BigQueryRow[];
  totalBytesProcessed?: string;
  cacheHit?: boolean;
}

export function analyticsReportSourceFromEnv(env: NodeJS.ProcessEnv = process.env): ArtistAnalyticsReportSource {
  const config = analyticsBigQueryReportConfigFromEnv(env);
  if (config.source === "bigquery") {
    return new BigQueryArtistAnalyticsReportSource(config);
  }
  return new DisabledArtistAnalyticsReportSource();
}

export function analyticsBigQueryReportConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsBigQueryReportConfig {
  const warehouseConfig = analyticsWarehouseConfigFromEnv(env);
  return {
    source: env.ANALYTICS_REPORT_SOURCE === "bigquery" ? "bigquery" : "warehouse_export",
    projectId:
      env.ANALYTICS_BIGQUERY_PROJECT_ID ||
      env.ANALYTICS_WAREHOUSE_PROJECT_ID ||
      env.GCP_PROJECT_ID ||
      warehouseConfig.projectId,
    datasetId: env.ANALYTICS_BIGQUERY_DATASET || warehouseConfig.datasetPrefix,
    factsTable: env.ANALYTICS_BIGQUERY_FACTS_TABLE || "analytics_facts",
    viewsTable: env.ANALYTICS_BIGQUERY_VIEWS_TABLE || "analytics_views",
    apiBaseUrl: env.ANALYTICS_BIGQUERY_API_BASE_URL || "https://bigquery.googleapis.com",
    cacheTtlSeconds: positiveInteger(env.ANALYTICS_BIGQUERY_CACHE_TTL_SECONDS, 60),
    maximumBytesBilled: positiveInteger(env.ANALYTICS_BIGQUERY_MAXIMUM_BYTES_BILLED, 500_000_000).toString(),
    queryTimeoutMs: positiveInteger(env.ANALYTICS_BIGQUERY_QUERY_TIMEOUT_MS, 10_000),
    rowLimit: positiveInteger(env.ANALYTICS_BIGQUERY_ROW_LIMIT, 10_000),
  };
}

export function timeWindowMetadata(from: Date, to: Date) {
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    days: Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)),
  };
}

function artistFactsQuery(config: AnalyticsBigQueryReportConfig) {
  return `
SELECT
  factId,
  factType,
  eventId,
  CAST(occurredAt AS STRING) AS occurredAt,
  CAST(occurredDate AS STRING) AS occurredDate,
  artistId,
  trackId,
  releaseId,
  subjectType,
  subjectId,
  canonicalAmountUsd,
  count,
  TO_JSON_STRING(dimensions) AS dimensions
FROM \`${bigQueryIdentifier(config.projectId)}.${bigQueryIdentifier(config.datasetId)}.${bigQueryIdentifier(
    config.factsTable,
  )}\`
WHERE artistId = @artistId
  AND occurredAt >= TIMESTAMP(@from)
  AND occurredAt < TIMESTAMP(@to)
ORDER BY occurredAt ASC
LIMIT @limit
`.trim();
}

function artistViewsQuery(config: AnalyticsBigQueryReportConfig) {
  return `
SELECT
  viewName,
  grain,
  CAST(date AS STRING) AS date,
  eventName,
  artistId,
  trackId,
  eventCount,
  playCount,
  payoutUsd
FROM \`${bigQueryIdentifier(config.projectId)}.${bigQueryIdentifier(config.datasetId)}.${bigQueryIdentifier(
    config.viewsTable,
  )}\`
WHERE artistId = @artistId
  AND date >= DATE(@fromDate)
  AND date < DATE(@toExclusiveDate)
ORDER BY date ASC
LIMIT @limit
`.trim();
}

function bigQueryIdentifier(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid BigQuery identifier: ${value}`);
  }
  return value;
}

function queryParameter(name: string, value: BigQueryParameterValue) {
  const parameterType = typeof value === "number" ? "INT64" : "STRING";
  return {
    name,
    parameterType: { type: parameterType },
    parameterValue: { value: String(value) },
  };
}

function decodeBigQueryRow(fields: BigQueryField[], row: BigQueryRow): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  fields.forEach((field, index) => {
    const value = row.f?.[index]?.v;
    output[field.name] = decodeBigQueryValue(field, value);
  });
  return output;
}

function decodeBigQueryValue(field: BigQueryField, value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (field.type === "INTEGER" || field.type === "INT64" || field.type === "FLOAT" || field.type === "FLOAT64") {
    return Number(value);
  }
  if (field.type === "BOOLEAN" || field.type === "BOOL") {
    return value === true || value === "true";
  }
  return value;
}

function toAnalyticsFactRow(row: Record<string, unknown>): AnalyticsFactRow {
  return {
    factId: stringValue(row.factId) ?? "",
    factType: stringValue(row.factType) ?? "",
    eventId: stringValue(row.eventId) ?? "",
    occurredAt: stringValue(row.occurredAt) ?? "",
    occurredDate: stringValue(row.occurredDate) ?? "",
    artistId: stringValue(row.artistId),
    trackId: stringValue(row.trackId),
    releaseId: stringValue(row.releaseId),
    subjectType: stringValue(row.subjectType),
    subjectId: stringValue(row.subjectId),
    canonicalAmountUsd: numberValue(row.canonicalAmountUsd),
    count: numberValue(row.count) ?? 1,
    dimensions: objectValue(row.dimensions),
  };
}

function toAnalyticsViewRow(row: Record<string, unknown>): AnalyticsViewRow {
  return {
    viewName: stringValue(row.viewName) ?? "daily_event_artist_track",
    grain: "day_event_artist_track",
    date: stringValue(row.date) ?? "",
    eventName: stringValue(row.eventName) ?? "",
    artistId: stringValue(row.artistId) ?? "unknown",
    trackId: stringValue(row.trackId) ?? "unknown",
    eventCount: numberValue(row.eventCount) ?? 0,
    playCount: numberValue(row.playCount) ?? 0,
    payoutUsd: numberValue(row.payoutUsd) ?? 0,
  };
}

function freshnessFromFacts(facts: AnalyticsFactRow[], now: Date) {
  const asOf = facts.reduce<string | null>((latest, fact) => {
    if (!fact.occurredAt) {
      return latest;
    }
    return latest === null || Date.parse(fact.occurredAt) > Date.parse(latest) ? fact.occurredAt : latest;
  }, null);

  return {
    asOf,
    lagSeconds: asOf === null ? null : Math.max(0, Math.floor((now.getTime() - Date.parse(asOf)) / 1000)),
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sumDecimalStrings(first?: string, second?: string) {
  if (!first && !second) {
    return undefined;
  }
  return (BigInt(first ?? "0") + BigInt(second ?? "0")).toString();
}

function dailyViewExclusiveEndDate(value: Date) {
  const start = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const exclusive = value.getTime() === start.getTime() ? start : new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return exclusive.toISOString().slice(0, 10);
}
