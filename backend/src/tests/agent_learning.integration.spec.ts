import { prisma } from "../db/prisma";
import { AgentLearningService } from "../modules/agents/agent_learning.service";

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
  });

  afterAll(async () => {
    await prisma.agentSignal.deleteMany({ where: { userId: `${TEST_PREFIX}user` } });
    await prisma.agentConfig.deleteMany({ where: { userId: `${TEST_PREFIX}user` } });
    await prisma.track.deleteMany({ where: { id: `${TEST_PREFIX}track` } });
    await prisma.release.deleteMany({ where: { id: `${TEST_PREFIX}release` } });
    await prisma.artist.deleteMany({ where: { id: `${TEST_PREFIX}artist` } });
    await prisma.user.deleteMany({ where: { id: `${TEST_PREFIX}user` } });
  });

  it("persists signals and updates AgentConfig taste profile", async () => {
    const profile = await service.recordSignal({
      userId: `${TEST_PREFIX}user`,
      trackId: `${TEST_PREFIX}track`,
      action: "purchase",
      metadata: { source: "integration_test" },
    });

    expect(profile.favoredGenres).toEqual(["Deep House"]);
    expect(profile.score).toBeGreaterThan(0);

    const signals = await prisma.agentSignal.findMany({
      where: { userId: `${TEST_PREFIX}user` },
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].weight).toBe(5);

    const config = await prisma.agentConfig.findUnique({
      where: { userId: `${TEST_PREFIX}user` },
    });
    expect(config?.tasteScore).toBe(profile.score);
    expect(config?.learnedTasteProfile).toMatchObject({
      schemaVersion: "agent-taste-profile/v1",
      favoredGenres: ["Deep House"],
    });
  });
});
