import {
  AnalyticsEventPublisher,
  DisabledAnalyticsEventPublisher,
  PubSubAnalyticsEventPublisher,
  analyticsEventPublisherFromEnv,
  analyticsPubSubAttributes,
  analyticsPubSubPublisherConfigFromEnv,
} from "../modules/analytics/analytics_event_publisher";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";

describe("analytics event Pub/Sub publisher", () => {
  beforeEach(() => {
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const event = {
    eventId: "evt_publish_1",
    eventName: "playback.completed",
    eventVersion: 1,
    occurredAt: "2026-05-22T10:00:00.000Z",
    receivedAt: "2026-05-22T10:00:01.000Z",
    producer: "playback-service",
    environment: "local" as const,
    privacyTier: "pseudonymous" as const,
    payload: { trackId: "track-1", artistId: "artist-1" },
  };

  it("derives the required Pub/Sub message attributes from the analytics envelope", () => {
    expect(analyticsPubSubAttributes(event)).toEqual({
      event_name: "playback.completed",
      event_version: "1",
      event_family: "playback",
      environment: "local",
      producer: "playback-service",
      privacy_tier: "pseudonymous",
    });
  });

  it("is disabled by default", async () => {
    const publisher = analyticsEventPublisherFromEnv({});

    await expect(publisher.publish(event)).resolves.toEqual({
      published: false,
      provider: "disabled",
      reason: "analytics event Pub/Sub publishing is disabled",
    });
  });

  it("reads enabled Pub/Sub config from environment variables", () => {
    expect(
      analyticsPubSubPublisherConfigFromEnv({
        ANALYTICS_EVENT_PUBLISHING_ENABLED: "true",
        ANALYTICS_EVENT_PUBLISHING_STRICT: "1",
        ANALYTICS_EVENT_PUBSUB_TOPIC: "resonate-dev-analytics-events",
        ANALYTICS_EVENT_PUBSUB_PROJECT_ID: "resonate-dev",
      }),
    ).toEqual({
      enabled: true,
      strict: true,
      topicName: "resonate-dev-analytics-events",
      projectId: "resonate-dev",
    });
  });

  it("publishes one message per stored analytics event when enabled", async () => {
    const publishMessage = jest.fn().mockResolvedValue("msg-1");
    const pubsub = {
      topic: jest.fn().mockReturnValue({ publishMessage }),
    };
    const service = new AnalyticsIngestService(
      undefined,
      new PubSubAnalyticsEventPublisher(
        {
          enabled: true,
          strict: false,
          topicName: "analytics-events",
          projectId: "resonate-test",
        },
        pubsub as any,
      ),
    );

    const result = await service.ingest({
      eventId: "evt_publish_service",
      eventName: "commerce.settled",
      eventVersion: 1,
      producer: "payments-service",
      environment: "local",
      privacyTier: "pseudonymous",
      occurredAt: "2026-05-22T10:00:00.000Z",
      receivedAt: "2026-05-22T10:00:01.000Z",
      payload: { paymentId: "pay-1" },
    });

    expect(result).toEqual({ status: "ok", eventId: "evt_publish_service", ingested: 1 });
    expect(pubsub.topic).toHaveBeenCalledWith("analytics-events");
    expect(publishMessage).toHaveBeenCalledWith({
      data: expect.any(Buffer),
      attributes: {
        event_name: "commerce.settled",
        event_version: "1",
        event_family: "commerce",
        environment: "local",
        producer: "payments-service",
        privacy_tier: "pseudonymous",
      },
    });
    const payload = JSON.parse(publishMessage.mock.calls[0][0].data.toString("utf8"));
    expect(payload).toEqual(
      expect.objectContaining({
        eventId: "evt_publish_service",
        eventName: "commerce.settled",
      }),
    );
  });

  it("keeps ledger ingestion successful when non-strict publishing fails", async () => {
    const publisher: AnalyticsEventPublisher = {
      publish: jest.fn().mockResolvedValue({
        published: false,
        provider: "pubsub",
        reason: "topic unavailable",
      }),
    };
    const service = new AnalyticsIngestService(undefined, publisher);

    await expect(
      service.ingest({
        eventId: "evt_publish_failure_non_strict",
        eventName: "playback.completed",
        payload: {},
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "ok",
        eventId: "evt_publish_failure_non_strict",
      }),
    );
    expect(publisher.publish).toHaveBeenCalled();

    await expect(service.listEvents()).resolves.toHaveLength(1);
  });

  it("fails ingestion only when strict publishing is configured", async () => {
    const service = new AnalyticsIngestService(
      undefined,
      new DisabledAnalyticsEventPublisher("missing analytics topic", true),
    );

    await expect(
      service.ingest({
        eventId: "evt_publish_failure_strict",
        eventName: "playback.completed",
        payload: {},
      }),
    ).rejects.toThrow("missing analytics topic");
  });
});
