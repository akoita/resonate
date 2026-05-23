import { Logger } from "@nestjs/common";
import { AnalyticsDomainEventBridgeService } from "../modules/analytics/analytics_domain_event_bridge.service";
import { AnalyticsEventPublisher } from "../modules/analytics/analytics_event_publisher";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { EventBus } from "../modules/shared/event_bus";

describe("AnalyticsDomainEventBridgeService", () => {
  let eventBus: EventBus;
  let bridge: AnalyticsDomainEventBridgeService;

  afterEach(() => {
    bridge?.onModuleDestroy();
    eventBus?.destroy();
    jest.restoreAllMocks();
  });

  it("bridges upload and release-ready events into the analytics publisher", async () => {
    const publisher: AnalyticsEventPublisher = {
      publish: jest.fn().mockResolvedValue({ published: true, provider: "pubsub", messageId: "msg-1" }),
    };
    const ingest = new AnalyticsIngestService(undefined, publisher);
    eventBus = new EventBus();
    bridge = new AnalyticsDomainEventBridgeService(eventBus, ingest);
    bridge.onModuleInit();

    eventBus.publish({
      eventName: "stems.uploaded",
      eventVersion: 1,
      occurredAt: "2026-05-23T10:00:00.000Z",
      releaseId: "rel_917",
      artistId: "artist_917",
      checksum: "completed",
      sourceType: "direct_upload",
      artworkData: Buffer.from("not-for-analytics"),
      metadata: {
        title: "Release Title",
        tracks: [
          {
            id: "track_917",
            title: "Track Title",
            position: 1,
            stems: [
              { id: "stem_original_917", uri: "local://original", type: "original", buffer: Buffer.from("audio") },
            ],
          },
        ],
      },
    } as any);
    eventBus.publish({
      eventName: "catalog.release_ready",
      eventVersion: 1,
      occurredAt: "2026-05-23T10:00:02.000Z",
      releaseId: "rel_917",
      artistId: "artist_917",
      metadata: {
        tracks: [{ id: "track_917", stems: [{ id: "stem_vocals_917" }] }],
      },
    });

    await waitForExpect(() => expect(publisher.publish).toHaveBeenCalledTimes(2));

    const events = await ingest.listEvents();
    expect(events.map((event) => event.eventName)).toEqual(["stems.uploaded", "catalog.release_ready"]);
    expect(events[0]).toEqual(
      expect.objectContaining({
        producer: "ingestion-service",
        privacyTier: "pseudonymous",
        subjectType: "release",
        subjectId: "rel_917",
        actorId: "artist_917",
        payload: expect.objectContaining({
          releaseId: "rel_917",
          artistId: "artist_917",
          sourceType: "direct_upload",
          trackIds: ["track_917"],
          trackCount: 1,
          stemCount: 1,
        }),
      }),
    );
    expect(JSON.stringify(events)).not.toContain("not-for-analytics");
    expect(JSON.stringify(events)).not.toContain("audio");
  });

  it("bridges processed and track-status events with model and status dimensions", async () => {
    const ingest = new AnalyticsIngestService();
    eventBus = new EventBus();
    bridge = new AnalyticsDomainEventBridgeService(eventBus, ingest);
    bridge.onModuleInit();

    eventBus.publish({
      eventName: "stems.processed",
      eventVersion: 1,
      occurredAt: "2026-05-23T10:01:00.000Z",
      releaseId: "rel_processed_917",
      artistId: "artist_917",
      modelVersion: "demucs-v4",
      tracks: [
        {
          id: "track_processed_917",
          title: "Processed",
          position: 1,
          stems: [
            { id: "stem_vocals_917", uri: "gs://bucket/vocals.wav", type: "vocals" },
            { id: "stem_drums_917", uri: "gs://bucket/drums.wav", type: "drums" },
          ],
        },
      ],
    });
    eventBus.publish({
      eventName: "catalog.track_status",
      eventVersion: 1,
      occurredAt: "2026-05-23T10:01:01.000Z",
      releaseId: "rel_processed_917",
      trackId: "track_processed_917",
      status: "complete",
    });

    await waitForExpect(async () => expect(await ingest.listEvents()).toHaveLength(2));

    await expect(ingest.listEvents()).resolves.toEqual([
      expect.objectContaining({
        eventName: "stems.processed",
        payload: expect.objectContaining({
          modelVersion: "demucs-v4",
          trackIds: ["track_processed_917"],
          stemIds: ["stem_vocals_917", "stem_drums_917"],
          stemCount: 2,
        }),
      }),
      expect.objectContaining({
        eventName: "catalog.track_status",
        subjectType: "track",
        subjectId: "track_processed_917",
        payload: expect.objectContaining({
          releaseId: "rel_processed_917",
          trackId: "track_processed_917",
          status: "complete",
        }),
      }),
    ]);
  });

  it("does not throw domain publishing when analytics ingest fails", async () => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const ingest = {
      ingest: jest.fn().mockRejectedValue(new Error("analytics unavailable")),
    } as unknown as AnalyticsIngestService;
    eventBus = new EventBus();
    bridge = new AnalyticsDomainEventBridgeService(eventBus, ingest);
    bridge.onModuleInit();

    expect(() =>
      eventBus.publish({
        eventName: "catalog.track_status",
        eventVersion: 1,
        occurredAt: "2026-05-23T10:02:00.000Z",
        releaseId: "rel_non_blocking_917",
        trackId: "track_non_blocking_917",
        status: "failed",
        error: "analytics should not block catalog",
      }),
    ).not.toThrow();

    await waitForExpect(() => expect(ingest.ingest).toHaveBeenCalledTimes(1));
  });
});

async function waitForExpect(assertion: () => void | Promise<void>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}
