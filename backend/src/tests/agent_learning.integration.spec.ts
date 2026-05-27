import { prisma } from "../db/prisma";
import { AgentLearningService, buildAgentSignalMetadata } from "../modules/agents/agent_learning.service";

const TEST_PREFIX = `aglearn_${Date.now()}_`;

describe("AgentLearningService (integration)", () => {
  const service = new AgentLearningService();

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: "Learning Artist",
        payoutAddress: `0x${"a".repeat(40)}`,
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: `${TEST_PREFIX}artist`,
        title: "Learning Release",
        genre: "Deep House",
        status: "published",
      },
    });
    await prisma.track.create({
      data: {
        id: `${TEST_PREFIX}track`,
        releaseId: `${TEST_PREFIX}release`,
        title: "Learning Track",
        position: 1,
      },
    });
    await prisma.agentConfig.create({
      data: {
        userId: `${TEST_PREFIX}user`,
        name: "Learning DJ",
        vibes: ["Ambient"],
        monthlyCapUsd: 10,
      },
    });
    await prisma.session.create({
      data: {
        id: `${TEST_PREFIX}session`,
        userId: `${TEST_PREFIX}user`,
        budgetCapUsd: 10,
      },
    });
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: `${TEST_PREFIX}user` } });
    await prisma.agentConfig.deleteMany({ where: { userId: `${TEST_PREFIX}user` } });
    await prisma.session.deleteMany({ where: { userId: `${TEST_PREFIX}user` } });
    await prisma.track.deleteMany({ where: { id: `${TEST_PREFIX}track` } });
    await prisma.release.deleteMany({ where: { id: `${TEST_PREFIX}release` } });
    await prisma.artist.deleteMany({ where: { id: `${TEST_PREFIX}artist` } });
    await prisma.user.deleteMany({ where: { id: `${TEST_PREFIX}user` } });
  });

  it("persists signals and updates AgentConfig taste profile", async () => {
    const profile = await service.recordSignal({
      userId: `${TEST_PREFIX}user`,
      sessionId: `${TEST_PREFIX}session`,
      trackId: `${TEST_PREFIX}track`,
      action: "complete",
      metadata: buildAgentSignalMetadata({
        source: "agent_session",
        sessionIntent: "focus",
        sessionIntentName: "Neural Flow",
        mood: "Focus",
        energy: "low",
        genres: ["Ambient", "Deep House"],
        outcome: {
          type: "playback_completed",
          completionRatio: 0.9,
          durationMs: 120000,
        },
      }),
    });

    expect(profile.favoredGenres).toEqual(["Deep House"]);
    expect(profile.score).toBeGreaterThan(0);

    const signals = await prisma.agentSignal.findMany({
      where: { userId: `${TEST_PREFIX}user` },
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].weight).toBe(1.5);
    expect(signals[0].metadata).toMatchObject({
      schemaVersion: "agent-signal-metadata/v1",
      sessionIntent: "focus",
      mood: "Focus",
      outcome: {
        type: "playback_completed",
        completionRatio: 0.9,
      },
    });

    const config = await prisma.agentConfig.findUnique({
      where: { userId: `${TEST_PREFIX}user` },
    });
    expect(config?.tasteScore).toBe(profile.score);
    expect(config?.learnedTasteProfile).toMatchObject({
      schemaVersion: "agent-taste-profile/v1",
      favoredGenres: ["Deep House"],
    });
  });

  it("annotates existing session signals with session outcome context", async () => {
    await service.annotateSessionOutcome({
      userId: `${TEST_PREFIX}user`,
      sessionId: `${TEST_PREFIX}session`,
      outcome: {
        type: "ended",
        sessionDurationMs: 300000,
        status: "stopped",
      },
    });

    const signal = await prisma.agentSignal.findFirstOrThrow({
      where: {
        userId: `${TEST_PREFIX}user`,
        sessionId: `${TEST_PREFIX}session`,
      },
    });
    expect(signal.metadata).toMatchObject({
      schemaVersion: "agent-signal-metadata/v1",
      sessionIntent: "focus",
      outcome: {
        type: "ended",
        completionRatio: 0.9,
        sessionDurationMs: 300000,
        status: "stopped",
      },
    });
  });
});
