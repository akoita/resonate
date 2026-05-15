import { prisma } from "../db/prisma";
import { AgentAudioFeatureService } from "../modules/agents/agent_audio_feature.service";

const TEST_PREFIX = `agaf_${Date.now()}_`;

describe("AgentAudioFeatureService (integration)", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: `${TEST_PREFIX}user`, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: `${TEST_PREFIX}user`,
        displayName: "Feature Artist",
        payoutAddress: `0x${"A".repeat(40)}`,
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        title: "Feature Release",
        artistId: `${TEST_PREFIX}artist`,
        status: "published",
        genre: "Techno",
      },
    });
    await prisma.track.create({
      data: {
        id: `${TEST_PREFIX}track`,
        title: "Heavy Club Kicks",
        releaseId: `${TEST_PREFIX}release`,
        position: 1,
      },
    });
    await prisma.stem.create({
      data: {
        id: `${TEST_PREFIX}stem`,
        trackId: `${TEST_PREFIX}track`,
        type: "drums",
        uri: "local://drums.mp3",
        durationSeconds: 123,
      },
    });
  });

  afterAll(async () => {
    await prisma.stem.deleteMany({ where: { trackId: `${TEST_PREFIX}track` } }).catch(() => {});
    await prisma.track.delete({ where: { id: `${TEST_PREFIX}track` } }).catch(() => {});
    await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: `${TEST_PREFIX}user` } }).catch(() => {});
  });

  it("derives and persists metadata-backed audio features", async () => {
    const service = new AgentAudioFeatureService();

    const result = await service.getOrCreate(`${TEST_PREFIX}track`);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.features.energyBand).toBe("high");
      expect(result.features.durationSeconds).toBe(123);
      expect(result.features.source).toBe("metadata_inferred");
      expect(result.features.warnings).toContain("fingerprint_unavailable");
    }

    const track = await prisma.track.findUnique({
      where: { id: `${TEST_PREFIX}track` },
      select: { generationMetadata: true },
    });
    expect(track?.generationMetadata).toEqual(expect.objectContaining({
      agentAudioFeatures: expect.objectContaining({
        schemaVersion: "agent-audio-features/v1",
      }),
    }));
  });

  it("fails gracefully when the track is missing", async () => {
    const service = new AgentAudioFeatureService();

    await expect(service.getOrCreate(`${TEST_PREFIX}missing`)).resolves.toEqual({
      status: "failed",
      trackId: `${TEST_PREFIX}missing`,
      reason: "track_not_found",
    });
  });
});
