import {
  GoogleAuthDiscoveryPopularityBigQueryClient,
} from "../modules/catalog/discovery-popularity-export.service";
import type { BigQueryRequestClient } from "../modules/catalog/discovery-popularity-export.service";
import { discoveryPopularityConfigFromEnv } from "../modules/catalog/discovery-popularity.math";

const schema = {
  fields: [
    { name: "track_id", type: "STRING" },
    { name: "window", type: "STRING" },
    { name: "computed_at", type: "TIMESTAMP" },
  ],
};

type RequestArgs = {
  url: string;
  method: "GET" | "POST";
  timeout: number;
  data?: unknown;
  params?: Record<string, unknown>;
};

function row(trackId: string, window = "7d") {
  // REST shape for a TIMESTAMP under formatOptions.useInt64Timestamp: epoch microseconds.
  return { f: [{ v: trackId }, { v: window }, { v: "1791025200123456" }] };
}

function warehouseConfig(rowLimit = 10) {
  return discoveryPopularityConfigFromEnv({
    DISCOVERY_POPULARITY_SOURCE: "warehouse",
    DISCOVERY_POPULARITY_BIGQUERY_PROJECT_ID: "test-project",
    DISCOVERY_POPULARITY_BIGQUERY_DATASET: "test_dataset",
    DISCOVERY_POPULARITY_EXPORT_ROW_LIMIT: String(rowLimit),
    DISCOVERY_POPULARITY_QUERY_TIMEOUT_MS: "2000",
    DISCOVERY_POPULARITY_MAXIMUM_BYTES_BILLED: "5000000",
  });
}

describe("BigQuery discovery popularity mart reader", () => {
  it("waits for query completion, paginates all rows, and applies byte and row bounds", async () => {
    const calls: RequestArgs[] = [];
    const responses: unknown[] = [
      {
        jobComplete: false,
        jobReference: { jobId: "job-1", location: "US" },
      },
      {
        jobComplete: true,
        jobReference: { jobId: "job-1", location: "US" },
        schema,
        totalRows: "2",
        rows: [row("track-a")],
        pageToken: "page-2",
      },
      {
        jobComplete: true,
        jobReference: { jobId: "job-1", location: "US" },
        schema,
        totalRows: "2",
        rows: [row("track-b")],
      },
    ];
    const requestClient: BigQueryRequestClient = {
      async request<T>(request: RequestArgs) {
        calls.push(request);
        return { data: responses.shift() as T };
      },
    };
    const client = new GoogleAuthDiscoveryPopularityBigQueryClient(
      warehouseConfig(),
      requestClient,
      () => 0,
      async () => {},
    );

    await expect(client.readMart("track_popularity", "track")).resolves.toEqual([
      { track_id: "track-a", window: "7d", computed_at: new Date("2026-10-03T11:00:00.123Z") },
      { track_id: "track-b", window: "7d", computed_at: new Date("2026-10-03T11:00:00.123Z") },
    ]);
    expect(calls).toHaveLength(3);
    expect((calls[0].data as { maximumBytesBilled: string }).maximumBytesBilled).toBe("5000000");
    expect((calls[0].data as { query: string }).query).toContain("purchases, computed_at");
    expect((calls[0].data as { queryParameters: Array<{ parameterValue: { value: string } }> }).queryParameters[0].parameterValue.value).toBe("11");
    expect(calls[2].params?.pageToken).toBe("page-2");
    expect((calls[0].data as { formatOptions: unknown }).formatOptions).toEqual({ useInt64Timestamp: true });
    expect(calls.slice(1).every((call) => call.params?.["formatOptions.useInt64Timestamp"] === true)).toBe(true);
  });

  it("rejects a TIMESTAMP cell that is not integer epoch microseconds", async () => {
    for (const value of ["1.791025200123456E9", "2026-10-03 11:00:00 UTC", ""]) {
      const requestClient: BigQueryRequestClient = {
        async request<T>() {
          return {
            data: {
              jobComplete: true,
              jobReference: { jobId: "job-1" },
              schema,
              totalRows: "1",
              rows: [{ f: [{ v: "track-a" }, { v: "7d" }, { v: value }] }],
            } as T,
          };
        },
      };
      const client = new GoogleAuthDiscoveryPopularityBigQueryClient(
        warehouseConfig(),
        requestClient,
        () => 0,
        async () => {},
      );
      await expect(client.readMart("track_popularity", "track")).rejects.toThrow("invalid computed_at TIMESTAMP");
    }
  });

  it("quotes the reserved window column for both marts and preserves its result name", async () => {
    const calls: RequestArgs[] = [];
    const requestClient: BigQueryRequestClient = {
      async request<T>(request: RequestArgs) {
        calls.push(request);
        const query = (request.data as { query: string }).query;
        const idField = query.includes("track_id") ? "track_id" : "artist_id";
        return {
          data: {
            jobComplete: true,
            schema: { fields: [{ name: idField }, { name: "window" }] },
            totalRows: "1",
            rows: [{ f: [{ v: "catalog-id" }, { v: "30d" }] }],
          } as T,
        };
      },
    };
    const client = new GoogleAuthDiscoveryPopularityBigQueryClient(warehouseConfig(), requestClient);

    for (const [tableName, mart, idField] of [
      ["track_popularity", "track", "track_id"],
      ["artist_engagement", "artist", "artist_id"],
    ] as const) {
      await expect(client.readMart(tableName, mart)).resolves.toEqual([
        { [idField]: "catalog-id", window: "30d" },
      ]);
    }

    expect(calls).toHaveLength(2);
    for (const [index, idField] of ["track_id", "artist_id"].entries()) {
      const request = calls[index];
      const query = (request.data as { query: string }).query;
      expect(query).toContain(`SELECT ${idField}, \`window\`, genre`);
      expect(query).toContain(`ORDER BY \`window\`, genre, ${idField} LIMIT @resultLimit`);
      expect((request.data as { queryParameters: Array<{ name: string }> }).queryParameters).toEqual([
        expect.objectContaining({ name: "resultLimit" }),
      ]);
    }
  });

  it("preserves the requested page token while an incomplete page is polled", async () => {
    const calls: RequestArgs[] = [];
    const responses: unknown[] = [
      {
        jobComplete: true,
        jobReference: { jobId: "job-2" },
        schema,
        totalRows: "2",
        rows: [row("track-a")],
        pageToken: "page-2",
      },
      {
        jobComplete: false,
        jobReference: { jobId: "job-2" },
      },
      {
        jobComplete: true,
        jobReference: { jobId: "job-2" },
        schema,
        totalRows: "2",
        rows: [row("track-b")],
      },
    ];
    const requestClient: BigQueryRequestClient = {
      async request<T>(request: RequestArgs) {
        calls.push(request);
        return { data: responses.shift() as T };
      },
    };
    const client = new GoogleAuthDiscoveryPopularityBigQueryClient(
      warehouseConfig(),
      requestClient,
      () => 0,
      async () => {},
    );

    await expect(client.readMart("track_popularity", "track")).resolves.toHaveLength(2);
    expect(calls[2].params?.pageToken).toBe("page-2");
  });

  it("fails closed when the mart is truncated or exceeds its configured row limit", async () => {
    const readWith = async (response: unknown, rowLimit: number) => {
      const requestClient: BigQueryRequestClient = {
        async request<T>() {
          return { data: response as T };
        },
      };
      const client = new GoogleAuthDiscoveryPopularityBigQueryClient(warehouseConfig(rowLimit), requestClient);
      return client.readMart("track_popularity", "track");
    };

    await expect(readWith({
      jobComplete: true,
      jobReference: { jobId: "job-3" },
      schema,
      totalRows: "2",
      rows: [row("track-a")],
    }, 10)).rejects.toThrow("returned 1 of 2 rows");

    await expect(readWith({
      jobComplete: true,
      jobReference: { jobId: "job-4" },
      schema,
      totalRows: "2",
      rows: [row("track-a"), row("track-b")],
    }, 1)).rejects.toThrow("exceeded row limit 1");
  });

  it("enforces the same total deadline across completed page requests", async () => {
    let now = 0;
    const requestClient: BigQueryRequestClient = {
      async request<T>(request: RequestArgs) {
        now += 1_000;
        const response = request.method === "POST"
          ? {
              jobComplete: true,
              jobReference: { jobId: "job-deadline" },
              schema,
              totalRows: "2",
              rows: [row("track-a")],
              pageToken: "page-2",
            }
          : {
              jobComplete: true,
              jobReference: { jobId: "job-deadline" },
              schema,
              totalRows: "2",
              rows: [row("track-b")],
            };
        return { data: response as T };
      },
    };
    const client = new GoogleAuthDiscoveryPopularityBigQueryClient(
      warehouseConfig(),
      requestClient,
      () => now,
      async () => {},
    );

    await expect(client.readMart("track_popularity", "track")).rejects.toThrow("timed out");
  });

  it("rejects a repeated pagination token", async () => {
    const responses: unknown[] = [
      {
        jobComplete: true,
        jobReference: { jobId: "job-repeat" },
        schema,
        totalRows: "2",
        rows: [row("track-a")],
        pageToken: "same-token",
      },
      {
        jobComplete: true,
        jobReference: { jobId: "job-repeat" },
        schema,
        totalRows: "2",
        rows: [row("track-b")],
        pageToken: "same-token",
      },
    ];
    const requestClient: BigQueryRequestClient = {
      async request<T>() {
        return { data: responses.shift() as T };
      },
    };
    const client = new GoogleAuthDiscoveryPopularityBigQueryClient(warehouseConfig(), requestClient);

    await expect(client.readMart("track_popularity", "track")).rejects.toThrow("repeated a page token");
  });
});
