import { BigQueryBatchAnalyticsWarehouseTarget, buildBatchQuery, validateBatchBounds, BatchSchemas } from "../modules/analytics/analytics_bigquery_batch";
import { buildAnalyticsWarehouseExport } from "../modules/analytics/analytics_warehouse";

const request = jest.fn();
jest.mock("google-auth-library", () => ({ GoogleAuth: jest.fn().mockImplementation(() => ({ getClient: async () => ({ request }) })) }));
const date = "2026-09-06T01:00:00.000Z";
const payload = buildAnalyticsWarehouseExport([{ eventId: "test", eventName: "playback.completed", eventVersion: 1,
  occurredAt: date, receivedAt: date, producer: "test", environment: "staging", privacyTier: "anonymous", payload: {} }]);
const context = { runId: "run", generatedAt: date, filters: { occurredFrom: new Date("2026-09-06"), occurredTo: new Date("2026-09-07") } };
const jsonFields = new Set(["payload", "sourceRefs", "envelope", "dimensions", "raw"]);
const schemas = Object.fromEntries(Object.entries(payload).filter(([, rows]) => Array.isArray(rows)).map(([layer, rows]) => [layer,
  Object.keys((rows as any[])[0] ?? { eventId: "", eventName: "", reason: "", receivedAt: "", raw: {} }).map(name => ({ name,
    type: jsonFields.has(name) ? "JSON" : ["eventVersion", "count", "eventCount", "playCount"].includes(name) ? "INTEGER" :
      ["canonicalAmountUsd", "payoutUsd"].includes(name) ? "FLOAT" : ["occurredAt", "receivedAt"].includes(name) ? "TIMESTAMP" :
      ["date", "occurredDate"].includes(name) ? "DATE" : "STRING" }))])) as BatchSchemas;

beforeEach(() => request.mockReset());
function prepareJob(error?: string) {
  request.mockImplementation(async (input: any) => {
    if (input.url.includes("/tables/")) {
      const name = input.url.split("/").pop();
      const layer = Object.entries(payload.config.tables).find(([, value]) => value.endsWith(`.${name}`))![0] as keyof BatchSchemas;
      return { data: { schema: { fields: schemas[layer] }, location: "EU" } };
    }
    if (input.url.endsWith("/jobs")) return { data: {} };
    if (input.url.includes("/jobs/")) return { data: { status: { state: "DONE", ...(error ? { errorResult: { reason: error } } : {}) } } };
    return { data: { rows: Object.keys(schemas).map(layer => ({ f: [layer, "1", "1", "0"].map(v => ({ v })) })) } };
  });
}

describe("transactional BigQuery batch writer", () => {
  it("parameterizes payloads and repairs keys before recomputing complete daily totals", () => {
    const sql = buildBatchQuery("test-project", payload, schemas);
    expect(sql).toContain("PARSE_JSON(@eventsRaw)");
    expect(sql).toContain("BEGIN TRANSACTION;");
    expect(sql).toContain("PARTITION BY factId");
    expect(sql).toContain("COMMIT TRANSACTION;");
    expect(sql).not.toContain('"producer":"test"');
    expect(sql).toContain("FROM `test-project.analytics_local.analytics_facts`");
  });
  it("fails closed on schema drift and unsafe identifiers", () => {
    expect(() => buildBatchQuery("project`; DELETE", payload, schemas)).toThrow("identifier");
    expect(() => buildBatchQuery("project", payload, { ...schemas, eventsRaw: [] })).toThrow("missing column");
  });
  it("requires bounded dates and bounded payload size", () => {
    expect(() => validateBatchBounds(payload, { ...context, filters: {} })).toThrow("from/to");
    expect(() => validateBatchBounds({ ...payload, eventsRaw: Array(10001).fill(payload.eventsRaw[0]) }, context)).toThrow("10000");
  });
  it("reports success only after the transaction finishes and evidence is read", async () => {
    prepareJob();
    const result = await new BigQueryBatchAnalyticsWarehouseTarget("project").load(payload, context);
    expect(result).toHaveLength(5);
    const submitted = request.mock.calls.find(([input]) => input.url.endsWith("/jobs"))![0];
    expect(submitted.data.configuration.query.maximumBytesBilled).toBe("500000000");
    expect(submitted.data.configuration.query.queryParameters[0].parameterValue.value).toBe(JSON.stringify(payload.eventsRaw));
  });
  it("does not report a failed transaction as a successful batch", async () => {
    prepareJob("invalidQuery");
    await expect(new BigQueryBatchAnalyticsWarehouseTarget("project").load(payload, context)).rejects.toThrow("invalidQuery");
  });
});
