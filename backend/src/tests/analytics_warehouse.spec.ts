import {
  analyticsWarehouseConfigFromEnv,
  buildAnalyticsWarehouseExport,
} from "../modules/analytics/analytics_warehouse";

describe("analytics warehouse export", () => {
  const generatedAt = new Date("2026-05-20T12:00:00.000Z");

  it("builds raw, clean, fact, and report view layers for known events", () => {
    const result = buildAnalyticsWarehouseExport(
      [
        event({
          eventId: "evt_play",
          eventName: "license.granted",
          payload: {
            artistId: "artist-1",
            trackId: "track-1",
            source: "agent",
          },
        }),
        event({
          eventId: "evt_payment",
          eventName: "payment.settled",
          payload: {
            artistId: "artist-1",
            trackId: "track-1",
            amountUsd: 2.5,
          },
        }),
      ],
      { generatedAt },
    );

    expect(result.eventsRaw).toHaveLength(2);
    expect(result.eventsClean).toEqual([
      expect.objectContaining({
        eventId: "evt_play",
        eventFamily: "license",
        eventAction: "granted",
        artistId: "artist-1",
        trackId: "track-1",
        source: "agent",
      }),
      expect.objectContaining({
        eventId: "evt_payment",
        eventFamily: "payment",
        canonicalAmountUsd: 2.5,
      }),
    ]);
    expect(result.analyticsFacts).toEqual([
      expect.objectContaining({ factId: "fact_evt_play", factType: "license_event" }),
      expect.objectContaining({ factId: "fact_evt_payment", factType: "payment_event", canonicalAmountUsd: 2.5 }),
    ]);
    expect(result.analyticsViews).toEqual([
      expect.objectContaining({
        date: "2026-05-20",
        eventName: "license.granted",
        artistId: "artist-1",
        trackId: "track-1",
        eventCount: 1,
        playCount: 1,
        payoutUsd: 0,
      }),
      expect.objectContaining({
        date: "2026-05-20",
        eventName: "payment.settled",
        eventCount: 1,
        playCount: 0,
        payoutUsd: 2.5,
      }),
    ]);
    expect(result.analyticsQuarantine).toHaveLength(0);
  });

  it("quarantines invalid records and unsupported event families", () => {
    const result = buildAnalyticsWarehouseExport(
      [
        { eventId: "evt_bad", eventName: "Bad Event" },
        event({
          eventId: "evt_unknown",
          eventName: "unknown.created",
          payload: {},
        }),
      ],
      { generatedAt },
    );

    expect(result.eventsRaw).toHaveLength(1);
    expect(result.eventsClean).toHaveLength(0);
    expect(result.analyticsFacts).toHaveLength(0);
    expect(result.analyticsQuarantine).toEqual([
      expect.objectContaining({
        eventId: "evt_bad",
        eventName: "Bad Event",
        reason: expect.stringContaining("eventName"),
      }),
      expect.objectContaining({
        eventId: "evt_unknown",
        eventName: "unknown.created",
        reason: "unsupported event family: unknown",
      }),
    ]);
  });

  it("derives warehouse target names from environment configuration", () => {
    const config = analyticsWarehouseConfigFromEnv({
      ANALYTICS_WAREHOUSE_PROJECT_ID: "analytics-project",
      ANALYTICS_WAREHOUSE_DATASET_PREFIX: "resonate_prod",
    });

    expect(config).toEqual({
      projectId: "analytics-project",
      datasetPrefix: "resonate_prod",
      tables: {
        eventsRaw: "resonate_prod.events_raw",
        eventsClean: "resonate_prod.events_clean",
        analyticsFacts: "resonate_prod.analytics_facts",
        analyticsViews: "resonate_prod.analytics_views",
        analyticsQuarantine: "resonate_prod.analytics_quarantine",
      },
    });
  });
});

function event(input: {
  eventId: string;
  eventName: string;
  payload: Record<string, unknown>;
}) {
  return {
    eventId: input.eventId,
    eventName: input.eventName,
    eventVersion: 1,
    occurredAt: "2026-05-20T09:00:00.000Z",
    receivedAt: "2026-05-20T09:00:01.000Z",
    producer: "analytics-test",
    environment: "local",
    privacyTier: "pseudonymous",
    payload: input.payload,
  };
}
