import { buildAnalyticsPipelineHealth } from "../modules/analytics/analytics_observability.service";
import { AnalyticsWarehouseExport } from "../modules/analytics/analytics_warehouse";

describe("analytics pipeline observability", () => {
  it("reports ok when facts are fresh and clean rows have required identifiers", () => {
    const report = buildAnalyticsPipelineHealth(
      exportWith({
        clean: [
          cleanRow({
            eventId: "evt_play",
            eventName: "playback.completed",
            eventFamily: "playback",
            actorId: "user_hash",
            sessionId: "session-1",
            artistId: "artist-1",
            trackId: "track-1",
            releaseId: "release-1",
            occurredAt: "2026-05-25T10:00:00.000Z",
          }),
        ],
        facts: [
          factRow({
            eventId: "evt_play",
            occurredAt: "2026-05-25T10:00:00.000Z",
          }),
        ],
      }),
      new Date("2026-05-25T10:05:00.000Z"),
      {},
    );

    expect(report.status).toBe("ok");
    expect(report.freshness.status).toBe("ok");
    expect(report.facts.cleanToFactRate).toBe(1);
    expect(report.identifierGaps.rows).toBe(0);
    expect(report.quarantine.rows).toBe(0);
  });

  it("surfaces quarantine, missing identifiers, stale facts, and Pub/Sub config gaps", () => {
    const report = buildAnalyticsPipelineHealth(
      exportWith({
        clean: [
          cleanRow({
            eventId: "evt_play",
            eventName: "playback.completed",
            eventFamily: "playback",
            actorId: undefined,
            sessionId: undefined,
            artistId: "artist-1",
            trackId: "track-1",
            releaseId: undefined,
            occurredAt: "2026-05-24T00:00:00.000Z",
          }),
        ],
        quarantine: [
          {
            eventId: "evt_bad",
            eventName: "unknown.event",
            reason: "unsupported event family: unknown",
            receivedAt: "2026-05-25T10:00:00.000Z",
            raw: {},
          },
        ],
      }),
      new Date("2026-05-25T10:00:00.000Z"),
      { ANALYTICS_EVENT_PUBLISHING_ENABLED: "true" },
    );

    expect(report.status).toBe("critical");
    expect(report.freshness.status).toBe("critical");
    expect(report.quarantine.byReason).toEqual([
      {
        reason: "unsupported event family: unknown",
        eventName: "unknown.event",
        count: 1,
      },
    ]);
    expect(report.identifierGaps.byReason).toEqual(
      expect.arrayContaining([
        { reason: "missing_actor_id", eventName: "playback.completed", count: 1 },
        { reason: "missing_session_id", eventName: "playback.completed", count: 1 },
        { reason: "missing_release_id", eventName: "playback.completed", count: 1 },
      ]),
    );
    expect(report.facts.missingFactRows).toBe(1);
    expect(report.pubSub).toMatchObject({
      enabled: true,
      topicConfigured: false,
    });
    expect(report.recommendations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Dataflow"),
        expect.stringContaining("analytics_quarantine"),
        expect.stringContaining("omit expected"),
        expect.stringContaining("ANALYTICS_EVENT_PUBSUB_TOPIC"),
      ]),
    );
  });
});

function exportWith(input: {
  clean?: AnalyticsWarehouseExport["eventsClean"];
  facts?: AnalyticsWarehouseExport["analyticsFacts"];
  quarantine?: AnalyticsWarehouseExport["analyticsQuarantine"];
}): AnalyticsWarehouseExport {
  return {
    generatedAt: "2026-05-25T10:00:00.000Z",
    config: {
      projectId: "test",
      datasetPrefix: "analytics_test",
      tables: {
        eventsRaw: "analytics_test.events_raw",
        eventsClean: "analytics_test.events_clean",
        analyticsFacts: "analytics_test.analytics_facts",
        analyticsViews: "analytics_test.analytics_views",
        analyticsQuarantine: "analytics_test.analytics_quarantine",
      },
    },
    eventsRaw: [],
    eventsClean: input.clean ?? [],
    analyticsFacts: input.facts ?? [],
    analyticsViews: [],
    analyticsQuarantine: input.quarantine ?? [],
  };
}

function cleanRow(overrides: Partial<AnalyticsWarehouseExport["eventsClean"][number]>) {
  return {
    eventId: "evt",
    eventName: "playback.completed",
    eventFamily: "playback",
    eventAction: "completed",
    eventVersion: 1,
    occurredAt: "2026-05-25T10:00:00.000Z",
    occurredDate: "2026-05-25",
    producer: "test",
    environment: "local",
    privacyTier: "pseudonymous",
    payload: {},
    ...overrides,
  };
}

function factRow(overrides: Partial<AnalyticsWarehouseExport["analyticsFacts"][number]>) {
  return {
    factId: "fact_evt",
    factType: "playback_event",
    eventId: "evt",
    occurredAt: "2026-05-25T10:00:00.000Z",
    occurredDate: "2026-05-25",
    count: 1,
    dimensions: {},
    ...overrides,
  };
}
