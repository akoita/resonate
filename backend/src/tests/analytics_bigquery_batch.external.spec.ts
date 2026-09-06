import { GoogleAuth } from "google-auth-library";
import { randomUUID } from "crypto";
import { BigQueryBatchAnalyticsWarehouseTarget } from "../modules/analytics/analytics_bigquery_batch";
import { analyticsWarehouseConfigFromEnv, buildAnalyticsWarehouseExport } from "../modules/analytics/analytics_warehouse";

// Explicit opt-in. Only synthetic rows are written, in an isolated expiring dataset.
const project = process.env.ANALYTICS_BATCH_TEST_PROJECT;
const sourceDataset = process.env.ANALYTICS_BATCH_TEST_SCHEMA_DATASET;
const external = project && sourceDataset ? describe : describe.skip;
external("BigQuery batch live contract", () => {
  const dataset = `analytics_batch_test_${randomUUID().replace(/-/g, "")}`;
  const api = `https://bigquery.googleapis.com/bigquery/v2/projects/${project}`;
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/bigquery"] });
  let client: Awaited<ReturnType<GoogleAuth["getClient"]>>;
  let created = false;
  let location: string;
  const config = analyticsWarehouseConfigFromEnv({ ANALYTICS_WAREHOUSE_PROJECT_ID: project, ANALYTICS_WAREHOUSE_DATASET_PREFIX: dataset });
  const from = new Date("2026-09-06T00:00:00Z");
  const to = new Date("2026-09-07T00:00:00Z");
  const context = { runId: "external-test", generatedAt: from.toISOString(), filters: { occurredFrom: from, occurredTo: to } };
  const event = (id: string) => ({ eventId: id, eventName: "playback.completed", eventVersion: 1,
    occurredAt: "2026-09-06T01:00:00.000Z", receivedAt: "2026-09-06T01:00:01.000Z", producer: "synthetic-contract-test",
    environment: "staging", privacyTier: "anonymous", payload: { artistId: "test-artist", trackId: "test-track" } });
  beforeAll(async () => {
    client = await auth.getClient();
    const source = await client.request<any>({ url: `${api}/datasets/${sourceDataset}` });
    location = source.data.location;
    await client.request({ url: `${api}/datasets`, method: "POST", data: {
      datasetReference: { projectId: project, datasetId: dataset }, location, defaultTableExpirationMs: "3600000",
      labels: { purpose: "analytics-batch-test" },
    } });
    created = true;
    for (const value of Object.values(config.tables)) {
      const table = value.split(".")[1];
      const sourceTable = await client.request<any>({ url: `${api}/datasets/${sourceDataset}/tables/${table}` });
      await client.request({ url: `${api}/datasets/${dataset}/tables`, method: "POST", data: {
        tableReference: { projectId: project, datasetId: dataset, tableId: table }, schema: sourceTable.data.schema,
      } });
    }
  }, 120000);
  afterAll(async () => {
    if (created) await client.request({ url: `${api}/datasets/${dataset}`, method: "DELETE", params: { deleteContents: true } });
  }, 30000);
  async function query(sql: string) {
    const r = await client.request<any>({ url: `${api}/queries`, method: "POST", data: {
      query: sql, useLegacySql: false, location, timeoutMs: 200000, maximumBytesBilled: "500000000",
    } });
    expect(r.data.jobComplete).toBe(true);
    return r.data.rows.map((row: any) => row.f.map((cell: any) => cell.v));
  }
  it("keeps counts stable across reruns, overlapping windows, and a rolled-back failure", async () => {
    const target = new BigQueryBatchAnalyticsWarehouseTarget(project!);
    const first = buildAnalyticsWarehouseExport([event("first")], { config });
    await target.load(first, context);
    await target.load(first, context);
    const later = buildAnalyticsWarehouseExport([event("later")], { config });
    await target.load(later, context);
    await target.load(buildAnalyticsWarehouseExport([event("first"), event("later"), event("first")], { config }), context);
    expect(await query(`SELECT COUNT(*), COUNT(DISTINCT factId) FROM \`${project}.${dataset}.analytics_facts\``)).toEqual([["2", "2"]]);
    expect(await query(`SELECT eventCount, playCount FROM \`${project}.${dataset}.analytics_views\``)).toEqual([["2", "2"]]);
    const broken = buildAnalyticsWarehouseExport([event("broken")], { config });
    (broken.analyticsFacts[0] as any).count = "not-a-number";
    await expect(target.load(broken, context)).rejects.toThrow("failed");
    expect(await query(`SELECT COUNT(*) FROM \`${project}.${dataset}.events_raw\``)).toEqual([["2"]]);
    expect(await query(`SELECT COUNT(*) FROM \`${project}.${dataset}.analytics_facts\``)).toEqual([["2"]]);
  }, 240000);
});
