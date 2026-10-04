import { BadRequestException, NotFoundException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { AgentConfigController } from "../modules/agents/agent_config.controller";
import { AgentRuntimeService } from "../modules/agents/agent_runtime.service";
import { resolveListeningLanes } from "../modules/agents/listening_lanes.service";
import { resolveMyMixPlan } from "../modules/agents/agent_my_mix";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { ToolRegistry } from "../modules/agents/tools/tool_registry";
import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";

const PREFIX = `my_mix_controller_${Date.now()}_`;
const OWNER = `${PREFIX}owner`;
const OTHER = `${PREFIX}other`;
const SESSION = `${PREFIX}session`;
const HISTORY_SESSIONS = [`${PREFIX}history_1`, `${PREFIX}history_2`];
const ARTIST = `${PREFIX}artist`;
const RELEASE = `${PREFIX}release`;
const TRACK = `${PREFIX}track`;

describe("AgentConfigController My Mix boundaries (integration)", () => {
  const coverage = {
    lanes: [{ id: "lane_private", label: "Soul · Warm", requested: 2, matched: 1 }],
  };
  const runtime = {
    getInitialMixCoverage: jest.fn().mockReturnValue(coverage),
    getMyMixTrackOrder: jest.fn().mockReturnValue([TRACK]),
    clearMyMixSession: jest.fn(),
    run: jest.fn(),
  };
  const controller = new AgentConfigController(
    {} as any,
    runtime as any,
    {} as any,
    {} as any,
    { publish: jest.fn() } as any,
  );

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: OWNER, email: `${OWNER}@test.resonate` },
        { id: OTHER, email: `${OTHER}@test.resonate` },
      ],
    });
    await prisma.agentConfig.create({
      data: { userId: OWNER, monthlyCapUsd: 10, isActive: false },
    });
    await prisma.session.create({ data: { id: SESSION, userId: OWNER, budgetCapUsd: 10 } });
    await prisma.session.createMany({
      data: HISTORY_SESSIONS.map((id) => ({ id, userId: OWNER, budgetCapUsd: 10 })),
    });
    await prisma.artist.create({
      data: {
        id: ARTIST,
        userId: OTHER,
        displayName: "My Mix Test Artist",
        payoutAddress: "0x" + "D".repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: RELEASE,
        artistId: ARTIST,
        title: "My Mix Test Release",
        status: "published",
        genre: "Jazz",
        moods: ["Warm"],
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK,
        releaseId: RELEASE,
        title: "My Mix Test Track",
        position: 1,
        processingStatus: "complete",
        contentStatus: "clean",
        explicit: false,
        aiDisclosureLevel: "NONE",
      },
    });
    await prisma.agentSignal.createMany({
      data: HISTORY_SESSIONS.map((sessionId) => ({
        userId: OWNER,
        sessionId,
        trackId: TRACK,
        action: "complete",
        weight: 1.5,
      })),
    });
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: OWNER } });
    await prisma.session.deleteMany({ where: { userId: { in: [OWNER, OTHER] } } });
    await prisma.agentConfig.deleteMany({ where: { userId: OWNER } });
    await prisma.track.deleteMany({ where: { id: TRACK } });
    await prisma.release.deleteMany({ where: { id: RELEASE } });
    await prisma.artist.deleteMany({ where: { id: ARTIST } });
    await prisma.user.deleteMany({ where: { id: { in: [OWNER, OTHER] } } });
  });

  it("returns cached initial coverage only for the owning listener", async () => {
    await expect(controller.getMixCoverage({ user: { userId: OWNER } }, SESSION))
      .resolves.toEqual({ mixCoverage: coverage });
    expect(runtime.getInitialMixCoverage).toHaveBeenCalledWith(OWNER, SESSION);

    runtime.getInitialMixCoverage.mockClear();
    await expect(controller.getMixCoverage({ user: { userId: OTHER } }, SESSION))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(runtime.getInitialMixCoverage).not.toHaveBeenCalled();
  });

  it("exposes ordered initial batch IDs only through owner-scoped history", async () => {
    runtime.getMyMixTrackOrder.mockClear();
    const history = await controller.getHistory({ user: { userId: OWNER } });
    expect(history.find((row) => row.id === SESSION)).toHaveProperty("mixTrackIds", [TRACK]);
    expect(runtime.getMyMixTrackOrder).toHaveBeenCalledWith(OWNER, SESSION);
    runtime.getMyMixTrackOrder.mockClear();
    expect(await controller.getHistory({ user: { userId: OTHER } })).toEqual([]);
    expect(runtime.getMyMixTrackOrder).not.toHaveBeenCalled();
  });

  it("rejects malformed or foreign lane selections before creating or activating a session", async () => {
    const before = await prisma.session.count({ where: { userId: OWNER } });

    await expect(controller.startSession(
      { user: { userId: OWNER } },
      { preferences: { myMix: { lanes: [{ id: "lane_from_another_user" }] } } },
    )).rejects.toBeInstanceOf(BadRequestException);

    expect(await prisma.session.count({ where: { userId: OWNER } })).toBe(before);
    expect((await prisma.agentConfig.findUniqueOrThrow({ where: { userId: OWNER } })).isActive).toBe(false);
    expect(runtime.run).not.toHaveBeenCalled();
  });

  it("resolves real listener history at runtime and selects an exact catalog lane", async () => {
    const lanes = await resolveListeningLanes(OWNER);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({ label: "Jazz · Warm", genreWeights: { Jazz: expect.any(Number) } });
    const plan = resolveMyMixPlan({}, lanes, 1)!;

    const selector = new AgentSelectorService(
      new ToolRegistry(new EmbeddingService(), new EmbeddingStore()),
      new DiscoveryRankingService(),
    );
    const selected = await selector.select({
      userId: OWNER,
      queries: ["Jazz", "Warm"],
      recentTrackIds: [],
      limit: 1,
      myMixPlan: plan,
    });
    expect(selected.selected[0]?.mixLaneId).toBe(lanes[0].id);
    expect(selected.selected[0]?.agentRecommendation?.explanation[0]).toBe(
      "Selected for your Jazz · Warm mix.",
    );
    expect(selected.mixCoverage?.lanes[0]).toMatchObject({ id: lanes[0].id, requested: 1, matched: 1 });

    const executor = {
      run: jest.fn(),
      runWithMyMix: jest.fn(async (_input: unknown, resolvedPlan: any) => ({
        status: "approved",
        tracks: [{ trackId: TRACK, mixLaneId: resolvedPlan.lanes[0].id }],
        mixCoverage: {
          lanes: resolvedPlan.lanes.map((lane: any) => ({
            id: lane.id,
            label: lane.label,
            requested: lane.requested,
            matched: lane.id === resolvedPlan.lanes[0].id ? 1 : 0,
          })),
        },
      })),
    };
    const remote = { enabled: true, required: true, run: jest.fn() };
    const runtimeService = new AgentRuntimeService(executor as any, remote as any);
    await runtimeService.run({
      sessionId: SESSION,
      userId: OWNER,
      recentTrackIds: [],
      budgetRemainingUsd: 1,
      preferences: { myMix: { lanes: [{ id: lanes[0].id, label: "untrusted label" }] } },
      myMixPlan: { lanes: [{ id: "attacker", label: "Forged lane" }] },
    } as any);

    expect(remote.run).not.toHaveBeenCalled();
    expect(executor.run).not.toHaveBeenCalled();
    expect(executor.runWithMyMix).toHaveBeenCalledWith(
      expect.objectContaining({ preferences: {} }),
      expect.objectContaining({ lanes: [expect.objectContaining({ id: lanes[0].id, requested: expect.any(Number) })] }),
    );
    expect(runtimeService.getInitialMixCoverage(OWNER, SESSION)?.lanes[0]).toMatchObject({
      id: lanes[0].id,
      label: "Jazz · Warm",
      matched: 1,
    });
    expect(runtimeService.getMyMixTrackOrder(OWNER, SESSION)).toEqual([TRACK]);
    const snapshot = runtimeService.getMyMixTrackOrder(OWNER, SESSION)!;
    snapshot.push("tampered");
    expect(runtimeService.getMyMixTrackOrder(OWNER, SESSION)).toEqual([TRACK]);
    expect(runtimeService.getMyMixTrackOrder(OTHER, SESSION)).toBeUndefined();
    expect(runtimeService.takeMyMixDemandObservations(OWNER, SESSION)[0]).toMatchObject({
      genres: ["Jazz"],
      moods: [],
    });
    runtimeService.clearMyMixSession(OWNER, SESSION);
    expect(runtimeService.getMyMixTrackOrder(OWNER, SESSION)).toBeUndefined();
  });
});
