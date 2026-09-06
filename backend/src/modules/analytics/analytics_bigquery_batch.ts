import { randomUUID } from "crypto";
import { analyticsBigQueryReportConfigFromEnv } from "./analytics_bigquery_report";
import { GoogleAuth } from "google-auth-library";
import type { AnalyticsWarehouseExport } from "./analytics_warehouse";
import type { AnalyticsWarehouseTarget, AnalyticsWarehouseLoadContext, AnalyticsWarehouseLayerLoadResult,
  AnalyticsWarehouseLayerName } from "./analytics_warehouse_loader";

interface Field { name: string; type: string; mode?: string }
export type BatchSchemas = Record<AnalyticsWarehouseLayerName, Field[]>;
const layers: AnalyticsWarehouseLayerName[] = ["eventsRaw", "eventsClean", "analyticsFacts", "analyticsViews", "analyticsQuarantine"];
const keys: Record<AnalyticsWarehouseLayerName, string[]> = {
  eventsRaw: ["eventId"], eventsClean: ["eventId"], analyticsFacts: ["factId"],
  analyticsViews: ["viewName", "grain", "date", "eventName", "artistId", "trackId"],
  analyticsQuarantine: ["eventId", "eventName", "reason"],
};
const api = `${analyticsBigQueryReportConfigFromEnv().apiBaseUrl.replace(/\/$/, "")}/bigquery/v2`;

/** Opt-in batch writer. Callers must serialize loads and stop streaming writers first. */
export class BigQueryBatchAnalyticsWarehouseTarget implements AnalyticsWarehouseTarget {
  private readonly auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/bigquery"] });
  constructor(private readonly projectId: string, private readonly maximumBytesBilled = analyticsBigQueryReportConfigFromEnv().maximumBytesBilled) {}
  describe() { return { provider: "bigquery_batch", location: this.projectId }; }

  async load(payload: AnalyticsWarehouseExport, context: AnalyticsWarehouseLoadContext): Promise<AnalyticsWarehouseLayerLoadResult[]> {
    validateBatchBounds(payload, context);
    if (!layers.some(layer => payload[layer].length)) return [];
    const client = await this.auth.getClient();
    const schemas = {} as BatchSchemas;
    let location: string | undefined;
    for (const layer of layers) {
      const [dataset, table] = tableParts(payload.config.tables[layer]);
      const response = await client.request<{ schema: { fields: Field[] }; location?: string }>({
        url: `${api}/projects/${encodeURIComponent(this.projectId)}/datasets/${dataset}/tables/${table}`,
      });
      schemas[layer] = response.data.schema.fields;
      if (location && response.data.location && location !== response.data.location) throw new Error("Batch tables must share a location");
      location = response.data.location ?? location;
    }
    const query = buildBatchQuery(this.projectId, payload, schemas);
    const jobId = `analytics_batch_${randomUUID().replace(/-/g, "")}`;
    const jobUrl = `${api}/projects/${encodeURIComponent(this.projectId)}/jobs/${jobId}`;
    // A fixed job ID allows transport retries without submitting the transaction twice.
    const job = {
      jobReference: { projectId: this.projectId, jobId, location },
      configuration: { jobTimeoutMs: "240000", query: { query, useLegacySql: false, useQueryCache: false,
        maximumBytesBilled: this.maximumBytesBilled, parameterMode: "NAMED",
        queryParameters: layers.filter(layer => layer !== "analyticsViews").map(layer => ({ name: layer,
          parameterType: { type: "STRING" }, parameterValue: { value: JSON.stringify(payload[layer]) } })),
      } },
    };
    if (Buffer.byteLength(JSON.stringify(job)) > 9_000_000) throw new Error("Encoded batch request exceeds 9 MB; split the window");
    await client.request({ url: `${api}/projects/${encodeURIComponent(this.projectId)}/jobs`, method: "POST", data: job });
    // A submitted job is not a successful load. Wait for the atomic transaction outcome.
    for (let attempt = 0; attempt < 150; attempt++) {
      const result = await client.request<{ status: { state: string; errorResult?: { reason?: string } } }>({
        url: jobUrl, params: { location },
      });
      if (result.data.status.state === "DONE") {
        if (result.data.status.errorResult) throw new Error(`BigQuery batch ${jobId} failed: ${result.data.status.errorResult.reason ?? "query error"}`);
        const results = await client.request<{ rows?: Array<{ f: Array<{ v: string }> }> }>({
          url: `${api}/projects/${encodeURIComponent(this.projectId)}/queries/${jobId}`, params: { location },
        });
        if (results.data.rows?.length !== layers.length) throw new Error(`BigQuery batch ${jobId} returned incomplete load evidence`);
        return results.data.rows.map(row => {
          const [layer, rows, inserted, updated] = row.f.map(cell => cell.v);
          return { layer: layer as AnalyticsWarehouseLayerName, table: payload.config.tables[layer as AnalyticsWarehouseLayerName],
            rows: Number(rows), inserted: Number(inserted), updated: Number(updated), skipped: 0 };
        });
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    await client.request({ url: `${jobUrl}/cancel`, method: "POST", params: { location } });
    throw new Error(`BigQuery batch ${jobId} did not finish; inspect job state before retrying`);
  }
}

export function validateBatchBounds(payload: AnalyticsWarehouseExport, context: AnalyticsWarehouseLoadContext) {
  const { occurredFrom: from, occurredTo: to } = context.filters;
  if (!from || !to || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) ||
      to <= from || to.getTime() - from.getTime() > 31 * 86400000) {
    throw new Error("BigQuery batch requires a positive from/to window of at most 31 days");
  }
  if (payload.eventsRaw.length + payload.analyticsQuarantine.length > 10000 || Buffer.byteLength(JSON.stringify(payload)) > 8_000_000) {
    throw new Error("BigQuery batch exceeds 10000 events or 8 MB; split the requested window");
  }
  for (const row of payload.eventsRaw) {
    const occurred = new Date(row.occurredAt);
    if (occurred < from || occurred >= to) throw new Error("Batch event falls outside the requested window");
  }
}

export function buildBatchQuery(project: string, payload: AnalyticsWarehouseExport, schemas: BatchSchemas): string {
  identifier(project);
  const table = (layer: AnalyticsWarehouseLayerName) => {
    const [dataset, name] = tableParts(payload.config.tables[layer]);
    return `\`${project}.${dataset}.${name}\``;
  };
  const statements = ["BEGIN TRANSACTION;", "CREATE TEMP TABLE load_results (layer STRING, row_count INT64, inserted INT64, updated INT64);"];
  for (const layer of layers.filter(layer => layer !== "analyticsViews")) {
    const fields = schemas[layer];
    const names = new Set(fields.map(field => field.name));
    for (const row of payload[layer]) {
      for (const [name, value] of Object.entries(row)) {
        if (value !== undefined && !names.has(name)) throw new Error(`Warehouse schema ${layer} is missing column ${name}`);
      }
    }
    for (const key of keys[layer]) if (!names.has(key)) throw new Error(`Warehouse schema ${layer} is missing key ${key}`);
    const columns = fields.map(field => `\`${identifier(field.name)}\``).join(", ");
    const projection = fields.map(field => `${jsonColumn(field)} AS \`${field.name}\``).join(",\n");
    statements.push(`CREATE TEMP TABLE source_${layer} AS SELECT ${projection}\nFROM UNNEST(JSON_QUERY_ARRAY(PARSE_JSON(@${layer}))) AS row;`);
    // Defensive de-duplication also covers malformed repeated quarantine records.
    statements.push(`CREATE TEMP TABLE unique_${layer} AS SELECT * FROM source_${layer}
QUALIFY ROW_NUMBER() OVER (PARTITION BY ${keys[layer].map(key => `\`${key}\``).join(", ")}) = 1;`);
    const keyExpression = (alias: string) => `TO_JSON_STRING(STRUCT(${keys[layer].map(key => `${alias}.\`${key}\` AS \`${key}\``).join(", ")}))`;
    const match = `${keyExpression("T")} = ${keyExpression("S")}`;
    statements.push(`INSERT INTO load_results SELECT '${layer}', COUNT(*), COUNTIF(NOT EXISTS (SELECT 1 FROM ${table(layer)} T WHERE ${match})), COUNTIF(EXISTS (SELECT 1 FROM ${table(layer)} T WHERE ${match})) FROM unique_${layer} S;`);
    // Replaces matching keys, repairing historical duplicates and refreshed/redacted rows.
    statements.push(`DELETE FROM ${table(layer)} T WHERE EXISTS (SELECT 1 FROM unique_${layer} S WHERE ${match});`);
    statements.push(`INSERT INTO ${table(layer)} (${columns}) SELECT ${columns} FROM unique_${layer};`);
  }
  // Recompute complete affected days from durable facts, not just this load's window.
  const facts = table("analyticsFacts");
  const views = table("analyticsViews");
  statements.push(`CREATE TEMP TABLE affected_dates AS SELECT DISTINCT occurredDate AS date FROM unique_analyticsFacts;
CREATE TEMP TABLE daily_views AS
WITH facts AS (
  SELECT * FROM ${facts} WHERE occurredDate IN (SELECT date FROM affected_dates)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY factId ORDER BY occurredAt) = 1
)
SELECT 'daily_event_artist_track' AS viewName, 'day_event_artist_track' AS grain,
 occurredDate AS date, JSON_VALUE(dimensions, '$.eventName') AS eventName,
 COALESCE(artistId, 'unknown') AS artistId, COALESCE(trackId, 'unknown') AS trackId,
 SUM(count) AS eventCount,
 SUM(IF(JSON_VALUE(dimensions, '$.eventName') IN ('license.granted', 'playback.completed'), count, 0)) AS playCount,
 SUM(IF(JSON_VALUE(dimensions, '$.eventName') IN ('payment.settled', 'commerce.settled'), COALESCE(canonicalAmountUsd, 0), 0)) AS payoutUsd
FROM facts GROUP BY 3, 4, 5, 6;
INSERT INTO load_results SELECT 'analyticsViews', COUNT(*),
 COUNTIF(NOT EXISTS (SELECT 1 FROM ${views} T WHERE T.date = S.date AND T.eventName = S.eventName AND T.artistId = S.artistId AND T.trackId = S.trackId)),
 COUNTIF(EXISTS (SELECT 1 FROM ${views} T WHERE T.date = S.date AND T.eventName = S.eventName AND T.artistId = S.artistId AND T.trackId = S.trackId)) FROM daily_views S;
DELETE FROM ${views} WHERE date IN (SELECT date FROM affected_dates);
INSERT INTO ${views} (viewName, grain, date, eventName, artistId, trackId, eventCount, playCount, payoutUsd)
SELECT viewName, grain, date, eventName, artistId, trackId, eventCount, playCount, payoutUsd FROM daily_views;
COMMIT TRANSACTION;
SELECT layer, row_count, inserted, updated FROM load_results;`);
  return statements.join("\n");
}

function identifier(value: string) {
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(value)) throw new Error("Invalid BigQuery batch identifier");
  return value;
}
function tableParts(value: string) {
  const parts = value.split(".");
  if (parts.length !== 2) throw new Error("Expected dataset.table for BigQuery batch");
  return parts.map(identifier);
}
function jsonColumn(field: Field) {
  identifier(field.name);
  if (field.mode === "REPEATED") throw new Error("Repeated warehouse columns are not supported by batch projection");
  const types: Record<string, string> = { STRING: "STRING", INTEGER: "INT64", INT64: "INT64", FLOAT: "FLOAT64", FLOAT64: "FLOAT64",
    BOOLEAN: "BOOL", BOOL: "BOOL", TIMESTAMP: "TIMESTAMP", DATE: "DATE", NUMERIC: "NUMERIC" };
  if (field.type === "JSON") return `JSON_QUERY(row, '$.${field.name}')`;
  const type = types[field.type];
  if (!type) throw new Error(`Unsupported warehouse column type ${field.type}`);
  return `CAST(JSON_VALUE(row, '$.${field.name}') AS ${type})`;
}
