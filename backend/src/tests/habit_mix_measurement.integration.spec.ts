import { prisma } from "../db/prisma";
import { AgentRuntimeService } from "../modules/agents/agent_runtime.service";
import { resolveListeningLanes } from "../modules/agents/listening_lanes.service";
import { EventBus } from "../modules/shared/event_bus";
import { AnalyticsDomainEventBridgeService } from "../modules/analytics/analytics_domain_event_bridge.service";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { PrismaAnalyticsEventStore } from "../modules/analytics/analytics_event_store";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import { AnalyticsService } from "../modules/analytics/analytics.service";

const prefix = `habitmeasurement_${Date.now()}_`;
const user = `${prefix}user`;
const track = `${prefix}track`;
const sessions = [1, 2].map((i) => `${prefix}history${i}`);
const originalExperiment = process.env.DISCOVERY_RANKER_EXPERIMENT;

describe("Habit Mix measurement ledger and dashboard (integration)", () => {
  const bus = new EventBus();
  const ingest = new AnalyticsIngestService(new PrismaAnalyticsEventStore());
  const bridge = new AnalyticsDomainEventBridgeService(bus, ingest);
  const executor = {
    run: jest.fn(async () => ({ status: "approved", tracks: [{ trackId: track }, { trackId: `${prefix}track2` }] })),
    runWithSingleProfile: jest.fn(async () => ({ status: "approved", tracks: [{ trackId: track }] })),
    runWithMyMix: jest.fn(async (_input: unknown, plan: any) => ({ status: "approved", tracks: [
      { trackId: track, mixLaneId: plan.lanes[0].id, pick: { recommendation: { reasonCode: "discovery_pick" } } },
    ] })),
  };
  const runtime = new AgentRuntimeService(executor as any, { enabled: false } as any, undefined, bus);
  const input = (sessionId: string, preferences: any) => ({ sessionId, userId: user, preferences,
    recentTrackIds: [], budgetRemainingUsd: 0 });
  beforeAll(async () => {
    await prisma.user.create({ data: { id: user, email: `${user}@test.resonate` } });
    await prisma.artist.create({ data: { id: `${prefix}artist`, userId: user, displayName: "Fixture artist" } });
    await prisma.release.create({ data: { id: `${prefix}release`, artistId: `${prefix}artist`, title: "Fixture", genre: "Jazz", moods: ["Warm"], status: "published" } });
    await prisma.track.createMany({ data: [track, `${prefix}track2`].map((id) => ({ id, releaseId: `${prefix}release`, title: "Fixture" })) });
    await prisma.session.createMany({ data: sessions.map((id) => ({ id, userId: user, budgetCapUsd: 0 })) });
    await prisma.agentSignal.createMany({ data: sessions.map((sessionId) => ({ userId: user, sessionId, trackId: track, action: "complete", weight: 1.5 })) });
    bridge.onModuleInit();
  });
  afterAll(async () => {
    bridge.onModuleDestroy(); bus.destroy();
    if (originalExperiment === undefined) delete process.env.DISCOVERY_RANKER_EXPERIMENT;
    else process.env.DISCOVERY_RANKER_EXPERIMENT = originalExperiment;
    await prisma.analyticsEvent.deleteMany({ where: { OR: [{ actorId: pseudonymousAnalyticsActorId(user) }, { eventId: { startsWith: prefix } }] } });
    await prisma.agentSignal.deleteMany({ where: { userId: user } });
    await prisma.session.deleteMany({ where: { userId: user } });
    await prisma.track.deleteMany({ where: { id: { in: [track, `${prefix}track2`] } } });
    await prisma.release.deleteMany({ where: { id: `${prefix}release` } });
    await prisma.artist.deleteMany({ where: { id: `${prefix}artist` } });
    await prisma.user.deleteMany({ where: { id: user } });
  });

  it("records source and actual ordering for each arm, validating lanes before the control", async () => {
    const lanes = await resolveListeningLanes(user);
    expect(lanes).toHaveLength(1);
    for (const [arm, ordering] of [["my_mix_habits", "habit"], ["my_mix_lanes", "neutral"], ["single_profile", "single_profile"]]) {
      process.env.DISCOVERY_RANKER_EXPERIMENT = `habit-ledger:${arm}=100`;
      await runtime.run(input(`${prefix}${arm}`, { myMix: { lanes: [{ id: lanes[0].id }] } }));
      if (ordering !== "single_profile") expect(executor.runWithMyMix).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ orderingVariant: ordering }));
      else expect(executor.runWithSingleProfile).toHaveBeenCalled();
    }
    await expect(runtime.run(input(`${prefix}forged`, { myMix: { lanes: [{ id: "foreign" }] } }))).rejects.toThrow();
    delete process.env.DISCOVERY_RANKER_EXPERIMENT;
    await runtime.run(input(`${prefix}preset`, {}));
    await runtime.run(input(`${prefix}described`, { request: { genres: ["Jazz"] } }));
    let events = await ingest.listEvents();
    for (let attempt = 0; events.filter((event) => event.actorId === pseudonymousAnalyticsActorId(user) && event.eventName === "recommendation.generated").length < 7 && attempt < 100; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20)); events = await ingest.listEvents();
    }
    const impressions = events.filter((event) => event.actorId === pseudonymousAnalyticsActorId(user) && event.eventName === "recommendation.generated");
    expect(impressions).toHaveLength(7);
    expect(impressions.filter((event) => event.payload.agentSessionId === `${prefix}preset`)).toHaveLength(2);
    expect(impressions.map((event) => event.payload.orderingVariant)).toEqual(expect.arrayContaining(["habit", "neutral", "single_profile"]));
    expect(impressions.map((event) => event.payload.sessionSource)).toEqual(expect.arrayContaining(["my_mix", "preset", "described"]));
    for (const event of impressions) {
      expect(event.payload).toMatchObject({ trackId: expect.any(String), trackIds: [event.payload.trackId], surface: "dj" });
      expect(event.payload).not.toHaveProperty("userId");
      expect(event.payload).not.toHaveProperty("mixLaneId");
      expect(event.sourceRefs ?? {}).not.toHaveProperty("userId");
    }
    expect(impressions.find((event) => event.payload.rankerVariant === "my_mix_habits")?.payload.explorationPick).toBe(true);
  });

  it("aggregates seeded durable events into three source rows with bounded rates", async () => {
    const actorId = pseudonymousAnalyticsActorId(user)!;
    const baseTime = Date.now() - 60_000;
    for (const [index, source] of ["my_mix", "preset", "described"].entries()) {
      const sessionId = `${prefix}metric${index}`;
      const dimensions = { trackId: track, agentSessionId: sessionId };
      const events = [
        { eventName: "recommendation.generated", payload: { ...dimensions, sessionSource: source, surface: "dj", rankerVariant: "baseline", orderingVariant: "single_profile", explorationPick: true } },
        { eventName: "playback.started", payload: { ...dimensions, playbackInstanceId: sessionId } },
        { eventName: index === 1 ? "playback.skipped" : "playback.completed", payload: { ...dimensions, playbackInstanceId: sessionId, positionMs: index === 1 ? 10_000 : 180_000, durationMs: 180_000, completionRatio: index === 1 ? 0.05 : 1 } },
        { eventName: "library.saved", payload: { ...dimensions, surface: "dj" } },
        { eventName: "playlist.track_added", payload: { ...dimensions, surface: "dj" } },
      ];
      for (const [ordinal, event] of events.entries()) await ingest.ingest({ ...event, eventId: `${prefix}metric${index}_${ordinal}`, eventVersion: 1, occurredAt: new Date(baseTime + ordinal * 1000).toISOString(), actorId, sessionId: `${prefix}browser${index}`, privacyTier: "pseudonymous", producer: "web-app" });
    }
    const service = new AnalyticsService(ingest);
    const report = await service.getAgentQualityDashboard(1);
    expect(report.sessionSourceBreakdown).toHaveLength(3);
    const rows = new Map(report.sessionSourceBreakdown.map((row: any) => [row.sessionSource, row]));
    expect(rows.get("preset")).toMatchObject({ plays: 1, skips: 1, earlySkips: 1, skipRate: 1, resonanceRate: 1 });
    expect(rows.get("my_mix")).toMatchObject({ plays: 1, completions: 1, completionRate: 1, resonanceRate: 1 });
    expect(rows.get("described")).toMatchObject({ plays: 1, completions: 1 });
    expect(JSON.stringify(report.sessionSourceBreakdown)).not.toContain(actorId);
    expect(JSON.stringify(report.sessionSourceBreakdown)).not.toContain(prefix);
  });
});
