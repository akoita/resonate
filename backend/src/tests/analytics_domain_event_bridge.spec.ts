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

  it("bridges high-value domain events with compact analytics payloads", async () => {
    const ingest = new AnalyticsIngestService();
    eventBus = new EventBus();
    bridge = new AnalyticsDomainEventBridgeService(eventBus, ingest);
    bridge.onModuleInit();

    const occurredAt = "2026-05-23T11:00:00.000Z";
    const events = [
      {
        eventName: "license.granted",
        eventVersion: 1,
        occurredAt,
        licenseId: "lic_919",
        type: "personal",
        priceUsd: 1.25,
        sessionId: "session_919",
        trackId: "track_919",
        artistId: "artist_919",
        title: "Track 919",
      },
      {
        eventName: "payment.settled",
        eventVersion: 1,
        occurredAt,
        paymentId: "pay_919",
        txHash: "tx_919",
        status: "settled",
        amountUsd: 1.25,
        trackId: "track_919",
        artistId: "artist_919",
        sessionId: "session_919",
        paymentToken: "0x0000000000000000000000000000000000000000",
        settlementAmount: "1250000000000000000",
        settlementAmountUnits: "wei",
      },
      {
        eventName: "contract.stem_sold",
        eventVersion: 1,
        occurredAt,
        listingId: 919n,
        buyerAddress: "0xbuyer",
        amount: 2n,
        totalPaid: 2500000000000000000n,
        chainId: 31337,
        contractAddress: "0xmarket",
        transactionHash: "0xtx919",
        blockNumber: "12",
      },
      {
        eventName: "agent.purchase_completed",
        eventVersion: 1,
        occurredAt,
        sessionId: "session_919",
        userId: "user_919",
        listingId: "919",
        tokenId: "101",
        amount: "1",
        priceUsd: 1.25,
        txHash: "tx_agent_919",
        mode: "onchain",
      },
      {
        eventName: "agent.track_selected",
        eventVersion: 1,
        occurredAt,
        sessionId: "session_919",
        trackId: "track_919",
        strategy: "recent-first",
        preferences: { secretUserText: "do not persist this" },
      },
      {
        eventName: "generation.started",
        eventVersion: 1,
        occurredAt,
        jobId: "job_919",
        userId: "user_919",
        artistId: "artist_919",
        prompt: "private prompt should not enter analytics",
        durationSeconds: 30,
      },
      {
        eventName: "generation.completed",
        eventVersion: 1,
        occurredAt,
        jobId: "job_919",
        userId: "user_919",
        artistId: "artist_919",
        trackId: "track_generated_919",
        releaseId: "release_generated_919",
      },
      {
        eventName: "recommendation.generated",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        trackIds: ["track_919", "track_alt_919"],
        strategy: "preference_mapping",
      },
      {
        eventName: "wallet.spent",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        amountUsd: 1.25,
        spentUsd: 2.5,
        balanceUsd: 17.5,
      },
      {
        eventName: "curator.reported",
        eventVersion: 1,
        occurredAt,
        reportId: "rpt_919",
        curatorId: "curator_919",
        trackId: "track_919",
        reason: "suspected_rights_issue",
      },
      {
        eventName: "remix.created",
        eventVersion: 1,
        occurredAt,
        remixId: "rmx_919",
        creatorId: "creator_919",
        sourceTrackId: "track_919",
        stemIds: ["stem_1", "stem_2"],
        title: "user supplied remix title should not enter analytics",
        txHash: "tx_remix_919",
      },
      {
        eventName: "notification.created",
        eventVersion: 1,
        occurredAt,
        walletAddress: "0xwallet919",
        notificationId: "notif_919",
        type: "dispute_filed",
        title: "do not persist title",
        message: "do not persist body",
        disputeId: "disp_919",
      },
    ];

    for (const event of events) {
      eventBus.publish(event as any);
    }

    await waitForExpect(async () => expect(await ingest.listEvents()).toHaveLength(events.length));

    const analyticsEvents = await ingest.listEvents();
    expect(analyticsEvents.map((event) => event.eventName)).toEqual(events.map((event) => event.eventName));
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "payment.settled",
        producer: "payments-service",
        subjectType: "payment",
        subjectId: "pay_919",
        sessionId: "session_919",
        payload: expect.objectContaining({
          paymentId: "pay_919",
          trackId: "track_919",
          artistId: "artist_919",
          canonicalAmountUsd: 1.25,
        }),
        sourceRefs: expect.objectContaining({
          paymentId: "pay_919",
          txHash: "tx_919",
          trackId: "track_919",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "contract.stem_sold",
        subjectId: "919",
        payload: expect.objectContaining({
          listingId: "919",
          amount: "2",
          totalPaid: "2500000000000000000",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "recommendation.generated",
        payload: expect.objectContaining({
          trackIds: ["track_919", "track_alt_919"],
          trackCount: 2,
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "remix.created",
        payload: expect.objectContaining({
          stemIds: ["stem_1", "stem_2"],
          stemCount: 2,
        }),
      }),
    );
    const serializedEvents = JSON.stringify(analyticsEvents);
    expect(serializedEvents).not.toContain("private prompt");
    expect(serializedEvents).not.toContain("secretUserText");
    expect(serializedEvents).not.toContain("do not persist title");
    expect(serializedEvents).not.toContain("do not persist body");
    expect(serializedEvents).not.toContain("user supplied remix title");
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
