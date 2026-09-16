import {
  BigQueryWarehouseGovernanceTarget,
  DisabledWarehouseGovernanceTarget,
  WarehouseGovernanceHttpRequest,
  analyticsWarehouseGovernanceFromEnv,
  buildViewRecomputeQuery,
} from "../modules/analytics/analytics_warehouse_governance";
import { analyticsWarehouseConfigFromEnv, buildAnalyticsWarehouseExport } from "../modules/analytics/analytics_warehouse";

jest.mock("google-auth-library", () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({ getClient: async () => ({ request: jest.fn() }) })),
}));

const config = analyticsWarehouseConfigFromEnv({
  ANALYTICS_WAREHOUSE_PROJECT_ID: "proj",
  ANALYTICS_WAREHOUSE_DATASET_PREFIX: "analytics_test",
});
const viewsTable = "`proj.analytics_test.analytics_views`";
const quarantineTable = "`proj.analytics_test.analytics_quarantine`";
const occurredAt = "2026-09-06T01:00:00.000Z";

function redactedEnvelope(eventId: string) {
  return {
    eventId,
    eventName: "commerce.settled",
    eventVersion: 1,
    occurredAt,
    receivedAt: occurredAt,
    producer: "analytics-api",
    environment: "staging",
    privacyTier: "personal",
    consentBasis: "test-consent:v1",
    subjectType: "track",
    subjectId: "[redacted]",
    actorId: "[redacted]",
    sessionId: "[redacted]",
    payload: { trackId: "track_1", artistId: "artist_1", canonicalAmountUsd: 9, userId: "[redacted]" },
  };
}

// Schemas mirror the columns the warehouse writers actually produce.
const jsonFields = new Set(["payload", "sourceRefs", "envelope", "dimensions"]);
const sample = buildAnalyticsWarehouseExport([redactedEnvelope("schema_sample")], { config });
const schemas = Object.fromEntries(
  (["eventsRaw", "eventsClean", "analyticsFacts"] as const).map((layer) => [
    layer,
    Object.keys(sample[layer][0]).map((name) => ({
      name,
      type: jsonFields.has(name)
        ? "JSON"
        : ["eventVersion", "count"].includes(name)
          ? "INTEGER"
          : ["canonicalAmountUsd"].includes(name)
            ? "FLOAT"
            : ["occurredAt", "receivedAt"].includes(name)
              ? "TIMESTAMP"
              : ["occurredDate"].includes(name)
                ? "DATE"
                : "STRING",
    })),
  ]),
) as Record<"eventsRaw" | "eventsClean" | "analyticsFacts", { name: string; type: string }[]>;

function fakeWarehouse(options: { failWith?: string } = {}) {
  const requests: WarehouseGovernanceHttpRequest[] = [];
  const jobs: any[] = [];
  const client = {
    async request<T>(input: WarehouseGovernanceHttpRequest): Promise<{ data: T }> {
      requests.push(input);
      if (input.url.includes("/tables/")) {
        const table = input.url.split("/").pop()!;
        const layer = (Object.entries(config.tables).find(([, value]) => value.endsWith(`.${table}`)) ?? [])[0] as
          | keyof typeof schemas
          | undefined;
        return { data: { schema: { fields: layer ? schemas[layer] : [] }, location: "EU" } } as unknown as { data: T };
      }
      if (input.url.endsWith("/jobs")) {
        jobs.push(input.data);
        return { data: {} as T };
      }
      return {
        data: {
          status: { state: "DONE", ...(options.failWith ? { errorResult: { message: options.failWith } } : {}) },
        } as unknown as T,
      };
    },
  };
  const target = new BigQueryWarehouseGovernanceTarget("proj", {
    config,
    apiBaseUrl: "https://bigquery.example",
    maximumBytesBilled: "500000000",
    auth: { getClient: async () => client },
    pollIntervalMs: 0,
  });
  const queries = () => jobs.map((job) => job.configuration.query.query as string);
  const parameters = (index: number) =>
    (jobs[index].configuration.query.queryParameters as any[]).reduce<Record<string, any>>((all, parameter) => {
      all[parameter.name] = parameter.parameterValue;
      return all;
    }, {});
  return { target, requests, jobs, queries, parameters };
}

describe("BigQuery analytics warehouse erasure", () => {
  it("deletes the person's rows from the three eventId-keyed layers only", async () => {
    const { target, queries, parameters } = fakeWarehouse();

    const result = await target.applyErasure({
      deleteEventIds: ["event_1", "event_2"],
      redactEventIds: [],
      redactedEnvelopes: [],
      affectedDates: ["2026-09-06"],
      reason: "user deletion request",
    });

    const [deleteQuery] = queries();
    expect(deleteQuery).toContain("BEGIN TRANSACTION;");
    expect(deleteQuery).toContain("DELETE FROM `proj.analytics_test.events_raw` WHERE eventId IN UNNEST(@ids);");
    expect(deleteQuery).toContain("DELETE FROM `proj.analytics_test.events_clean` WHERE eventId IN UNNEST(@ids);");
    expect(deleteQuery).toContain("DELETE FROM `proj.analytics_test.analytics_facts` WHERE eventId IN UNNEST(@ids);");
    expect(deleteQuery).toContain("COMMIT TRANSACTION;");
    expect(deleteQuery).not.toContain(viewsTable);
    expect(deleteQuery).not.toContain(quarantineTable);
    expect(parameters(0).ids.arrayValues).toEqual([{ value: "event_1" }, { value: "event_2" }]);
    expect(result).toEqual({ status: "ok", provider: "bigquery", deletedRows: 2, redactedRows: 0, statements: 2 });
  });

  it("recomputes the affected days from surviving facts instead of leaving stale aggregates", async () => {
    const { target, queries, parameters } = fakeWarehouse();

    await target.applyErasure({
      deleteEventIds: ["event_1"],
      redactEventIds: [],
      redactedEnvelopes: [],
      affectedDates: ["2026-09-06", "2026-09-07"],
      reason: "user deletion request",
    });

    const viewQuery = queries()[1];
    expect(viewQuery).toContain("CREATE TEMP TABLE affected_dates AS SELECT DISTINCT CAST(day AS DATE) AS date FROM UNNEST(@dates) AS day;");
    expect(viewQuery).toContain("FROM `proj.analytics_test.analytics_facts` WHERE occurredDate IN (SELECT date FROM affected_dates)");
    expect(viewQuery).toContain(`DELETE FROM ${viewsTable} WHERE date IN (SELECT date FROM affected_dates);`);
    expect(viewQuery).toContain(`INSERT INTO ${viewsTable} (viewName, grain, date, eventName, artistId, trackId, eventCount, playCount, payoutUsd)`);
    expect(viewQuery).toContain("FROM daily_views;");
    expect(parameters(1).dates.arrayValues).toEqual([{ value: "2026-09-06" }, { value: "2026-09-07" }]);
    expect(queries().some((query) => query.includes(quarantineTable))).toBe(false);
  });

  it("casts the recomputed dates to the real occurredDate column type", () => {
    const dateSchema = buildViewRecomputeQuery("proj", config, [{ name: "occurredDate", type: "DATE" }]);
    const stringSchema = buildViewRecomputeQuery("proj", config, [{ name: "occurredDate", type: "STRING" }]);

    expect(dateSchema).toContain("CAST(day AS DATE) AS date");
    expect(stringSchema).toContain("CAST(day AS STRING) AS date");
    expect(stringSchema).not.toContain("CAST(day AS DATE)");
    // A table whose fetched schema has no occurredDate falls back to the documented type.
    expect(buildViewRecomputeQuery("proj", config)).toContain("CAST(day AS DATE) AS date");
  });

  it("rebuilds redacted rows from the redacted envelopes and never writes derived view rows", async () => {
    const { target, queries, parameters } = fakeWarehouse();

    const result = await target.applyErasure({
      deleteEventIds: [],
      redactEventIds: ["event_1", "event_2"],
      redactedEnvelopes: [redactedEnvelope("event_1"), redactedEnvelope("event_2")],
      affectedDates: ["2026-09-06"],
      reason: "user deletion request",
    });

    const [mergeQuery] = queries();
    expect(mergeQuery).toContain("DELETE FROM `proj.analytics_test.events_clean` T WHERE EXISTS");
    expect(mergeQuery).toContain("INSERT INTO `proj.analytics_test.events_raw`");
    expect(mergeQuery).toContain("INSERT INTO `proj.analytics_test.analytics_facts`");
    expect(mergeQuery).not.toContain(viewsTable);
    expect(mergeQuery).not.toContain(quarantineTable);

    const merged = parameters(0);
    // The export also derives daily view rows; they must not be written, because a
    // view row aggregated from two events would overwrite a whole day's real totals.
    expect(merged.analyticsViews).toBeUndefined();
    expect(merged.analyticsQuarantine).toBeUndefined();

    const clean = JSON.parse(merged.eventsClean.value);
    expect(clean).toHaveLength(2);
    expect(clean[0]).toEqual(
      expect.objectContaining({
        eventId: "event_1",
        actorId: "[redacted]",
        subjectId: "[redacted]",
        sessionId: "[redacted]",
        trackId: "track_1",
        artistId: "artist_1",
        canonicalAmountUsd: 9,
      }),
    );
    const facts = JSON.parse(merged.analyticsFacts.value);
    expect(facts[0]).toEqual(expect.objectContaining({ subjectId: "[redacted]", trackId: "track_1" }));
    expect(facts[0].dimensions).toEqual(expect.objectContaining({ actorId: "[redacted]", sessionId: "[redacted]" }));
    expect(result).toEqual({ status: "ok", provider: "bigquery", deletedRows: 0, redactedRows: 2, statements: 2 });
  });

  it("refuses a redaction merge it cannot rebuild instead of leaving un-redacted rows", async () => {
    const { target, jobs } = fakeWarehouse();

    await expect(
      target.applyErasure({
        deleteEventIds: [],
        redactEventIds: ["broken"],
        redactedEnvelopes: [{ eventId: "broken" }],
        affectedDates: ["2026-09-06"],
        reason: "user deletion request",
      }),
    ).rejects.toThrow("refusing a partial erasure");
    expect(jobs).toHaveLength(0);
  });

  it("chunks ids at 500 and runs each chunk as its own transaction", async () => {
    const { target, queries, parameters } = fakeWarehouse();
    const ids = Array.from({ length: 1200 }, (_, index) => `event_${index}`);

    const result = await target.applyErasure({
      deleteEventIds: ids,
      redactEventIds: [],
      redactedEnvelopes: [],
      affectedDates: ["2026-09-06"],
      reason: "user deletion request",
    });

    const deleteChunks = queries().filter((query) => query.includes("WHERE eventId IN UNNEST(@ids)"));
    expect(deleteChunks).toHaveLength(3);
    for (const chunk of deleteChunks) {
      expect(chunk.startsWith("BEGIN TRANSACTION;")).toBe(true);
      expect(chunk.trimEnd().endsWith("COMMIT TRANSACTION;")).toBe(true);
    }
    expect(parameters(0).ids.arrayValues).toHaveLength(500);
    expect(parameters(1).ids.arrayValues).toHaveLength(500);
    expect(parameters(2).ids.arrayValues).toHaveLength(200);
    expect(result.deletedRows).toBe(1200);
    expect(result.statements).toBe(4);
  });

  it("short-circuits an empty erasure without touching the warehouse", async () => {
    const { target, requests } = fakeWarehouse();

    const result = await target.applyErasure({
      deleteEventIds: [],
      redactEventIds: [],
      redactedEnvelopes: [],
      affectedDates: ["2026-09-06"],
      reason: "user deletion request",
    });

    expect(result).toEqual({ status: "ok", provider: "bigquery", deletedRows: 0, redactedRows: 0, statements: 0 });
    expect(requests).toHaveLength(0);
  });

  it("does not report a failed erasure job as a successful erasure", async () => {
    const { target } = fakeWarehouse({ failWith: "invalidQuery" });

    await expect(
      target.applyErasure({
        deleteEventIds: ["event_1"],
        redactEventIds: [],
        redactedEnvelopes: [],
        affectedDates: ["2026-09-06"],
        reason: "user deletion request",
      }),
    ).rejects.toThrow("invalidQuery");
  });
});

describe("analytics warehouse erasure target selection", () => {
  it("skips every warehouse write when the deployment has no BigQuery warehouse", async () => {
    const target = new DisabledWarehouseGovernanceTarget();

    expect(target.describe()).toEqual({ provider: "disabled" });
    await expect(target.applyErasure()).resolves.toEqual({
      status: "skipped",
      provider: "disabled",
      deletedRows: 0,
      redactedRows: 0,
      statements: 0,
    });
    expect(analyticsWarehouseGovernanceFromEnv({}).describe().provider).toBe("disabled");
    expect(analyticsWarehouseGovernanceFromEnv({ ANALYTICS_WAREHOUSE_TARGET: "local_json" }).describe().provider).toBe("disabled");
  });

  it("erases from BigQuery for every BigQuery warehouse variant", () => {
    expect(analyticsWarehouseGovernanceFromEnv({ ANALYTICS_WAREHOUSE_TARGET: "bigquery_batch" }).describe().provider).toBe("bigquery");
    expect(analyticsWarehouseGovernanceFromEnv({ ANALYTICS_WAREHOUSE_TARGET: "bigquery_insert_all" }).describe().provider).toBe("bigquery");
  });
});
