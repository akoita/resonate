import { Inject, Injectable } from "@nestjs/common";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { GoogleAuth } from "google-auth-library";
import { dirname, join, resolve } from "path";
import { AnalyticsEventListFilters, AnalyticsEventStore, ANALYTICS_EVENT_STORE } from "./analytics_event_store";
import {
  AnalyticsWarehouseExport,
  analyticsWarehouseConfigFromEnv,
  buildAnalyticsWarehouseExport,
} from "./analytics_warehouse";

export const ANALYTICS_WAREHOUSE_TARGET = Symbol("ANALYTICS_WAREHOUSE_TARGET");

export type AnalyticsWarehouseLayerName =
  | "eventsRaw"
  | "eventsClean"
  | "analyticsFacts"
  | "analyticsViews"
  | "analyticsQuarantine";

export interface AnalyticsWarehouseLoadRequest {
  from?: string;
  to?: string;
  eventFamily?: string;
  runId?: string;
  dryRun?: boolean;
}

export interface AnalyticsWarehouseTargetDescription {
  provider: string;
  location: string;
}

export interface AnalyticsWarehouseLayerLoadResult {
  layer: AnalyticsWarehouseLayerName;
  table: string;
  rows: number;
  inserted: number;
  skipped: number;
}

export interface AnalyticsWarehouseTarget {
  describe(): AnalyticsWarehouseTargetDescription;
  load(exportPayload: AnalyticsWarehouseExport, context: AnalyticsWarehouseLoadContext): Promise<AnalyticsWarehouseLayerLoadResult[]>;
}

export interface AnalyticsWarehouseLoadContext {
  runId: string;
  generatedAt: string;
  filters: AnalyticsEventListFilters;
}

export interface AnalyticsWarehouseLoadResult {
  status: "ok" | "dry_run";
  runId: string;
  target: AnalyticsWarehouseTargetDescription;
  generatedAt: string;
  filters: {
    from?: string;
    to?: string;
    eventFamily?: string;
  };
  eventsRead: number;
  layers: {
    eventsRaw: number;
    eventsClean: number;
    analyticsFacts: number;
    analyticsViews: number;
    analyticsQuarantine: number;
  };
  writes: AnalyticsWarehouseLayerLoadResult[];
  metrics: {
    insertedRows: number;
    skippedRows: number;
    quarantinedRows: number;
    schemaIncompatibleRows: number;
  };
}

type LayerRows = AnalyticsWarehouseExport[AnalyticsWarehouseLayerName];

@Injectable()
export class AnalyticsWarehouseLoaderService {
  constructor(
    @Inject(ANALYTICS_EVENT_STORE)
    private readonly eventStore: AnalyticsEventStore,
    @Inject(ANALYTICS_WAREHOUSE_TARGET)
    private readonly warehouseTarget: AnalyticsWarehouseTarget,
  ) {}

  async load(request: AnalyticsWarehouseLoadRequest = {}): Promise<AnalyticsWarehouseLoadResult> {
    const filters = requestToFilters(request);
    const generatedAt = new Date();
    const runId = request.runId ?? `analytics_load_${generatedAt.toISOString().replace(/[:.]/g, "-")}`;
    const events = await this.eventStore.listEvents(filters);
    const exportPayload = buildAnalyticsWarehouseExport(events, {
      generatedAt,
      config: analyticsWarehouseConfigFromEnv(),
      supportedEventVersions: supportedEventVersionsFromEnv(),
    });

    const writes = request.dryRun
      ? dryRunWrites(exportPayload)
      : await this.warehouseTarget.load(exportPayload, {
          runId,
          generatedAt: exportPayload.generatedAt,
          filters,
        });

    return {
      status: request.dryRun ? "dry_run" : "ok",
      runId,
      target: this.warehouseTarget.describe(),
      generatedAt: exportPayload.generatedAt,
      filters: {
        from: filters.occurredFrom?.toISOString(),
        to: filters.occurredTo?.toISOString(),
        eventFamily: filters.eventFamily,
      },
      eventsRead: events.length,
      layers: layerCounts(exportPayload),
      writes,
      metrics: {
        insertedRows: writes.reduce((total, write) => total + write.inserted, 0),
        skippedRows: writes.reduce((total, write) => total + write.skipped, 0),
        quarantinedRows: exportPayload.analyticsQuarantine.length,
        schemaIncompatibleRows: exportPayload.analyticsQuarantine.filter((row) =>
          row.reason.startsWith("unsupported event version:"),
        ).length,
      },
    };
  }

  async backfill(request: AnalyticsWarehouseLoadRequest = {}) {
    return this.load(request);
  }
}

export class LocalJsonAnalyticsWarehouseTarget implements AnalyticsWarehouseTarget {
  constructor(private readonly baseDir = analyticsWarehouseLocalDirFromEnv()) {}

  describe() {
    return {
      provider: "local_json",
      location: this.baseDir,
    };
  }

  async load(exportPayload: AnalyticsWarehouseExport): Promise<AnalyticsWarehouseLayerLoadResult[]> {
    const layers = layerEntries(exportPayload);
    const results: AnalyticsWarehouseLayerLoadResult[] = [];

    for (const layer of layers) {
      const table = exportPayload.config.tables[layer.layer];
      const filePath = join(this.baseDir, `${table.replace(/[./]/g, "_")}.jsonl`);
      const result = await upsertJsonlRows(filePath, layer.rows, rowKey(layer.layer));
      results.push({
        layer: layer.layer,
        table,
        rows: layer.rows.length,
        inserted: result.inserted,
        skipped: result.skipped,
      });
    }

    return results;
  }
}

export class BigQueryInsertAllAnalyticsWarehouseTarget implements AnalyticsWarehouseTarget {
  private readonly auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/bigquery.insertdata"],
  });

  constructor(private readonly projectId = analyticsWarehouseConfigFromEnv().projectId) {}

  describe() {
    return {
      provider: "bigquery_insert_all",
      location: this.projectId,
    };
  }

  async load(exportPayload: AnalyticsWarehouseExport): Promise<AnalyticsWarehouseLayerLoadResult[]> {
    const client = await this.auth.getClient();
    const results: AnalyticsWarehouseLayerLoadResult[] = [];

    for (const layer of layerEntries(exportPayload)) {
      const table = exportPayload.config.tables[layer.layer];
      const { datasetId, tableId } = parseBigQueryTable(table);
      let inserted = 0;

      for (const chunk of chunkRows(layer.rows as unknown as Array<Record<string, unknown>>, 500)) {
        if (chunk.length === 0) {
          continue;
        }

        const response = await client.request<{ insertErrors?: Array<{ index: number; errors: unknown[] }> }>({
          url: `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(
            this.projectId,
          )}/datasets/${encodeURIComponent(datasetId)}/tables/${encodeURIComponent(tableId)}/insertAll`,
          method: "POST",
          data: {
            kind: "bigquery#tableDataInsertAllRequest",
            skipInvalidRows: false,
            ignoreUnknownValues: false,
            rows: chunk.map((row) => ({
              insertId: rowKey(layer.layer)(row),
              json: toBigQueryInsertAllJson(layer.layer, row),
            })),
          },
        });

        if (response.data.insertErrors?.length) {
          throw new Error(
            `BigQuery insertAll failed for ${table}: ${JSON.stringify(response.data.insertErrors.slice(0, 5))}`,
          );
        }

        inserted += chunk.length;
      }

      results.push({
        layer: layer.layer,
        table,
        rows: layer.rows.length,
        inserted,
        skipped: 0,
      });
    }

    return results;
  }
}

export function analyticsWarehouseTargetFromEnv(env: NodeJS.ProcessEnv = process.env): AnalyticsWarehouseTarget {
  const provider = env.ANALYTICS_WAREHOUSE_TARGET || "local_json";
  if (provider === "local_json") {
    return new LocalJsonAnalyticsWarehouseTarget(analyticsWarehouseLocalDirFromEnv(env));
  }
  if (provider === "bigquery_insert_all") {
    return new BigQueryInsertAllAnalyticsWarehouseTarget(
      env.ANALYTICS_WAREHOUSE_PROJECT_ID || env.GCP_PROJECT_ID || "local",
    );
  }
  throw new Error(`Unsupported ANALYTICS_WAREHOUSE_TARGET "${provider}". Supported: local_json, bigquery_insert_all`);
}

export function analyticsWarehouseLocalDirFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return resolve(env.ANALYTICS_WAREHOUSE_LOCAL_DIR || ".analytics/warehouse");
}

export function supportedEventVersionsFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.ANALYTICS_WAREHOUSE_SUPPORTED_EVENT_VERSIONS || "1";
  const versions = raw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return versions.length > 0 ? versions : [1];
}

export function toBigQueryInsertAllJson(
  layer: AnalyticsWarehouseLayerName,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const jsonFields = bigQueryJsonFieldsByLayer[layer];
  if (!jsonFields?.length) {
    return row;
  }

  const encoded = { ...row };
  for (const field of jsonFields) {
    if (field in encoded && encoded[field] !== undefined) {
      encoded[field] = JSON.stringify(encoded[field]);
    }
  }
  return encoded;
}

const bigQueryJsonFieldsByLayer: Record<AnalyticsWarehouseLayerName, readonly string[]> = {
  eventsRaw: ["payload", "sourceRefs", "envelope"],
  eventsClean: ["payload"],
  analyticsFacts: ["dimensions"],
  analyticsViews: [],
  analyticsQuarantine: ["raw"],
};

function requestToFilters(request: AnalyticsWarehouseLoadRequest): AnalyticsEventListFilters {
  return {
    occurredFrom: parseOptionalDate(request.from, "from"),
    occurredTo: parseOptionalDate(request.to, "to"),
    eventFamily: request.eventFamily,
  };
}

function parseOptionalDate(value: string | undefined, field: string) {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid analytics warehouse ${field} timestamp: ${value}`);
  }
  return parsed;
}

function layerCounts(exportPayload: AnalyticsWarehouseExport) {
  return {
    eventsRaw: exportPayload.eventsRaw.length,
    eventsClean: exportPayload.eventsClean.length,
    analyticsFacts: exportPayload.analyticsFacts.length,
    analyticsViews: exportPayload.analyticsViews.length,
    analyticsQuarantine: exportPayload.analyticsQuarantine.length,
  };
}

function dryRunWrites(exportPayload: AnalyticsWarehouseExport): AnalyticsWarehouseLayerLoadResult[] {
  return layerEntries(exportPayload).map((layer) => ({
    layer: layer.layer,
    table: exportPayload.config.tables[layer.layer],
    rows: layer.rows.length,
    inserted: 0,
    skipped: layer.rows.length,
  }));
}

function layerEntries(exportPayload: AnalyticsWarehouseExport): Array<{
  layer: AnalyticsWarehouseLayerName;
  rows: LayerRows;
}> {
  return [
    { layer: "eventsRaw", rows: exportPayload.eventsRaw },
    { layer: "eventsClean", rows: exportPayload.eventsClean },
    { layer: "analyticsFacts", rows: exportPayload.analyticsFacts },
    { layer: "analyticsViews", rows: exportPayload.analyticsViews },
    { layer: "analyticsQuarantine", rows: exportPayload.analyticsQuarantine },
  ];
}

function rowKey(layer: AnalyticsWarehouseLayerName) {
  return (row: Record<string, unknown>) => {
    switch (layer) {
      case "eventsRaw":
      case "eventsClean":
        return String(row.eventId);
      case "analyticsFacts":
        return String(row.factId);
      case "analyticsViews":
        return [row.viewName, row.grain, row.date, row.eventName, row.artistId, row.trackId].join("|");
      case "analyticsQuarantine":
        return [row.eventId ?? "unknown", row.eventName ?? "unknown", row.reason].join("|");
    }
  };
}

function parseBigQueryTable(table: string) {
  const [datasetId, tableId] = table.split(".");
  if (!datasetId || !tableId) {
    throw new Error(`Invalid analytics warehouse BigQuery table name: ${table}`);
  }
  return { datasetId, tableId };
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

async function upsertJsonlRows(
  filePath: string,
  rows: LayerRows,
  keyForRow: (row: Record<string, unknown>) => string,
) {
  await mkdir(dirname(filePath), { recursive: true });
  const existing = await readJsonlMap(filePath, keyForRow);
  let inserted = 0;
  let skipped = 0;

  for (const row of rows as unknown as Array<Record<string, unknown>>) {
    const key = keyForRow(row);
    if (existing.has(key)) {
      skipped += 1;
      continue;
    }
    existing.set(key, row);
    inserted += 1;
  }

  const body = [...existing.values()].map((row) => JSON.stringify(row)).join("\n");
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, body ? `${body}\n` : "", "utf8");
  await rename(tmpPath, filePath);
  return { inserted, skipped };
}

async function readJsonlMap(filePath: string, keyForRow: (row: Record<string, unknown>) => string) {
  const rows = new Map<string, Record<string, unknown>>();
  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return rows;
    }
    throw error;
  }

  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const row = JSON.parse(line) as Record<string, unknown>;
    rows.set(keyForRow(row), row);
  }
  return rows;
}
