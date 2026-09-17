import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AnalyticsAuthorizationService } from "../modules/analytics/analytics_authorization.service";
import {
  ANALYTICS_CONSENT_POLICY_VERSION,
  AnalyticsConsentService,
} from "../modules/analytics/analytics_consent.service";
import { AnalyticsController } from "../modules/analytics/analytics.controller";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { AnalyticsInstrumentationService } from "../modules/analytics/analytics_instrumentation.service";
import { AnalyticsService } from "../modules/analytics/analytics.service";
import { AnalyticsWarehouseExportService } from "../modules/analytics/analytics_warehouse";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const instrumentationService = {
  recordPlaybackCompleted: jest.fn(),
  recordPlaybackLifecycle: jest.fn(),
  recordProductEvent: jest.fn(),
};

const consentService = {
  isProductAnalyticsAllowed: jest.fn(),
  getDecision: jest.fn(),
  record: jest.fn(),
};

const PLAYBACK_COMPLETED_BODY = {
  trackId: "track-1",
  sessionId: "playback-session-1",
  source: "web_player",
  completionRatio: 0.9,
  durationMs: 31000,
};

const PLAYBACK_LIFECYCLE_BODY = {
  action: "started",
  trackId: "track-1",
  sessionId: "playback-session-1",
  source: "web_player",
};

const PRODUCT_EVENT_BODY = {
  eventName: "search.submitted",
  sessionId: "product-session-1",
  payload: { queryLength: 4 },
};

const TELEMETRY_ROUTES = [
  {
    name: "POST /analytics/playback/completed",
    path: "/analytics/playback/completed",
    body: PLAYBACK_COMPLETED_BODY,
    recorder: () => instrumentationService.recordPlaybackCompleted,
  },
  {
    name: "POST /analytics/playback/event",
    path: "/analytics/playback/event",
    body: PLAYBACK_LIFECYCLE_BODY,
    recorder: () => instrumentationService.recordPlaybackLifecycle,
  },
  {
    name: "POST /analytics/product/event",
    path: "/analytics/product/event",
    body: PRODUCT_EVENT_BODY,
    recorder: () => instrumentationService.recordProductEvent,
  },
];

describe("Analytics consent gate (HTTP)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(AnalyticsController, [
      { provide: AnalyticsService, useValue: {} },
      { provide: AnalyticsAuthorizationService, useValue: {} },
      { provide: AnalyticsIngestService, useValue: { ingest: jest.fn(), dailyRollup: jest.fn() } },
      { provide: AnalyticsWarehouseExportService, useValue: { exportLayers: jest.fn() } },
      { provide: AnalyticsInstrumentationService, useValue: instrumentationService },
      { provide: AnalyticsConsentService, useValue: consentService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    instrumentationService.recordPlaybackCompleted.mockResolvedValue({ status: "ok", eventId: "evt_1", ingested: 1 });
    instrumentationService.recordPlaybackLifecycle.mockResolvedValue({ status: "ok", eventId: "evt_2", ingested: 1 });
    instrumentationService.recordProductEvent.mockResolvedValue({ status: "ok", eventId: "evt_3", ingested: 1 });
  });

  describe.each(TELEMETRY_ROUTES)("$name", (route) => {
    it("records under an explicit consent basis when the person granted consent", async () => {
      consentService.isProductAnalyticsAllowed.mockResolvedValue(true);

      const response = await request(app.getHttpServer())
        .post(route.path)
        .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
        .send(route.body)
        .expect(201);

      expect(consentService.isProductAnalyticsAllowed).toHaveBeenCalledWith("listener-1");
      expect(route.recorder()).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: "listener-1",
          consentBasis: "consent",
        }),
      );
      expect(response.body).toMatchObject({ status: "ok" });
    });

    it("records nothing and answers 202 when no decision has been recorded", async () => {
      consentService.isProductAnalyticsAllowed.mockResolvedValue(false);

      const response = await request(app.getHttpServer())
        .post(route.path)
        .set("Authorization", `Bearer ${authToken("listener-2", "listener")}`)
        .send(route.body)
        .expect(202);

      expect(response.body).toEqual({ recorded: false, reason: "consent_not_granted" });
      expect(route.recorder()).not.toHaveBeenCalled();
    });

    it("requires authentication", async () => {
      await request(app.getHttpServer()).post(route.path).send(route.body).expect(401);
      expect(route.recorder()).not.toHaveBeenCalled();
    });
  });

  it("GET /analytics/consent returns only the authenticated user's decision, plus the current policy version", async () => {
    const decidedAt = new Date("2026-09-01T10:00:00.000Z");
    // A decision given against superseded text: the client has to re-ask, and
    // the server says so rather than making the client compare version strings.
    consentService.getDecision.mockResolvedValue({
      productAnalytics: true,
      decided: true,
      needsDecision: true,
      policyVersion: "analytics-consent:2026-01-01",
      decidedAt,
    });

    const response = await request(app.getHttpServer())
      .get("/analytics/consent?userId=someone-else")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(200);

    expect(consentService.getDecision).toHaveBeenCalledWith("listener-1");
    expect(response.body).toMatchObject({
      productAnalytics: true,
      decided: true,
      needsDecision: true,
      policyVersion: "analytics-consent:2026-01-01",
      currentPolicyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
    });
  });

  it.each([
    [
      "never decided",
      { productAnalytics: false, decided: false, needsDecision: true },
      true,
    ],
    [
      "granted against the current text",
      {
        productAnalytics: true,
        decided: true,
        needsDecision: false,
        policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
      },
      false,
    ],
    [
      "refused against the current text",
      {
        productAnalytics: false,
        decided: true,
        needsDecision: false,
        policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
      },
      false,
    ],
  ])("GET /analytics/consent reports needsDecision for a user %s", async (_label, decision, needsDecision) => {
    consentService.getDecision.mockResolvedValue(decision);

    const response = await request(app.getHttpServer())
      .get("/analytics/consent")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(200);

    expect(response.body.needsDecision).toBe(needsDecision);
  });

  it("GET /analytics/consent requires authentication", async () => {
    await request(app.getHttpServer()).get("/analytics/consent").expect(401);
    expect(consentService.getDecision).not.toHaveBeenCalled();
  });

  it("PUT /analytics/consent writes the authenticated user's decision and ignores a body user id", async () => {
    consentService.record.mockResolvedValue({
      productAnalytics: true,
      decided: true,
      needsDecision: false,
      policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
      decidedAt: new Date("2026-09-01T10:00:00.000Z"),
    });

    const response = await request(app.getHttpServer())
      .put("/analytics/consent")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({
        productAnalytics: true,
        policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
        userId: "victim-1",
        actorUserId: "victim-1",
      })
      .expect(200);

    expect(consentService.record).toHaveBeenCalledTimes(1);
    // No policy version is forwarded: the service stores the server constant,
    // so a client string can never become the recorded evidence.
    expect(consentService.record).toHaveBeenCalledWith("listener-1", true);
    expect(response.body).toMatchObject({
      policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
      currentPolicyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
    });
  });

  it("PUT /analytics/consent records a refusal", async () => {
    consentService.record.mockResolvedValue({
      productAnalytics: false,
      decided: true,
      needsDecision: false,
      policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
      decidedAt: new Date("2026-09-01T10:00:00.000Z"),
    });

    const response = await request(app.getHttpServer())
      .put("/analytics/consent")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({ productAnalytics: false, policyVersion: ANALYTICS_CONSENT_POLICY_VERSION })
      .expect(200);

    expect(consentService.record).toHaveBeenCalledWith("listener-1", false);
    expect(response.body).toMatchObject({ productAnalytics: false, decided: true });
  });

  it("PUT /analytics/consent rejects a stale policy version with 409 and writes nothing", async () => {
    const response = await request(app.getHttpServer())
      .put("/analytics/consent")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({ productAnalytics: true, policyVersion: "analytics-consent:2026-01-01" })
      .expect(409);

    expect(response.body).toMatchObject({
      error: "policy_version_stale",
      currentVersion: ANALYTICS_CONSENT_POLICY_VERSION,
    });
    expect(consentService.record).not.toHaveBeenCalled();
  });

  it("PUT /analytics/consent rejects a version from the future too — any mismatch means the text is not the served one", async () => {
    await request(app.getHttpServer())
      .put("/analytics/consent")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({ productAnalytics: false, policyVersion: `${ANALYTICS_CONSENT_POLICY_VERSION}-draft` })
      .expect(409);

    expect(consentService.record).not.toHaveBeenCalled();
  });

  it("PUT /analytics/consent rejects a missing or non-boolean decision and a missing policy version", async () => {
    const token = `Bearer ${authToken("listener-1", "listener")}`;

    await request(app.getHttpServer())
      .put("/analytics/consent")
      .set("Authorization", token)
      .send({ policyVersion: ANALYTICS_CONSENT_POLICY_VERSION })
      .expect(400);

    await request(app.getHttpServer())
      .put("/analytics/consent")
      .set("Authorization", token)
      .send({ productAnalytics: "true", policyVersion: ANALYTICS_CONSENT_POLICY_VERSION })
      .expect(400);

    await request(app.getHttpServer())
      .put("/analytics/consent")
      .set("Authorization", token)
      .send({ productAnalytics: true })
      .expect(400);

    expect(consentService.record).not.toHaveBeenCalled();
  });

  it("PUT /analytics/consent requires authentication", async () => {
    await request(app.getHttpServer())
      .put("/analytics/consent")
      .send({ productAnalytics: true, policyVersion: ANALYTICS_CONSENT_POLICY_VERSION })
      .expect(401);
    expect(consentService.record).not.toHaveBeenCalled();
  });
});
