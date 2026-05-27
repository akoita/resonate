import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { GoogleAuth } from "google-auth-library";
import { analyticsWarehouseConfigFromEnv } from "../analytics/analytics_warehouse";

export const AGENT_BIGQUERY_TASTE_SOURCE = "bigquery";
export const AGENT_BIGQUERY_TASTE_CONFIG = Symbol("AGENT_BIGQUERY_TASTE_CONFIG");
export const AGENT_BIGQUERY_TASTE_QUERY_CLIENT = Symbol("AGENT_BIGQUERY_TASTE_QUERY_CLIENT");

export interface AgentBigQueryTasteSignalConfig {
  source: "disabled" | "bigquery";
  projectId: string;
  datasetId: string;
  scoresTable: string;
  apiBaseUrl: string;
  maximumBytesBilled: string;
  queryTimeoutMs: number;
  rowLimit: number;
}

export interface AgentTasteScore {
  trackId: string;
  score: number;
  confidence?: number;
  rank?: number;
  explanation?: string;
  modelVersion?: string;
  updatedAt?: string;
}

const MAX_TASTE_EXPLANATION_LENGTH = 180;

export interface AgentBigQueryTasteQueryRequest {
  projectId: string;
  apiBaseUrl: string;
  query: string;
  parameters: Record<string, BigQueryParameterValue>;
  maximumBytesBilled: string;
  timeoutMs: number;
}

export interface AgentBigQueryTasteQueryResponse {
  rows: Record<string, unknown>[];
  totalBytesProcessed?: string;
  cacheHit?: boolean;
}

type BigQueryScalarParameterValue = string | number;
type BigQueryParameterValue = BigQueryScalarParameterValue | string[];

@Injectable()
export class AgentBigQueryTasteSignalService {
  private readonly logger = new Logger(AgentBigQueryTasteSignalService.name);
  private readonly config: AgentBigQueryTasteSignalConfig;
  private readonly client: AgentBigQueryTasteQueryClient;

  constructor(
    @Optional()
    @Inject(AGENT_BIGQUERY_TASTE_CONFIG)
    config?: AgentBigQueryTasteSignalConfig,
    @Optional()
    @Inject(AGENT_BIGQUERY_TASTE_QUERY_CLIENT)
    client?: AgentBigQueryTasteQueryClient,
  ) {
    this.config = config ?? agentBigQueryTasteSignalConfigFromEnv();
    this.client = client ?? new GoogleAuthAgentBigQueryTasteQueryClient();
  }

  isEnabled() {
    return this.config.source === AGENT_BIGQUERY_TASTE_SOURCE;
  }

  async scoreTracks(input: {
    userId: string;
    trackIds: string[];
  }): Promise<Map<string, AgentTasteScore>> {
    const uniqueTrackIds = Array.from(new Set(input.trackIds.filter(Boolean)));
    if (!this.isEnabled() || uniqueTrackIds.length === 0) {
      return new Map();
    }

    try {
      const response = await this.client.query({
        projectId: this.config.projectId,
        apiBaseUrl: this.config.apiBaseUrl,
        query: userTrackScoresQuery(this.config),
        parameters: {
          userId: input.userId,
          trackIds: uniqueTrackIds,
          limit: Math.min(this.config.rowLimit, uniqueTrackIds.length),
        },
        maximumBytesBilled: this.config.maximumBytesBilled,
        timeoutMs: this.config.queryTimeoutMs,
      });

      return new Map(
        response.rows
          .map(toAgentTasteScore)
          .filter((score): score is AgentTasteScore => Boolean(score))
          .map((score) => [score.trackId, score]),
      );
    } catch (error) {
      this.logger.warn(`BigQuery taste signal unavailable; continuing without it: ${describeError(error)}`);
      return new Map();
    }
  }
}

export interface AgentBigQueryTasteQueryClient {
  query(request: AgentBigQueryTasteQueryRequest): Promise<AgentBigQueryTasteQueryResponse>;
}

export class GoogleAuthAgentBigQueryTasteQueryClient implements AgentBigQueryTasteQueryClient {
  private readonly auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/bigquery.readonly"],
  });

  async query(request: AgentBigQueryTasteQueryRequest): Promise<AgentBigQueryTasteQueryResponse> {
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

export function agentBigQueryTasteSignalConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AgentBigQueryTasteSignalConfig {
  const warehouseConfig = analyticsWarehouseConfigFromEnv(env);
  return {
    source: env.AGENT_TASTE_SIGNAL_SOURCE?.trim().toLowerCase() === AGENT_BIGQUERY_TASTE_SOURCE ? "bigquery" : "disabled",
    projectId:
      env.AGENT_TASTE_BIGQUERY_PROJECT_ID ||
      env.ANALYTICS_BIGQUERY_PROJECT_ID ||
      env.ANALYTICS_WAREHOUSE_PROJECT_ID ||
      env.GCP_PROJECT_ID ||
      warehouseConfig.projectId,
    datasetId:
      env.AGENT_TASTE_BIGQUERY_DATASET ||
      env.ANALYTICS_BIGQUERY_DATASET ||
      warehouseConfig.datasetPrefix,
    scoresTable: env.AGENT_TASTE_BIGQUERY_SCORES_TABLE || "user_track_recommendation_scores",
    apiBaseUrl: env.AGENT_TASTE_BIGQUERY_API_BASE_URL || env.ANALYTICS_BIGQUERY_API_BASE_URL || "https://bigquery.googleapis.com",
    maximumBytesBilled: positiveInteger(env.AGENT_TASTE_BIGQUERY_MAXIMUM_BYTES_BILLED, 100_000_000).toString(),
    queryTimeoutMs: positiveInteger(env.AGENT_TASTE_BIGQUERY_QUERY_TIMEOUT_MS, 5_000),
    rowLimit: positiveInteger(env.AGENT_TASTE_BIGQUERY_ROW_LIMIT, 100),
  };
}

function userTrackScoresQuery(config: AgentBigQueryTasteSignalConfig) {
  return `
SELECT
  CAST(track_id AS STRING) AS trackId,
  SAFE_CAST(recommendation_score AS FLOAT64) AS score,
  SAFE_CAST(confidence AS FLOAT64) AS confidence,
  SAFE_CAST(rank AS INT64) AS rank,
  CAST(explanation AS STRING) AS explanation,
  CAST(model_version AS STRING) AS modelVersion,
  CAST(updated_at AS STRING) AS updatedAt
FROM \`${identifier(config.projectId)}.${identifier(config.datasetId)}.${identifier(config.scoresTable)}\`
WHERE CAST(user_id AS STRING) = @userId
  AND CAST(track_id AS STRING) IN UNNEST(@trackIds)
ORDER BY score DESC, rank ASC
LIMIT @limit
`.trim();
}

function toAgentTasteScore(row: Record<string, unknown>): AgentTasteScore | null {
  const trackId = stringValue(row.trackId);
  const score = numberValue(row.score);
  if (!trackId || score === undefined) {
    return null;
  }

  const confidence = numberValue(row.confidence);
  const rank = numberValue(row.rank);
  const explanation = safeTasteExplanation(row.explanation);
  return {
    trackId,
    score: clamp(score),
    ...(confidence !== undefined ? { confidence: clamp(confidence) } : {}),
    ...(rank !== undefined ? { rank } : {}),
    ...(explanation ? { explanation } : {}),
    ...(stringValue(row.modelVersion) ? { modelVersion: stringValue(row.modelVersion) } : {}),
    ...(stringValue(row.updatedAt) ? { updatedAt: stringValue(row.updatedAt) } : {}),
  };
}

export function safeTasteExplanation(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const cleaned = value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return undefined;
  if (/https?:\/\//i.test(cleaned)) return undefined;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(cleaned)) return undefined;
  if (/\b(?:0x[a-fA-F0-9]{16,}|user[_:-]?[A-Za-z0-9_-]{6,}|session[_:-]?[A-Za-z0-9_-]{6,})\b/.test(cleaned)) {
    return undefined;
  }

  return cleaned.length > MAX_TASTE_EXPLANATION_LENGTH
    ? `${cleaned.slice(0, MAX_TASTE_EXPLANATION_LENGTH - 3).trimEnd()}...`
    : cleaned;
}

function queryParameter(name: string, value: BigQueryParameterValue) {
  if (Array.isArray(value)) {
    return {
      name,
      parameterType: {
        type: "ARRAY",
        arrayType: { type: "STRING" },
      },
      parameterValue: {
        arrayValues: value.map((entry) => ({ value: entry })),
      },
    };
  }

  const type = typeof value === "number" ? "INT64" : "STRING";
  return {
    name,
    parameterType: { type },
    parameterValue: { value: value.toString() },
  };
}

function identifier(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid BigQuery identifier: ${value}`);
  }
  return value;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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

function decodeBigQueryRow(fields: BigQueryField[], row: BigQueryRow): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  row.f?.forEach((cell, index) => {
    const field = fields[index];
    if (!field) return;
    output[field.name] = cell.v;
  });
  return output;
}
