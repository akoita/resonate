import { AnalyticsCatalogMetadataService } from "../modules/analytics/analytics_catalog_metadata.service";
import { AnalyticsInstrumentationService } from "../modules/analytics/analytics_instrumentation.service";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";

describe("AnalyticsInstrumentationService", () => {
  it("emits generation events with the required personal-data consent basis", async () => {
    const ingest = new AnalyticsIngestService();
    const instrumentation = new AnalyticsInstrumentationService(ingest);

    await instrumentation.recordGenerationCreated({
      generationId: "generation-1",
      userId: "user-1",
      model: "lyria",
    });

    expect(await ingest.listEvents()).toEqual([
      expect.objectContaining({
        eventName: "generation.created",
        privacyTier: "personal",
        consentBasis: "platform_analytics:v1",
        payload: expect.objectContaining({
          generationId: "generation-1",
          userId: "user-1",
          model: "lyria",
        }),
      }),
    ]);
  });

  it("resolves playback artist id from catalog metadata when the client omits it", async () => {
    const ingest = new AnalyticsIngestService();
    const catalogMetadata = {
      findTracks: jest.fn().mockResolvedValue(
        new Map([
          [
            "track-1",
            {
              trackId: "track-1",
              title: "Track",
              releaseId: "release-1",
              releaseTitle: "Release",
              artistId: "artist-1",
              artistName: "Artist",
            },
          ],
        ]),
      ),
    };
    const instrumentation = new AnalyticsInstrumentationService(
      ingest,
      catalogMetadata as unknown as AnalyticsCatalogMetadataService,
    );

    await instrumentation.recordPlaybackCompleted({
      trackId: "track-1",
      sessionId: "session-1",
      source: "web_player",
      completionRatio: 1,
    });

    expect(catalogMetadata.findTracks).toHaveBeenCalledWith(["track-1"]);
    expect(await ingest.listEvents()).toEqual([
      expect.objectContaining({
        eventName: "playback.completed",
        payload: expect.objectContaining({
          trackId: "track-1",
          artistId: "artist-1",
          releaseId: "release-1",
        }),
        sourceRefs: expect.objectContaining({
          trackId: "track-1",
          releaseId: "release-1",
        }),
      }),
    ]);
  });

  it("mirrors playback completions into AgentSignal outcomes when an authenticated user is available", async () => {
    const ingest = new AnalyticsIngestService();
    const agentLearning = {
      recordSignal: jest.fn().mockResolvedValue({}),
    };
    const instrumentation = new AnalyticsInstrumentationService(
      ingest,
      undefined,
      agentLearning as any,
    );

    await instrumentation.recordPlaybackCompleted({
      trackId: "track-1",
      artistId: "artist-1",
      actorId: "user_hash",
      actorUserId: "user-1",
      sessionId: "playback-session-1",
      source: "web_player",
      completionRatio: 0.95,
      durationMs: 180000,
    });

    expect(agentLearning.recordSignal).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: undefined,
      trackId: "track-1",
      action: "complete",
      metadata: {
        schemaVersion: "agent-signal-metadata/v1",
        source: "web_player",
        outcome: {
          type: "playback_completed",
          completionRatio: 0.95,
          durationMs: 180000,
        },
      },
    });
  });

  it("emits playback lifecycle events with listener, instance, and queue dimensions", async () => {
    const ingest = new AnalyticsIngestService();
    const instrumentation = new AnalyticsInstrumentationService(ingest);

    await instrumentation.recordPlaybackLifecycle({
      action: "heartbeat",
      trackId: "track-1",
      artistId: "artist-1",
      releaseId: "release-1",
      actorId: "listener_hash",
      sessionId: "session-1",
      playbackInstanceId: "playback-instance-1",
      source: "web_player",
      positionMs: 30000,
      durationMs: 120000,
      heartbeatIntervalMs: 30000,
      queueIndex: 1,
      queueLength: 4,
      repeatMode: "all",
      shuffle: true,
    });

    expect(await ingest.listEvents()).toEqual([
      expect.objectContaining({
        eventName: "playback.heartbeat",
        actorId: "listener_hash",
        sessionId: "session-1",
        payload: expect.objectContaining({
          action: "heartbeat",
          trackId: "track-1",
          artistId: "artist-1",
          releaseId: "release-1",
          playbackInstanceId: "playback-instance-1",
          positionMs: 30000,
          heartbeatIntervalMs: 30000,
          queueIndex: 1,
          queueLength: 4,
          repeatMode: "all",
          shuffle: true,
        }),
        sourceRefs: expect.objectContaining({
          actorId: "listener_hash",
          playbackInstanceId: "playback-instance-1",
          action: "heartbeat",
          positionMs: "30000",
        }),
      }),
    ]);
  });

  it("emits generic product events for app-wide analytics memory", async () => {
    const ingest = new AnalyticsIngestService();
    const instrumentation = new AnalyticsInstrumentationService(ingest);

    await instrumentation.recordProductEvent({
      eventName: "playlist.track_added",
      actorId: "user_hash",
      sessionId: "session-1",
      subjectType: "playlist",
      subjectId: "playlist-1",
      source: "web_app",
      payload: {
        playlistId: "playlist-1",
        trackId: "track-1",
        position: 3,
      },
      sourceRefs: { clientEventId: "client-event-1" },
    });

    expect(await ingest.listEvents()).toEqual([
      expect.objectContaining({
        eventName: "playlist.track_added",
        producer: "web-app",
        actorId: "user_hash",
        sessionId: "session-1",
        subjectType: "playlist",
        subjectId: "playlist-1",
        payload: expect.objectContaining({
          playlistId: "playlist-1",
          trackId: "track-1",
          position: 3,
          source: "web_app",
        }),
        sourceRefs: expect.objectContaining({
          actorId: "user_hash",
          sessionId: "session-1",
          subjectId: "playlist-1",
          clientEventId: "client-event-1",
        }),
      }),
    ]);
  });

  it("mirrors library saves into AgentSignal save outcomes", async () => {
    const ingest = new AnalyticsIngestService();
    const agentLearning = {
      recordSignal: jest.fn().mockResolvedValue({}),
    };
    const instrumentation = new AnalyticsInstrumentationService(
      ingest,
      undefined,
      agentLearning as any,
    );

    await instrumentation.recordProductEvent({
      eventName: "library.saved",
      actorId: "user_hash",
      actorUserId: "user-1",
      subjectType: "track",
      subjectId: "track-1",
      source: "library",
      payload: {
        trackId: "track-1",
      },
    });

    expect(agentLearning.recordSignal).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: undefined,
      trackId: "track-1",
      action: "save",
      metadata: {
        schemaVersion: "agent-signal-metadata/v1",
        source: "library",
        outcome: {
          type: "library.saved",
          source: "library",
        },
      },
    });
  });

  it("emits coarse geo dimensions on product events outside the free-form payload", async () => {
    const ingest = new AnalyticsIngestService();
    const instrumentation = new AnalyticsInstrumentationService(ingest);

    await instrumentation.recordProductEvent({
      eventName: "shows.pledge_intent_created",
      producer: "shows-service",
      actorId: "user_hash",
      subjectType: "show_campaign",
      subjectId: "campaign-1",
      source: "shows-api",
      geo: {
        countryCode: "FR",
        regionCode: "IDF",
        citySlug: "paris",
        source: "user_declared",
        precision: "city",
      },
      payload: {
        campaignId: "campaign-1",
        amountUnits: "25000000",
      },
    });

    expect(await ingest.listEvents()).toEqual([
      expect.objectContaining({
        eventName: "shows.pledge_intent_created",
        producer: "shows-service",
        geo: {
          countryCode: "FR",
          regionCode: "IDF",
          citySlug: "paris",
          source: "user_declared",
          precision: "city",
        },
        payload: expect.objectContaining({
          campaignId: "campaign-1",
          amountUnits: "25000000",
          source: "shows-api",
        }),
      }),
    ]);
  });
});
