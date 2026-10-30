import { BadRequestException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AgentConfigController } from "../modules/agents/agent_config.controller";
import { AgentRuntimeService } from "../modules/agents/agent_runtime.service";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { resolveListeningLanes } from "../modules/agents/listening_lanes.service";
import { resolveRightNow } from "../modules/agents/agent_right_now";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";

/**
 * "Right now" (#2245), against a real database: a listener who plays jazz on
 * weekday evenings and electronic on weekday mornings gets a session with no
 * filters that leans on the habit of the time of day the client reports.
 */
const PREFIX = `right_now_${Date.now()}_`;
const OWNER = `${PREFIX}owner`;
const NEWCOMER = `${PREFIX}newcomer`;
const SESSION = `${PREFIX}session`;
const SESSIONS = {
  eveningA: `${PREFIX}evening_a`,
  eveningB: `${PREFIX}evening_b`,
  morningA: `${PREFIX}morning_a`,
  morningB: `${PREFIX}morning_b`,
};
const CATALOG_OWNER = `${PREFIX}catalog_owner`;
const CATALOG = [1, 2, 3].flatMap((n) => [
  { key: `jazz${n}`, genre: "Jazz", moods: ["Warm"] },
  { key: `electronic${n}`, genre: "Electronic", moods: ["Energetic"] },
]).map((entry) => ({
  ...entry,
  artist: `${PREFIX}artist_${entry.key}`,
  release: `${PREFIX}release_${entry.key}`,
  track: `${PREFIX}track_${entry.key}`,
  user: `${PREFIX}artist_user_${entry.key}`,
}));
const jazzTrackIds = CATALOG.filter((entry) => entry.genre === "Jazz").map((entry) => entry.track);
const electronicTrackIds = CATALOG.filter((entry) => entry.genre === "Electronic").map((entry) => entry.track);

describe("Right now (integration)", () => {
  const controller = new AgentConfigController({} as any, {} as any, {} as any, {} as any, { publish: jest.fn() } as any);

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: OWNER, email: `${OWNER}@test.resonate` },
        { id: NEWCOMER, email: `${NEWCOMER}@test.resonate` },
        { id: CATALOG_OWNER, email: `${CATALOG_OWNER}@test.resonate` },
        ...CATALOG.map((entry) => ({ id: entry.user, email: `${entry.user}@test.resonate` })),
      ],
    });
    await prisma.agentConfig.createMany({
      data: [
        { userId: OWNER, monthlyCapUsd: 10, isActive: false, vibes: ["Ambient"] },
        { userId: NEWCOMER, monthlyCapUsd: 10, isActive: false, vibes: ["Ambient"] },
      ],
    });
    await prisma.session.createMany({
      data: [SESSION, ...Object.values(SESSIONS)].map((id) => ({ id, userId: OWNER, budgetCapUsd: 10 })),
    });
    for (const entry of CATALOG) {
      await prisma.artist.create({
        data: {
          id: entry.artist,
          userId: entry.user,
          displayName: `Right Now ${entry.key}`,
          payoutAddress: "0x" + "D".repeat(40),
        },
      });
      await prisma.release.create({
        data: {
          id: entry.release,
          artistId: entry.artist,
          title: `Right Now ${entry.key}`,
          status: "published",
          genre: entry.genre,
          moods: entry.moods,
        },
      });
      await prisma.track.create({
        data: {
          id: entry.track,
          releaseId: entry.release,
          title: `Right Now ${entry.key}`,
          position: 1,
          processingStatus: "complete",
          contentStatus: "clean",
          explicit: false,
          aiDisclosureLevel: "NONE",
        },
      });
    }
    const signal = (sessionId: string, trackId: string, localHourBucket: string) => ({
      userId: OWNER,
      sessionId,
      trackId,
      action: "complete",
      weight: 1.5,
      metadata: { localHourBucket, weekdayKind: "weekday" },
    });
    await prisma.agentSignal.createMany({
      data: [
        signal(SESSIONS.eveningA, jazzTrackIds[0], "evening"),
        signal(SESSIONS.eveningB, jazzTrackIds[1], "evening"),
        signal(SESSIONS.morningA, electronicTrackIds[0], "morning"),
        signal(SESSIONS.morningB, electronicTrackIds[1], "morning"),
      ],
    });
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: OWNER } });
    await prisma.session.deleteMany({ where: { userId: OWNER } });
    await prisma.agentConfig.deleteMany({ where: { userId: { in: [OWNER, NEWCOMER] } } });
    await prisma.track.deleteMany({ where: { id: { in: CATALOG.map((entry) => entry.track) } } });
    await prisma.release.deleteMany({ where: { id: { in: CATALOG.map((entry) => entry.release) } } });
    await prisma.artist.deleteMany({ where: { id: { in: CATALOG.map((entry) => entry.artist) } } });
    await prisma.user.deleteMany({
      where: { id: { in: [OWNER, NEWCOMER, CATALOG_OWNER, ...CATALOG.map((entry) => entry.user)] } },
    });
  });

  const run = (userId: string, preferences: Record<string, unknown>) => {
    const executor = {
      run: jest.fn(async () => ({ status: "no_tracks", tracks: [], shortfall: 0 })),
      runWithMyMix: jest.fn(async () => ({ status: "no_tracks", tracks: [], shortfall: 0 })),
      // A seed-only session (a named artist, a seed track) is served by the selector (#2463).
      runDeterministic: jest.fn(async () => ({ status: "no_tracks", tracks: [], shortfall: 0 })),
    };
    const service = new AgentRuntimeService(executor as any, { enabled: false, required: false, run: jest.fn() } as any);
    return {
      executor,
      service,
      done: service.run({
        sessionId: SESSION,
        userId,
        recentTrackIds: [],
        budgetRemainingUsd: 10,
        preferences,
      } as any),
    };
  };

  const laneShare = (plan: any) =>
    Object.fromEntries(plan.lanes.map((lane: any) => [Object.keys(lane.genreWeights)[0], lane.requested]));

  it("reads the habit of each time of day from real history", async () => {
    const lanes = await resolveListeningLanes(OWNER);
    expect(lanes.map((lane) => Object.keys(lane.genreWeights)[0]).sort()).toEqual(["Electronic", "Jazz"]);
  });

  it("weights an evening session with no filters toward jazz, and a morning one toward electronic", async () => {
    const evening = run(OWNER, { genres: ["Ambient"], listeningContext: "evening:weekday" });
    await evening.done;
    expect(evening.executor.run).not.toHaveBeenCalled();
    const [eveningInput, eveningPlan] = evening.executor.runWithMyMix.mock.calls[0] as unknown as [any, any];
    expect(laneShare(eveningPlan).Jazz).toBeGreaterThan(laneShare(eveningPlan).Electronic);
    // Only the plan carries the bucket: the preferences handed on do not, and the run is no My Mix.
    expect(eveningInput.preferences).not.toHaveProperty("listeningContext");
    expect(eveningInput.preferences).not.toHaveProperty("myMix");
    expect(eveningPlan.context).toBe("evening:weekday");
    expect(evening.service.getInitialMixCoverage(OWNER, SESSION)).toBeUndefined();
    expect(evening.service.takeMyMixDemandObservations(OWNER, SESSION)).toEqual([]);

    const morning = run(OWNER, { genres: ["Ambient"], listeningContext: "morning:weekday" });
    await morning.done;
    const [, morningPlan] = morning.executor.runWithMyMix.mock.calls[0] as unknown as [any, any];
    expect(laneShare(morningPlan).Electronic).toBeGreaterThan(laneShare(morningPlan).Jazz);
  });

  it("selects tracks that lean on the time of day", async () => {
    const lanes = await resolveListeningLanes(OWNER);
    const selector = new AgentSelectorService(
      new ToolRegistry(new EmbeddingService(), new EmbeddingStore()),
      new DiscoveryRankingService(),
    );
    const pick = async (context: "evening:weekday" | "morning:weekday") => {
      const { plan } = resolveRightNow(lanes, context, 4);
      const selection = await selector.select({
        userId: OWNER,
        queries: ["Jazz", "Electronic", "Warm", "Energetic"],
        recentTrackIds: [],
        limit: 4,
        myMixPlan: plan,
      });
      return selection.selected.map((track: { id: string }) => track.id);
    };
    const evening = await pick("evening:weekday");
    const morning = await pick("morning:weekday");
    const count = (ids: string[], among: string[]) => ids.filter((id) => among.includes(id)).length;
    expect(count(evening, jazzTrackIds)).toBeGreaterThan(count(evening, electronicTrackIds));
    expect(count(morning, electronicTrackIds)).toBeGreaterThan(count(morning, jazzTrackIds));
  });

  it("keeps the saved vibes for a listener without enough history", async () => {
    const cold = run(NEWCOMER, { genres: ["Ambient"], listeningContext: "evening:weekday" });
    await cold.done;
    expect(cold.executor.runWithMyMix).not.toHaveBeenCalled();
    expect(cold.executor.run).toHaveBeenCalledTimes(1);
    const [input] = cold.executor.run.mock.calls[0] as unknown as [any];
    expect(input.preferences.genres).toEqual(["Ambient"]);
    expect(input.preferences).not.toHaveProperty("listeningContext");
  });

  it("keeps the saved vibes at a time of day the history does not cover", async () => {
    const weekend = run(OWNER, { genres: ["Ambient"], listeningContext: "night:weekend" });
    await weekend.done;
    expect(weekend.executor.runWithMyMix).not.toHaveBeenCalled();
    expect(weekend.executor.run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a genre of its own", { sessionGenres: ["Jazz"] }],
    ["a mood", { mood: "Warm" }],
    ["an energy", { energy: "high" }],
    ["a tempo", { tempoBpm: { min: 120, max: 130 } }],
    ["a sentence", { requestText: "something for cooking" }],
    ["a named artist", { artists: ["Right Now jazz1"] }],
    ["a seed track", { seedTrackId: "any" }],
    ["a described request", { request: { genres: ["Jazz"], moods: [], energy: null, bpm: null } }],
    ["a starter's intent", { sessionIntent: "Focus", sessionIntentName: "Focus" }],
  ])("does not weight by context a session with %s", async (_label, filters) => {
    const filtered = run(OWNER, { genres: ["Ambient"], listeningContext: "evening:weekday", ...filters });
    await filtered.done;
    expect(filtered.executor.runWithMyMix).not.toHaveBeenCalled();
    // One path serves the session: the runtime, or the selector for a seed-only request (#2463).
    const calls = [...filtered.executor.run.mock.calls, ...filtered.executor.runDeterministic.mock.calls];
    expect(calls).toHaveLength(1);
    // The request, not the habit, decides: no request scope is created or removed by the bucket.
    const [input] = calls[0] as unknown as [any];
    expect(input.preferences).not.toHaveProperty("listeningContext");
  });

  it("ignores a missing or invalid bucket", async () => {
    for (const listeningContext of [undefined, "lunch:weekday", "Europe/Paris", 7]) {
      const plain = run(OWNER, { genres: ["Ambient"], ...(listeningContext === undefined ? {} : { listeningContext }) });
      await plain.done;
      expect(plain.executor.runWithMyMix).not.toHaveBeenCalled();
      expect(plain.executor.run).toHaveBeenCalledTimes(1);
    }
  });

  it("leaves My Mix alone: its own plan wins over the bucket", async () => {
    const mix = run(OWNER, { myMix: {}, listeningContext: "evening:weekday" });
    await mix.done;
    expect(mix.executor.runWithMyMix).toHaveBeenCalledTimes(1);
    // The plan is the one My Mix resolved from its own preferences (it sent no bucket) ...
    const [, plan] = mix.executor.runWithMyMix.mock.calls[0] as unknown as [any, any];
    expect(plan.context).toBeUndefined();
    // ... and only a My Mix session keeps coverage for its surface.
    expect(mix.service.getInitialMixCoverage(OWNER, SESSION)).toBeDefined();
  });

  describe("the reason", () => {
    const req = (userId: string) => ({ user: { userId } });

    it("names the genres the listener usually plays at this time", async () => {
      await expect(controller.getRightNow(req(OWNER), "evening:weekday")).resolves.toEqual({
        status: "ready",
        context: "evening:weekday",
        highlights: ["Jazz"],
      });
      await expect(controller.getRightNow(req(OWNER), "morning:weekday")).resolves.toEqual({
        status: "ready",
        context: "morning:weekday",
        highlights: ["Electronic"],
      });
    });

    it("says so on a cold start and never reads another listener's history", async () => {
      await expect(controller.getRightNow(req(NEWCOMER), "evening:weekday")).resolves.toEqual({
        status: "cold_start",
        context: "evening:weekday",
        reason: "no_history",
      });
      await expect(controller.getRightNow(req(OWNER), "night:weekend")).resolves.toMatchObject({
        status: "cold_start",
        reason: "no_context_history",
      });
    });

    it("rejects anything but one of the eight buckets", async () => {
      for (const context of [undefined, "", "lunch:weekday", "Europe/Paris", "2026-10-24T18:00:00Z"]) {
        await expect(controller.getRightNow(req(OWNER), context)).rejects.toBeInstanceOf(BadRequestException);
      }
    });
  });
});
