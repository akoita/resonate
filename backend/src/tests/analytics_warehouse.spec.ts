import { readFileSync } from "fs";
import { resolve } from "path";
import { ANALYTICS_EVENT_SCHEMA_EXAMPLES } from "../modules/analytics/analytics_event";
import {
  analyticsWarehouseConfigFromEnv,
  buildAnalyticsWarehouseExport,
} from "../modules/analytics/analytics_warehouse";

describe("analytics warehouse export", () => {
  const generatedAt = new Date("2026-05-20T12:00:00.000Z");
  const expectedEventCases = loadExpectedEventCases();

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
        event({
          eventId: "evt_rights",
          eventName: "rights.route_decided",
          payload: {
            artistId: "artist-1",
            releaseId: "release-1",
            route: "STANDARD_ESCROW",
            evidenceTypes: ["rights_metadata"],
            decisionReason: "verified uploader",
          },
        }),
      ],
      { generatedAt },
    );

    expect(result.eventsRaw).toHaveLength(3);
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
      expect.objectContaining({
        eventId: "evt_rights",
        eventFamily: "rights",
        releaseId: "release-1",
      }),
    ]);
    expect(result.analyticsFacts).toEqual([
      expect.objectContaining({ factId: "fact_evt_play", factType: "license_event" }),
      expect.objectContaining({ factId: "fact_evt_payment", factType: "payment_event", canonicalAmountUsd: 2.5 }),
      expect.objectContaining({
        factId: "fact_evt_rights",
        factType: "rights_event",
        dimensions: expect.objectContaining({
          route: "STANDARD_ESCROW",
          evidenceTypes: ["rights_metadata"],
          decisionReason: "verified uploader",
        }),
      }),
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
      expect.objectContaining({
        date: "2026-05-20",
        eventName: "rights.route_decided",
        artistId: "artist-1",
        trackId: "unknown",
        eventCount: 1,
        playCount: 0,
        payoutUsd: 0,
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

  it("promotes existing domain event families without quarantine", () => {
    const domainEvents = [
      ["evt_stems", "stems.processed"],
      ["evt_contract", "contract.stem_sold"],
      ["evt_wallet", "wallet.funded"],
      ["evt_curator", "curator.staked"],
      ["evt_recommendation", "recommendation.generated"],
      ["evt_remix", "remix.created"],
      ["evt_marketplace", "marketplace.listing_sold"],
      ["evt_notification", "notification.sent"],
      ["evt_release_rights", "release_rights.request_updated"],
      ["evt_realtime", "realtime.audio"],
      ["evt_x402", "x402.payment_settled"],
      ["evt_session", "session.started"],
    ] as const;

    const result = buildAnalyticsWarehouseExport(
      domainEvents.map(([eventId, eventName]) =>
        event({
          eventId,
          eventName,
          payload: {
            artistId: "artist-1",
            trackId: "track-1",
            releaseId: "release-1",
            amountUsd: eventName.includes("payment") || eventName.includes("sold") ? 1.25 : undefined,
          },
        }),
      ),
      { generatedAt },
    );

    expect(result.analyticsQuarantine).toHaveLength(0);
    expect(result.eventsClean.map((row) => row.eventFamily)).toEqual([
      "stems",
      "contract",
      "wallet",
      "curator",
      "recommendation",
      "remix",
      "marketplace",
      "notification",
      "release_rights",
      "realtime",
      "x402",
      "session",
    ]);
    expect(result.analyticsFacts).toHaveLength(domainEvents.length);
  });

  it("promotes every expected analytics event through raw, clean, fact, and view layers", () => {
    const events = expectedEventCases.map((eventCase, index) =>
      event({
        eventId: `evt_expected_${index}_${eventCase.eventName.replaceAll(".", "_")}`,
        eventName: eventCase.eventName,
        payload: eventCase.payload,
        privacyTier: eventCase.privacyTier,
        consentBasis: eventCase.consentBasis,
      }),
    );

    const result = buildAnalyticsWarehouseExport(events, { generatedAt });
    const eventNames = expectedEventCases.map((eventCase) => eventCase.eventName);

    expect(result.analyticsQuarantine).toEqual([]);
    expect(result.eventsRaw.map((row) => row.eventName)).toEqual(eventNames);
    expect(result.eventsClean.map((row) => row.eventName)).toEqual(eventNames);
    expect(result.analyticsFacts.map((row) => row.dimensions.eventName)).toEqual(eventNames);
    expect(result.analyticsViews.map((row) => row.eventName)).toEqual(eventNames);
    expect(result.eventsRaw).toHaveLength(eventNames.length);
    expect(result.eventsClean).toHaveLength(eventNames.length);
    expect(result.analyticsFacts).toHaveLength(eventNames.length);
    expect(result.analyticsViews).toHaveLength(eventNames.length);
  });

  it("keeps schema examples covered by the expected event processing matrix", () => {
    const eventNames = new Set(expectedEventCases.map((eventCase) => eventCase.eventName));

    expect(ANALYTICS_EVENT_SCHEMA_EXAMPLES.map((schema) => schema.eventName).filter((eventName) => !eventNames.has(eventName))).toEqual([]);
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
  privacyTier?: string;
  consentBasis?: string;
}) {
  return {
    eventId: input.eventId,
    eventName: input.eventName,
    eventVersion: 1,
    occurredAt: "2026-05-20T09:00:00.000Z",
    receivedAt: "2026-05-20T09:00:01.000Z",
    producer: "analytics-test",
    environment: "local",
    privacyTier: input.privacyTier ?? "pseudonymous",
    consentBasis: input.consentBasis,
    payload: input.payload,
  };
}

type ExpectedEventCase = {
  eventName: string;
  privacyTier?: string;
  consentBasis?: string;
  payload: Record<string, unknown>;
};

function loadExpectedEventCases(): ExpectedEventCase[] {
  return JSON.parse(
    readFileSync(resolve(__dirname, "../../../test-fixtures/analytics_expected_events.json"), "utf8"),
  ) as ExpectedEventCase[];
}
