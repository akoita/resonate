import {
  AnalyticsBigQueryQueryClient,
  analyticsBigQueryReportConfigFromEnv,
  analyticsReportSourceFromEnv,
  BigQueryArtistAnalyticsReportSource,
  DisabledArtistAnalyticsReportSource,
} from "../modules/analytics/analytics_bigquery_report";

describe("analytics BigQuery report source", () => {
  it("stays disabled unless explicitly configured", () => {
    expect(analyticsReportSourceFromEnv({})).toBeInstanceOf(DisabledArtistAnalyticsReportSource);
    expect(
      analyticsBigQueryReportConfigFromEnv({
        GCP_PROJECT_ID: "resonate-dev",
        ANALYTICS_WAREHOUSE_DATASET_PREFIX: "analytics_dev",
      }),
    ).toEqual(
      expect.objectContaining({
        source: "warehouse_export",
        projectId: "resonate-dev",
        datasetId: "analytics_dev",
        factsTable: "analytics_facts",
        viewsTable: "analytics_views",
        cacheTtlSeconds: 60,
        maximumBytesBilled: "500000000",
      }),
    );
  });

  it("queries bounded artist-scoped facts and views with cache metadata", async () => {
    const client = new FakeBigQueryClient([
      {
        rows: [
          {
            factId: "fact_play",
            factType: "playback_event",
            eventId: "evt_play",
            occurredAt: "2026-05-20 10:00:00 UTC",
            occurredDate: "2026-05-20",
            artistId: "artist-1",
            trackId: "track-1",
            canonicalAmountUsd: undefined,
            count: 1,
            dimensions: JSON.stringify({ eventName: "playback.completed", title: "Pulse" }),
          },
        ],
        totalBytesProcessed: "1000",
        cacheHit: false,
      },
      {
        rows: [
          {
            viewName: "daily_event_artist_track",
            grain: "day_event_artist_track",
            date: "2026-05-20",
            eventName: "playback.completed",
            artistId: "artist-1",
            trackId: "track-1",
            eventCount: 1,
            playCount: 1,
            payoutUsd: 0,
          },
        ],
        totalBytesProcessed: "2000",
        cacheHit: false,
      },
    ]);
    const source = new BigQueryArtistAnalyticsReportSource(
      analyticsBigQueryReportConfigFromEnv({
        ANALYTICS_REPORT_SOURCE: "bigquery",
        ANALYTICS_BIGQUERY_PROJECT_ID: "analytics-project",
        ANALYTICS_BIGQUERY_DATASET: "analytics_dev",
        ANALYTICS_BIGQUERY_CACHE_TTL_SECONDS: "120",
        ANALYTICS_BIGQUERY_MAXIMUM_BYTES_BILLED: "123456",
      }),
      client,
      () => new Date("2026-05-22T12:00:00.000Z"),
    );

    const result = await source.listArtistFacts({
      artistId: "artist-1",
      from: new Date("2026-05-01T00:00:00.000Z"),
      to: new Date("2026-05-22T00:00:00.000Z"),
    });
    const cached = await source.listArtistFacts({
      artistId: "artist-1",
      from: new Date("2026-05-01T00:00:00.000Z"),
      to: new Date("2026-05-22T00:00:00.000Z"),
    });

    expect(client.requests).toHaveLength(2);
    expect(client.requests[0].query).toContain("FROM `analytics-project.analytics_dev.analytics_facts`");
    expect(client.requests[0].query).toContain("artistId = @artistId");
    expect(client.requests[0].query).toContain("occurredAt >= TIMESTAMP(@from)");
    expect(client.requests[0].parameters.artistId).toBe("artist-1");
    expect(client.requests[0].maximumBytesBilled).toBe("123456");
    expect(result.facts[0]).toEqual(
      expect.objectContaining({
        eventId: "evt_play",
        artistId: "artist-1",
        dimensions: expect.objectContaining({ eventName: "playback.completed" }),
      }),
    );
    expect(result.views[0].playCount).toBe(1);
    expect(result.metadata).toEqual(
      expect.objectContaining({
        source: "bigquery",
        isEmpty: false,
        freshness: { asOf: "2026-05-20 10:00:00 UTC", lagSeconds: 180000 },
        cache: { hit: false, ttlSeconds: 120 },
        query: expect.objectContaining({
          projectId: "analytics-project",
          datasetId: "analytics_dev",
          maximumBytesBilled: "123456",
          totalBytesProcessed: "3000",
        }),
      }),
    );
    expect(cached.metadata.cache.hit).toBe(true);
    expect(client.requests).toHaveLength(2);
  });

  it("marks empty BigQuery windows as real no-data responses", async () => {
    const client = new FakeBigQueryClient([
      { rows: [], totalBytesProcessed: "0", cacheHit: true },
      { rows: [], totalBytesProcessed: "0", cacheHit: true },
    ]);
    const source = new BigQueryArtistAnalyticsReportSource(
      analyticsBigQueryReportConfigFromEnv({
        ANALYTICS_REPORT_SOURCE: "bigquery",
        ANALYTICS_BIGQUERY_PROJECT_ID: "analytics-project",
      }),
      client,
      () => new Date("2026-05-22T12:00:00.000Z"),
    );

    const result = await source.listArtistFacts({
      artistId: "artist-empty",
      from: new Date("2026-05-01T00:00:00.000Z"),
      to: new Date("2026-05-22T00:00:00.000Z"),
    });

    expect(result.facts).toEqual([]);
    expect(result.views).toEqual([]);
    expect(result.metadata.isEmpty).toBe(true);
    expect(result.metadata.freshness).toEqual({ asOf: null, lagSeconds: null });
    expect(result.metadata.query?.cacheHit).toBe(true);
  });
});

class FakeBigQueryClient implements AnalyticsBigQueryQueryClient {
  readonly requests: Parameters<AnalyticsBigQueryQueryClient["query"]>[0][] = [];

  constructor(private readonly responses: Awaited<ReturnType<AnalyticsBigQueryQueryClient["query"]>>[]) {}

  async query(request: Parameters<AnalyticsBigQueryQueryClient["query"]>[0]) {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) {
      throw new Error("unexpected query");
    }
    return response;
  }
}
