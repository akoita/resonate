/**
 * Listening while suspended (#2167) against real Postgres, through a Nest app
 * wired like production for this slice: the global AccountStatusInterceptor, the
 * real analytics telemetry controller, the real instrumentation / ingest /
 * consent / learning services, and the real sessions controller (its service is
 * a stand-in, because the routes under test are about the gate, not the DJ).
 *
 * A suspended or closed account keeps playing (no 403 on playback routes), but
 * nothing it plays counts: no playback fact, no taste signal. A purchase is
 * still refused.
 */
import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { applyGlobalValidation } from "../config/validation";
import { prisma } from "../db/prisma";
import { AccountStandingService } from "../modules/accounts/account_standing.service";
import { AccountStatusInterceptor } from "../modules/accounts/account_status.interceptor";
import { AccountStatusService } from "../modules/accounts/account_status.service";
import { AgentLearningService } from "../modules/agents/agent_learning.service";
import { AnalyticsController } from "../modules/analytics/analytics.controller";
import { AnalyticsAuthorizationService } from "../modules/analytics/analytics_authorization.service";
import { ANALYTICS_CONSENT_POLICY_VERSION, AnalyticsConsentService } from "../modules/analytics/analytics_consent.service";
import { PrismaAnalyticsEventStore } from "../modules/analytics/analytics_event_store";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { AnalyticsInstrumentationService } from "../modules/analytics/analytics_instrumentation.service";
import { AnalyticsService } from "../modules/analytics/analytics.service";
import { AnalyticsWarehouseExportService } from "../modules/analytics/analytics_warehouse";
import { JwtStrategy } from "../modules/auth/jwt.strategy";
import { RolesGuard } from "../modules/auth/roles.guard";
import { PlaybackIntentsService } from "../modules/sessions/playback_intents.service";
import { SessionsController } from "../modules/sessions/sessions.controller";
import { SessionsService } from "../modules/sessions/sessions.service";
import { TEST_JWT_SECRET, authToken } from "./e2e-helpers";

const TEST_PREFIX = `susp_listen_${Date.now()}_`;
const ACTIVE = `${TEST_PREFIX}active`;
const SUSPENDED = `${TEST_PREFIX}suspended`;
const CLOSED = `${TEST_PREFIX}closed`;
const USERS = [ACTIVE, SUSPENDED, CLOSED];
const ARTIST = `${TEST_PREFIX}artist`;
const RELEASE = `${TEST_PREFIX}release`;
const TRACK = `${TEST_PREFIX}track`;
const DURATION_MS = 200_000;

const sessionsService = {
  startSession: jest.fn(async () => ({ sessionId: `${TEST_PREFIX}session` })),
  stopSession: jest.fn(async () => ({ stopped: true })),
  agentNext: jest.fn(async () => ({ status: "approved" })),
  playTrack: jest.fn(async () => ({ allowed: true })),
};
const playbackIntents = {
  requestPlay: jest.fn(async () => ({ status: "queued" })),
};

describe("listening while suspended (integration)", () => {
  let app: INestApplication;
  const standing = new AccountStandingService();
  const as = (id: string) => ({ Authorization: `Bearer ${authToken(id)}` });
  const server = () => app.getHttpServer();

  /** The three telemetry calls a real play makes, in order. */
  async function play(userId: string, instance: string) {
    const started = await request(server())
      .post("/analytics/playback/event")
      .set(as(userId))
      .send({ action: "started", trackId: TRACK, artistId: ARTIST, source: "web_player", playbackInstanceId: instance });
    const counted = await request(server())
      .post("/analytics/playback/completed")
      .set(as(userId))
      .send({
        trackId: TRACK,
        artistId: ARTIST,
        source: "web_player",
        playbackInstanceId: instance,
        completionRatio: 30_000 / DURATION_MS,
        durationMs: DURATION_MS,
      });
    const playedThrough = await request(server())
      .post("/analytics/playback/event")
      .set(as(userId))
      .send({
        action: "played_through",
        trackId: TRACK,
        artistId: ARTIST,
        source: "web_player",
        playbackInstanceId: instance,
        positionMs: 185_000,
        durationMs: DURATION_MS,
      });
    return [started, counted, playedThrough];
  }

  const playbackFacts = () =>
    prisma.analyticsEvent.findMany({
      where: { subjectId: TRACK, eventName: { startsWith: "playback." } },
    });
  const signalsFor = (userId: string) => prisma.agentSignal.findMany({ where: { userId, trackId: TRACK } });

  beforeAll(async () => {
    await prisma.user.createMany({ data: USERS.map((id) => ({ id, email: `${id}@test.resonate` })) });
    for (const id of USERS) {
      await prisma.analyticsConsent.create({
        data: {
          userId: id,
          productAnalytics: true,
          policyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
          decidedAt: new Date(),
        },
      });
    }
    await prisma.artist.create({ data: { id: ARTIST, displayName: "Suspended Listening Artist" } });
    await prisma.release.create({
      data: {
        id: RELEASE,
        artistId: ARTIST,
        title: "Suspended Listening Release",
        genre: "Deep House",
        status: "published",
        primaryArtist: "Suspended Listening Credit",
      },
    });
    await prisma.track.create({ data: { id: TRACK, releaseId: RELEASE, title: "Suspended Listening Track", position: 1 } });

    const ingest = new AnalyticsIngestService(new PrismaAnalyticsEventStore());
    const instrumentation = new AnalyticsInstrumentationService(
      ingest,
      undefined,
      new AgentLearningService(),
      standing,
    );
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [() => ({ JWT_SECRET: TEST_JWT_SECRET })] }),
        PassportModule.register({ defaultStrategy: "jwt" }),
        JwtModule.register({ secret: TEST_JWT_SECRET, signOptions: { expiresIn: "1h" } }),
      ],
      controllers: [AnalyticsController, SessionsController],
      providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_INTERCEPTOR, useClass: AccountStatusInterceptor },
        { provide: AccountStatusService, useValue: { getEffective: (id: string) => standing.getEffective(id) } },
        { provide: AnalyticsInstrumentationService, useValue: instrumentation },
        { provide: AnalyticsIngestService, useValue: ingest },
        AnalyticsConsentService,
        { provide: AnalyticsService, useValue: {} },
        { provide: AnalyticsAuthorizationService, useValue: {} },
        { provide: AnalyticsWarehouseExportService, useValue: {} },
        { provide: SessionsService, useValue: sessionsService },
        { provide: PlaybackIntentsService, useValue: playbackIntents },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    applyGlobalValidation(app);
    await app.init();
  });

  afterAll(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { subjectId: TRACK } });
    await prisma.agentSignal.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.analyticsConsent.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.track.deleteMany({ where: { id: TRACK } });
    await prisma.release.deleteMany({ where: { id: RELEASE } });
    await prisma.artist.deleteMany({ where: { id: ARTIST } });
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await prisma.analyticsEvent.deleteMany({ where: { subjectId: TRACK } });
    await prisma.agentSignal.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.user.update({ where: { id: SUSPENDED }, data: { accountStatus: "suspended", accountStatusReason: "abuse" } });
    await prisma.user.update({ where: { id: CLOSED }, data: { accountStatus: "closed", accountStatusReason: "fraud" } });
    standing.clearCache();
  });

  it("counts an active account's play: facts and a taste signal", async () => {
    const responses = await play(ACTIVE, `${TEST_PREFIX}active_instance`);
    for (const res of responses) expect(res.status).toBe(201);
    expect((await playbackFacts()).map((fact) => fact.eventName).sort()).toEqual([
      "playback.completed",
      "playback.played_through",
      "playback.started",
    ]);
    expect((await signalsFor(ACTIVE)).length).toBeGreaterThan(0);
  });

  it.each([
    ["suspended", SUSPENDED],
    ["closed", CLOSED],
  ])("lets a %s account keep playing (no 403) but records nothing", async (_label, userId) => {
    const responses = await play(userId, `${TEST_PREFIX}${_label}_instance`);
    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("skipped");
      expect(res.body.reason).toBe("account_restricted");
    }
    expect(await playbackFacts()).toEqual([]);
    expect(await signalsFor(userId)).toEqual([]);
  });

  it("does not let a suspended account record a play through the generic product route either", async () => {
    // Blocked outright by the suspension (not on the allowlist), and dropped
    // by the instrumentation even if it ever were.
    await request(server())
      .post("/analytics/product/event")
      .set(as(SUSPENDED))
      .send({ eventName: "playback.completed", subjectType: "track", subjectId: TRACK })
      .expect(403);
    const instrumentation = app.get(AnalyticsInstrumentationService);
    const result = await instrumentation.recordProductEvent({
      eventName: "playback.completed",
      subjectType: "track",
      subjectId: TRACK,
      actorId: `${TEST_PREFIX}pseudonym`,
      actorUserId: SUSPENDED,
    });
    expect(result.status).toBe("skipped");
    expect(await playbackFacts()).toEqual([]);
  });

  it("lets a suspended account start, continue and stop a listening session", async () => {
    await request(server()).post("/sessions/start").set(as(SUSPENDED)).send({ budgetCapUsd: 0 }).expect(201);
    await request(server()).post("/sessions/agent/next").set(as(SUSPENDED)).send({ sessionId: "s1" }).expect(201);
    await request(server()).post("/sessions/playback/play").set(as(SUSPENDED)).send({ trackIds: [TRACK] }).expect(201);
    await request(server()).post("/sessions/stop").set(as(SUSPENDED)).send({ sessionId: "s1" }).expect(201);
    expect(sessionsService.startSession).toHaveBeenCalledTimes(1);
    expect(sessionsService.agentNext).toHaveBeenCalledTimes(1);
    expect(playbackIntents.requestPlay).toHaveBeenCalledTimes(1);
  });

  it("still refuses a purchase by a suspended or closed account", async () => {
    for (const userId of [SUSPENDED, CLOSED]) {
      const res = await request(server())
        .post("/sessions/play")
        .set(as(userId))
        .send({ sessionId: "s1", trackId: TRACK, priceUsd: 1 })
        .expect(403);
      expect(res.body.code).toBe(userId === SUSPENDED ? "account_suspended" : "account_closed");
    }
    expect(sessionsService.playTrack).not.toHaveBeenCalled();
    await request(server())
      .post("/sessions/play")
      .set(as(ACTIVE))
      .send({ sessionId: "s1", trackId: TRACK, priceUsd: 1 })
      .expect(201);
  });

  it("counts plays again once the suspension is lifted", async () => {
    await prisma.user.update({
      where: { id: SUSPENDED },
      data: { accountStatus: "active", accountStatusReason: null },
    });
    standing.clearCache();
    await play(SUSPENDED, `${TEST_PREFIX}lifted_instance`);
    expect((await playbackFacts()).length).toBe(3);
  });
});
