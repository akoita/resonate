import { ForbiddenException, INestApplication } from "@nestjs/common";
import request from "supertest";
import { AnalyticsAuthorizationService } from "../modules/analytics/analytics_authorization.service";
import { AnalyticsController } from "../modules/analytics/analytics.controller";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { AnalyticsInstrumentationService } from "../modules/analytics/analytics_instrumentation.service";
import { AnalyticsService } from "../modules/analytics/analytics.service";
import { AnalyticsWarehouseExportService } from "../modules/analytics/analytics_warehouse";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const analyticsService = {
  getArtistStats: jest.fn(),
  getArtistDashboard: jest.fn(),
  getAgentQualityDashboard: jest.fn(),
};

const authorizationService = {
  assertCanReadArtistMetrics: jest.fn(),
  assertCanReadAgentQualityDashboard: jest.fn(),
};

const ingestService = {
  ingest: jest.fn(),
  dailyRollup: jest.fn(),
};

const warehouseExportService = {
  exportLayers: jest.fn(),
};

const instrumentationService = {
  recordPlaybackCompleted: jest.fn(),
  recordPlaybackLifecycle: jest.fn(),
  recordProductEvent: jest.fn(),
};

describe("AnalyticsController (HTTP)", () => {
  let app: INestApplication;
  let warnSpy: jest.SpyInstance;

  beforeAll(async () => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    app = await createControllerTestApp(AnalyticsController, [
      { provide: AnalyticsService, useValue: analyticsService },
      { provide: AnalyticsAuthorizationService, useValue: authorizationService },
      { provide: AnalyticsIngestService, useValue: ingestService },
      { provide: AnalyticsWarehouseExportService, useValue: warehouseExportService },
      { provide: AnalyticsInstrumentationService, useValue: instrumentationService },
    ]);
  });

  afterAll(async () => {
    await app.close();
    warnSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    analyticsService.getArtistStats.mockResolvedValue({ summary: { totalPlays: 0 }, tracks: [] });
    analyticsService.getArtistDashboard.mockResolvedValue({
      summary: { totalPlays: 0 },
      tracks: [],
      meta: { isEmpty: true },
    });
    analyticsService.getAgentQualityDashboard.mockResolvedValue({
      summary: { sessionsStarted: 0, acceptanceRate: 0 },
      intentBreakdown: [],
      meta: { isEmpty: true },
    });
    authorizationService.assertCanReadArtistMetrics.mockResolvedValue(undefined);
    authorizationService.assertCanReadAgentQualityDashboard.mockReturnValue(undefined);
    instrumentationService.recordPlaybackCompleted.mockResolvedValue({
      status: "ok",
      eventId: "evt_playback_completed",
      ingested: 1,
    });
    instrumentationService.recordPlaybackLifecycle.mockResolvedValue({
      status: "ok",
      eventId: "evt_playback_lifecycle",
      ingested: 1,
    });
    instrumentationService.recordProductEvent.mockResolvedValue({
      status: "ok",
      eventId: "evt_product_event",
      ingested: 1,
    });
  });

  it("GET /analytics/artist/:id/v1 requires JWT auth", async () => {
    await request(app.getHttpServer()).get("/analytics/artist/artist-1/v1").expect(401);
  });

  it("authorizes artist dashboard access before returning metrics", async () => {
    await request(app.getHttpServer())
      .get("/analytics/artist/artist-1/v1?days=14")
      .set("Authorization", `Bearer ${authToken("user-1", "artist")}`)
      .expect(200);

    expect(authorizationService.assertCanReadArtistMetrics).toHaveBeenCalledWith("artist-1", {
      userId: "user-1",
      role: "artist",
    });
    expect(analyticsService.getArtistDashboard).toHaveBeenCalledWith("artist-1", 14);
  });

  it("rejects artist dashboard access when the authorization check fails", async () => {
    authorizationService.assertCanReadArtistMetrics.mockRejectedValue(
      new ForbiddenException("Artist analytics are restricted to the artist owner"),
    );

    await request(app.getHttpServer())
      .get("/analytics/artist/artist-2/v1")
      .set("Authorization", `Bearer ${authToken("user-1", "artist")}`)
      .expect(403);

    expect(analyticsService.getArtistDashboard).not.toHaveBeenCalled();
  });

  it("authorizes the legacy artist stats endpoint too", async () => {
    await request(app.getHttpServer())
      .get("/analytics/artist/artist-1?days=7")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .expect(200);

    expect(authorizationService.assertCanReadArtistMetrics).toHaveBeenCalledWith("artist-1", {
      userId: "admin-1",
      role: "admin",
    });
    expect(analyticsService.getArtistStats).toHaveBeenCalledWith("artist-1", 7);
  });

  it("GET /analytics/agent/quality requires JWT auth", async () => {
    await request(app.getHttpServer()).get("/analytics/agent/quality").expect(401);
  });

  it("authorizes aggregate AI DJ quality metrics for operators", async () => {
    await request(app.getHttpServer())
      .get("/analytics/agent/quality?days=90")
      .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
      .expect(200);

    expect(authorizationService.assertCanReadAgentQualityDashboard).toHaveBeenCalledWith({
      userId: "operator-1",
      role: "operator",
    });
    expect(analyticsService.getAgentQualityDashboard).toHaveBeenCalledWith(90);
  });

  it("rejects AI DJ quality metrics when the role gate fails", async () => {
    authorizationService.assertCanReadAgentQualityDashboard.mockImplementation(() => {
      throw new ForbiddenException("AI DJ quality analytics are restricted to operators");
    });

    await request(app.getHttpServer())
      .get("/analytics/agent/quality")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(403);

    expect(analyticsService.getAgentQualityDashboard).not.toHaveBeenCalled();
  });

  it("records playback completion through the instrumentation service", async () => {
    await request(app.getHttpServer())
      .post("/analytics/playback/completed")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({
        trackId: "track-1",
        artistId: "artist-1",
        releaseId: "release-1",
        sessionId: "playback-session-1",
        source: "web_player",
        completionRatio: 0.82,
        durationMs: 31000,
      })
      .expect(201);

    expect(instrumentationService.recordPlaybackCompleted).toHaveBeenCalledWith(expect.objectContaining({
      trackId: "track-1",
      artistId: "artist-1",
      releaseId: "release-1",
      sessionId: "playback-session-1",
      source: "web_player",
      completionRatio: 0.82,
      durationMs: 31000,
      actorId: expect.stringMatching(/^user_[0-9a-f]{32}$/),
      actorUserId: "listener-1",
    }));
  });

  it("accepts playback completion without artist id for backend catalog enrichment", async () => {
    await request(app.getHttpServer())
      .post("/analytics/playback/completed")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({
        trackId: "track-1",
        sessionId: "playback-session-1",
        source: "web_player",
        completionRatio: 0.82,
        durationMs: 31000,
      })
      .expect(201);

    expect(instrumentationService.recordPlaybackCompleted).toHaveBeenCalledWith(expect.objectContaining({
      trackId: "track-1",
      artistId: undefined,
      releaseId: undefined,
      sessionId: "playback-session-1",
      source: "web_player",
      completionRatio: 0.82,
      durationMs: 31000,
      actorId: expect.stringMatching(/^user_[0-9a-f]{32}$/),
      actorUserId: "listener-1",
    }));
  });

  it("records playback lifecycle events with the pseudonymous user actor", async () => {
    await request(app.getHttpServer())
      .post("/analytics/playback/event")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({
        action: "heartbeat",
        trackId: "track-1",
        artistId: "artist-1",
        releaseId: "release-1",
        sessionId: "playback-session-1",
        playbackInstanceId: "playback-instance-1",
        source: "web_player",
        positionMs: 30000,
        durationMs: 120000,
        heartbeatIntervalMs: 30000,
        queueIndex: 2,
        queueLength: 8,
        repeatMode: "all",
        shuffle: true,
      })
      .expect(201);

    expect(instrumentationService.recordPlaybackLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      action: "heartbeat",
      trackId: "track-1",
      artistId: "artist-1",
      releaseId: "release-1",
      sessionId: "playback-session-1",
      playbackInstanceId: "playback-instance-1",
      source: "web_player",
      positionMs: 30000,
      durationMs: 120000,
      heartbeatIntervalMs: 30000,
      queueIndex: 2,
      queueLength: 8,
      repeatMode: "all",
      shuffle: true,
      actorId: expect.stringMatching(/^user_[0-9a-f]{32}$/),
      actorUserId: "listener-1",
    }));
  });

  it("rejects malformed playback completion payloads", async () => {
    await request(app.getHttpServer())
      .post("/analytics/playback/completed")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({
        trackId: "track-1",
        artistId: "artist-1",
        completionRatio: 2,
      })
      .expect(400);

    expect(instrumentationService.recordPlaybackCompleted).not.toHaveBeenCalled();
  });

  it("records allowed product analytics events with sanitized payload and pseudonymous actor", async () => {
    await request(app.getHttpServer())
      .post("/analytics/product/event")
      .set("Authorization", `Bearer ${authToken("artist-1", "artist")}`)
      .send({
        eventName: "artist.upload_step_completed",
        sessionId: "onboarding-session-1",
        subjectType: "release",
        subjectId: "release-1",
        clientEventId: "client-event-1",
        geo: {
          countryCode: "fr",
          regionCode: "idf",
          citySlug: "Paris",
          source: "user_declared",
          precision: "city",
          rawIp: "203.0.113.1",
        },
        payload: {
          step: "stems",
          fileCount: 8,
          completed: true,
          nested: { should: "drop" },
          rawIp: "203.0.113.1",
          reallyLong: "x".repeat(300),
        },
      })
      .expect(201);

    expect(instrumentationService.recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: "artist.upload_step_completed",
      sessionId: "onboarding-session-1",
      traceId: undefined,
      subjectType: "release",
      subjectId: "release-1",
      source: "web_app",
      geo: {
        countryCode: "FR",
        regionCode: "IDF",
        citySlug: "paris",
        source: "user_declared",
        precision: "city",
      },
      payload: {
        step: "stems",
        fileCount: 8,
        completed: true,
        reallyLong: "x".repeat(240),
      },
      sourceRefs: { clientEventId: "client-event-1" },
      actorId: expect.stringMatching(/^user_[0-9a-f]{32}$/),
      actorUserId: "artist-1",
    }));
  });

  it("accepts Session Intent product analytics events emitted by the AI DJ UI", async () => {
    await request(app.getHttpServer())
      .post("/analytics/product/event")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({
        eventName: "agent.intent_selected",
        sessionId: "product-session-1",
        subjectType: "agent_session",
        subjectId: "agent-session-1",
        clientEventId: "client-event-2",
        payload: {
          intent: "focus",
          intentName: "Neural Flow",
          mood: "Focus",
          energy: "low",
          queueStyle: "stable",
          commercePosture: "curate",
        },
      })
      .expect(201);

    expect(instrumentationService.recordProductEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "agent.intent_selected",
        sessionId: "product-session-1",
        subjectType: "agent_session",
        subjectId: "agent-session-1",
        payload: expect.objectContaining({
          intent: "focus",
          intentName: "Neural Flow",
          mood: "Focus",
          energy: "low",
        }),
        actorId: expect.stringMatching(/^user_[0-9a-f]{32}$/),
      }),
    );
  });

  it("rejects unsupported product analytics event names", async () => {
    await request(app.getHttpServer())
      .post("/analytics/product/event")
      .set("Authorization", `Bearer ${authToken("artist-1", "artist")}`)
      .send({
        eventName: "freeform.everything",
        payload: { step: "anything" },
      })
      .expect(400);

    expect(instrumentationService.recordProductEvent).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("analytics_product_event_rejected"));
  });
});
