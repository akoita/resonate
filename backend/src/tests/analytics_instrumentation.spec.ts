import { AnalyticsCatalogMetadataService } from "../modules/analytics/analytics_catalog_metadata.service";
import { AnalyticsInstrumentationService } from "../modules/analytics/analytics_instrumentation.service";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";

describe("AnalyticsInstrumentationService", () => {
  it("deduplicates player action retries without merging different actors, tracks, events, or deliberate actions", async () => {
    const ingest = new AnalyticsIngestService();
    const instrumentation = new AnalyticsInstrumentationService(ingest);
    const input = {
      eventName: "player.action_impression", actorId: "listener_hash", sessionId: "session-1",
      subjectType: "track", subjectId: "track-1", source: "player",
      payload: { actionKeys: ["save"], actionStatuses: ["available"] },
      sourceRefs: { clientEventId: "client-event-1" },
    };
    const first = await instrumentation.recordProductEvent(input);
    const retry = await instrumentation.recordProductEvent(input);
    expect(retry.eventId).toBe(first.eventId);
    for (const variant of [
      { actorId: "another_listener_hash" },
      { subjectId: "track-2" },
      { sessionId: "session-2" },
      { eventName: "player.action_selected", payload: { actionKey: "save", actionStatus: "available" } },
      { sourceRefs: { clientEventId: "client-event-2" } },
    ]) {
      const result = await instrumentation.recordProductEvent({ ...input, ...variant });
      expect(result.eventId).not.toBe(first.eventId);
    }
    expect(await ingest.listEvents()).toHaveLength(6);
  });

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
        initiator: "listener",
        agentOriginated: false,
        outcome: {
          type: "playback_completed",
          completionRatio: 0.95,
          durationMs: 180000,
        },
      },
    });
  });

  it("mirrors a deliberate skip into a negative AgentSignal (#1449)", async () => {
    const ingest = new AnalyticsIngestService();
    const agentLearning = {
      recordSignal: jest.fn().mockResolvedValue({}),
    };
    const instrumentation = new AnalyticsInstrumentationService(
      ingest,
      undefined,
      agentLearning as any,
    );

    await instrumentation.recordPlaybackLifecycle({
      action: "skipped",
      trackId: "track-1",
      artistId: "artist-1",
      actorUserId: "user-1",
      sessionId: "playback-session-1",
      source: "web_player",
      positionMs: 12000,
      durationMs: 180000,
    } as any);

    expect(await ingest.listEvents()).toEqual([
      expect.objectContaining({ eventName: "playback.skipped" }),
    ]);
    expect(agentLearning.recordSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        trackId: "track-1",
        action: "skip",
        metadata: expect.objectContaining({
          outcome: expect.objectContaining({
            type: "playback_skipped",
            positionMs: 12000,
          }),
        }),
      }),
    );
  });

  it("mirrors playback started into an accept AgentSignal, but never heartbeats (#1449)", async () => {
    const ingest = new AnalyticsIngestService();
    const agentLearning = {
      recordSignal: jest.fn().mockResolvedValue({}),
    };
    const instrumentation = new AnalyticsInstrumentationService(
      ingest,
      undefined,
      agentLearning as any,
    );

    await instrumentation.recordPlaybackLifecycle({
      action: "started",
      trackId: "track-1",
      artistId: "artist-1",
      actorUserId: "user-1",
      source: "web_player",
    } as any);
    expect(agentLearning.recordSignal).toHaveBeenCalledWith(
      expect.objectContaining({ action: "accept", trackId: "track-1" }),
    );

    agentLearning.recordSignal.mockClear();
    await instrumentation.recordPlaybackLifecycle({
      action: "heartbeat",
      trackId: "track-1",
      artistId: "artist-1",
      actorUserId: "user-1",
      source: "web_player",
    } as any);
    expect(agentLearning.recordSignal).not.toHaveBeenCalled();
  });

  it("does not mirror agent-originated playback (the agent runtime records its own signals) (#1449)", async () => {
    const ingest = new AnalyticsIngestService();
    const agentLearning = {
      recordSignal: jest.fn().mockResolvedValue({}),
    };
    const instrumentation = new AnalyticsInstrumentationService(
      ingest,
      undefined,
      agentLearning as any,
    );

    await instrumentation.recordPlaybackLifecycle({
      action: "skipped",
      trackId: "track-1",
      artistId: "artist-1",
      actorUserId: "user-1",
      source: "web_player",
      agentOriginated: true,
    } as any);
    expect(agentLearning.recordSignal).not.toHaveBeenCalled();
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

// #1743: warehouse facts for client-emitted product events carried no artistId,
// so punchline, remix, and recommendation activity never reached the artist
// dashboard. Attribution is resolved server-side at ingest.
describe("AnalyticsInstrumentationService product artist attribution", () => {
  const trackMetadata = {
    trackId: "track-1",
    title: "Track",
    releaseId: "release-1",
    releaseTitle: "Release",
    artistId: "artist-1",
    artistName: "Artist",
    managerArtistId: "artist-1",
    managerArtistName: "Artist",
    creditedArtistId: "credited-artist-1",
    creditedArtistName: "Credited Artist",
    creditedArtistIds: ["credited-artist-1"],
    creditedArtistNames: ["Credited Artist"],
  };

  function buildCatalogMetadata(overrides: {
    findTracks?: jest.Mock;
    findPunchlineDropArtists?: jest.Mock;
  } = {}) {
    return {
      findTracks: overrides.findTracks ?? jest.fn().mockResolvedValue(new Map([["track-1", trackMetadata]])),
      findPunchlineDropArtists:
        overrides.findPunchlineDropArtists ?? jest.fn().mockResolvedValue(new Map([["drop-1", "artist-1"]])),
    };
  }

  it("resolves the artist and credited identity for a track-backed product event", async () => {
    const ingest = new AnalyticsIngestService();
    const catalogMetadata = buildCatalogMetadata();
    const instrumentation = new AnalyticsInstrumentationService(
      ingest,
      catalogMetadata as unknown as AnalyticsCatalogMetadataService,
    );

    await instrumentation.recordProductEvent({
      eventName: "recommendation.clicked",
      subjectType: "track",
      subjectId: "track-1",
      payload: { requestId: "request-1", railId: "rail-1", trackId: "track-1", position: 2 },
    });

    expect(catalogMetadata.findTracks).toHaveBeenCalledWith(["track-1"]);
    expect(await ingest.listEvents()).toEqual([
      expect.objectContaining({
        eventName: "recommendation.clicked",
        payload: expect.objectContaining({
          trackId: "track-1",
          artistId: "artist-1",
          creditedArtistId: "credited-artist-1",
          creditedArtistName: "Credited Artist",
        }),
      }),
    ]);
  });

  it("resolves the artist through the drop when a punchline event carries only a dropId", async () => {
    const ingest = new AnalyticsIngestService();
    const catalogMetadata = buildCatalogMetadata();
    const instrumentation = new AnalyticsInstrumentationService(
      ingest,
      catalogMetadata as unknown as AnalyticsCatalogMetadataService,
    );

    await instrumentation.recordProductEvent({
      eventName: "punchline.drop_viewed",
      payload: { dropId: "drop-1", momentCount: 3 },
    });

    expect(catalogMetadata.findTracks).not.toHaveBeenCalled();
    expect(catalogMetadata.findPunchlineDropArtists).toHaveBeenCalledWith(["drop-1"]);
    expect(await ingest.listEvents()).toEqual([
      expect.objectContaining({
        eventName: "punchline.drop_viewed",
        payload: expect.objectContaining({ dropId: "drop-1", artistId: "artist-1" }),
      }),
    ]);
  });

  it("leaves recommendation.served unattributed because a rail impression spans several artists", async () => {
    const ingest = new AnalyticsIngestService();
    const catalogMetadata = buildCatalogMetadata();
    const instrumentation = new AnalyticsInstrumentationService(
      ingest,
      catalogMetadata as unknown as AnalyticsCatalogMetadataService,
    );

    await instrumentation.recordProductEvent({
      eventName: "recommendation.served",
      payload: { requestId: "request-1", railId: "rail-1", trackIds: ["track-1", "track-2"], count: 2 },
    });

    expect(catalogMetadata.findTracks).not.toHaveBeenCalled();
    expect(catalogMetadata.findPunchlineDropArtists).not.toHaveBeenCalled();
    const [event] = await ingest.listEvents();
    expect(event.payload).not.toHaveProperty("artistId");
  });

  it("replaces a client-supplied artistId with the server-resolved one", async () => {
    const ingest = new AnalyticsIngestService();
    const catalogMetadata = buildCatalogMetadata();
    const instrumentation = new AnalyticsInstrumentationService(
      ingest,
      catalogMetadata as unknown as AnalyticsCatalogMetadataService,
    );

    await instrumentation.recordProductEvent({
      eventName: "player.segment_loop_enabled",
      payload: { trackId: "track-1", artistId: "spoofed-artist", startMs: 0, endMs: 5000 },
    });

    const [event] = await ingest.listEvents();
    expect((event.payload as Record<string, unknown>).artistId).toBe("artist-1");
  });

  it("keeps the payload unchanged when resolution fails and never throws at the caller", async () => {
    const ingest = new AnalyticsIngestService();
    const catalogMetadata = buildCatalogMetadata({
      findTracks: jest.fn().mockRejectedValue(new Error("catalog unavailable")),
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const instrumentation = new AnalyticsInstrumentationService(
      ingest,
      catalogMetadata as unknown as AnalyticsCatalogMetadataService,
    );

    await expect(
      instrumentation.recordProductEvent({
        eventName: "player.segment_loop_enabled",
        payload: { trackId: "track-1", artistId: "client-artist", startMs: 0, endMs: 5000 },
      }),
    ).resolves.toBeDefined();

    const [event] = await ingest.listEvents();
    expect((event.payload as Record<string, unknown>).artistId).toBe("client-artist");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("caches a resolution so impression-rate events do not repeat the lookup", async () => {
    const ingest = new AnalyticsIngestService();
    const catalogMetadata = buildCatalogMetadata();
    const instrumentation = new AnalyticsInstrumentationService(
      ingest,
      catalogMetadata as unknown as AnalyticsCatalogMetadataService,
    );

    for (const position of [1, 2, 3]) {
      await instrumentation.recordProductEvent({
        eventName: "recommendation.clicked",
        payload: { requestId: `request-${position}`, railId: "rail-1", trackId: "track-1", position },
      });
    }

    expect(catalogMetadata.findTracks).toHaveBeenCalledTimes(1);
    const events = await ingest.listEvents();
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect((event.payload as Record<string, unknown>).artistId).toBe("artist-1");
    }
  });
});
