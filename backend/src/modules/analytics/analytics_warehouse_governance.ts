import { randomUUID } from "crypto";
import { GoogleAuth } from "google-auth-library";
import {
  bigQueryCastType,
  bigQueryTableRef,
  buildDailyViewsStatement,
  buildLayerMergeStatements,
  buildViewSwapStatements,
  type Field as BigQuerySchemaField,
} from "./analytics_bigquery_batch";
import { analyticsBigQueryReportConfigFromEnv } from "./analytics_bigquery_report";
import {
  AnalyticsWarehouseConfig,
  analyticsWarehouseConfigFromEnv,
  buildAnalyticsWarehouseExport,
} from "./analytics_warehouse";

export const ANALYTICS_WAREHOUSE_GOVERNANCE = Symbol("ANALYTICS_WAREHOUSE_GOVERNANCE");

/**
 * Only these layers hold a person identifier keyed by eventId.
 *
 * `analytics_quarantine` holds envelopes that never became person rows, and
 * `analytics_views` is a derived daily aggregate that is recomputed from
 * `analytics_facts` after the erasure — writing view rows aggregated from just
 * the erased events would overwrite a whole day's real totals with a count of N.
 */
export const ERASURE_LAYERS = ["eventsRaw", "eventsClean", "analyticsFacts"] as const;

export type ErasureLayer = (typeof ERASURE_LAYERS)[number];

export interface WarehouseErasureRequest {
  /** Events removed from Postgres; their warehouse rows are deleted outright. */
  deleteEventIds: string[];
  /** Audit-preserved events redacted in Postgres rather than deleted. */
  redactEventIds: string[];
  /**
   * Envelopes re-read from Postgres *after* redaction. The warehouse rows are
   * rebuilt from them, so warehouse redaction is identical to Postgres
   * redaction by construction instead of a second set of rules that can drift.
   */
  redactedEnvelopes: unknown[];
  /** `YYYY-MM-DD` occurrence dates of every touched event, for the view recompute. */
  affectedDates: string[];
  reason: string;
}

export interface WarehouseErasureResult {
  status: "ok" | "skipped" | "failed";
  provider: string;
  /** Erased analytics events, not warehouse rows: one event maps to at most one row per layer. */
  deletedRows: number;
  redactedRows: number;
  /** Transactional statement sets submitted to the warehouse. */
  statements: number;
  error?: string;
}

export interface AnalyticsWarehouseGovernanceTarget {
  describe(): { provider: string };
  applyErasure(request: WarehouseErasureRequest): Promise<WarehouseErasureResult>;
}

/** What a local or non-BigQuery deployment gets: no warehouse exists to erase from. */
export class DisabledWarehouseGovernanceTarget implements AnalyticsWarehouseGovernanceTarget {
  describe() {
    return { provider: "disabled" };
  }

  async applyErasure(): Promise<WarehouseErasureResult> {
    return { status: "skipped", provider: "disabled", deletedRows: 0, redactedRows: 0, statements: 0 };
  }
}

export interface WarehouseGovernanceHttpRequest {
  url: string;
  method?: string;
  data?: unknown;
  params?: Record<string, unknown>;
}

export interface WarehouseGovernanceHttpClient {
  request<T = unknown>(options: WarehouseGovernanceHttpRequest): Promise<{ data: T }>;
}

export interface WarehouseGovernanceClientFactory {
  getClient(): Promise<WarehouseGovernanceHttpClient>;
}

export interface BigQueryWarehouseGovernanceOptions {
  config?: AnalyticsWarehouseConfig;
  apiBaseUrl?: string;
  maximumBytesBilled?: string;
  auth?: WarehouseGovernanceClientFactory;
  chunkSize?: number;
  pollIntervalMs?: number;
  pollAttempts?: number;
}

interface BigQueryJobParameter {
  name: string;
  parameterType: Record<string, unknown>;
  parameterValue: Record<string, unknown>;
}

interface WarehouseTableMetadata {
  location?: string;
  schemas: Record<ErasureLayer, BigQuerySchemaField[]>;
}

export class BigQueryWarehouseGovernanceTarget implements AnalyticsWarehouseGovernanceTarget {
  private readonly config: AnalyticsWarehouseConfig;
  private readonly api: string;
  private readonly maximumBytesBilled: string;
  private readonly auth: WarehouseGovernanceClientFactory;
  private readonly chunkSize: number;
  private readonly pollIntervalMs: number;
  private readonly pollAttempts: number;

  constructor(private readonly projectId: string, options: BigQueryWarehouseGovernanceOptions = {}) {
    const report = analyticsBigQueryReportConfigFromEnv();
    this.config = options.config ?? analyticsWarehouseConfigFromEnv();
    this.api = `${(options.apiBaseUrl ?? report.apiBaseUrl).replace(/\/$/, "")}/bigquery/v2`;
    this.maximumBytesBilled = options.maximumBytesBilled ?? report.maximumBytesBilled;
    // Erasure writes. The report client is deliberately read-only, so it cannot be reused here.
    this.auth =
      options.auth ??
      (new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/bigquery"] }) as unknown as WarehouseGovernanceClientFactory);
    this.chunkSize = options.chunkSize ?? 500;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000;
    this.pollAttempts = options.pollAttempts ?? 150;
  }

  describe() {
    return { provider: "bigquery" };
  }

  async applyErasure(request: WarehouseErasureRequest): Promise<WarehouseErasureResult> {
    const deleteEventIds = distinct(request.deleteEventIds ?? []);
    const redactedEnvelopes = request.redactedEnvelopes ?? [];
    const affectedDates = distinct(request.affectedDates ?? []);
    if (deleteEventIds.length === 0 && redactedEnvelopes.length === 0) {
      return { status: "ok", provider: this.describe().provider, deletedRows: 0, redactedRows: 0, statements: 0 };
    }

    const client = await this.auth.getClient();
    const metadata = await this.readTableMetadata(client);
    let statements = 0;
    let redactedRows = 0;

    // Chunks run one at a time: concurrent erasure transactions would contend on the same tables.
    for (const chunk of chunked(deleteEventIds, this.chunkSize)) {
      await this.runJob(client, buildErasureDeleteQuery(this.projectId, this.config), [arrayParameter("ids", chunk)], metadata.location);
      statements += 1;
    }

    for (const chunk of chunked(redactedEnvelopes, this.chunkSize)) {
      const payload = this.buildRedactionPayload(chunk);
      const query = buildErasureRedactionQuery(this.projectId, this.config, payload, metadata.schemas);
      const parameters = ERASURE_LAYERS.map((layer) => stringParameter(layer, JSON.stringify(payload[layer])));
      await this.runJob(client, query, parameters, metadata.location);
      redactedRows += payload.eventsClean.length;
      statements += 1;
    }

    // Views last: they are recomputed from the facts that survive the erasure.
    if (deleteEventIds.length > 0 || redactedRows > 0) {
      for (const chunk of chunked(affectedDates, this.chunkSize)) {
        const query = buildViewRecomputeQuery(this.projectId, this.config, metadata.schemas.analyticsFacts);
        await this.runJob(client, query, [arrayParameter("dates", chunk)], metadata.location);
        statements += 1;
      }
    }

    return {
      status: "ok",
      provider: this.describe().provider,
      deletedRows: deleteEventIds.length,
      redactedRows,
      statements,
    };
  }

  /**
   * Rebuild warehouse rows from the already-redacted Postgres envelopes.
   *
   * The derived view and quarantine arrays are dropped: views are recomputed
   * from the facts table for the affected days, and a quarantined envelope is a
   * rebuild failure, not a row to write — refuse the merge rather than silently
   * leaving un-redacted rows behind.
   */
  private buildRedactionPayload(envelopes: unknown[]) {
    const exported = buildAnalyticsWarehouseExport(envelopes, { config: this.config });
    if (exported.analyticsQuarantine.length > 0 || exported.eventsClean.length !== envelopes.length) {
      throw new Error("Redacted analytics events could not be rebuilt for the warehouse; refusing a partial erasure");
    }
    return { ...exported, analyticsViews: [], analyticsQuarantine: [] };
  }

  private async readTableMetadata(client: WarehouseGovernanceHttpClient): Promise<WarehouseTableMetadata> {
    const schemas = {} as Record<ErasureLayer, BigQuerySchemaField[]>;
    let location: string | undefined;
    for (const layer of ERASURE_LAYERS) {
      const [dataset, table] = this.config.tables[layer].split(".");
      const response = await client.request<{ schema: { fields: BigQuerySchemaField[] }; location?: string }>({
        url: `${this.api}/projects/${encodeURIComponent(this.projectId)}/datasets/${dataset}/tables/${table}`,
      });
      schemas[layer] = response.data.schema.fields;
      location = response.data.location ?? location;
    }
    return { location, schemas };
  }

  private async runJob(
    client: WarehouseGovernanceHttpClient,
    query: string,
    queryParameters: BigQueryJobParameter[],
    location: string | undefined,
  ) {
    const jobId = `analytics_erasure_${randomUUID().replace(/-/g, "")}`;
    const jobUrl = `${this.api}/projects/${encodeURIComponent(this.projectId)}/jobs/${jobId}`;
    // A fixed job ID allows transport retries without applying the transaction twice.
    await client.request({
      url: `${this.api}/projects/${encodeURIComponent(this.projectId)}/jobs`,
      method: "POST",
      data: {
        jobReference: { projectId: this.projectId, jobId, location },
        configuration: {
          jobTimeoutMs: "240000",
          query: {
            query,
            useLegacySql: false,
            useQueryCache: false,
            maximumBytesBilled: this.maximumBytesBilled,
            parameterMode: "NAMED",
            queryParameters,
          },
        },
      },
    });

    // A submitted job is not a completed erasure. Wait for the transaction outcome.
    for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
      const result = await client.request<{ status: { state: string; errorResult?: { reason?: string; message?: string } } }>({
        url: jobUrl,
        params: { location },
      });
      if (result.data.status.state === "DONE") {
        const errorResult = result.data.status.errorResult;
        if (errorResult) {
          throw new Error(`BigQuery erasure ${jobId} failed: ${errorResult.message ?? errorResult.reason ?? "query error"}`);
        }
        return;
      }
      await delay(this.pollIntervalMs);
    }

    await client.request({ url: `${jobUrl}/cancel`, method: "POST", params: { location } });
    throw new Error(`BigQuery erasure ${jobId} did not finish; inspect job state before retrying`);
  }
}

/** Deletes the erased person's rows from every eventId-keyed layer in one transaction. */
export function buildErasureDeleteQuery(projectId: string, config: AnalyticsWarehouseConfig): string {
  const statements = ["BEGIN TRANSACTION;"];
  for (const layer of ERASURE_LAYERS) {
    statements.push(`DELETE FROM ${bigQueryTableRef(projectId, config.tables[layer])} WHERE eventId IN UNNEST(@ids);`);
  }
  statements.push("COMMIT TRANSACTION;");
  return statements.join("\n");
}

/** Replaces the rows of redacted events with rows rebuilt from the redacted envelopes. */
export function buildErasureRedactionQuery(
  projectId: string,
  config: AnalyticsWarehouseConfig,
  payload: { eventsRaw: unknown[]; eventsClean: unknown[]; analyticsFacts: unknown[] },
  schemas: Record<ErasureLayer, BigQuerySchemaField[]>,
): string {
  const statements = ["BEGIN TRANSACTION;"];
  for (const layer of ERASURE_LAYERS) {
    statements.push(
      ...buildLayerMergeStatements({
        layer,
        table: bigQueryTableRef(projectId, config.tables[layer]),
        rows: payload[layer] as Record<string, unknown>[],
        fields: schemas[layer],
      }),
    );
  }
  statements.push("COMMIT TRANSACTION;");
  return statements.join("\n");
}

/** Recomputes the erased days' aggregates from the facts that survived the erasure. */
export function buildViewRecomputeQuery(
  projectId: string,
  config: AnalyticsWarehouseConfig,
  factsSchema: BigQuerySchemaField[] = [],
): string {
  return [
    "BEGIN TRANSACTION;",
    `CREATE TEMP TABLE affected_dates AS SELECT DISTINCT CAST(day AS ${affectedDateCastType(factsSchema)}) AS date FROM UNNEST(@dates) AS day;`,
    buildDailyViewsStatement(bigQueryTableRef(projectId, config.tables.analyticsFacts)),
    ...buildViewSwapStatements(bigQueryTableRef(projectId, config.tables.analyticsViews)),
    "COMMIT TRANSACTION;",
  ].join("\n");
}

export function analyticsWarehouseGovernanceFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsWarehouseGovernanceTarget {
  // Mirrors analyticsWarehouseTargetFromEnv: no erasure target without a BigQuery warehouse.
  const provider = env.ANALYTICS_WAREHOUSE_TARGET || "local_json";
  if (provider === "bigquery_batch" || provider === "bigquery_insert_all") {
    const report = analyticsBigQueryReportConfigFromEnv(env);
    return new BigQueryWarehouseGovernanceTarget(env.ANALYTICS_WAREHOUSE_PROJECT_ID || env.GCP_PROJECT_ID || "local", {
      config: analyticsWarehouseConfigFromEnv(env),
      apiBaseUrl: report.apiBaseUrl,
      maximumBytesBilled: report.maximumBytesBilled,
    });
  }
  return new DisabledWarehouseGovernanceTarget();
}

/**
 * The staged dates must match `analytics_facts.occurredDate` for
 * `WHERE occurredDate IN (SELECT date FROM affected_dates)` to compare like with
 * like, so the cast follows the fetched column type exactly as the batch
 * projection does. The real schemas live in resonate-iac and are only known at
 * run time; DATE is the fallback for the documented type when the column is
 * missing from the fetched schema.
 */
function affectedDateCastType(factsSchema: BigQuerySchemaField[]) {
  const field = factsSchema.find((candidate) => candidate.name === "occurredDate");
  return field ? bigQueryCastType(field.type) : "DATE";
}

function distinct(values: string[]) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function chunked<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function arrayParameter(name: string, values: string[]): BigQueryJobParameter {
  return {
    name,
    parameterType: { type: "ARRAY", arrayType: { type: "STRING" } },
    parameterValue: { arrayValues: values.map((value) => ({ value })) },
  };
}

function stringParameter(name: string, value: string): BigQueryJobParameter {
  return { name, parameterType: { type: "STRING" }, parameterValue: { value } };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
