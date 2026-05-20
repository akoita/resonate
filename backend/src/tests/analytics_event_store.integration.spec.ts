import { prisma } from "../db/prisma";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { PrismaAnalyticsEventStore } from "../modules/analytics/analytics_event_store";
import { AnalyticsService } from "../modules/analytics/analytics.service";

const TEST_PREFIX = `analytics_ledger_${Date.now()}_`;

describe("Analytics event store integration", () => {
  const store = new PrismaAnalyticsEventStore();
  const ingest = new AnalyticsIngestService(store);
  const analytics = new AnalyticsService(ingest);

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({
      where: {
        eventId: { startsWith: TEST_PREFIX },
      },
    });
    await prisma.$disconnect();
  });

  it("persists raw analytics envelopes and can list them", async () => {
    const eventId = `${TEST_PREFIX}play`;

    const result = await ingest.ingest({
      eventId,
      eventName: "license.granted",
      occurredAt: "2026-05-20T09:00:00.000Z",
      receivedAt: "2026-05-20T09:00:01.000Z",
      producer: "analytics-integration-test",
      environment: "local",
      privacyTier: "pseudonymous",
      subjectType: "track",
      subjectId: `${TEST_PREFIX}track`,
      payload: {
        artistId: `${TEST_PREFIX}artist`,
        trackId: `${TEST_PREFIX}track`,
        title: "Durable Drift",
      },
      sourceRefs: {
        testCase: "persist",
      },
    });

    expect(result).toEqual(expect.objectContaining({ status: "ok", eventId }));

    const stored = await prisma.analyticsEvent.findUnique({ where: { eventId } });
    expect(stored).toEqual(
      expect.objectContaining({
        eventName: "license.granted",
        eventVersion: 1,
        producer: "analytics-integration-test",
        privacyTier: "pseudonymous",
        subjectType: "track",
        subjectId: `${TEST_PREFIX}track`,
      }),
    );

    const listed = await ingest.listEvents();
    expect(listed.find((event) => event.eventId === eventId)).toEqual(
      expect.objectContaining({
        eventId,
        occurredAt: "2026-05-20T09:00:00.000Z",
        receivedAt: "2026-05-20T09:00:01.000Z",
        payload: expect.objectContaining({ artistId: `${TEST_PREFIX}artist` }),
        sourceRefs: { testCase: "persist" },
      }),
    );
  });

  it("deduplicates duplicate eventId writes", async () => {
    const eventId = `${TEST_PREFIX}duplicate`;

    await ingest.ingest({
      eventId,
      eventName: "payment.settled",
      occurredAt: "2026-05-20T09:01:00.000Z",
      producer: "analytics-integration-test",
      environment: "local",
      privacyTier: "pseudonymous",
      payload: {
        artistId: `${TEST_PREFIX}artist`,
        trackId: `${TEST_PREFIX}track`,
        title: "Durable Drift",
        amountUsd: 5,
      },
    });
    await ingest.ingest({
      eventId,
      eventName: "payment.settled",
      occurredAt: "2026-05-20T09:01:00.000Z",
      producer: "analytics-integration-test",
      environment: "local",
      privacyTier: "pseudonymous",
      payload: {
        artistId: `${TEST_PREFIX}artist`,
        trackId: `${TEST_PREFIX}track`,
        title: "Durable Drift",
        amountUsd: 99,
      },
    });

    const rows = await prisma.analyticsEvent.findMany({ where: { eventId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual(expect.objectContaining({ amountUsd: 5 }));
  });

  it("keeps existing artist report aggregation working from durable storage", async () => {
    const result = await analytics.getArtistStats(`${TEST_PREFIX}artist`, 30);

    expect(result.summary.totalPlays).toBe(1);
    expect(result.summary.totalPayoutUsd).toBe(5);
    expect(result.tracks).toEqual([
      expect.objectContaining({
        trackId: `${TEST_PREFIX}track`,
        title: "Durable Drift",
        plays: 1,
        payoutUsd: 5,
      }),
    ]);
  });
});
